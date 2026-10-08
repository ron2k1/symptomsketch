import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ViduS2AvatarModel,
  type ViduS2AvatarSessionStateMessage,
} from "@reactor-models/vidu-s2-avatar/core";
import { paths, SUPPORT_CALL_AGENT_NAME } from "@symptomsketch/contracts";
import {
  createSupportCallToken,
  errorMessage,
  fetchSupportCallPortrait,
  getSupportCallBrief,
  saveSupportCallAvatar,
} from "@/lib/api";
import { SamPrep, type PrepPortrait, type SamPrepView } from "./sam-prep";

const AVATAR_READY_TIMEOUT_MS = 120_000;
const DISCONNECT_WAIT_MS = 5_000;

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Prep stopped."));
    const onAbort = () => reject(new Error("Prep stopped."));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Hidden Reactor session that only builds the avatar: the same token route, upload and
 * create_avatar the call uses, then disconnect. No call is started, no media is attached.
 */
async function buildAvatarOnReactor(
  ticketId: string,
  portrait: PrepPortrait,
  signal: AbortSignal,
): Promise<{ avatarId: string; avatarMs: number }> {
  const token = await abortable(createSupportCallToken(ticketId), signal);
  const model = new ViduS2AvatarModel();
  let state: ViduS2AvatarSessionStateMessage | null = null;
  let commandError: string | null = null;
  const wakers = new Set<() => void>();
  const offState = model.onSessionState((s) => {
    state = s;
    for (const w of [...wakers]) w();
  });
  const offError = model.onCommandError((e) => {
    if (e.command === "create_avatar" || e.command === "session") commandError = e.code;
    for (const w of [...wakers]) w();
  });
  try {
    await abortable(model.connect(token.jwt), signal);
    if (model.getStatus() !== "ready") throw new Error("The avatar service did not get ready.");
    const image = await abortable(
      model.uploadFile(portrait.blob, { name: "support-agent.jpg" }),
      signal,
    );
    const started = performance.now();
    await abortable(model.createAvatar({ image, name: SUPPORT_CALL_AGENT_NAME }), signal);
    const avatarId = await abortable(
      new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          wakers.delete(check);
          reject(new Error("create_avatar timed out"));
        }, AVATAR_READY_TIMEOUT_MS);
        const check = () => {
          const s = state as ViduS2AvatarSessionStateMessage | null;
          if (s?.phase === "avatar_ready" && s.avatar_id) {
            wakers.delete(check);
            window.clearTimeout(timer);
            resolve(s.avatar_id);
          } else if (commandError) {
            wakers.delete(check);
            window.clearTimeout(timer);
            reject(new Error(`create_avatar ${commandError}`));
          }
        };
        wakers.add(check);
        check();
      }),
      signal,
    );
    const avatarMs = Math.round(performance.now() - started);
    console.info(`[sam-prep] create_avatar ready ms=${avatarMs}`);
    return { avatarId, avatarMs };
  } finally {
    offState();
    offError();
    // Billing runs while connected: release the prep session at once, bounded.
    void Promise.race([
      model.disconnect().catch(() => undefined),
      new Promise((r) => window.setTimeout(r, DISCONNECT_WAIT_MS)),
    ]);
  }
}

/** One prep for the whole page, so a remount or a second panel never opens a second session. */
export const samPrep = new SamPrep({
  getBrief: (ticketId, signal) => getSupportCallBrief(ticketId, { signal }),
  getPortrait: (ticketId, signal) =>
    fetchSupportCallPortrait(paths.ticketSupportCallPortrait(ticketId), { signal }),
  buildAvatar: async (ticketId, portrait, signal) => {
    try {
      return await buildAvatarOnReactor(ticketId, portrait, signal);
    } catch (err) {
      throw new Error(errorMessage(err) || (err instanceof Error ? err.message : "Prep failed."));
    }
  },
  saveAvatar: async (ticketId, avatarId, portraitSource) => {
    await saveSupportCallAvatar(ticketId, { avatarId, portraitSource });
  },
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          reject(new Error("Prep stopped."));
        },
        { once: true },
      );
    }),
});

/** Starts prep for this ticket once mounted; returns the live view and a 1 s clock for elapsed. */
export function useSamPrep(ticketId: string | null): { view: SamPrepView; now: number } {
  const view = useSyncExternalStore(
    (cb) => samPrep.subscribe(cb),
    () => samPrep.current,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ticketId) samPrep.start(ticketId);
  }, [ticketId]);
  const preparing = view.phase === "preparing";
  useEffect(() => {
    if (!preparing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preparing]);
  return { view, now };
}
