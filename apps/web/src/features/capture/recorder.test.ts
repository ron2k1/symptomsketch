import { describe, expect, it } from "vitest";
import { checkRecordingSupport, pickRecordingMimeType, type SupportProbe } from "./recorder";

const only =
  (...types: string[]) =>
  (t: string) =>
    types.includes(t);

describe("pickRecordingMimeType", () => {
  it("prefers VP9, then VP8, then MP4", () => {
    expect(pickRecordingMimeType(only("video/webm;codecs=vp9", "video/webm;codecs=vp8"))).toBe(
      "video/webm;codecs=vp9",
    );
    expect(pickRecordingMimeType(only("video/webm;codecs=vp8", "video/mp4"))).toBe(
      "video/webm;codecs=vp8",
    );
    expect(pickRecordingMimeType(only("video/mp4"))).toBe("video/mp4");
    expect(pickRecordingMimeType(only())).toBeNull();
  });

  it("skips a probe that throws", () => {
    const picky = (t: string) => {
      if (t.includes("vp9")) throw new Error("bad type");
      return t === "video/webm;codecs=vp8";
    };
    expect(pickRecordingMimeType(picky)).toBe("video/webm;codecs=vp8");
  });
});

describe("checkRecordingSupport", () => {
  const full: SupportProbe = {
    isTypeSupported: only("video/webm;codecs=vp9"),
    canvasCaptureStream: true,
    videoFrameCallback: true,
  };

  it("supports recording when every capability is present", () => {
    expect(checkRecordingSupport(full)).toEqual({
      supported: true,
      canPreview: true,
      mimeType: "video/webm;codecs=vp9",
      missing: [],
    });
  });

  it("reports each missing capability before any credits are spent", () => {
    expect(checkRecordingSupport({ ...full, isTypeSupported: null })).toMatchObject({
      supported: false,
      canPreview: true,
      missing: ["MediaRecorder"],
    });
    expect(checkRecordingSupport({ ...full, videoFrameCallback: false })).toMatchObject({
      supported: false,
      canPreview: false,
      missing: ["requestVideoFrameCallback"],
    });
    expect(checkRecordingSupport({ ...full, isTypeSupported: only() })).toMatchObject({
      supported: false,
      mimeType: null,
      missing: ["codec"],
    });
  });

  it("jsdom has no MediaRecorder, so the real probe reports unsupported", () => {
    expect(checkRecordingSupport().supported).toBe(false);
  });
});
