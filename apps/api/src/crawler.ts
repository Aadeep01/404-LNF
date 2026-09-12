import { chromium, type Page as BrowserPage } from "playwright";
import { db, type ProjectRow } from "./db";

type CrawlJob = {
  status: "queued" | "running" | "completed" | "failed";
  discovered: number;
  crawled: number;
  skipped: number;
  issue?: string;
};

type ExtractedSegment = {
  sourceText: string;
  elementType: string;
  selector: string;
};

export const crawlJobs = new Map<string, CrawlJob>();

const maxPages = () => Number(process.env.CRAWL_MAX_PAGES ?? 25);
const maxDepth = () => Number(process.env.CRAWL_MAX_DEPTH ?? 3);

const normalizeUrl = (raw: string, base?: string) => {
  const url = new URL(raw, base);
  url.hash = "";
  url.search = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
};

const isCrawlableUrl = (url: URL) =>
  ["http:", "https:"].includes(url.protocol) &&
  !/\.(pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|ico|mp4|mp3|mov|avi|css|js|json|xml|woff2?|ttf|eot)$/i.test(url.pathname);

function parseRobots(robots: string) {
  const rules: string[] = [];
  let applies = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line) continue;
    const [rawKey, rawValue] = line.split(":", 2);
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim() ?? "";
    if (key === "user-agent") {
      applies = value === "*";
    } else if (applies && key === "disallow" && value) {
      rules.push(value);
    }
  }
  return (url: URL) => !rules.some((rule) => url.pathname.startsWith(rule));
}

async function robotsAllowed(root: URL, candidate: URL) {
  try {
    const response = await fetch(new URL("/robots.txt", root.origin));
    if (!response.ok) return true;
    return parseRobots(await response.text())(candidate);
  } catch {
    return true;
  }
}

export async function extractSegments(page: BrowserPage): Promise<ExtractedSegment[]> {
  return page.evaluate(() => {
    const excludedTags = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "CANVAS", "CODE", "PRE", "HEAD",
    ]);
    const excludedClasses = (element: Element) => {
      const value = `${element.className ?? ""} ${element.getAttribute("id") ?? ""}`.toLowerCase();
      return /(^|[\s_-])(cookie|captcha|recaptcha|password|secret|token)([\s_-]|$)/.test(value);
    };
    const isExcluded = (element: Element | null) => {
      while (element) {
        if (excludedTags.has(element.tagName) || element.getAttribute("translate") === "no" || excludedClasses(element)) return true;
        element = element.parentElement;
      }
      return false;
    };
    const isCandidate = (value: string) => {
      const normalized = value.replace(/\s+/g, " ").trim();
      if (normalized.length < 2 || normalized.length > 2000) return false;
      if (/^[\d\s\W_]+$/.test(normalized)) return false;
      if (/^(https?:\/\/|[\w./-]+\.(com|org|net|io|js|css))$/i.test(normalized)) return false;
      return true;
    };
    const pathFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children as HTMLCollectionOf<Element>)
          .filter((child: Element) => child.tagName === current!.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
        current = parent;
      }
      return `body > ${parts.join(" > ")}`;
    };

    const segments: ExtractedSegment[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      const sourceText = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!parent || isExcluded(parent) || !isCandidate(sourceText)) continue;
      if ((parent as HTMLElement).offsetParent === null) continue;
      segments.push({ sourceText, elementType: parent.tagName.toLowerCase(), selector: pathFor(parent) });
    }

    const attributeNames = ["alt", "title", "placeholder", "aria-label"];
    for (const element of Array.from(document.querySelectorAll("*"))) {
      if (isExcluded(element)) continue;
      for (const attribute of attributeNames) {
        const value = element.getAttribute(attribute)?.replace(/\s+/g, " ").trim() ?? "";
        if (isCandidate(value)) {
          segments.push({ sourceText: value, elementType: `${element.tagName.toLowerCase()}@${attribute}`, selector: pathFor(element) });
        }
      }
      if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
        const value = element.value.replace(/\s+/g, " ").trim();
        if (isCandidate(value)) segments.push({ sourceText: value, elementType: `${element.tagName.toLowerCase()}@value`, selector: pathFor(element) });
      }
    }

    const title = document.title.replace(/\s+/g, " ").trim();
    if (isCandidate(title)) segments.push({ sourceText: title, elementType: "title", selector: "title" });
    const description = document.querySelector("meta[name='description']")?.getAttribute("content")?.replace(/\s+/g, " ").trim() ?? "";
    if (isCandidate(description)) segments.push({ sourceText: description, elementType: "meta@description", selector: "meta[name='description']" });
    return segments;
  });
}

