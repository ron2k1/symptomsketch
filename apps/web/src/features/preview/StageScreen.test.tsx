import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StageScreen, type StageScreenProps } from "./StageScreen";

function props(over: Partial<StageScreenProps>): StageScreenProps {
  return {
    videoRef: createRef<HTMLVideoElement>(),
    referenceImageUrl: "/api/assets/ref/media",
    productLabel: "Robot vacuum",
    purposeLabel: "AI-generated reenactment",
    showLiveVideo: false,
    isLive: false,
    take: null,
    compareOriginal: false,
    recordingSec: null,
    updating: false,
    overlay: null,
    ...over,
  };
}

/** The 16:9 frame: burned-in MP4 labels live inside it, so saved-take chips must not. */
const frameOf = (container: HTMLElement) => container.querySelector(".aspect-video")!;

afterEach(cleanup);

describe("StageScreen chips", () => {
  it("puts saved-take chips outside the video frame (labels are burned into the MP4)", () => {
    const { container } = render(
      <StageScreen
        {...props({
          take: {
            id: "tk_1",
            number: 2,
            mediaUrl: "/api/takes/tk_1/media",
            stateLabel: "Ready",
            failed: false,
          },
        })}
      />,
    );
    const frame = frameOf(container);
    for (const text of [/Saved/, /AI-generated reenactment/, /^Ready$/]) {
      expect(frame.contains(screen.getByText(text))).toBe(false);
    }
    expect(frame.querySelector("video[src='/api/takes/tk_1/media']")).not.toBeNull();
  });

  it("plays a saved take on loop, muted and inline, with controls kept", () => {
    const { container } = render(
      <StageScreen
        {...props({
          take: {
            id: "tk_1",
            number: 2,
            mediaUrl: "/api/takes/tk_1/media",
            stateLabel: "Ready",
            failed: false,
          },
        })}
      />,
    );
    const video = container.querySelector<HTMLVideoElement>("video[src='/api/takes/tk_1/media']")!;
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.controls).toBe(true);
  });

  it("keeps live chips over the frame while previewing", () => {
    const { container } = render(<StageScreen {...props({ showLiveVideo: true, isLive: true })} />);
    const frame = frameOf(container);
    expect(frame.contains(screen.getByText(/Live/))).toBe(true);
    expect(frame.contains(screen.getByText("AI-generated reenactment"))).toBe(true);
  });

  it("names Reactor X2 in the live badge, in the Reactor face", () => {
    const { container } = render(<StageScreen {...props({ showLiveVideo: true, isLive: true })} />);
    const badge = frameOf(container).querySelector("[data-reactor-mark]");
    expect(badge?.textContent).toMatch(/Live · Reactor X2/);
    expect(badge?.className).toContain("font-reactor");
  });

  it("never shows the reference still under the Recorded chip while the MP4 is being made", () => {
    const { container } = render(
      <StageScreen
        {...props({
          take: { id: "tk_1", number: 2, mediaUrl: null, stateLabel: "Processing", failed: false },
        })}
      />,
    );
    const frame = frameOf(container);
    expect(frame.querySelector("img[src='/api/assets/ref/media']")).toBeNull();
    expect(frame.contains(screen.getByText(/MP4 not ready/))).toBe(true);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("offers Retry when the take's MP4 export failed", () => {
    const onRetryTake = vi.fn();
    const { container } = render(
      <StageScreen
        {...props({
          take: {
            id: "tk_1",
            number: 2,
            mediaUrl: null,
            stateLabel: "Export failed",
            failed: true,
          },
          onRetryTake,
        })}
      />,
    );
    expect(frameOf(container).querySelector("img[src='/api/assets/ref/media']")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/MP4 not ready/);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetryTake).toHaveBeenCalledTimes(1);
  });
});
