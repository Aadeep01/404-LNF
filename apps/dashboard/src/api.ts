export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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
export type Segment = {
  id: string; pageId: string; sourceText: string; targetText: string; elementType: string;
  selector: string; sourceHash: string; status: string; issue: string | null;
  createdAt: string; updatedAt: string;
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
  listSegments: (pageId: string) => request<Segment[]>(`/api/pages/${pageId}/segments`),
  translatePage: (pageId: string) => request<{ translated: number; mode: string; segments: Segment[] }>(`/api/pages/${pageId}/translate`, { method: "POST" }),
  approveReady: (pageId: string) => request<{ approved: number; segments: Segment[] }>(`/api/pages/${pageId}/approve-ready`, { method: "POST" }),
  updateSegment: (segmentId: string, targetText: string) => request<Segment>(`/api/segments/${segmentId}`, { method: "PATCH", body: JSON.stringify({ targetText }) }),
  translateSegment: (segmentId: string) => request<Segment & { mode: string }>(`/api/segments/${segmentId}/translate`, { method: "POST" }),
  approveSegment: (segmentId: string) => request<Segment>(`/api/segments/${segmentId}/approve`, { method: "POST" }),
  publishProject: (projectId: string) => request<{ projectId: string; approvedSegments: number; targetLanguage: string; snippet: string }>(`/api/projects/${projectId}/publish`, { method: "POST" }),
};
