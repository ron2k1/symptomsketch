import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_ACTION_LABELS,
  type AssessmentUiStatus,
  type Purpose,
  type Take,
  type TakeAssessment,
} from "@symptomsketch/contracts";
import { ExportPanel } from "./ExportPanel";
import { ReviewActions } from "./ReviewActions";
import { needsPolling } from "./useTakePolling";

const T0 = "2026-10-08T07:00:00.000Z";
const SHA = "a".repeat(64);

function assessment(uiStatus: AssessmentUiStatus): TakeAssessment {
  return {
    id: "asm_1",
    takeId: "take_1",
    createdAt: T0,
    updatedAt: T0,
    jobState: uiStatus === "pending" ? "running" : uiStatus === "unavailable" ? "failed" : "done",
    uiStatus,
    summary: null,
    errorCode: null,
    result: null,
  };
}

function take(over: Partial<Take> = {}): Take {
  return {
    id: "take_1",
    caseId: "case_1",
    purpose: "problem",
    number: 1,
    planRevisionId: "plan_1",
    productRevisionId: "prod_1",
    procedureRevisionId: null,
    runId: "run_1",
    captureStatus: "complete",
    captureReason: null,
    firstOutputOffsetMs: 300,
    processingState: "ready",
    reviewState: "unreviewed",
    durationMs: 6000,
    sizeBytes: 1000,
    sha256: SHA,
    width: 1280,
    height: 720,
    thumbnailUrl: null,
    mediaUrl: "/api/takes/take_1/media",
    downloadUrl: null,
    caption: "Take caption",
    errorCode: null,
    retryable: false,
    createdAt: T0,
    updatedAt: T0,
    currentAssessment: null,
    latestReview: null,
    ...over,
  };
}

const noop = () => {};

function renderActions(purpose: Purpose, status: AssessmentUiStatus | null) {
  render(
    <ReviewActions
      take={take({ purpose, currentAssessment: status ? assessment(status) : null })}
      onTakeUpdated={noop}
      onDecision={noop}
      onConflict={noop}
    />,
  );
  return screen.getByRole("button", { name: REVIEW_ACTION_LABELS[purpose].accept });
}

afterEach(cleanup);

describe("ReviewActions accept gating", () => {
  it("never allows accepting a needs_revision clip", () => {
    expect(renderActions("problem", "needs_revision")).toHaveProperty("disabled", true);
  });

  it("waits while the visual check is pending", () => {
    expect(renderActions("problem", "pending")).toHaveProperty("disabled", true);
  });

  it("requires a note before a customer accepts an uncertain check", () => {
    const accept = renderActions("problem", "uncertain");
    expect(accept).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/Review note/), {
      target: { value: "The jerk distance is a guess." },
    });
    expect(accept).toHaveProperty("disabled", false);
  });

  it("treats an unavailable or missing check as unverified, not favorable", () => {
    expect(renderActions("problem", "unavailable")).toHaveProperty("disabled", true);
    cleanup();
    expect(renderActions("problem", null)).toHaveProperty("disabled", true);
  });

  it("lets a customer accept a matching clip without a note", () => {
    expect(renderActions("problem", "matches")).toHaveProperty("disabled", false);
  });

  it("confirms an instructional take only when the check matches", () => {
    expect(renderActions("solution", "uncertain")).toHaveProperty("disabled", true);
    expect(screen.queryByLabelText(/Review note/)).toBeNull();
    cleanup();
    expect(renderActions("solution", "matches")).toHaveProperty("disabled", false);
  });

  it("blocks accept without an exact MP4 hash", () => {
    render(
      <ReviewActions
        take={take({ sha256: null, currentAssessment: assessment("matches") })}
        onTakeUpdated={noop}
        onDecision={noop}
        onConflict={noop}
      />,
    );
    const accept = screen.getByRole("button", { name: REVIEW_ACTION_LABELS.problem.accept });
    expect(accept).toHaveProperty("disabled", true);
  });

  it("offers Send anyway on needs_revision only behind an explicit confirmation", () => {
    expect(renderActions("problem", "needs_revision")).toHaveProperty("disabled", true);
    expect(screen.queryByText("Send flagged clip to support")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    expect(screen.getByText(/Gemini flagged this clip as needing revision/)).toBeTruthy();
    expect(screen.getByText(/support will see that it\s+was flagged and why/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send flagged clip to support" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Send flagged clip to support")).toBeNull();
  });

  it("never offers Send anyway for other verdicts or instructional takes", () => {
    renderActions("problem", "uncertain");
    expect(screen.queryByRole("button", { name: "Send anyway" })).toBeNull();
    cleanup();
    renderActions("problem", "matches");
    expect(screen.queryByRole("button", { name: "Send anyway" })).toBeNull();
    cleanup();
    renderActions("solution", "needs_revision");
    expect(screen.queryByRole("button", { name: "Send anyway" })).toBeNull();
  });
});

describe("needsPolling", () => {
  const now = Date.parse(T0);

  it("polls while converting or while the check runs", () => {
    expect(needsPolling(take({ processingState: "converting" }), now)).toBe(true);
    expect(needsPolling(take({ currentAssessment: assessment("pending") }), now)).toBe(true);
  });

  it("stops for settled, failed or incomplete takes", () => {
    expect(needsPolling(take({ currentAssessment: assessment("matches") }), now)).toBe(false);
    expect(needsPolling(take({ processingState: "failed" }), now)).toBe(false);
    expect(
      needsPolling(take({ captureStatus: "incomplete", processingState: "converting" }), now),
    ).toBe(false);
  });

  it("waits a bounded grace period for the check to appear", () => {
    expect(needsPolling(take(), now + 10_000)).toBe(true);
    expect(needsPolling(take(), now + 120_000)).toBe(false);
  });
});

describe("ExportPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries the email explanation after a failed load instead of leaving Copy dead", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("network down");
        const body = {
          takeId: "take_1",
          subject: "Subj",
          body: "Body",
          attachmentFilename: "x.mp4",
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    render(
      <ExportPanel
        take={take({ reviewState: "accepted" })}
        original={null}
        continueLabel="Continue to Support"
        onContinue={noop}
        announce={noop}
      />,
    );
    expect(await screen.findByText("Could not reach the server.")).toBeTruthy();
    const copy = screen.getByRole("button", { name: /Copy email explanation/ });
    expect((copy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText(/Email explanation/) as HTMLTextAreaElement).value).toBe(
      "Subject: Subj\n\nBody",
    );
  });
});
