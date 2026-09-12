import "./config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { db, type PageRow, type ProjectRow, type SegmentRow } from "./db";
import { crawlJobs, crawlProject } from "./crawler";
import { translateText, translationMode } from "./translator";

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
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.root_url,
    row.source_language,
    row.target_language,
    row.status,
    row.created_at,
    row.updated_at,
  );

  return c.json(projectResponse(row), 201);
});

app.get("/api/projects/:projectId", (c) => {
  const row = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(c.req.param("projectId"));
  return row ? c.json(projectResponse(row)) : c.json({ error: "Project not found" }, 404);
});

app.delete("/api/projects/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const result = db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  if (result.changes === 0) return c.json({ error: "Project not found" }, 404);
  return c.json({ deleted: true, projectId });
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

app.post("/api/projects/:projectId/crawl", (c) => {
  const projectId = c.req.param("projectId");
  const project = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);
  const active = [...crawlJobs.entries()].find(([, job]) => job.status === "queued" || job.status === "running");
  if (active) return c.json({ error: "A crawl is already running", jobId: active[0] }, 409);

  const jobId = crypto.randomUUID();
  crawlJobs.set(jobId, { status: "queued", discovered: 0, crawled: 0, skipped: 0 });
  db.query("UPDATE projects SET status = 'crawling', updated_at = ? WHERE id = ?").run(now(), projectId);

  void (async () => {
    const job = crawlJobs.get(jobId)!;
    job.status = "running";
    try {
      await crawlProject(project, jobId);
      job.status = "completed";
      db.query("UPDATE projects SET status = 'crawled', updated_at = ? WHERE id = ?").run(now(), projectId);
    } catch (error) {
      job.status = "failed";
      job.issue = error instanceof Error ? error.message : "Crawl failed";
      db.query("UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ?").run(now(), projectId);
    }
  })();

  return c.json({ jobId, status: "queued" }, 202);
});

app.get("/api/crawl-jobs/:jobId", (c) => {
  const job = crawlJobs.get(c.req.param("jobId"));
  return job ? c.json(job) : c.json({ error: "Crawl job not found" }, 404);
});

app.get("/api/pages/:pageId/segments", (c) => {
  const rows = db.query<SegmentRow, [string]>(
    "SELECT * FROM segments WHERE page_id = ? ORDER BY id",
  ).all(c.req.param("pageId"));
  return c.json(rows.map(segmentResponse));
});

app.post("/api/pages/:pageId/translate", async (c) => {
  const pageId = c.req.param("pageId");
  const page = db.query<{ id: string; project_id: string; title: string }, [string]>(
    "SELECT id, project_id, title FROM pages WHERE id = ?",
  ).get(pageId);
  if (!page) return c.json({ error: "Page not found" }, 404);
  const project = db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = (SELECT project_id FROM pages WHERE id = ?)").get(pageId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const segments = db.query<SegmentRow, [string]>(
    "SELECT * FROM segments WHERE page_id = ? AND (status = 'pending' OR target_text = '') ORDER BY id",
  ).all(pageId);
  let translated = 0;
  for (const segment of segments) {
    try {
      const memory = db.query<{ target_text: string }, [string, string, string]>(
        `SELECT s.target_text FROM segments s
         JOIN pages p ON p.id = s.page_id
         JOIN projects pr ON pr.id = p.project_id
         WHERE s.source_text = ? AND s.target_text != '' AND s.status != 'pending'
           AND pr.source_language = ? AND pr.target_language = ? LIMIT 1`,
      ).get(segment.source_text, project.source_language, project.target_language);
      const result = memory ? { text: memory.target_text, mode: "memory" as const } : await translateText({
        sourceText: segment.source_text,
        sourceLanguage: project.source_language,
        targetLanguage: project.target_language,
        context: `${page.title} (${segment.element_type})`,
      });
      db.query("UPDATE segments SET target_text = ?, status = 'machine_translated', updated_at = ? WHERE id = ?").run(result.text, now(), segment.id);
      translated += 1;
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Translation failed", translated, mode: translationMode() }, 502);
    }
  }
  const rows = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE page_id = ? ORDER BY id").all(pageId);
  return c.json({ translated, mode: translationMode(), segments: rows.map(segmentResponse) });
});

app.post("/api/pages/:pageId/approve-ready", (c) => {
  const pageId = c.req.param("pageId");
  const page = db.query<{ id: string }, [string]>("SELECT id FROM pages WHERE id = ?").get(pageId);
  if (!page) return c.json({ error: "Page not found" }, 404);
  const result = db.query(
    "UPDATE segments SET status = 'approved', updated_at = ? WHERE page_id = ? AND target_text != '' AND status IN ('machine_translated', 'edited')",
  ).run(now(), pageId);
  const rows = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE page_id = ? ORDER BY id").all(pageId);
  return c.json({ approved: result.changes, segments: rows.map(segmentResponse) });
});

app.post("/api/segments/:segmentId/translate", async (c) => {
  const segmentId = c.req.param("segmentId");
  const segment = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE id = ?").get(segmentId);
  if (!segment) return c.json({ error: "Segment not found" }, 404);
  const project = db.query<ProjectRow, [string]>(
    "SELECT * FROM projects WHERE id = (SELECT project_id FROM pages WHERE id = (SELECT page_id FROM segments WHERE id = ?))",
  ).get(segmentId);
  if (!project) return c.json({ error: "Project not found" }, 404);
  try {
    const result = await translateText({ sourceText: segment.source_text, sourceLanguage: project.source_language, targetLanguage: project.target_language });
    db.query("UPDATE segments SET target_text = ?, status = 'machine_translated', updated_at = ? WHERE id = ?").run(result.text, now(), segmentId);
    const updated = db.query<SegmentRow, [string]>("SELECT * FROM segments WHERE id = ?").get(segmentId)!;
    return c.json({ ...segmentResponse(updated), mode: result.mode });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Translation failed" }, 502);
  }
});

app.patch("/api/pages/:pageId", async (c) => {
  const pageId = c.req.param("pageId");
  const body = await c.req.json<{ selected?: boolean }>();
  if (typeof body.selected !== "boolean") return c.json({ error: "selected must be a boolean" }, 400);
  const current = db.query<PageRow, [string]>("SELECT * FROM pages WHERE id = ?").get(pageId);
  if (!current) return c.json({ error: "Page not found" }, 404);
  db.query("UPDATE pages SET selected = ? WHERE id = ?").run(body.selected ? 1 : 0, pageId);
  const updated = db.query<PageRow, [string]>("SELECT * FROM pages WHERE id = ?").get(pageId)!;
  return c.json(pageResponse(updated));
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
