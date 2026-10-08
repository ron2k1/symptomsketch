import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { IdPrefix } from "@symptomsketch/contracts";
import { runMigrations } from "./schema.ts";

export type Db = DatabaseSync;

/** SQLite row values as returned by node:sqlite. */
export type Row = Record<string, string | number | bigint | null | Uint8Array>;

/**
 * Open (or create) `<dataDir>/symptomsketch.db`, enable WAL + foreign keys, run migrations.
 * Pass ":memory:" for an in-memory database (tests).
 */
export function openDb(dataDir: string): Db {
  let file = ":memory:";
  if (dataDir !== ":memory:") {
    mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, "symptomsketch.db");
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  runMigrations(db);
  return db;
}

const depth = new WeakMap<Db, number>();

/**
 * Run `fn` in a transaction (BEGIN IMMEDIATE). Nested calls use savepoints. `fn` must be
 * synchronous: node:sqlite is synchronous and an await inside would release the transaction scope.
 */
export function tx<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const sp = `sp_${level}`;
  db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error("tx() callback must be synchronous");
    }
    db.exec(level === 0 ? "COMMIT" : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    if (level === 0) {
      db.exec("ROLLBACK");
    } else {
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
    }
    throw err;
  } finally {
    depth.set(db, level);
  }
}

/** Current time as an ISO-8601 UTC string. */
export function now(): string {
  return new Date().toISOString();
}

/** ISO timestamp `ms` milliseconds from now (negative for the past). */
export function fromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/** Opaque id: `<prefix>_<16 random bytes base64url>`. Use ID_PREFIX from contracts. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

/** JSON column helpers. */
export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Typed single-row read. */
export function getRow<T>(
  db: Db,
  sql: string,
  ...params: (string | number | null)[]
): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

/** Typed multi-row read. */
export function allRows<T>(db: Db, sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
