/**
 * API surface (spec 11). `ROUTES` are Express path patterns (server registers with these exact
 * strings); `paths` builds concrete URLs for the browser. Keep both in sync.
 *
 * Request/response schemas per route:
 * | Route                                   | Request                         | Response                 |
 * | GET    /api/health                      | -                               | HealthResponse           |
 * | GET    /api/session                     | -                               | SessionState             |
 * | POST   /api/session                     | CreateSessionRequest            | SessionState             |
 * | POST   /api/support/session             | CreateSupportSessionRequest     | SessionState             |
 * | GET    /api/catalog                     | -                               | CatalogResponse          |
 * | POST   /api/cases                       | CreateCaseRequest               | CaseResponse (201)       |
 * | GET    /api/cases/:caseId               | -                               | CaseResponse             |
 * | PATCH  /api/cases/:caseId               | PatchCaseRequest                | CaseResponse             |
 * | DELETE /api/cases/:caseId               | -                               | OkResponse               |
 * | POST   /api/cases/:caseId/assets        | multipart `file`                | UploadAssetResponse      |
 * | POST   /api/cases/:caseId/product-revisions | CreateProductRevisionRequest | CreateProductRevisionResponse |
 * | POST   /api/cases/:caseId/procedures    | CreateProcedureRequest          | CreateProcedureResponse  |
 * | POST   /api/cases/:caseId/plans         | CreatePlanRequest               | PlannerResult            |
 * | POST   /api/cases/:caseId/reactor-token | ReactorTokenRequest             | ReactorTokenResponse     |
 * | POST   /api/cases/:caseId/preview-lease | PreviewLeaseRequest             | PreviewLeaseResponse     |
 * | POST   /api/cases/:caseId/takes         | multipart `recording` + `meta`  | CreateTakeResponse (202) |
 * | POST   /api/cases/:caseId/tickets       | CreateTicketRequest             | TicketResponse (201)     |
 * | GET    /api/assets/:assetId/media       | -                               | bytes (Range)            |
 * | GET    /api/assets/:assetId/download    | -                               | bytes (attachment)       |
 * | GET    /api/takes/:takeId               | -                               | GetTakeResponse          |
 * | POST   /api/takes/:takeId/assessment    | RequestAssessmentRequest        | TakeResponse (202)       |
 * | POST   /api/takes/:takeId/retry-export  | RetryExportRequest              | TakeResponse (202)       |
 * | GET    /api/takes/:takeId/media         | -                               | bytes (Range)            |
 * | POST   /api/takes/:takeId/review        | CreateReviewRequest             | TakeResponse             |
 * | GET    /api/takes/:takeId/download      | -                               | bytes (attachment)       |
 * | GET    /api/takes/:takeId/message       | -                               | TakeMessageResponse      |
 * | GET    /api/tickets/:ticketId           | -                               | TicketResponse           |
 * | POST   /api/tickets/:ticketId/replies   | CreateReplyRequest              | TicketResponse (201)     |
 * | POST   /api/tickets/:ticketId/work-case | CreateWorkCaseRequest           | CreateWorkCaseResponse   |
 * | GET    /api/tickets/:ticketId/attachments/:assetId/media    | -        | bytes (Range)            |
 * | GET    /api/tickets/:ticketId/attachments/:assetId/download | -        | bytes (attachment)       |
 * | GET    /api/support/tickets             | -                               | SupportInboxResponse     |
 * | POST   /api/tickets/:ticketId/support-call/token       | -                | SupportCallTokenResponse |
 * | POST   /api/tickets/:ticketId/support-call/brief       | -                | SupportCallBriefResponse |
 * | GET    /api/tickets/:ticketId/support-call/portrait    | -                | image/jpeg bytes         |
 * | PUT    /api/tickets/:ticketId/support-call/avatar      | SaveSupportCallAvatarRequest | OkResponse  |
 * | POST   /api/tickets/:ticketId/support-call/transcripts | CreateSupportCallTranscriptRequest | SupportCallTranscript (201) |
 * Errors: every non-2xx body is ApiError { code, message }.
 */

