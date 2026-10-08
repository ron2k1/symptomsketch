import { STAGE_FPS } from "@/features/preview/geometry";

/** Preference order (spec 12): VP9 WebM, VP8 WebM, then MP4. The server converts to H264 MP4. */
export const RECORDING_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1",
  "video/mp4",
] as const;

/** 4 Mbps keeps a 35 s hard-capped 1280x720 recording well under the 25 MiB upload limit. */
export const RECORDING_BITS_PER_SECOND = 4_000_000;

export function pickRecordingMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of RECORDING_MIME_CANDIDATES) {
    try {
      if (isSupported(type)) return type;
    } catch {
      // isTypeSupported can throw on malformed input in some engines; try the next one.
    }
  }
  return null;
}

/** Browser features the armed recording needs (spec 6: check before spending credits). */
export interface SupportProbe {
  isTypeSupported: ((type: string) => boolean) | null;
  canvasCaptureStream: boolean;
  videoFrameCallback: boolean;
}

export interface RecordingSupport {
  /** Record next take can run. */
  supported: boolean;
  /** Fresh-frame detection works, so the live preview can report honest states. */
  canPreview: boolean;
  mimeType: string | null;
  missing: Array<"MediaRecorder" | "canvas captureStream" | "requestVideoFrameCallback" | "codec">;
}

export function browserSupportProbe(): SupportProbe {
  const hasRecorder =
    typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function";
  return {
    isTypeSupported: hasRecorder ? (type) => MediaRecorder.isTypeSupported(type) : null,
    canvasCaptureStream:
      typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype,
    videoFrameCallback:
      typeof HTMLVideoElement !== "undefined" &&
      "requestVideoFrameCallback" in HTMLVideoElement.prototype,
  };
}

export function checkRecordingSupport(
  probe: SupportProbe = browserSupportProbe(),
): RecordingSupport {
  const missing: RecordingSupport["missing"] = [];
  if (!probe.isTypeSupported) missing.push("MediaRecorder");
  if (!probe.canvasCaptureStream) missing.push("canvas captureStream");
  if (!probe.videoFrameCallback) missing.push("requestVideoFrameCallback");
  const mimeType = probe.isTypeSupported ? pickRecordingMimeType(probe.isTypeSupported) : null;
  if (probe.isTypeSupported && !mimeType) missing.push("codec");
  return {
    supported: missing.length === 0,
    canPreview: probe.canvasCaptureStream && probe.videoFrameCallback,
    mimeType,
    missing,
  };
}

export interface CanvasRecorder {
  /** Actual container/codec reported by the recorder (falls back to the requested type). */
  readonly mimeType: string;
  /** Resolves with performance.now() at the recorder's `start` event (its actual start). */
  readonly started: Promise<number>;
  stop(): Promise<{ blob: Blob; stoppedAt: number }>;
}

/** MediaRecorder on recordingCanvas.captureStream(24). */
export function startCanvasRecorder(canvas: HTMLCanvasElement, mimeType: string): CanvasRecorder {
  const stream = canvas.captureStream(STAGE_FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: RECORDING_BITS_PER_SECOND,
  });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  const started = new Promise<number>((resolve, reject) => {
    recorder.addEventListener("start", () => resolve(performance.now()), { once: true });
    recorder.addEventListener("error", () => reject(new Error("recorder failed to start")), {
      once: true,
    });
  });
  recorder.start(500);

  const stopTracks = () => {
    for (const track of stream.getTracks()) track.stop();
  };
  const actualType = () => recorder.mimeType || mimeType;

  return {
    get mimeType() {
      return actualType();
    },
    started,
    stop() {
      return new Promise((resolve) => {
        const finish = () => {
          const stoppedAt = performance.now();
          stopTracks();
          resolve({ blob: new Blob(chunks, { type: actualType() }), stoppedAt });
        };
        if (recorder.state === "inactive") {
          finish();
          return;
        }
        recorder.addEventListener("stop", finish, { once: true });
        recorder.stop();
      });
    },
  };
}
