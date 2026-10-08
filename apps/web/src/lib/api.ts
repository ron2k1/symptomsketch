import {
  ASSET_UPLOAD_FIELD,
  ERROR_COPY,
  ErrorCode,
  TAKE_UPLOAD_FIELDS,
  paths,
  type CaseResponse,
  type CatalogResponse,
  type CreateCaseRequest,
  type CreatePlanRequest,
  type CreateProcedureRequest,
  type CreateProcedureResponse,
  type CreateProductRevisionRequest,
  type CreateProductRevisionResponse,
  type CreateReplyRequest,
  type CreateReviewRequest,
  type CreateTakeMeta,
  type CreateTakeResponse,
  type CreateTicketRequest,
  type CreateWorkCaseRequest,
  type CreateWorkCaseResponse,
  type GetTakeResponse,
  type HealthResponse,
  type OkResponse,
  type PatchCaseRequest,
  type PlannerResult,
  type PreviewLeaseRequest,
  type PreviewLeaseResponse,
  type ReactorTokenRequest,
  type ReactorTokenResponse,
  type RequestAssessmentRequest,
  type RetryExportRequest,
  type CreateSupportCallTranscriptRequest,
  type SaveSupportCallAvatarRequest,
  type SessionState,
  type SupportCallBriefResponse,
  type SupportCallTokenResponse,
  type SupportCallTranscript,
  type SupportInboxResponse,
  type TakeMessageResponse,
  type TakeResponse,
  type TicketResponse,
  type UploadAssetResponse,
} from "@symptomsketch/contracts";

