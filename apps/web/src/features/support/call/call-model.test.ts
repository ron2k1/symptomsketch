import { describe, expect, it } from "vitest";
import { EMPTY_TRANSCRIPT, applyTranscript } from "../support-call-model";
import {
  DUCKED_VOLUME,
  clampDockPosition,
  defaultDockPosition,
  detectPipSupport,
  dockPlacement,
  formatCallTimer,
  latestCaption,
  samVolume,
  type DockInput,
} from "./call-model";

describe("formatCallTimer", () => {
  it("pads minutes and seconds to mm:ss", () => {
    expect(formatCallTimer(0)).toBe("00:00");
    expect(formatCallTimer(7.9)).toBe("00:07");
    expect(formatCallTimer(65)).toBe("01:05");
    expect(formatCallTimer(600)).toBe("10:00");
  });

  it("never shows a negative or NaN time", () => {
    expect(formatCallTimer(-3)).toBe("00:00");
    expect(formatCallTimer(Number.NaN)).toBe("00:00");
  });
});

describe("dockPlacement", () => {
  const base: DockInput = {
    phase: "live",
    error: null,
    errorDismissed: false,
    fullViewOpen: false,
    pipOpen: false,
  };

  it("shows the dock in the page while a call is active away from the full view", () => {
    expect(dockPlacement(base)).toBe("page");
    expect(dockPlacement({ ...base, phase: "preparing" })).toBe("page");
    expect(dockPlacement({ ...base, phase: "connecting" })).toBe("page");
  });

  it("hides on the full call view and when no call is active", () => {
    expect(dockPlacement({ ...base, fullViewOpen: true })).toBe("hidden");
    expect(dockPlacement({ ...base, phase: "idle" })).toBe("hidden");
    expect(dockPlacement({ ...base, phase: "ended" })).toBe("hidden");
  });

  it("keeps a failed call's error visible until dismissed", () => {
    const failed = { ...base, phase: "ended" as const, error: "The call could not start." };
    expect(dockPlacement(failed)).toBe("page");
    expect(dockPlacement({ ...failed, errorDismissed: true })).toBe("hidden");
    expect(dockPlacement({ ...failed, fullViewOpen: true })).toBe("hidden");
  });

  it("moves to the PiP window while one is open, even over the full view", () => {
    expect(dockPlacement({ ...base, pipOpen: true })).toBe("pip");
    expect(dockPlacement({ ...base, pipOpen: true, fullViewOpen: true })).toBe("pip");
    expect(dockPlacement({ ...base, pipOpen: true, phase: "ended" })).toBe("hidden");
  });
});

describe("latestCaption", () => {
  it("is null before anyone speaks", () => {
    expect(latestCaption(EMPTY_TRANSCRIPT)).toBeNull();
  });

  it("prefers Sam's unsettled words, then the customer's, then the last final line", () => {
    let t = applyTranscript(EMPTY_TRANSCRIPT, { speaker: "character", text: "Hello", final: true });
    expect(latestCaption(t)).toEqual({ speaker: "character", text: "Hello", interim: false });
    t = applyTranscript(t, { speaker: "user", text: "it jerks", final: false });
    expect(latestCaption(t)).toEqual({ speaker: "user", text: "it jerks", interim: true });
    t = applyTranscript(t, { speaker: "character", text: "Let me", final: false });
    expect(latestCaption(t)).toEqual({ speaker: "character", text: "Let me", interim: true });
  });
});

describe("detectPipSupport", () => {
  const videoProto = { prototype: { requestPictureInPicture: () => undefined } };

  it("prefers Document Picture-in-Picture", () => {
    expect(
      detectPipSupport({
        documentPictureInPicture: { requestWindow: () => undefined },
        document: { pictureInPictureEnabled: true },
        HTMLVideoElement: videoProto,
      }),
    ).toBe("document");
  });

  it("falls back to video Picture-in-Picture", () => {
    expect(
      detectPipSupport({
        document: { pictureInPictureEnabled: true },
        HTMLVideoElement: videoProto,
      }),
    ).toBe("video");
  });

  it("reports none when neither API is usable", () => {
    expect(detectPipSupport(undefined)).toBe("none");
    expect(detectPipSupport({})).toBe("none");
    expect(
      detectPipSupport({
        document: { pictureInPictureEnabled: false },
        HTMLVideoElement: videoProto,
      }),
    ).toBe("none");
    expect(detectPipSupport({ documentPictureInPicture: {} })).toBe("none");
  });
});

describe("samVolume (story ducking)", () => {
  it("ducks to ~20% while any story clip plays and restores after", () => {
    expect(samVolume(0)).toBe(1);
    expect(samVolume(1)).toBe(DUCKED_VOLUME);
    expect(samVolume(2)).toBe(DUCKED_VOLUME);
    expect(DUCKED_VOLUME).toBeCloseTo(0.2);
  });
});

describe("dock position", () => {
  const dock = { width: 300, height: 480 };
  const viewport = { width: 1280, height: 800 };

  it("defaults to the bottom-right corner with 24px margins", () => {
    expect(defaultDockPosition(dock, viewport)).toEqual({ x: 956, y: 296 });
  });

  it("keeps the dock inside the viewport", () => {
    expect(clampDockPosition({ x: -50, y: -10 }, dock, viewport)).toEqual({ x: 24, y: 24 });
    expect(clampDockPosition({ x: 5000, y: 5000 }, dock, viewport)).toEqual({ x: 956, y: 296 });
    expect(clampDockPosition({ x: 400, y: 100 }, dock, viewport)).toEqual({ x: 400, y: 100 });
  });

  it("pins to the top-left margin when the viewport is smaller than the dock", () => {
    expect(clampDockPosition({ x: 100, y: 100 }, dock, { width: 200, height: 300 })).toEqual({
      x: 24,
      y: 24,
    });
  });
});
