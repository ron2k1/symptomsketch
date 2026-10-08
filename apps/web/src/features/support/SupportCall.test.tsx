import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallProvider, useSupportCall } from "./call/CallProvider";
import { SupportCall } from "./SupportCall";
import { bodiesOf, mockApi } from "./test-fixtures";

// The Reactor SDK needs WebRTC + wasm, so the controller is replaced by one that "runs" a call and
// ends it at once: this test covers what the component does after end_call + disconnect.
// With fake.holdOpen the call stays live until end(), to cover a call running on another ticket.
const fake = vi.hoisted(() => ({ holdOpen: false }));
vi.mock("./support-call-controller", async (importOriginal) => {
  const real = await importOriginal<typeof import("./support-call-controller")>();
  class FakeController {
    constructor(
      private readonly onView: (view: import("./support-call-controller").CallView) => void,
      private readonly onEnded?: (ended: import("./support-call-controller").CallEnded) => void,
    ) {}
    get busy() {
      return false;
    }
    async end() {
      this.onView({ ...real.INITIAL_CALL_VIEW, phase: "ended" });
    }
    async start() {
      if (fake.holdOpen) {
        this.onView({ ...real.INITIAL_CALL_VIEW, phase: "live" });
        return;
      }
      this.onView({ ...real.INITIAL_CALL_VIEW, phase: "ended", elapsedSeconds: 31 });
      this.onEnded?.({
        lines: [
          { speaker: "character", text: "Hi, I'm Sam, an AI support agent." },
          { speaker: "user", text: "It jerks back.", typed: true },
        ],
        durationSeconds: 31,
        endReason: "ended_by_client",
      });
    }
    dispose() {}
  }
  return { ...real, SupportCallController: FakeController };
});

function StartOtherCall() {
  const call = useSupportCall();
  return (
    <button type="button" onClick={() => call.start("tkt_2")}>
      Start other call
    </button>
  );
}

describe("SupportCall", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fake.holdOpen = false;
  });

  it("offers to end a call running on another ticket instead of a dead Start button", async () => {
    fake.holdOpen = true;
    mockApi({});
    render(
      <CallProvider>
        <StartOtherCall />
        <SupportCall ticketId="tkt_1" />
      </CallProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start other call" }));
    const end = await screen.findByRole("button", { name: "End that call" });
    const talk = screen.getByRole("button", { name: /Talk to support now/ }) as HTMLButtonElement;
    expect(talk.disabled).toBe(true);
    fireEvent.click(end);
    await waitFor(() => expect(talk.disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "End that call" })).toBeNull();
  });

  it("adds the ended call's transcript to the ticket and says so", async () => {
    const fetchMock = mockApi({
      "POST /api/tickets/tkt_1/support-call/transcripts": () => ({
        status: 201,
        body: { id: "sct_1" },
      }),
    });
    const onEnded = vi.fn();
    render(
      <CallProvider>
        <SupportCall ticketId="tkt_1" onEnded={onEnded} />
      </CallProvider>,
    );
    expect(screen.getByText("Reactor Vidu S2 Avatar").className).toContain("font-reactor");
    fireEvent.click(screen.getByRole("button", { name: /Talk to support now/ }));

    expect(
      await screen.findByText("The call transcript was added to your ticket for Demo Support."),
    ).toBeTruthy();
    const [body] = bodiesOf(fetchMock, "POST", "/api/tickets/tkt_1/support-call/transcripts");
    expect(body).toMatchObject({
      durationSeconds: 31,
      endReason: "ended_by_client",
      lines: [
        { speaker: "character", text: "Hi, I'm Sam, an AI support agent." },
        { speaker: "user", text: "It jerks back.", typed: true },
      ],
    });
    expect(typeof body?.idempotencyKey).toBe("string");
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Talk to support again/ })).toBeTruthy();
  });

  it("tells the customer when the transcript could not be saved", async () => {
    mockApi({
      "POST /api/tickets/tkt_1/support-call/transcripts": () => ({
        status: 500,
        body: { code: "INTERNAL_ERROR", message: "x" },
      }),
    });
    render(
      <CallProvider>
        <SupportCall ticketId="tkt_1" />
      </CallProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Talk to support now/ }));
    expect(
      await screen.findByText("The call transcript could not be added to your ticket."),
    ).toBeTruthy();
  });
});
