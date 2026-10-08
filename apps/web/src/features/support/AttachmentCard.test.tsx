import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TicketAttachment } from "@symptomsketch/contracts";
import { AttachmentCard } from "./AttachmentCard";
import { CallProvider, useSupportCall } from "./call/CallProvider";

const clip: TicketAttachment = {
  id: "att_1",
  ticketId: "tkt_1",
  assetId: "asset_1",
  purpose: "customer_take",
  mime: "video/mp4",
  sha256: "a".repeat(64),
  sizeBytes: 1024,
  filename: "clip.mp4",
  durationMs: 8000,
  mediaUrl: "/m",
  downloadUrl: "/d",
  createdAt: "2026-10-08T12:00:00.000Z",
};

function DuckingProbe() {
  const { ducking } = useSupportCall();
  return <span data-testid="ducking">{String(ducking)}</span>;
}

afterEach(cleanup);

describe("AttachmentCard", () => {
  it("ducks Sam while the clip plays and restores when it pauses or ends", () => {
    const { container } = render(
      <CallProvider>
        <AttachmentCard ticketId="tkt_1" attachment={clip} />
        <DuckingProbe />
      </CallProvider>,
    );
    const video = container.querySelector("video")!;
    expect(screen.getByTestId("ducking").textContent).toBe("false");
    fireEvent.play(video);
    expect(screen.getByTestId("ducking").textContent).toBe("true");
    fireEvent.pause(video);
    expect(screen.getByTestId("ducking").textContent).toBe("false");
    fireEvent.play(video);
    fireEvent.ended(video);
    expect(screen.getByTestId("ducking").textContent).toBe("false");
  });

  it("renders without a call provider (staff pages)", () => {
    render(<AttachmentCard ticketId="tkt_1" attachment={clip} />);
    expect(screen.getByRole("link", { name: /Download/ })).toBeTruthy();
    expect(screen.queryByText("Gemini check: needs revision")).toBeNull();
  });

  it("shows the needs-revision badge with the critic's reason on a flagged clip", () => {
    const override = {
      checkStatus: "needs_revision" as const,
      reason: "The clip shows the vacuum stopping; the customer said it keeps spinning.",
      overriddenByRole: "customer" as const,
      overriddenAt: "2026-10-08T12:00:00.000Z",
    };
    render(<AttachmentCard ticketId="tkt_1" attachment={clip} criticOverride={override} />);
    expect(screen.getByText("Gemini check: needs revision")).toBeTruthy();
    expect(screen.getByText(override.reason)).toBeTruthy();
    cleanup();
    render(
      <AttachmentCard
        ticketId="tkt_1"
        attachment={{ ...clip, purpose: "customer_reference", mime: "image/jpeg" }}
        criticOverride={override}
      />,
    );
    expect(screen.queryByText("Gemini check: needs revision")).toBeNull();
  });
});