async function crawlPage(browser: Awaited<ReturnType<typeof chromium.launch>>, project: ProjectRow, url: string, depth: number) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const title = await page.title().catch(() => "");
    const segments = response?.ok() ? await extractSegments(page) : [];
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const id = crypto.randomUUID();
    const crawledAt = new Date().toISOString();
    db.query(`INSERT OR IGNORE INTO pages
      (id, project_id, url, title, http_status, detected_language, word_count, content_type, selected, crawled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
      id, project.id, url, title, response?.status() ?? null,
      await page.locator("html").getAttribute("lang").catch(() => null),
      bodyText.split(/\s+/).filter(Boolean).length,
      classifyPage(url, title), crawledAt,
    );

    const savedPage = db.query<{ id: string }, [string, string]>(
      "SELECT id FROM pages WHERE project_id = ? AND url = ?",
    ).get(project.id, url);
    if (savedPage) {
      const insertSegment = db.query(`INSERT OR IGNORE INTO segments
        (id, page_id, source_text, element_type, selector, source_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const segment of segments) {
        const timestamp = new Date().toISOString();
        insertSegment.run(
          crypto.randomUUID(), savedPage.id, segment.sourceText, segment.elementType,
          segment.selector, Bun.hash(segment.sourceText).toString(16), timestamp, timestamp,
        );
      }
    }

    const links = response?.ok()
      ? await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href))
      : [];
    return { links, issue: response && !response.ok() ? `HTTP ${response.status()}` : undefined, depth };
  } finally {
    await page.close();
  }
}

function classifyPage(url: string, title: string) {
  const value = `${url} ${title}`.toLowerCase();
  if (/blog|article|news|post/.test(value)) return "blog/article";
  if (/product|pricing|features/.test(value)) return "product page";
  if (/about|contact|home|services/.test(value)) return "marketing page";
  return "other";
}

export async function crawlProject(project: ProjectRow, jobId: string) {
  const job = crawlJobs.get(jobId)!;
  const root = new URL(project.root_url);
  const queue = [{ url: normalizeUrl(project.root_url), depth: 0 }];
  const seen = new Set<string>();
  const browser = await chromium.launch({ headless: true });
  const allowed = await robotsAllowed(root, root);
  try {
    if (!allowed) throw new Error("Crawl disallowed by robots.txt");

    while (queue.length && seen.size < maxPages()) {
      const current = queue.shift()!;
      if (seen.has(current.url) || current.depth > maxDepth()) continue;
      const parsed = new URL(current.url);
      if (parsed.origin !== root.origin || !isCrawlableUrl(parsed)) continue;
      if (!(await robotsAllowed(root, parsed))) {
        job.skipped += 1;
        continue;
      }
      seen.add(current.url);
      job.discovered = Math.max(job.discovered, queue.length + seen.size);
      try {
        const result = await crawlPage(browser, project, current.url, current.depth);
        job.crawled += 1;
        for (const link of result.links) {
          try {
            const normalized = normalizeUrl(link, current.url);
            if (!seen.has(normalized) && queue.length + seen.size < maxPages()) {
              queue.push({ url: normalized, depth: current.depth + 1 });
            }
          } catch {
            job.skipped += 1;
          }
        }
      } catch (error) {
        job.skipped += 1;
        job.issue = error instanceof Error ? error.message : "Unknown crawl error";
      }
    }
  } finally {
    await browser.close();
  }
}
