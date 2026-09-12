import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";

mkdirSync("data", { recursive: true });

export const db = new Database(process.env.DATABASE_PATH ?? "data/localization.sqlite");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    root_url TEXT NOT NULL,
    source_language TEXT NOT NULL,
    target_language TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    http_status INTEGER,
    detected_language TEXT,
    word_count INTEGER NOT NULL DEFAULT 0,
    content_type TEXT NOT NULL DEFAULT 'other',
    crawl_issue TEXT,
    selected INTEGER NOT NULL DEFAULT 1,
    crawled_at TEXT,
    UNIQUE(project_id, url)
  );

  CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL DEFAULT '',
    element_type TEXT NOT NULL,
    selector TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    issue TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(page_id, selector, source_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_pages_project_id ON pages(project_id);
  CREATE INDEX IF NOT EXISTS idx_segments_page_id ON segments(page_id);
`);

export type ProjectRow = {
  id: string;
  root_url: string;
  source_language: string;
  target_language: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PageRow = {
  id: string;
  project_id: string;
  url: string;
  title: string;
  http_status: number | null;
  detected_language: string | null;
  word_count: number;
  content_type: string;
  crawl_issue: string | null;
  selected: number;
  crawled_at: string | null;
};

export type SegmentRow = {
  id: string;
  page_id: string;
  source_text: string;
  target_text: string;
  element_type: string;
  selector: string;
  source_hash: string;
  status: string;
  issue: string | null;
  created_at: string;
  updated_at: string;
};
