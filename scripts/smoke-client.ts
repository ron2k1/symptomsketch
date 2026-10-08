import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

/**
 * SMOKE TEST helpers (never imported by the app). A cookie-keeping JSON client that behaves like
 * the browser (same-origin Origin header on writes) and ffmpeg makers for clearly labeled
 * SYNTHETIC take recordings. Output is limited to statuses, ids and short fields: no bodies of
 * failed requests beyond the bounded error code, never a code, key, cookie or JWT.
 */

export class SmokeFailure extends Error {}

export interface Res<T> {
  status: number;
  body: T;
  headers: Headers;
}

export function key(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function sha256(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export class Client {
  private cookie: string | null = null;

  readonly base: string;
  readonly name: string;

  constructor(base: string, name: string) {
    this.base = base;
    this.name = name;
  }

  private headers(extra: Record<string, string>, write: boolean): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.cookie) h.cookie = this.cookie;
    if (write) h.origin = this.base;
    return h;
  }

  private keepCookie(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      if (pair.startsWith("ss_session=")) this.cookie = pair;
    }
  }

  async raw(
    method: string,
    path: string,
    init: { body?: string | FormData; headers?: Record<string, string> } = {},
  ) {
    const write = method !== "GET" && method !== "HEAD";
    const res = await fetch(this.base + path, {
      method,
      body: init.body,
      headers: this.headers(init.headers ?? {}, write),
    });
    this.keepCookie(res);
    return res;
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<Res<T>> {
    const res = await this.raw(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { "content-type": "application/json" },
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : (undefined as T);
    return { status: res.status, body: parsed, headers: res.headers };
  }

  /** Request that must return one of `ok`; on anything else throws with status + error code only. */
  async expect<T>(method: string, path: string, ok: number[], body?: unknown): Promise<Res<T>> {
    const res = await this.json<T>(method, path, body);
    if (!ok.includes(res.status)) {
      const code = (res.body as { code?: unknown } | undefined)?.code;
      throw new SmokeFailure(
        `${this.name} ${method} ${path} -> ${res.status} ${typeof code === "string" ? code : ""}`,
      );
    }
    return res;
  }

  async bytes(path: string, headers: Record<string, string> = {}) {
    const res = await this.raw("GET", path, { headers });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, buf, headers: res.headers };
  }
}

async function runFfmpeg(args: string[], out: string, ffmpegPath: string): Promise<string> {
  const child = spawn(ffmpegPath, ["-hide_banner", "-nostdin", "-v", "error", ...args, "pipe:1"], {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await pipeline(child.stdout, createWriteStream(out));
  const code = await exited;
  if (code !== 0) throw new SmokeFailure(`ffmpeg exited ${code}`);
  return out;
}

const WEBM_OUT = ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8"];

/**
 * SYNTHETIC: 1 s solid lead-in (the waiting phase) + 7 s ffmpeg testsrc2. Written through a pipe
 * so, like MediaRecorder output, the WebM has no duration header.
 */
export function makeTestsrcWebm(out: string, ffmpegPath: string): Promise<string> {
  const graph =
    "color=c=black:s=1280x720:r=24:d=1[a];testsrc2=s=1280x720:r=24:d=7[b];" +
    "[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]";
  return runFfmpeg(
    ["-filter_complex", graph, "-map", "[v]", ...WEBM_OUT, "-b:v", "1500k", "-f", "webm"],
    out,
    ffmpegPath,
  );
}

/**
 * SYNTHETIC: the robot-vacuum fixture photo as a still scene (vacuum stopped); at 3 s the patch
 * holding the vacuum (crop margins keep the original covered) jerks 80 px back once, then holds.
 * Crop coordinates are specific to assets/demo/demo-vacuum.jpg. A stand-in for generated output so
 * the critic has real motion to judge; it is never presented as Reactor output.
 */
export function makePhotoMotionWebm(out: string, photo: string, ffmpegPath: string) {
  const x = "300-if(lt(t,3),0,if(lt(t,3.25),(t-3)*320,80))";
  const graph =
    "[0:v]scale=1280:-2,split[a][b];[a]crop=1280:720:0:100[bg];[b]crop=760:360:300:430[fg];" +
    `[bg][fg]overlay=x='${x}':y=330:shortest=1,format=yuv420p[v]`;
  const input = ["-loop", "1", "-framerate", "24", "-t", "8", "-i", photo];
  const output = ["-map", "[v]", ...WEBM_OUT, "-b:v", "1500k", "-f", "webm"];
  return runFfmpeg([...input, "-filter_complex", graph, ...output], out, ffmpegPath);
}
