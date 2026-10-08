import type {
  CaptureStatus,
  ProcessingState,
  Purpose,
  ReviewDecision,
  ReviewState,
  Role,
  SourceType,
  TicketAttachmentPurpose,
  TicketStatus,
} from "@symptomsketch/contracts";

/** SQLite row shapes the support domain reads (schema owned by architect in db/schema.ts). */

export interface TicketRow {
  id: string;
  case_id: string;
  owner_session_id: string;
  /** Null for a ticket a sent story opened (no X2 take). */
  take_id: string | null;
  queue: string;
  status: TicketStatus;
  snapshot_json: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface AttachmentRow {
  id: string;
  ticket_id: string;
  asset_id: string;
  sha256: string;
  purpose: TicketAttachmentPurpose;
  filename: string;
  lineage_json: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ReplyRow {
  id: string;
  ticket_id: string;
  author_session_id: string;
  text: string;
  attachment_id: string | null;
  take_id: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export interface CaseRow {
  id: string;
  owner_session_id: string;
  owner_role: Role;
  title: string;
  mode: Purpose;
  status: "active" | "deleted" | "expired";
  original_account: string;
  actions_tried: string;
  model_label: string | null;
  fixture_id: string | null;
  product_revision_id: string | null;
  source_ticket_id: string | null;
  created_at: string;
  expires_at: string;
}

export interface AssetRow {
  id: string;
  case_id: string;
  owner_session_id: string;
  kind: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sha256: string;
  filename: string | null;
  storage_path: string;
  created_at: string;
  deleted_at: string | null;
}

export interface ProductRevisionRow {
  id: string;
  case_id: string;
  source_type: SourceType;
  fixture_id: string | null;
  original_asset_id: string;
  normalized_asset_id: string;
  model_label: string | null;
  confirmed_features_json: string;
  source_hash: string;
}

export interface TakeRow {
  id: string;
  case_id: string;
  purpose: Purpose;
  number: number;
  plan_revision_id: string;
  product_revision_id: string;
  capture_status: CaptureStatus;
  processing_state: ProcessingState;
  review_state: ReviewState;
  final_asset_id: string | null;
  duration_ms: number | null;
  sha256: string | null;
  caption: string;
  current_assessment_id: string | null;
}

export interface ReviewRow {
  id: string;
  take_id: string;
  final_sha256: string;
  decision: ReviewDecision;
  resulting_state: ReviewState;
  uncertainty_note: string | null;
  created_at: string;
}

export interface AssessmentRow {
  id: string;
  final_sha256: string;
  job_state: "queued" | "running" | "done" | "failed";
  result_status: "matches" | "needs_revision" | "uncertain" | null;
  summary: string | null;
  result_json: string | null;
}

export interface PlanRow {
  id: string;
  plan_json: string;
  unclear_json: string;
}
