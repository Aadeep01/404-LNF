import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, API_URL, type CrawlJob, type Page, type Project, type Segment } from "./api";
import "./styles.css";

const languages: Record<string, string> = { en: "English", es: "Spanish", fr: "French", de: "German", hi: "Hindi" };
const nameOf = (code: string) => languages[code.toLowerCase()] ?? code.toUpperCase();

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [editorPage, setEditorPage] = useState<Page | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [form, setForm] = useState({ rootUrl: "", sourceLanguage: "en", targetLanguage: "es" });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [publishResult, setPublishResult] = useState<{ approvedSegments: number; targetLanguage: string; snippet: string } | null>(null);

  useEffect(() => {
    api.listProjects().then((items) => { setProjects(items); if (items[0]) selectProject(items[0]); }).catch(showError);
  }, []);

  function showError(reason: unknown) { setError(reason instanceof Error ? reason.message : "Something went wrong"); }
  function selectProject(next: Project) { setProject(next); setError(""); setPublishResult(null); api.listPages(next.id).then(setPages).catch(showError); }
  async function openEditor(page: Page) { setEditorPage(page); setError(""); try { setSegments(await api.listSegments(page.id)); } catch (reason) { showError(reason); } }

  async function deleteProject(item: Project) {
    if (!window.confirm(`Delete the ${new URL(item.rootUrl).hostname} project? Its pages and translations will also be removed.`)) return;
    try {
      await api.deleteProject(item.id);
      const remaining = projects.filter((candidate) => candidate.id !== item.id);
      setProjects(remaining);
      if (project?.id === item.id) {
        setProject(null);
        setPages([]);
        setJob(null);
        if (remaining[0]) selectProject(remaining[0]);
      }
    } catch (reason) { showError(reason); }
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const created = await api.createProject(form); setProjects((items) => [created, ...items]); selectProject(created); setForm({ rootUrl: "", sourceLanguage: "en", targetLanguage: "es" }); }
    catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function startCrawl() {
    if (!project) return; setBusy(true); setError(""); setJob(null);
    try { const started = await api.startCrawl(project.id); await pollJob(started.jobId, project.id); }
    catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  async function pollJob(jobId: string, projectId: string): Promise<void> {
    const current = await api.getCrawlJob(jobId); setJob(current);
    if (current.status === "queued" || current.status === "running") { await new Promise((resolve) => setTimeout(resolve, 1000)); return pollJob(jobId, projectId); }
    setPages(await api.listPages(projectId));
    setProjects((items) => items.map((item) => item.id === projectId ? { ...item, status: current.status === "completed" ? "crawled" : "failed" } : item));
  }

  async function togglePage(page: Page) { try { const updated = await api.updatePage(page.id, !page.selected); setPages((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (reason) { showError(reason); } }
  async function translatePage() { if (!editorPage) return; setTranslationBusy(true); setError(""); try { const result = await api.translatePage(editorPage.id); setSegments(result.segments); } catch (reason) { showError(reason); } finally { setTranslationBusy(false); } }
  async function approveReady() { if (!editorPage) return; setTranslationBusy(true); setError(""); try { const result = await api.approveReady(editorPage.id); setSegments(result.segments); } catch (reason) { showError(reason); } finally { setTranslationBusy(false); } }
  async function saveSegment(segment: Segment, targetText: string) { try { const updated = await api.updateSegment(segment.id, targetText); setSegments((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (reason) { showError(reason); } }
  async function regenerateSegment(segment: Segment) { try { const updated = await api.translateSegment(segment.id); setSegments((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (reason) { showError(reason); } }
  async function approveSegment(segment: Segment) { try { const updated = await api.approveSegment(segment.id); setSegments((items) => items.map((item) => item.id === updated.id ? updated : item)); } catch (reason) { showError(reason); } }
  async function publishProject() {
    if (!project) return;
    setBusy(true); setError("");
    try { const result = await api.publishProject(project.id); setPublishResult(result); setProject({ ...project, status: "published" }); setProjects((items) => items.map((item) => item.id === project.id ? { ...item, status: "published" } : item)); }
    catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  const visiblePages = useMemo(() => pages.filter((page) => `${page.title} ${page.url} ${page.contentType}`.toLowerCase().includes(query.toLowerCase())), [pages, query]);
  const totalWords = pages.reduce((total, page) => total + page.wordCount, 0);
  const selected = pages.filter((page) => page.selected).length;
  const visiblePublishResult = publishResult ?? (project?.status === "published" ? {
    approvedSegments: 0,
    targetLanguage: project.targetLanguage,
    snippet: `<script src="${API_URL}/publisher/localizer.js" data-project="${project.id}" data-api="${API_URL}"></script>`,
  } : null);

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">L</span>Localize</div><div className="sidebar-label">Projects</div><div className="project-list">{projects.map((item) => <div className={`project-item ${project?.id === item.id ? "active" : ""}`} key={item.id}><button className="project-select" onClick={() => selectProject(item)}><span className="project-dot" /><span className="project-name">{new URL(item.rootUrl).hostname}</span><span className="project-status">{item.status}</span></button><button className="delete-project" title="Delete project" aria-label={`Delete ${new URL(item.rootUrl).hostname}`} onClick={() => deleteProject(item)}>×</button></div>)}{!projects.length && <p className="muted small">Create your first project.</p>}</div></aside>
    <main className="content"><header className="topbar"><div><p className="eyebrow">Website localization</p><h1>{project ? "Project overview" : "Create a project"}</h1></div><div className="status-pill"><span className="status-dot" /> Prototype workspace</div></header>
      {error && <div className="alert">{error}</div>}
      <section className="hero-card"><div><p className="eyebrow">Start here</p><h2>Discover your website</h2><p className="muted">Enter the public homepage you want to localize. We’ll crawl its internal pages and prepare content for review.</p><p className="form-example">Example: <code>https://your-site.com</code></p></div><form className="project-form" onSubmit={createProject}><label>Website URL<input required type="url" placeholder="https://your-site.com" value={form.rootUrl} onChange={(e) => setForm({ ...form, rootUrl: e.target.value })} /><small>Use a public URL, or a local URL such as <code>http://localhost:8765</code>.</small></label><label>Source<select value={form.sourceLanguage} onChange={(e) => setForm({ ...form, sourceLanguage: e.target.value })}><option value="en">English</option><option value="hi">Hindi</option><option value="fr">French</option></select></label><label>Target<select value={form.targetLanguage} onChange={(e) => setForm({ ...form, targetLanguage: e.target.value })}><option value="es">Spanish</option><option value="de">German</option><option value="fr">French</option><option value="hi">Hindi</option></select></label><button className="primary" disabled={busy}> {busy ? "Saving…" : "Add website"}</button></form></section>
      {project && <><section className="project-header"><div><p className="eyebrow">{nameOf(project.sourceLanguage)} → {nameOf(project.targetLanguage)}</p><h2>{new URL(project.rootUrl).hostname}</h2><a href={project.rootUrl} target="_blank" rel="noreferrer">{project.rootUrl}</a></div><div className="header-actions"><button className="secondary" disabled={busy} onClick={startCrawl}>{project.status === "crawling" ? "Crawling…" : pages.length ? "Crawl again" : "Start crawl"}</button><button className="primary" disabled={busy} onClick={publishProject}>{project.status === "published" ? "Republish" : "Publish"}</button></div></section>
      {visiblePublishResult && <section className="publish-card"><div><p className="eyebrow">Published localization</p><h3>Install the runtime on your website</h3><p className="muted">Copy this script into your site’s HTML, just before the closing <code>&lt;/body&gt;</code> tag. Visitors can then switch languages with <code>?lang=es</code>, <code>?lang=fr</code>, or another supported code.</p></div><div className="snippet-row"><code>{visiblePublishResult.snippet}</code><button className="secondary" onClick={() => navigator.clipboard?.writeText(visiblePublishResult.snippet)}>Copy snippet</button></div><p className="publish-help"><strong>Local test:</strong> run <code>python3 -m http.server 8765</code> from the repository root, then open <code>http://localhost:8765/sample-site/index.html?lang={visiblePublishResult.targetLanguage}</code> after adding the snippet to the sample page.</p></section>}
      {job && <div className="progress-card"><div className="progress-copy"><strong>{job.status === "completed" ? "Crawl complete" : job.status === "failed" ? "Crawl failed" : "Crawling website…"}</strong><span className="muted">{job.crawled} pages crawled · {job.skipped} skipped</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(8, job.discovered ? job.crawled / job.discovered * 100 : 8))}%` }} /></div></div>}
      <div className="metrics"><Metric label="Pages discovered" value={pages.length} /><Metric label="Words found" value={totalWords.toLocaleString()} /><Metric label="Pages selected" value={selected} /><Metric label="Translation status" value={pages.length ? "Ready" : "Not started"} /></div>
      <section className="table-card"><div className="table-toolbar"><div><h3>Discovered pages</h3><p className="muted">Select pages to include, then open one for translation.</p></div><input className="search" placeholder="Filter pages…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>{visiblePages.length ? <div className="table-wrap"><table><thead><tr><th /><th>Page</th><th>Type</th><th>Language</th><th>Words</th><th>Status</th><th /></tr></thead><tbody>{visiblePages.map((page) => <tr key={page.id}><td><input type="checkbox" checked={page.selected} onChange={() => togglePage(page)} /></td><td><button className="page-link" onClick={() => openEditor(page)}><div className="page-title">{page.title || "Untitled page"}</div><div className="page-url">{page.url}</div></button>{page.crawlIssue && <div className="issue">{page.crawlIssue}</div>}</td><td><span className="tag">{page.contentType}</span></td><td>{page.detectedLanguage ? nameOf(page.detectedLanguage) : "—"}</td><td>{page.wordCount.toLocaleString()}</td><td><span className={`table-status ${page.httpStatus === 200 ? "ok" : "warn"}`}>{page.httpStatus ?? "—"}</span></td><td><button className="small-action" onClick={() => openEditor(page)}>Edit</button></td></tr>)}</tbody></table></div> : <div className="empty"><div className="empty-icon">⌁</div><strong>No pages discovered yet</strong><p className="muted">Start a crawl to analyze the website.</p></div>}</section>
      {editorPage && <section className="editor-card"><div className="editor-header"><div><p className="eyebrow">Translation editor</p><h2>{editorPage.title || editorPage.url}</h2><p className="muted">{segments.length} segments · {segments.filter((segment) => segment.status === "approved").length} approved · {segments.filter((segment) => segment.status === "pending" || !segment.targetText.trim()).length} pending</p></div><div className="editor-actions"><button className="secondary" onClick={() => setEditorPage(null)}>Back to pages</button><button className="secondary" disabled={translationBusy || !segments.some((segment) => segment.status === "machine_translated" || segment.status === "edited")} onClick={approveReady}>Approve translated</button><button className="primary" disabled={translationBusy || !segments.some((segment) => segment.status === "pending" || !segment.targetText.trim())} onClick={translatePage}>{translationBusy ? "Translating…" : `Translate ${segments.filter((segment) => segment.status === "pending" || !segment.targetText.trim()).length} pending`}</button></div></div>{segments.length ? <div className="segment-list">{segments.map((segment) => <SegmentRow key={segment.id} segment={segment} onSave={saveSegment} onRegenerate={regenerateSegment} onApprove={approveSegment} />)}</div> : <div className="empty"><strong>No segments extracted</strong><p className="muted">This page has no translatable content.</p></div>}</section>}
      </>}
    </main></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric"><span className="muted">{label}</span><strong>{value}</strong></div>; }
function SegmentRow({ segment, onSave, onRegenerate, onApprove }: { segment: Segment; onSave: (segment: Segment, targetText: string) => void; onRegenerate: (segment: Segment) => void; onApprove: (segment: Segment) => void }) { const [value, setValue] = useState(segment.targetText); useEffect(() => setValue(segment.targetText), [segment.targetText]); return <article className="segment-row"><div className="segment-meta"><span className="tag">{segment.elementType}</span><span className={`table-status ${segment.status === "approved" ? "ok" : "warn"}`}>{segment.status.replace("_", " ")}</span></div><div className="segment-columns"><div><span className="field-label">Source</span><p>{segment.sourceText}</p></div><div><span className="field-label">Target</span><textarea value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => value !== segment.targetText && onSave(segment, value)} placeholder="Translate this segment…" /></div></div><div className="segment-actions"><button className="small-action" onClick={() => onRegenerate(segment)}>Regenerate</button><button className="approve-action" disabled={!value.trim() || segment.status === "approved"} onClick={() => onApprove(segment)}>Approve</button></div></article>; }
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
