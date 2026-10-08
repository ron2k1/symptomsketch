import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallView } from "../support-call-model";
import { applyTranscript } from "../support-call-model";
import { SupportCall } from "../SupportCall";
import { CallDock } from "./CallDock";
import { CallProvider, useDuckSamWhile, useSupportCall } from "./CallProvider";

// The Reactor SDK needs WebRTC + wasm: this fake "connects" at once and exposes its view setter so
// the test can push the same CallView updates the real controller publishes.
const fake = vi.hoisted(() => ({
  push: null as ((patch: Partial<CallView>) => void) | null,
  ended: vi.fn(),
  mic: vi.fn(),
}));

vi.mock("../support-call-controller", async (importOriginal) => {
  const real = await importOriginal<typeof import("../support-call-controller")>();
  class FakeController {
    private view: CallView = real.INITIAL_CALL_VIEW;
    constructor(private readonly onView: (view: CallView) => void) {
      fake.push = (patch) => {
        this.view = { ...this.view, ...patch };
        this.onView(this.view);
      };
    }
    get busy() {
      return this.view.phase !== "idle" && this.view.phase !== "ended";
    }
    async start() {
      fake.push?.({ phase: "live", liveAt: Date.now(), elapsedSeconds: 65 });
    }
    async end() {
      fake.ended();
      fake.push?.({ phase: "ended" });
    }
    async toggleMic() {
      fake.mic();
      fake.push?.({ micOn: !this.view.micOn });
    }
    dispose() {}
  }
  return { ...real, SupportCallController: FakeController };
});

function Nav() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate("/elsewhere")}>
      Go elsewhere
    </button>
  );
}

function DuckProbe({ playing }: { playing: boolean }) {
  useDuckSamWhile(playing);
  const { ducking } = useSupportCall();
  return <span data-testid="ducking">{String(ducking)}</span>;
}

function renderApp(playing = false) {
  // The app runs under BrowserRouter, where the window URL is the route the call started from.
  window.history.replaceState(null, "", "/cases/case_1/support");
  return render(tree(playing));
}

function tree(playing: boolean) {
  return (
    <MemoryRouter initialEntries={["/cases/case_1/support"]}>
      <CallProvider>
        <Routes>
          <Route
            path="/cases/:caseId/support"
            element={
              <>
                <SupportCall ticketId="tkt_1" />
                <Nav />
              </>
            }
          />
          <Route path="/elsewhere" element={<p>Another tab</p>} />
        </Routes>
        <CallDock />
        <DuckProbe playing={playing} />
      </CallProvider>
    </MemoryRouter>
  );
}

describe("CallDock", () => {
  afterEach(() => {
    cleanup();
    fake.push = null;
    vi.clearAllMocks();
  });

  async function startLiveCallAndLeave() {
    fireEvent.click(screen.getByRole("button", { name: /Talk to support now/ }));
    await screen.findByRole("button", { name: /Turn mic on/ });
    // On the full call view the dock stays hidden.
    expect(document.querySelector("[data-call-dock]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go elsewhere" }));
    await screen.findByText("Another tab");
  }

  it("follows the user off the Support tab with the real timer and the latest real caption", async () => {
    renderApp();
    await startLiveCallAndLeave();
    const dock = screen.getByRole("region", { name: /Live call with Sam/ });
    expect(dock.querySelector("[data-dock-timer]")?.textContent).toBe("01:05");
    // No caption until the transcript has words; then the newest real line.
    expect(dock.querySelector("[data-dock-caption]")?.textContent).toBe("");
    act(() =>
      fake.push?.({
        transcript: applyTranscript(
          { lines: [], interim: {}, nextId: 1, lastTyped: null },
          { speaker: "character", text: "Let's check the brush roll.", final: true },
        ),
      }),
    );
    expect(dock.querySelector("[data-dock-caption]")?.textContent).toBe(
      "Sam: Let's check the brush roll.",
    );
    expect(dock.querySelector("video[data-sam-video]")).toBeTruthy();
  });

  it("toggles the mic with aria-pressed, minimizes to a pill, and expands back to the full view", async () => {
    renderApp();
    await startLiveCallAndLeave();
    const mic = screen.getByRole("button", { name: /Mic off/ });
    expect(mic.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mic);
    expect(fake.mic).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Mic on/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Minimize the call dock" }));
    expect(document.querySelector("[data-call-dock]")?.getAttribute("data-call-dock")).toBe("pill");
    fireEvent.click(screen.getByRole("button", { name: "Show the call dock" }));
    expect(document.querySelector("[data-call-dock]")?.getAttribute("data-call-dock")).toBe("card");

    fireEvent.click(screen.getByRole("button", { name: "Expand to the full call view" }));
    await screen.findByRole("button", { name: /Interrupt/ });
    expect(document.querySelector("[data-call-dock]")).toBeNull();
  });

  it("hides Pop out when neither Picture-in-Picture API exists, and End call ends the call", async () => {
    renderApp();
    await startLiveCallAndLeave();
    expect(screen.queryByRole("button", { name: /Pop out/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /End call/ }));
    expect(fake.ended).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-call-dock]")).toBeNull();
  });

  it("shows a failed call's error with Retry until dismissed", async () => {
    renderApp();
    await startLiveCallAndLeave();
    act(() => fake.push?.({ phase: "ended", error: "The call connection closed." }));
    expect(screen.getByRole("alert").textContent).toBe("The call connection closed.");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await screen.findByRole("button", { name: /End call/ });
    act(() => fake.push?.({ phase: "ended", error: "The call connection closed." }));
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(document.querySelector("[data-call-dock]")).toBeNull();
  });

  it("ducks Sam while a story clip plays and restores after", () => {
    const { rerender } = renderApp(true);
    expect(screen.getByTestId("ducking").textContent).toBe("true");
    rerender(tree(false));
    expect(screen.getByTestId("ducking").textContent).toBe("false");
  });
});
