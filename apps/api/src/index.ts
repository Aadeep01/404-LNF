import { Hono } from "hono";
import { cors } from "hono/cors";
import { db, type PageRow, type ProjectRow, type SegmentRow } from "./db";

const app = new Hono();

app.use("/api/*", cors({ origin: "*" }));

const now = () => new Date().toISOString();

function projectResponse(row: ProjectRow) {
  return {
    id: row.id,
    rootUrl: row.root_url,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pageResponse(row: PageRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    url: row.url,
    title: row.title,
    httpStatus: row.http_status,
    detectedLanguage: row.detected_language,
    wordCount: row.word_count,
    contentType: row.content_type,
    crawlIssue: row.crawl_issue,
    selected: Boolean(row.selected),
    crawledAt: row.crawled_at,
  };
}

function segmentResponse(row: SegmentRow) {
  return {
    id: row.id,
    pageId: row.page_id,
    sourceText: row.source_text,
    targetText: row.target_text,
    elementType: row.element_type,
    selector: row.selector,
    sourceHash: row.source_hash,
    status: row.status,
    issue: row.issue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

app.get("/api/health", (c) => c.json({ status: "ok" }));

app.get("/api/projects", (c) => {
  const rows = db.query<ProjectRow, []>(
    "SELECT * FROM projects ORDER BY created_at DESC",
  ).all();
  return c.json(rows.map(projectResponse));
});

app.post("/api/projects", async (c) => {
  const body = await c.req.json<{
    rootUrl?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  }>();

  if (!body.rootUrl || !body.sourceLanguage || !body.targetLanguage) {
    return c.json({ error: "rootUrl, sourceLanguage, and targetLanguage are required" }, 400);
  }

  let url: URL;
  try {
    url = new URL(body.rootUrl);
  } catch {
    return c.json({ error: "rootUrl must be a valid URL" }, 400);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return c.json({ error: "rootUrl must use HTTP or HTTPS" }, 400);
  }

  const timestamp = now();
  const row: ProjectRow = {
    id: crypto.randomUUID(),
    root_url: url.toString(),
    source_language: body.sourceLanguage.trim(),
    target_language: body.targetLanguage.trim(),
    status: "draft",
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.query(
    `INSERT INTO projects (id, root_url, source_language, target_language, status, created_at, updated_at)
     VALUES ($id, $root_url, $source_language, $target_language, $status, $created_at, $updated_at)`,
  ).run(row);

  return c.json(projectResponse(row), 201);
});

app.get("/api/projects/:projectId", (c) => {
  const row = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(c.req.param("projectId"));
  return row ? c.json(projectResponse(row)) : c.json({ error: "Project not found" }, 404);
});

app.get("/api/projects/:projectId/pages", (c) => {
  const projectId = c.req.param("projectId");
  const project = db.query("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const rows = db.query<PageRow, [string]>(
    "SELECT * FROM pages WHERE project_id = ? ORDER BY url",
  ).all(projectId);
  return c.json(rows.map(pageResponse));
});

app.get("/api/pages/:pageId/segments", (c) => {
  const rows = db.query<SegmentRow, [string]>(
    "SELECT * FROM segments WHERE page_id = ? ORDER BY id",
  ).all(c.req.param("pageId"));
  return c.json(rows.map(segmentResponse));
});

app.patch("/api/segments/:segmentId", async (c) => {
  const segmentId = c.req.param("segmentId");
  const body = await c.req.json<{ targetText?: string; status?: string }>();
  const current = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE id = ?").get(segmentId);
  if (!current) return c.json({ error: "Segment not found" }, 404);

  const targetText = body.targetText ?? current.target_text;
  const status = body.status ?? (targetText !== current.target_text ? "edited" : current.status);
  const updatedAt = now();
  db.query(
    "UPDATE segments SET target_text = ?, status = ?, updated_at = ? WHERE id = ?",
  ).run(targetText, status, updatedAt, segmentId);

  const updated = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE id = ?").get(segmentId)!;
  return c.json(segmentResponse(updated));
});

app.post("/api/segments/:segmentId/approve", (c) => {
  const segmentId = c.req.param("segmentId");
  const current = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE id = ?").get(segmentId);
  if (!current) return c.json({ error: "Segment not found" }, 404);
  if (!current.target_text.trim()) return c.json({ error: "A translation is required before approval" }, 400);

  db.query("UPDATE segments SET status = 'approved', updated_at = ? WHERE id = ?").run(now(), segmentId);
  const updated = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE id = ?").get(segmentId)!;
  return c.json(segmentResponse(updated));
});

export default {
  port: Number(process.env.PORT ?? 8000),
  fetch: app.fetch,
};
