// One MiniMax FastH3 session on Reactor (generic @reactor-team/js-sdk 3.1 with wire name
// reactor/fast-h3; docs/providers/reactor-fast-h3.md). Owns the Reactor client, the single
// MediaStream (main_video + main_audio) and the message normalization. One instance per token:
// disconnect() ends the session for good, there is no reconnect loop.
import { Reactor, type FileRef, type ReactorMessage } from "@reactor-team/js-sdk";
import { FAST_H3_MODEL_NAME } from "@symptomsketch/contracts";
import type { ClipRecord } from "./story-state";

const TRACKS = [
  { name: "main_video", kind: "video" as const, direction: "recvonly" as const },
  { name: "main_audio", kind: "audio" as const, direction: "recvonly" as const },
];

export type FastH3Status = "disconnected" | "connecting" | "waiting" | "ready";

/** A message from the model, normalized: `{type, data}` envelopes are unwrapped. */
export interface FastH3Message {
  type: string;
  body: Record<string, unknown>;
}

export interface FastH3Handlers {
  status?: (s: FastH3Status) => void;
  message?: (m: FastH3Message) => void;
  /** Fires when the set of received tracks changes; `stream` holds every track so far. */
  tracks?: (stream: MediaStream, names: string[]) => void;
  /** SDK-level failure; `code` only (never a provider message). */
  error?: (code: string) => void;
}

export interface EnqueueParams {
  prompt: string;
  seconds: number;
  metadata: string;
  position?: number;
  startingFrame?: FileRef;
  continueFromClipId?: string;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function unwrap(raw: ReactorMessage | { type?: unknown; data?: unknown }): FastH3Message {
  const env = asObject(raw);
  const type = typeof env.type === "string" ? env.type : "unknown";
  const data = asObject(env.data);
  return { type, body: Object.keys(data).length > 0 ? data : env };
}

/** A clip record from any clip-referencing message (`clip` field or the body itself). */
export function clipOf(body: Record<string, unknown>): ClipRecord | null {
  const c = asObject(body.clip ?? body);
  const id = c.clip_id ?? c.id;
  if (typeof id !== "string" || !id) return null;
  return {
    clipId: id,
    prompt: typeof c.prompt === "string" ? c.prompt : undefined,
    metadata: typeof c.metadata === "string" ? c.metadata : undefined,
    seconds: typeof c.seconds === "number" ? c.seconds : undefined,
    ready: typeof c.ready === "boolean" ? c.ready : undefined,
  };
}

export function clipList(v: unknown): ClipRecord[] {
  return Array.isArray(v)
    ? v.map((x) => clipOf(asObject(x))).filter((c): c is ClipRecord => !!c)
    : [];
}

export function numberOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export class FastH3Session {
  readonly reactor = new Reactor({ modelName: FAST_H3_MODEL_NAME, modelTracks: TRACKS });
  private readonly tracks = new Map<string, MediaStreamTrack>();
  private stream = new MediaStream();
  private closed = false;
  private readonly offs: Array<() => void> = [];

  constructor(handlers: FastH3Handlers) {
    const r = this.reactor;
    const status = (s: FastH3Status) => !this.closed && handlers.status?.(s);
    const message = (m: ReactorMessage) => !this.closed && handlers.message?.(unwrap(m));
    const error = (e: { code?: string }) =>
      !this.closed && handlers.error?.(e.code ?? "REACTOR_ERROR");
    const track = (name: string, t: MediaStreamTrack) => {
      if (this.closed || (name !== "main_video" && name !== "main_audio")) return;
      this.tracks.set(name, t);
      // One MediaStream on one <video>: video + audio stay in sync and MediaRecorder sees both.
      this.stream = new MediaStream([...this.tracks.values()]);
      handlers.tracks?.(this.stream, [...this.tracks.keys()]);
    };
    r.on("statusChanged", status);
    r.on("message", message);
    r.on("error", error);
    r.on("trackReceived", track);
    this.offs.push(
      () => r.off("statusChanged", status),
      () => r.off("message", message),
      () => r.off("error", error),
      () => r.off("trackReceived", track),
    );
  }

  get mediaStream(): MediaStream {
    return this.stream;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async connect(jwt: string): Promise<void> {
    await this.reactor.connect(jwt);
  }

  /** Send one command; resolves the correlated reply (3.x) normalized, or null. */
  async command(name: string, data: Record<string, unknown> = {}): Promise<FastH3Message | null> {
    if (this.closed) return null;
    const reply = await this.reactor.sendCommand(name, data);
    return reply ? unwrap(reply) : null;
  }

  /** Session defaults for a story: 16:9, hold the last frame between scenes, explicit play. */
  async configure(seconds: number): Promise<void> {
    await this.command("set_canvas", { aspect: "16:9" });
    await this.command("set_flush_on_clip_end", { enabled: false });
    await this.command("set_autoplay", { enabled: false });
    await this.command("set_clip_seconds", { seconds });
  }

  uploadFile(blob: Blob): Promise<FileRef> {
    return this.reactor.uploadFile(blob);
  }

  /** Enqueue one scene; resolves the clip FastH3 queued (clip_queued reply) or null. */
  async enqueue(p: EnqueueParams): Promise<ClipRecord | null> {
    const data: Record<string, unknown> = {
      prompt: p.prompt,
      seconds: p.seconds,
      metadata: p.metadata,
    };
    if (p.position !== undefined) data.position = p.position;
    if (p.startingFrame) data.starting_frame = p.startingFrame;
    if (p.continueFromClipId) data.continue_from_clip_id = p.continueFromClipId;
    const reply = await this.command("enqueue", data);
    return reply ? clipOf(reply.body) : null;
  }

  play(clipId: string) {
    return this.command("play", { clip_id: clipId });
  }

  pop(clipId: string) {
    return this.command("pop", { clip_id: clipId });
  }

  move(clipId: string, position: number) {
    return this.command("move", { clip_id: clipId, position });
  }

  /** End the session server-side. Idempotent; the instance is unusable afterwards. */
  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.offs.splice(0)) off();
    try {
      await this.reactor.disconnect();
    } catch {
      // already gone
    }
  }
}
