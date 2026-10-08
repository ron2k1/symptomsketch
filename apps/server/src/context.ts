import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Router } from "express";
import type { AppConfig } from "./config.ts";
import { type Db, openDb } from "./db/index.ts";
import { JobQueue } from "./db/jobs.ts";

/** Absolute directories under DATA_DIR. Never exposed as a static directory (spec 14). */
export interface DataPaths {
  root: string;
  /** Untouched uploads / copied demo photos. */
  originals: string;
  /** Normalized working references (<= 1280 long edge, EXIF stripped). */
  normalized: string;
  /** Raw MediaRecorder uploads (kept for one export retry window). */
  recordings: string;
  /** Final immutable MP4s. */
  finals: string;
  /** Take + reference thumbnails. */
  thumbnails: string;
  /** Partial / in-progress files; write here then rename atomically into place. */
  tmp: string;
}

export interface AppContext {
  config: AppConfig;
  db: Db;
  paths: DataPaths;
  jobs: JobQueue;
}

/** Every route module exports `register(router, ctx)`; app.ts mounts them in order. */
export type RegisterRoutes = (router: Router, ctx: AppContext) => void;

export function resolveDataPaths(dataDir: string): DataPaths {
  const root = path.resolve(dataDir);
  return {
    root,
    originals: path.join(root, "media", "originals"),
    normalized: path.join(root, "media", "normalized"),
    recordings: path.join(root, "media", "recordings"),
    finals: path.join(root, "media", "finals"),
    thumbnails: path.join(root, "media", "thumbnails"),
    tmp: path.join(root, "tmp"),
  };
}

export function ensureDataDirs(paths: DataPaths): void {
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
}

/** Create directories, open + migrate SQLite, build the job queue (not started). */
export function createContext(config: AppConfig, opts: { dataDir?: string } = {}): AppContext {
  const paths = resolveDataPaths(opts.dataDir ?? config.dataDir);
  ensureDataDirs(paths);
  const db = openDb(paths.root);
  const jobs = new JobQueue(db);
  return { config, db, paths, jobs };
}
