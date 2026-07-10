// Local persistent store — SQLite with the sqlite-vec extension for vector
// search. Lives in Electron's per-user data dir (NEVER in the app bundle), so
// uninstalling the app doesn't wipe analyst data and reinstalling preserves it.
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

// nomic-embed-text:v1.5 returns 768-dim vectors. If you change embedding model
// you must rebuild the vec_chunks table — wipe whiteintel.db once.
export const EMBED_DIM = 768;

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "whiteintel.db");
  const conn = new Database(dbPath);
  sqliteVec.load(conn);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(`
    create table if not exists cases(
      id          text primary key,
      name        text not null,
      created_at  text not null default current_timestamp
    );
    create table if not exists docs(
      id          text primary key,
      case_id     text not null references cases(id) on delete cascade,
      path        text not null,
      name        text not null,
      pages       int,
      created_at  text not null default current_timestamp
    );
    create index if not exists idx_docs_case on docs(case_id);
    create table if not exists chunks(
      id          integer primary key autoincrement,
      doc_id      text not null references docs(id) on delete cascade,
      ordinal     int not null,
      text        text not null
    );
    create index if not exists idx_chunks_doc on chunks(doc_id);
    create virtual table if not exists vec_chunks using vec0(
      chunk_id integer primary key,
      embedding float[${EMBED_DIM}]
    );
  `);
  _db = conn;
  return conn;
}
