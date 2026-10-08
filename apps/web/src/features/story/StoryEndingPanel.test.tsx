import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodiesOf, mockApi } from "@/features/support/test-fixtures";
import type { EnqueueParams, FastH3Handlers } from "./fast-h3";

// TEST STUB of the FastH3 session (never used by the live app): records commands and lets the
// test emit clip events as FastH3 would.
const live = vi.hoisted(() => ({
  sessions: [] as Array<{
    handlers: FastH3Handlers;
    enqueued: EnqueueParams[];
    played: string[];
    disconnected: boolean;
  }>,
}));

vi.mock("./fast-h3", async (importOriginal) => {
  const real = await importOriginal<typeof import("./fast-h3")>();
  class StubSession {
    readonly rec;
    private n = 0;
    constructor(handlers: FastH3Handlers) {
      this.rec = {
        handlers,
        enqueued: [] as EnqueueParams[],
        played: [] as string[],
        disconnected: false,
      };
      live.sessions.push(this.rec);
    }
    async connect() {
      this.rec.handlers.status?.("ready");
    }
    async configure() {}
    async uploadFile() {
      return { id: "stub-file-ref" };
    }
    async enqueue(p: EnqueueParams) {
      this.rec.enqueued.push(p);
      this.n += 1;
      return { clipId: `stub-clip-${this.n}` };
    }
    async play(clipId: string) {
      this.rec.played.push(clipId);
      return null;
    }
    async disconnect() {
      this.rec.disconnected = true;
    }
  }
  return { ...real, FastH3Session: StubSession };
});

const { StoryEndingPanel } = await import("./StoryEndingPanel");

const FRAME_URL = "/api/tickets/tkt_1/story/frame?story=story_1";
const TOKEN_URL = "/api/tickets/tkt_1/story/ending/token";
const DIRECTOR_URL = "/api/tickets/tkt_1/story/ending/director";
const scene = (n: number) => ({
  label: `STUB fix ${n}`,
  caption: `STUB caption ${n}`,
  prompt: `STUB ending prompt ${n}`,
});
const TOKEN = {
  jwt: "stub.jwt",
  expiresAt: "2026-10-08T17:00:00.000Z",
  modelName: "reactor/fast-h3",
  clipSeconds: 5.875,
  sessionMaxSeconds: 300,
};

function emit(type: string, clipId: string) {
  const s = live.sessions[live.sessions.length - 1]!;
  act(() => s.handlers.message?.({ type, body: { clip: { clip_id: clipId } } }));
}

beforeEach(() => {
  live.sessions.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function writeEnding(text: string) {
  fireEvent.change(screen.getByLabelText("How to fix it"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Write the ending" }));
}

describe("StoryEndingPanel (staff: Write the ending)", () => {
  it("sends support's text, opens FastH3 from the last frame and plays the scenes in order", async () => {
    const fetchMock = mockApi({
      [`POST ${DIRECTOR_URL}`]: () => ({
        status: 200,
        body: { scenes: [scene(1), scene(2)], modelId: "stub", latencyMs: 4200 },
      }),
      [`POST ${TOKEN_URL}`]: () => ({ status: 200, body: TOKEN }),
      [`GET ${FRAME_URL}`]: () => ({ status: 200, body: {} }),
    });
    render(<StoryEndingPanel ticketId="tkt_1" frameUrl={FRAME_URL} />);
    await writeEnding("  Lift the bumper and pull the hair off the brush roll.  ");

    await screen.findByText("STUB fix 2");
    expect(bodiesOf(fetchMock, "POST", DIRECTOR_URL)).toEqual([
      { text: "Lift the bumper and pull the hair off the brush roll." },
    ]);
    const s = live.sessions[0]!;
    await waitFor(() => expect(s.enqueued).toHaveLength(2));
    expect(s.enqueued[0]!.startingFrame).toEqual({ id: "stub-file-ref" });
    expect(s.enqueued[1]!.continueFromClipId).toBe("stub-clip-1");
    expect(screen.getByRole("status").textContent).toContain("FastH3 is building");

    emit("clip_generated", "stub-clip-2");
    expect(s.played).toEqual([]); // scene 2 waits for scene 1
    emit("clip_generated", "stub-clip-1");
    expect(s.played).toEqual(["stub-clip-1"]);
    emit("clip_started", "stub-clip-1");
    expect(screen.getByRole("status").textContent).toBe("Scene 1 of 2");
    expect(screen.getByText("STUB caption 1", { selector: "div > p" })).toBeTruthy();
    expect(screen.getByText(/Gemini wrote it in 4.2 s/)).toBeTruthy();
    emit("clip_finished", "stub-clip-1");
    expect(s.played).toEqual(["stub-clip-1", "stub-clip-2"]);
    emit("clip_started", "stub-clip-2");
    emit("clip_finished", "stub-clip-2");

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/ending played/));
    await waitFor(() => expect(s.disconnected).toBe(true), { timeout: 3000 });
    expect(screen.getByRole("button", { name: "Write another ending" })).toBeTruthy();
  });

  it("a director failure shows an honest error with Retry, plays nothing, closes the session", async () => {
    let director = 0;
    mockApi({
      [`POST ${DIRECTOR_URL}`]: () => {
        director += 1;
        return { status: 502, body: { code: "PROVIDER_FAILED", message: "STUB provider failed." } };
      },
      [`POST ${TOKEN_URL}`]: () => ({ status: 200, body: TOKEN }),
      [`GET ${FRAME_URL}`]: () => ({ status: 200, body: {} }),
    });
    render(<StoryEndingPanel ticketId="tkt_1" frameUrl={FRAME_URL} />);
    await writeEnding("Restart it.");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("STUB provider failed.");
    await waitFor(() => expect(live.sessions[0]!.disconnected).toBe(true));
    expect(live.sessions[0]!.enqueued).toHaveLength(0);
    expect(screen.queryByText("STUB fix 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(director).toBe(2));
    expect(live.sessions).toHaveLength(2);
  });

  it("needs at least a few characters before it writes anything", () => {
    const fetchMock = mockApi({});
    render(<StoryEndingPanel ticketId="tkt_1" frameUrl={FRAME_URL} />);
    fireEvent.change(screen.getByLabelText("How to fix it"), { target: { value: "ok" } });
    const button = screen.getByRole("button", { name: "Write the ending" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
