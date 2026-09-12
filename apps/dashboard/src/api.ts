const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload as T;
}

export type Project = {
  id: string; rootUrl: string; sourceLanguage: string; targetLanguage: string;
  status: string; createdAt: string; updatedAt: string;
};
export type Page = {
  id: string; projectId: string; url: string; title: string; httpStatus: number | null;
  detectedLanguage: string | null; wordCount: number; contentType: string;
  crawlIssue: string | null; selected: boolean; crawledAt: string | null;
};
export type CrawlJob = {
  status: "queued" | "running" | "completed" | "failed";
  discovered: number; crawled: number; skipped: number; issue?: string;
};

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (input: { rootUrl: string; sourceLanguage: string; targetLanguage: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  deleteProject: (projectId: string) => request<{ deleted: boolean; projectId: string }>(`/api/projects/${projectId}`, { method: "DELETE" }),
  listPages: (projectId: string) => request<Page[]>(`/api/projects/${projectId}/pages`),
  startCrawl: (projectId: string) => request<{ jobId: string; status: string }>(`/api/projects/${projectId}/crawl`, { method: "POST" }),
  getCrawlJob: (jobId: string) => request<CrawlJob>(`/api/crawl-jobs/${jobId}`),
  updatePage: (pageId: string, selected: boolean) =>
    request<Page>(`/api/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ selected }) }),
};
