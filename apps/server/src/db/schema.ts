import type { DatabaseSync } from "node:sqlite";

/**
 * Ordered, append-only migrations. Never edit a shipped migration; add a new entry instead.
 * Version tracking uses PRAGMA user_version (= number of applied migrations).
 * All timestamps are ISO-8601 UTC TEXT. JSON columns end in _json.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1: initial schema (spec 10) */ `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('customer','support')),
  access_granted INTEGER NOT NULL DEFAULT 0,
  plan_calls INTEGER NOT NULL DEFAULT 0,
  critic_calls INTEGER NOT NULL DEFAULT 0,
  token_issues INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  owner_role TEXT NOT NULL CHECK (owner_role IN ('customer','support')),
  title TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL CHECK (mode IN ('problem','solution')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted','expired')),
  original_account TEXT NOT NULL DEFAULT '',
  actions_tried TEXT NOT NULL DEFAULT '',
  model_label TEXT,
  fixture_id TEXT,
  product_revision_id TEXT REFERENCES product_revisions(id) ON DELETE SET NULL,
  problem_plan_id TEXT REFERENCES plan_revisions(id) ON DELETE SET NULL,
  solution_plan_id TEXT REFERENCES plan_revisions(id) ON DELETE SET NULL,
  source_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  take_counter INTEGER NOT NULL DEFAULT 0,
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_cases_owner ON cases(owner_session_id, status);
CREATE UNIQUE INDEX idx_cases_client_req ON cases(owner_session_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Every stored file. storage_path is relative to DATA_DIR and never leaves the server.
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  owner_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('original','normalized','thumbnail','recording','final_mp4','take_thumbnail')),
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms REAL,
  sha256 TEXT NOT NULL,
  filename TEXT,
  storage_path TEXT NOT NULL,
  source_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  lineage_json TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_assets_case ON assets(case_id);

CREATE TABLE product_revisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('demo_photo','uploaded_photo')),
  fixture_id TEXT,
  original_asset_id TEXT NOT NULL REFERENCES assets(id),
  normalized_asset_id TEXT NOT NULL REFERENCES assets(id),
  model_label TEXT,
  confirmed_features_json TEXT NOT NULL DEFAULT '[]',
  source_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_product_revisions_case ON product_revisions(case_id);

CREATE TABLE procedure_revisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  product_revision_id TEXT NOT NULL REFERENCES product_revisions(id),
  title TEXT NOT NULL,
  procedure_code TEXT,
  approved_text TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  source_description TEXT NOT NULL,
  source_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  model_applicability_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_procedure_revisions_case ON procedure_revisions(case_id);

CREATE TABLE plan_revisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES plan_revisions(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('problem','solution')),
  product_revision_id TEXT NOT NULL REFERENCES product_revisions(id),
  procedure_revision_id TEXT REFERENCES procedure_revisions(id),
  status TEXT NOT NULL CHECK (status IN ('ready','needs_clarification','invalid')),
  plan_json TEXT NOT NULL,
  reactor_prompt TEXT,
  caption TEXT NOT NULL,
  understanding TEXT NOT NULL DEFAULT '',
  preserved_json TEXT NOT NULL DEFAULT '[]',
  unclear_json TEXT NOT NULL DEFAULT '[]',
  clarification_question TEXT,
  validation_issues_json TEXT NOT NULL DEFAULT '[]',
  model_id TEXT,
  client_request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_plan_revisions_case ON plan_revisions(case_id, purpose);
CREATE UNIQUE INDEX idx_plan_revisions_client_req ON plan_revisions(case_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('problem','solution')),
  role TEXT NOT NULL CHECK (role IN ('user','planner')),
  kind TEXT NOT NULL CHECK (kind IN ('account','actions_tried','correction','answer','understanding','clarification')),
  text TEXT NOT NULL,
  plan_revision_id TEXT REFERENCES plan_revisions(id) ON DELETE SET NULL,
  highlights_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_case ON messages(case_id, created_at);

CREATE TABLE takes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('problem','solution')),
  number INTEGER NOT NULL,
  plan_revision_id TEXT NOT NULL REFERENCES plan_revisions(id),
  product_revision_id TEXT NOT NULL REFERENCES product_revisions(id),
  procedure_revision_id TEXT REFERENCES procedure_revisions(id),
  run_id TEXT NOT NULL,
  capture_status TEXT NOT NULL CHECK (capture_status IN ('complete','incomplete')),
  capture_reason TEXT CHECK (capture_reason IN ('output_timeout','output_stalled','disconnected','user_cancelled')),
  first_output_offset_ms REAL,
  recorded_duration_ms REAL,
  processing_state TEXT NOT NULL CHECK (processing_state IN ('uploading','queued','converting','ready','failed')),
  review_state TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed','uncertain','rejected','accepted')),
  raw_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  final_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  thumbnail_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  duration_ms REAL,
  size_bytes INTEGER,
  sha256 TEXT,
  width INTEGER,
  height INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  error_code TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  current_assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (case_id, number)
);
CREATE INDEX idx_takes_case ON takes(case_id);
CREATE UNIQUE INDEX idx_takes_idem ON takes(case_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  take_id TEXT NOT NULL REFERENCES takes(id) ON DELETE CASCADE,
  final_sha256 TEXT NOT NULL,
  product_revision_id TEXT NOT NULL,
  plan_revision_id TEXT NOT NULL,
  procedure_revision_id TEXT,
  model_id TEXT NOT NULL,
  critic_prompt_version TEXT NOT NULL,
  input_coverage_json TEXT NOT NULL,
  job_state TEXT NOT NULL CHECK (job_state IN ('queued','running','done','failed')),
  result_status TEXT CHECK (result_status IN ('matches','needs_revision','uncertain')),
  summary TEXT,
  result_json TEXT,
  error_code TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_assessments_take ON assessments(take_id);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  take_id TEXT NOT NULL REFERENCES takes(id) ON DELETE CASCADE,
  final_sha256 TEXT NOT NULL,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accept','refine','unsure')),
  resulting_state TEXT NOT NULL CHECK (resulting_state IN ('unreviewed','uncertain','rejected','accepted')),
  uncertainty_note TEXT,
  reviewer_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  reviewer_role TEXT NOT NULL CHECK (reviewer_role IN ('customer','support')),
  idempotency_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reviews_take ON reviews(take_id, created_at);
CREATE UNIQUE INDEX idx_reviews_idem ON reviews(take_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  owner_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  take_id TEXT NOT NULL REFERENCES takes(id),
  queue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','replied','revoked')),
  snapshot_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_session_id, idempotency_key)
);
CREATE INDEX idx_tickets_status ON tickets(status, created_at);

CREATE TABLE ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('customer_reference','customer_take','customer_original','support_reply_take')),
  filename TEXT NOT NULL,
  lineage_json TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (ticket_id, asset_id)
);

CREATE TABLE ticket_replies (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_session_id TEXT NOT NULL REFERENCES sessions(id),
  text TEXT NOT NULL,
  attachment_id TEXT REFERENCES ticket_attachments(id) ON DELETE SET NULL,
  take_id TEXT REFERENCES takes(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_replies_ticket ON ticket_replies(ticket_id, created_at);
CREATE UNIQUE INDEX idx_ticket_replies_idem ON ticket_replies(ticket_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Generic SQLite job queue (db/jobs.ts): export + visual-check + cleanup.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','retryable')),
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  case_id TEXT,
  error_code TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_jobs_claim ON jobs(kind, status, created_at);
CREATE INDEX idx_jobs_case ON jobs(case_id);

-- Preview capacity leases (spec 8).
CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  plan_revision_id TEXT,
  created_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX idx_leases_active ON leases(released_at, expires_at);

-- Generic idempotency record for routes that are not naturally keyed by a table above.
CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, session_id, key)
);
`,
  /* 2: live AI support agent call, per-ticket cache (call package + saved Reactor avatar id) */ `
CREATE TABLE ticket_support_calls (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  persona TEXT,
  greeting TEXT,
  brief_model_id TEXT,
  avatar_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  /* 3: final transcripts of live AI support agent calls, shown to Demo Support on the ticket */ `
CREATE TABLE support_call_transcripts (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lines_json TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  end_reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (ticket_id, session_id, idempotency_key)
);
CREATE INDEX idx_support_call_transcripts_ticket ON support_call_transcripts(ticket_id, created_at);
`,
];

/** Apply pending migrations inside one transaction each. Returns the resulting schema version. */
export function runMigrations(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version]!;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    version += 1;
  }
  return version;
}