/** Every failed API call throws this. `code` is a contracts ErrorCode (or NETWORK_ERROR). */
export class ApiClientError extends Error {
  readonly code: ErrorCode | "NETWORK_ERROR";
  readonly status: number;
  constructor(code: ErrorCode | "NETWORK_ERROR", message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

export function isApiClientError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError;
}

/** User-facing copy for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return ERROR_COPY.INTERNAL_ERROR;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function toError(res: Response): Promise<ApiClientError> {
  let code: ErrorCode = "INTERNAL_ERROR";
  let message: string = ERROR_COPY.INTERNAL_ERROR;
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    const parsed = ErrorCode.safeParse(body.code);
    if (parsed.success) {
      code = parsed.data;
      message = typeof body.message === "string" ? body.message : ERROR_COPY[code];
    }
  } catch {
    // non-JSON error body (proxy / server down)
  }
  return new ApiClientError(code, message, res.status);
}

async function send<T>(
  method: Method,
  url: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not reach the server.", 0);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(url: string, init?: RequestInit) => send<T>("GET", url, undefined, init);
const post = <T>(url: string, body?: unknown, init?: RequestInit) =>
  send<T>("POST", url, body ?? {}, init);

/* Health + session */
export const getHealth = () => get<HealthResponse>(paths.health());
export const getSession = () => get<SessionState>(paths.session());
export const createSession = (accessCode: string) =>
  post<SessionState>(paths.session(), { accessCode });
export const createSupportSession = (supportCode: string) =>
  post<SessionState>(paths.supportSession(), { supportCode });

/* Catalog */
export const getCatalog = () => get<CatalogResponse>(paths.catalog());

/* Cases */
export const createCase = (req: CreateCaseRequest) => post<CaseResponse>(paths.cases(), req);
export const getCase = (caseId: string, init?: RequestInit) =>
  get<CaseResponse>(paths.case(caseId), init);
export const patchCase = (caseId: string, req: PatchCaseRequest) =>
  send<CaseResponse>("PATCH", paths.case(caseId), req);
export const deleteCase = (caseId: string) => send<OkResponse>("DELETE", paths.case(caseId));

/* Product reference */
export function uploadAsset(caseId: string, file: File): Promise<UploadAssetResponse> {
  const form = new FormData();
  form.append(ASSET_UPLOAD_FIELD, file, file.name);
  return send<UploadAssetResponse>("POST", paths.caseAssets(caseId), form);
}
export const createProductRevision = (caseId: string, req: CreateProductRevisionRequest) =>
  post<CreateProductRevisionResponse>(paths.caseProductRevisions(caseId), req);
export const createProcedure = (caseId: string, req: CreateProcedureRequest) =>
  post<CreateProcedureResponse>(paths.caseProcedures(caseId), req);

/* Planning + preview */
export const createPlan = (caseId: string, req: CreatePlanRequest, init?: RequestInit) =>
  post<PlannerResult>(paths.casePlans(caseId), req, init);
export const createReactorToken = (caseId: string, req: ReactorTokenRequest) =>
  post<ReactorTokenResponse>(paths.caseReactorToken(caseId), req);
export const previewLease = (caseId: string, req: PreviewLeaseRequest) =>
  post<PreviewLeaseResponse>(paths.casePreviewLease(caseId), req);

/* Takes */
export function uploadTake(
  caseId: string,
  recording: Blob,
  meta: CreateTakeMeta,
): Promise<CreateTakeResponse> {
  const form = new FormData();
  const ext = meta.mimeType.includes("mp4") ? "mp4" : "webm";
  form.append(TAKE_UPLOAD_FIELDS.meta, JSON.stringify(meta));
  form.append(TAKE_UPLOAD_FIELDS.recording, recording, `recording.${ext}`);
  return send<CreateTakeResponse>("POST", paths.caseTakes(caseId), form);
}
export const getTake = (takeId: string, init?: RequestInit) =>
  get<GetTakeResponse>(paths.take(takeId), init);
export const requestAssessment = (takeId: string, req: RequestAssessmentRequest) =>
  post<TakeResponse>(paths.takeAssessment(takeId), req);
export const retryExport = (takeId: string, req: RetryExportRequest) =>
  post<TakeResponse>(paths.takeRetryExport(takeId), req);
export const reviewTake = (takeId: string, req: CreateReviewRequest) =>
  post<TakeResponse>(paths.takeReview(takeId), req);
export const getTakeMessage = (takeId: string) =>
  get<TakeMessageResponse>(paths.takeMessage(takeId));

/* Tickets + support */
export const createTicket = (caseId: string, req: CreateTicketRequest) =>
  post<TicketResponse>(paths.caseTickets(caseId), req);
export const getTicket = (ticketId: string, init?: RequestInit) =>
  get<TicketResponse>(paths.ticket(ticketId), init);
export const listSupportTickets = (init?: RequestInit) =>
  get<SupportInboxResponse>(paths.supportTickets(), init);
export const createReply = (ticketId: string, req: CreateReplyRequest) =>
  post<TicketResponse>(paths.ticketReplies(ticketId), req);
export const createWorkCase = (ticketId: string, req: CreateWorkCaseRequest) =>
  post<CreateWorkCaseResponse>(paths.ticketWorkCase(ticketId), req);

/* Live AI support agent call (Reactor Vidu S2 Avatar) */
export const createSupportCallToken = (ticketId: string) =>
  post<SupportCallTokenResponse>(paths.ticketSupportCallToken(ticketId));
export const getSupportCallBrief = (ticketId: string, init?: RequestInit) =>
  post<SupportCallBriefResponse>(paths.ticketSupportCallBrief(ticketId), undefined, init);
export const saveSupportCallAvatar = (ticketId: string, req: SaveSupportCallAvatarRequest) =>
  send<OkResponse>("PUT", paths.ticketSupportCallAvatar(ticketId), req);

/** keepalive lets the save outlive a closing tab; browsers cap keepalive bodies at 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60_000;
export const saveSupportCallTranscript = (
  ticketId: string,
  req: CreateSupportCallTranscriptRequest,
) =>
  post<SupportCallTranscript>(paths.ticketSupportCallTranscripts(ticketId), req, {
    keepalive: new TextEncoder().encode(JSON.stringify(req)).length < KEEPALIVE_MAX_BYTES,
  });

/**
 * The ticket's agent portrait for create_avatar (the per-ticket Nano Banana composite). A failed
 * composite is a PROVIDER_FAILED / PROVIDER_TIMEOUT error that the call shows with Retry.
 */
export async function fetchSupportCallPortrait(url: string, init?: RequestInit): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not reach the server.", 0);
  }
  if (!res.ok) throw await toError(res);
  return res.blob();
}

/* Authorized media URLs (same-origin; cookie carries auth). */
export const mediaUrls = {
  asset: (assetId: string) => paths.assetMedia(assetId),
  assetDownload: (assetId: string) => paths.assetDownload(assetId),
  take: (takeId: string) => paths.takeMedia(takeId),
  takeDownload: (takeId: string) => paths.takeDownload(takeId),
  ticketAttachment: (ticketId: string, assetId: string) =>
    paths.ticketAttachmentMedia(ticketId, assetId),
  ticketAttachmentDownload: (ticketId: string, assetId: string) =>
    paths.ticketAttachmentDownload(ticketId, assetId),
} as const;
