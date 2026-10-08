import { describe, expect, it } from "vitest";
import type { Take, Ticket, TicketSummary } from "@symptomsketch/contracts";
import { ApiClientError } from "@/lib/api";
import {
  acceptedTakes,
  emailText,
  isAuthError,
  isTerminalError,
  mergeTickets,
  resolveSupportTake,
  ticketForTake,
} from "./model";

/** Test-only DTO builder (labeled fixture; never served by the app). */
function take(over: Partial<Take> & Pick<Take, "id" | "number">): Take {
  return {
    caseId: "case_1",
    purpose: "problem",
    planRevisionId: "plan_1",
    productRevisionId: "prod_1",
    procedureRevisionId: null,
    runId: "run_1",
    captureStatus: "complete",
    captureReason: null,
    firstOutputOffsetMs: 120,
    processingState: "ready",
    reviewState: "accepted",
    durationMs: 8000,
    sizeBytes: 1000,
    sha256: "a".repeat(64),
    width: 1280,
    height: 720,
    thumbnailUrl: null,
    mediaUrl: null,
    downloadUrl: null,
    caption: "caption",
    errorCode: null,
    retryable: false,
    createdAt: "2026-10-08T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    currentAssessment: null,
    latestReview: null,
    ...over,
  };
}

function summary(over: Partial<TicketSummary> & Pick<TicketSummary, "id" | "takeId">) {
  return {
    status: "submitted",
    queue: "SymptomSketch Demo Support",
    takeNumber: 1,
    replyCount: 0,
    lastReplyAt: null,
    createdAt: "2026-10-08T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    ...over,
  } satisfies TicketSummary;
}

describe("support take resolution", () => {
  const accepted = take({ id: "take_a", number: 2 });
  const unsure = take({ id: "take_u", number: 3, reviewState: "uncertain" });
  const incomplete = take({ id: "take_i", number: 4, captureStatus: "incomplete" });
  const solution = take({ id: "take_s", number: 5, purpose: "solution" });
  const caseData = { takes: [accepted, unsure, incomplete, solution] };

  it("uses the selected take only when it is an accepted, complete problem take", () => {
    const r = resolveSupportTake(caseData, "take_a");
    expect(r.kind).toBe("selected");
    expect(r.kind === "selected" && r.take.id).toBe("take_a");
  });

  it("never swaps in another take when the selected one is not accepted", () => {
    const r = resolveSupportTake(caseData, "take_u");
    expect(r.kind).toBe("not_accepted");
    expect(r.kind === "not_accepted" && r.accepted.map((t) => t.id)).toEqual(["take_a"]);
    expect(resolveSupportTake(caseData, "take_i").kind).toBe("not_accepted");
  });

  it("asks the user to choose when nothing is selected, and prompts Recreate when none exist", () => {
    expect(resolveSupportTake(caseData, null).kind).toBe("choose");
    expect(resolveSupportTake({ takes: [unsure] }, null).kind).toBe("none");
  });

  it("lists accepted takes per purpose, newest first", () => {
    const newer = take({ id: "take_b", number: 7 });
    expect(acceptedTakes([accepted, newer, solution], "problem").map((t) => t.id)).toEqual([
      "take_b",
      "take_a",
    ]);
    expect(acceptedTakes([accepted, solution], "solution").map((t) => t.id)).toEqual(["take_s"]);
  });
});

describe("tickets", () => {
  it("merges a just-created ticket with server summaries without duplicates", () => {
    const server = [summary({ id: "tkt_1", takeId: "take_a" })];
    const created = {
      id: "tkt_1",
      queue: "SymptomSketch Demo Support",
      status: "replied",
      snapshot: { takeId: "take_a", takeNumber: 2 },
      attachments: [],
      replies: [{ createdAt: "2026-10-08T10:05:00.000Z" }],
      workCaseIds: [],
      createdAt: "2026-10-08T10:00:00.000Z",
      updatedAt: "2026-10-08T10:05:00.000Z",
    } as unknown as Ticket;
    const merged = mergeTickets(server, [created]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("replied");
    expect(merged[0]?.replyCount).toBe(1);
  });

  it("finds the stored ticket for a take and ignores revoked ones", () => {
    const list = [
      summary({ id: "tkt_2", takeId: "take_a", status: "revoked" }),
      summary({ id: "tkt_1", takeId: "take_b" }),
    ];
    expect(ticketForTake(list, "take_a")).toBeNull();
    expect(ticketForTake(list, "take_b")?.id).toBe("tkt_1");
  });
});

describe("email explanation", () => {
  it("puts the subject first and keeps the edited body", () => {
    expect(emailText("Vacuum jerks backward", "Edited body")).toBe(
      "Subject: Vacuum jerks backward\n\nEdited body",
    );
    expect(emailText("", "Body only")).toBe("Body only");
  });

  it("retains an uncertainty review note the edit dropped, without duplicating it", () => {
    expect(emailText("S", "Body", "Not sure about timing")).toBe(
      "Subject: S\n\nBody\n\nMy review note: Not sure about timing",
    );
    expect(emailText("S", "Body. Not sure about timing", "Not sure about timing")).toBe(
      "Subject: S\n\nBody. Not sure about timing",
    );
  });
});

describe("error classification", () => {
  it("treats lost staff sessions as auth errors and gone resources as terminal", () => {
    expect(isAuthError(new ApiClientError("SESSION_EXPIRED", "x", 401))).toBe(true);
    expect(isAuthError(new ApiClientError("SUPPORT_FORBIDDEN", "x", 403))).toBe(true);
    expect(isAuthError(new ApiClientError("NETWORK_ERROR", "x", 0))).toBe(false);
    expect(isTerminalError(new ApiClientError("NOT_FOUND", "x", 404))).toBe(true);
    expect(isTerminalError(new ApiClientError("INTERNAL_ERROR", "x", 500))).toBe(false);
    expect(isTerminalError(new Error("boom"))).toBe(false);
  });
});
