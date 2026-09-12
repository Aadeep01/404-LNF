import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type CrawlJob, type Page, type Project } from "./api";
import "./styles.css";

const languages: Record<string, string> = { en: "English", es: "Spanish", fr: "French", de: "German", hi: "Hindi" };
const nameOf = (code: string) => languages[code.toLowerCase()] ?? code.toUpperCase();

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [form, setForm] = useState({ rootUrl: "", sourceLanguage: "en", targetLanguage: "es" });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listProjects().then((items) => { setProjects(items); if (items[0]) selectProject(items[0]); }).catch(showError);
  }, []);

  function showError(reason: unknown) { setError(reason instanceof Error ? reason.message : "Something went wrong"); }
  function selectProject(next: Project) { setProject(next); setError(""); api.listPages(next.id).then(setPages).catch(showError); }

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

  const visiblePages = useMemo(() => pages.filter((page) => `${page.title} ${page.url} ${page.contentType}`.toLowerCase().includes(query.toLowerCase())), [pages, query]);
  const totalWords = pages.reduce((total, page) => total + page.wordCount, 0);
  const selected = pages.filter((page) => page.selected).length;

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">L</span>Localize</div><div className="sidebar-label">Projects</div><div className="project-list">{projects.map((item) => <div className={`project-item ${project?.id === item.id ? "active" : ""}`} key={item.id}><button className="project-select" onClick={() => selectProject(item)}><span className="project-dot" /><span className="project-name">{new URL(item.rootUrl).hostname}</span><span className="project-status">{item.status}</span></button><button className="delete-project" title="Delete project" aria-label={`Delete ${new URL(item.rootUrl).hostname}`} onClick={() => deleteProject(item)}>×</button></div>)}{!projects.length && <p className="muted small">Create your first project.</p>}</div></aside>
    <main className="content"><header className="topbar"><div><p className="eyebrow">Website localization</p><h1>{project ? "Project overview" : "Create a project"}</h1></div><div className="status-pill"><span className="status-dot" /> Prototype workspace</div></header>
      {error && <div className="alert">{error}</div>}
      <section className="hero-card"><div><p className="eyebrow">Start here</p><h2>Discover your website</h2><p className="muted">Render pages, analyze content, and prepare your website for translation.</p></div><form className="project-form" onSubmit={createProject}><label>Website URL<input required type="url" placeholder="https://example.com" value={form.rootUrl} onChange={(e) => setForm({ ...form, rootUrl: e.target.value })} /></label><label>Source<select value={form.sourceLanguage} onChange={(e) => setForm({ ...form, sourceLanguage: e.target.value })}><option value="en">English</option><option value="hi">Hindi</option><option value="fr">French</option></select></label><label>Target<select value={form.targetLanguage} onChange={(e) => setForm({ ...form, targetLanguage: e.target.value })}><option value="es">Spanish</option><option value="de">German</option><option value="fr">French</option><option value="hi">Hindi</option></select></label><button className="primary" disabled={busy}> {busy ? "Saving…" : "Add website"}</button></form></section>
      {project && <><section className="project-header"><div><p className="eyebrow">{nameOf(project.sourceLanguage)} → {nameOf(project.targetLanguage)}</p><h2>{new URL(project.rootUrl).hostname}</h2><a href={project.rootUrl} target="_blank" rel="noreferrer">{project.rootUrl}</a></div><button className="primary" disabled={busy} onClick={startCrawl}>{project.status === "crawling" ? "Crawling…" : pages.length ? "Crawl again" : "Start crawl"}</button></section>
      {job && <div className="progress-card"><div className="progress-copy"><strong>{job.status === "completed" ? "Crawl complete" : job.status === "failed" ? "Crawl failed" : "Crawling website…"}</strong><span className="muted">{job.crawled} pages crawled · {job.skipped} skipped</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(8, job.discovered ? job.crawled / job.discovered * 100 : 8))}%` }} /></div></div>}
      <div className="metrics"><Metric label="Pages discovered" value={pages.length} /><Metric label="Words found" value={totalWords.toLocaleString()} /><Metric label="Pages selected" value={selected} /><Metric label="Translation status" value={pages.length ? "Ready" : "Not started"} /></div>
      <section className="table-card"><div className="table-toolbar"><div><h3>Discovered pages</h3><p className="muted">Select pages to include in this localization project.</p></div><input className="search" placeholder="Filter pages…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>{visiblePages.length ? <div className="table-wrap"><table><thead><tr><th /><th>Page</th><th>Type</th><th>Language</th><th>Words</th><th>Status</th></tr></thead><tbody>{visiblePages.map((page) => <tr key={page.id}><td><input type="checkbox" checked={page.selected} onChange={() => togglePage(page)} /></td><td><div className="page-title">{page.title || "Untitled page"}</div><div className="page-url">{page.url}</div>{page.crawlIssue && <div className="issue">{page.crawlIssue}</div>}</td><td><span className="tag">{page.contentType}</span></td><td>{page.detectedLanguage ? nameOf(page.detectedLanguage) : "—"}</td><td>{page.wordCount.toLocaleString()}</td><td><span className={`table-status ${page.httpStatus === 200 ? "ok" : "warn"}`}>{page.httpStatus ?? "—"}</span></td></tr>)}</tbody></table></div> : <div className="empty"><div className="empty-icon">⌁</div><strong>No pages discovered yet</strong><p className="muted">Start a crawl to analyze the website.</p></div>}</section></>}
    </main></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric"><span className="muted">{label}</span><strong>{value}</strong></div>; }
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
