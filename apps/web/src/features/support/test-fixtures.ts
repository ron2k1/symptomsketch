/**
 * TEST-ONLY fixtures for support UI tests (labeled; never imported by app code or served live).
 * They model API DTOs from packages/contracts, not provider output.
 */
import { vi } from "vitest";
import type {
  CaseDetail,
  MediaAsset,
  ProductRevision,
  Take,
  Ticket,
} from "@symptomsketch/contracts";

const T0 = "2026-10-08T10:00:00.000Z";
const HASH = "b".repeat(64);

function asset(id: string, kind: MediaAsset["kind"], filename: string): MediaAsset {
  return {
    id,
    kind,
    mime: "image/jpeg",
    sizeBytes: 120_000,
    width: 1280,
    height: 853,
    sha256: HASH,
    filename,
    mediaUrl: `/api/assets/${id}/media`,
    downloadUrl: `/api/assets/${id}/download`,
    createdAt: T0,
  };
}

export const fixtureProduct: ProductRevision = {
  id: "prod_1",
  caseId: "case_1",
  sourceType: "demo_photo",
  fixtureId: "robot-vacuum",
  modelLabel: null,
  confirmedFeatures: [],
  sourceHash: HASH,
  original: asset("ast_orig", "original", "demo-vacuum.jpg"),
  normalized: asset("ast_norm", "normalized", "reference.jpg"),
  createdAt: T0,
};

export function fixtureTake(over: Partial<Take> = {}): Take {
  return {
    id: "take_a",
    caseId: "case_1",
    purpose: "problem",
    number: 2,
    planRevisionId: "plan_1",
    productRevisionId: "prod_1",
    procedureRevisionId: null,
    runId: "run_1",
    captureStatus: "complete",
    captureReason: null,
    firstOutputOffsetMs: 300,
    processingState: "ready",
    reviewState: "accepted",
    durationMs: 8000,
    sizeBytes: 900_000,
    sha256: HASH,
    width: 1280,
    height: 720,
    thumbnailUrl: null,
    mediaUrl: "/api/takes/take_a/media",
    downloadUrl: "/api/takes/take_a/download",
    caption: "Stops, then jerks backward once",
    errorCode: null,
    retryable: false,
    createdAt: T0,
    updatedAt: T0,
    currentAssessment: null,
    latestReview: null,
    ...over,
  };
}

export function fixtureCase(over: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: "case_1",
    title: "Robot vacuum",
    mode: "problem",
    status: "active",
    ownerRole: "customer",
    originalAccount: "The vacuum stops and then jerks backward once.",
    actionsTried: "Restarted it.",
    modelLabel: null,
    fixtureId: "robot-vacuum",
    productRevisionId: "prod_1",
    problemPlanId: "plan_1",
    solutionPlanId: null,
    sourceTicketId: null,
    createdAt: T0,
    updatedAt: T0,
    expiresAt: T0,
    product: fixtureProduct,
    products: [fixtureProduct],
    procedures: [],
    messages: [],
    plans: [],
    takes: [fixtureTake()],
    tickets: [],
    ...over,
  };
}

export function fixtureTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "tkt_1",
    queue: "SymptomSketch Demo Support",
    status: "submitted",
    snapshot: {
      caseTitle: "Robot vacuum",
      purpose: "problem",
      purposeLabel: "AI-generated reenactment",
      productLabel: "Robot vacuum",
      sourceType: "demo_photo",
      modelLabel: null,
      originalAccount: "The vacuum stops and then jerks backward once.",
      actionsTried: "Restarted it.",
      unresolved: ["cause unknown"],
      takeId: "take_a",
      takeNumber: 2,
      finalSha256: HASH,
      caption: "Stops, then jerks backward once",
      durationMs: 8000,
      assessmentStatus: "matches",
      assessmentSummary: null,
      reviewState: "accepted",
      uncertaintyNote: null,
      message: "Edited message",
      submittedAt: T0,
    },
    attachments: [],
    replies: [],
    workCaseIds: [],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown } | Error;

/** Stub global fetch with "<METHOD> <path>" handlers; unknown routes answer 404 NOT_FOUND. */
export function mockApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = handlers[`${method} ${url}`];
    const result = handler
      ? handler(init)
      : { status: 404, body: { code: "NOT_FOUND", message: "Not found." } };
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Parsed JSON bodies of every call to one route. */
export function bodiesOf(fetchMock: ReturnType<typeof mockApi>, method: string, url: string) {
  return fetchMock.mock.calls
    .filter(([u, init]) => u === url && (init?.method ?? "GET") === method)
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}
