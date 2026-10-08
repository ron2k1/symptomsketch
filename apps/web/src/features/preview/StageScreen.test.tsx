import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
          take: { id: "tk_1", number: 2, mediaUrl: "/api/takes/tk_1/media", stateLabel: "Ready" },
        })}
      />,
    );
    const frame = frameOf(container);
    for (const text of [/Saved/, /AI-generated reenactment/, /^Ready$/]) {
      expect(frame.contains(screen.getByText(text))).toBe(false);
    }
    expect(frame.querySelector("video[src='/api/takes/tk_1/media']")).not.toBeNull();
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
});
