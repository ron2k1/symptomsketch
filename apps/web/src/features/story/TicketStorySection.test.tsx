import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryBeatsUpload, type TicketStory } from "@symptomsketch/contracts";
import { mockApi } from "@/features/support/test-fixtures";
import { beatsUpload } from "./story-api";
import type { PlayedBeat } from "./story-state";
import { TicketStorySection } from "./TicketStorySection";

// Labeled stubs only (test fixtures, never shown by the live app).
const STORY: TicketStory = {
  id: "story_1",
  ticketId: "tkt_1",
  caseId: "case_1",
  beats: [
    { label: "STUB opening", caption: "STUB caption 1", prompt: "STUB prompt 1", custom: false },
    { label: "STUB pick", caption: "STUB caption 2", prompt: "STUB prompt 2", custom: false },
    { label: "STUB typed", caption: "STUB caption 3", prompt: "STUB prompt 3", custom: true },
  ],
  offered: [[], ["STUB pick", "STUB other", "STUB third"], []],
  clipSeconds: 5.875,
  durationMs: 17000,
  reelMime: "video/webm",
  reelBytes: 2_000_000,
  reelUrl: "/api/tickets/tkt_1/story/reel?story=story_1",
  frameUrl: "/api/tickets/tkt_1/story/frame?story=story_1",
  createdAt: "2026-10-08T16:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TicketStorySection (staff ticket view)", () => {
  it("shows the reel player and every scene with its choices, typed beats and prompt", async () => {
    mockApi({
      "GET /api/tickets/tkt_1/story": () => ({ status: 200, body: { story: STORY } }),
    });
    const { container } = render(<TicketStorySection ticketId="tkt_1" />);
    expect(
      await screen.findByRole("heading", { name: "Customer story (MiniMax FastH3)" }),
    ).toBeTruthy();
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(STORY.reelUrl);
    expect(video?.getAttribute("poster")).toBe(STORY.frameUrl);
    const scenes = screen.getByRole("list", { name: "Story scenes" }).querySelectorAll("li");
    expect(scenes).toHaveLength(3);
    expect(scenes[1]!.textContent).toContain("Picked from: STUB pick · STUB other · STUB third");
    expect(scenes[2]!.textContent).toContain("Typed by the customer");
    expect(scenes[0]!.textContent).toContain("Scene 1 · Setup");
    expect(scenes[2]!.textContent).toContain("STUB prompt 3");
  });

  it("offers Write the ending only when the story has its last frame", async () => {
    mockApi({
      "GET /api/tickets/tkt_1/story": () => ({ status: 200, body: { story: STORY } }),
    });
    render(<TicketStorySection ticketId="tkt_1" />);
    expect(await screen.findByRole("heading", { name: "Write the ending" })).toBeTruthy();
    cleanup();
    mockApi({
      "GET /api/tickets/tkt_1/story": () => ({
        status: 200,
        body: { story: { ...STORY, frameUrl: null } },
      }),
    });
    render(<TicketStorySection ticketId="tkt_1" />);
    expect(await screen.findByText(/sent without its last frame/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Write the ending" })).toBeNull();
  });

  it("renders nothing when the case has no story or the ticket is not readable", async () => {
    const fetchMock = mockApi({
      "GET /api/tickets/tkt_1/story": () => ({ status: 200, body: { story: null } }),
    });
    const { container } = render(<TicketStorySection ticketId="tkt_1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    cleanup();
    mockApi({});
    const gone = render(<TicketStorySection ticketId="tkt_2" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(gone.container.innerHTML).toBe("");
  });
});

describe("beatsUpload (the JSON sent with the reel)", () => {
  it("keeps exactly the played scenes and the cards offered, and passes the upload schema", () => {
    const played: PlayedBeat[] = [
      { ...STORY.beats[0]!, clipId: "c0", offered: [] },
      { ...STORY.beats[1]!, clipId: "c1", offered: ["STUB pick", "STUB other", "STUB third"] },
      { ...STORY.beats[2]!, clipId: "c2", offered: [] },
    ];
    const out = beatsUpload(played, 5.875, 17000.6);
    expect(out.beats.map((b) => b.label)).toEqual(["STUB opening", "STUB pick", "STUB typed"]);
    expect(out.beats[0]).not.toHaveProperty("clipId");
    expect(out.offered[1]).toEqual(["STUB pick", "STUB other", "STUB third"]);
    expect(out.durationMs).toBe(17001);
    expect(StoryBeatsUpload.safeParse(out).success).toBe(true);
  });
});