export const ROUTES = {
  health: "/api/health",
  session: "/api/session",
  supportSession: "/api/support/session",
  catalog: "/api/catalog",
  cases: "/api/cases",
  case: "/api/cases/:caseId",
  caseAssets: "/api/cases/:caseId/assets",
  caseProductRevisions: "/api/cases/:caseId/product-revisions",
  caseProcedures: "/api/cases/:caseId/procedures",
  casePlans: "/api/cases/:caseId/plans",
  caseReactorToken: "/api/cases/:caseId/reactor-token",
  casePreviewLease: "/api/cases/:caseId/preview-lease",
  caseTakes: "/api/cases/:caseId/takes",
  caseTickets: "/api/cases/:caseId/tickets",
  assetMedia: "/api/assets/:assetId/media",
  assetDownload: "/api/assets/:assetId/download",
  take: "/api/takes/:takeId",
  takeAssessment: "/api/takes/:takeId/assessment",
  takeRetryExport: "/api/takes/:takeId/retry-export",
  takeMedia: "/api/takes/:takeId/media",
  takeReview: "/api/takes/:takeId/review",
  takeDownload: "/api/takes/:takeId/download",
  takeMessage: "/api/takes/:takeId/message",
  ticket: "/api/tickets/:ticketId",
  ticketReplies: "/api/tickets/:ticketId/replies",
  ticketWorkCase: "/api/tickets/:ticketId/work-case",
  ticketAttachmentMedia: "/api/tickets/:ticketId/attachments/:assetId/media",
  ticketAttachmentDownload: "/api/tickets/:ticketId/attachments/:assetId/download",
  supportTickets: "/api/support/tickets",
  ticketSupportCallToken: "/api/tickets/:ticketId/support-call/token",
  ticketSupportCallBrief: "/api/tickets/:ticketId/support-call/brief",
  ticketSupportCallPortrait: "/api/tickets/:ticketId/support-call/portrait",
  ticketSupportCallAvatar: "/api/tickets/:ticketId/support-call/avatar",
  ticketSupportCallTranscripts: "/api/tickets/:ticketId/support-call/transcripts",
} as const;
export type RouteName = keyof typeof ROUTES;

const e = encodeURIComponent;

export const paths = {
  health: () => ROUTES.health,
  session: () => ROUTES.session,
  supportSession: () => ROUTES.supportSession,
  catalog: () => ROUTES.catalog,
  cases: () => ROUTES.cases,
  case: (caseId: string) => `/api/cases/${e(caseId)}`,
  caseAssets: (caseId: string) => `/api/cases/${e(caseId)}/assets`,
  caseProductRevisions: (caseId: string) => `/api/cases/${e(caseId)}/product-revisions`,
  caseProcedures: (caseId: string) => `/api/cases/${e(caseId)}/procedures`,
  casePlans: (caseId: string) => `/api/cases/${e(caseId)}/plans`,
  caseReactorToken: (caseId: string) => `/api/cases/${e(caseId)}/reactor-token`,
  casePreviewLease: (caseId: string) => `/api/cases/${e(caseId)}/preview-lease`,
  caseTakes: (caseId: string) => `/api/cases/${e(caseId)}/takes`,
  caseTickets: (caseId: string) => `/api/cases/${e(caseId)}/tickets`,
  assetMedia: (assetId: string) => `/api/assets/${e(assetId)}/media`,
  assetDownload: (assetId: string) => `/api/assets/${e(assetId)}/download`,
  take: (takeId: string) => `/api/takes/${e(takeId)}`,
  takeAssessment: (takeId: string) => `/api/takes/${e(takeId)}/assessment`,
  takeRetryExport: (takeId: string) => `/api/takes/${e(takeId)}/retry-export`,
  takeMedia: (takeId: string) => `/api/takes/${e(takeId)}/media`,
  takeReview: (takeId: string) => `/api/takes/${e(takeId)}/review`,
  takeDownload: (takeId: string) => `/api/takes/${e(takeId)}/download`,
  takeMessage: (takeId: string) => `/api/takes/${e(takeId)}/message`,
  ticket: (ticketId: string) => `/api/tickets/${e(ticketId)}`,
  ticketReplies: (ticketId: string) => `/api/tickets/${e(ticketId)}/replies`,
  ticketWorkCase: (ticketId: string) => `/api/tickets/${e(ticketId)}/work-case`,
  ticketAttachmentMedia: (ticketId: string, assetId: string) =>
    `/api/tickets/${e(ticketId)}/attachments/${e(assetId)}/media`,
  ticketAttachmentDownload: (ticketId: string, assetId: string) =>
    `/api/tickets/${e(ticketId)}/attachments/${e(assetId)}/download`,
  supportTickets: () => ROUTES.supportTickets,
  ticketSupportCallToken: (ticketId: string) => `/api/tickets/${e(ticketId)}/support-call/token`,
  ticketSupportCallBrief: (ticketId: string) => `/api/tickets/${e(ticketId)}/support-call/brief`,
  ticketSupportCallPortrait: (ticketId: string) =>
    `/api/tickets/${e(ticketId)}/support-call/portrait`,
  ticketSupportCallAvatar: (ticketId: string) => `/api/tickets/${e(ticketId)}/support-call/avatar`,
  ticketSupportCallTranscripts: (ticketId: string) =>
    `/api/tickets/${e(ticketId)}/support-call/transcripts`,
} as const;

/** Browser routes (react-router). */
export const APP_PATHS = {
  landing: () => "/",
  caseTab: (caseId: string, tab: "issue" | "recreate" | "support") => `/cases/${e(caseId)}/${tab}`,
  supportInbox: () => "/support",
  supportTicket: (ticketId: string) => `/support/tickets/${e(ticketId)}`,
} as const;
