// Records the story client-side from the ONE FastH3 MediaStream (main_video + main_audio), so the
// reel support sees is exactly what played, with its generated sound. The recorder runs only
// while a scene is on stage (paused between scenes), and the last frame is kept as a PNG.
import { useCallback, useEffect, useRef, useState } from "react";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export interface StoryRecording {
  reel: Blob | null;
  frame: Blob | null;
  mime: string;
  durationMs: number;
  /** Why there is no reel, when there is none. */
  problem: string | null;
}

export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

function grabFrame(video: HTMLVideoElement | null): Promise<Blob | null> {
  if (!video || video.videoWidth === 0) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const g = canvas.getContext("2d");
  if (!g) return Promise.resolve(null);
  g.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function useStoryRecorder(stream: MediaStream | null, playingId: string | null) {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const playMs = useRef(0);
  const playStart = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [result, setResult] = useState<StoryRecording | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Start once both tracks are in the stream (paused until the first scene plays).
  useEffect(() => {
    if (!stream || recRef.current) return;
    const kinds = new Set(stream.getTracks().map((t) => t.kind));
    if (!kinds.has("video") || !kinds.has("audio")) return;
    const mime = pickRecorderMime();
    if (!mime) return;
    try {
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.start(1000);
      rec.pause();
      recRef.current = rec;
      setRecording(true);
    } catch {
      recRef.current = null;
    }
  }, [stream]);

  // Record only while a scene plays.
  useEffect(() => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    if (playingId && rec.state === "paused") {
      rec.resume();
      playStart.current = performance.now();
    } else if (!playingId && rec.state === "recording") {
      rec.pause();
      if (playStart.current !== null) playMs.current += performance.now() - playStart.current;
      playStart.current = null;
    }
  }, [playingId, recording]);

  /** Stop recording and keep the last frame. Call before the session disconnects. */
  const finish = useCallback((video: HTMLVideoElement | null) => {
    setFinishing(true);
    const framePromise = grabFrame(video);
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (playStart.current !== null) playMs.current += performance.now() - playStart.current;
    playStart.current = null;
    const durationMs = Math.round(playMs.current);
    if (!rec || rec.state === "inactive") {
      void framePromise.then((frame) => {
        setResult({
          reel: null,
          frame,
          mime: "",
          durationMs,
          problem: pickRecorderMime()
            ? "Nothing was recorded."
            : "This browser cannot record video.",
        });
        setFinishing(false);
      });
      return;
    }
    const mime = rec.mimeType.split(";")[0] || "video/webm";
    rec.onstop = () => {
      const reel = chunks.current.length > 0 ? new Blob(chunks.current, { type: mime }) : null;
      chunks.current = [];
      void framePromise.then((frame) => {
        setResult({
          reel,
          frame,
          mime,
          durationMs,
          problem: reel ? null : "Nothing was recorded.",
        });
        setFinishing(false);
      });
    };
    rec.stop();
  }, []);

  /** Drop the last result before a new recording (one recorder reused for another session). */
  const reset = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.ondataavailable = null;
      rec.stop();
    }
    chunks.current = [];
    playMs.current = 0;
    playStart.current = null;
    setRecording(false);
    setFinishing(false);
    setResult(null);
  }, []);

  useEffect(
    () => () => {
      const rec = recRef.current;
      recRef.current = null;
      if (rec && rec.state !== "inactive") rec.stop();
    },
    [],
  );

  return { recording, finishing, result, finish, reset };
}

export type StoryRecorder = ReturnType<typeof useStoryRecorder>;
