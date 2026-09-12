# DOM matching and scaling notes

## Prototype matching

The crawler records visible text nodes and translatable attributes (`alt`, `title`, `placeholder`, and `aria-label`) with a stable CSS selector, element type, and normalized source hash. The editor keeps one segment per discovered string. On the published site, the runtime queries the selector and only replaces a node when its current text still matches the approved source text. This prevents an old translation from overwriting content that the application has changed.

The runtime also scans newly inserted DOM nodes with a `MutationObserver`, which covers common client-rendered content. It does not attempt to rewrite scripts, styles, editable fields, URLs, or hidden content. This is a practical generic fallback; high-value production sites should support explicit `data-localize-key` keys for components whose markup changes frequently.

## Scaling beyond the prototype

For a larger deployment, keep the same project/page/segment model but move crawl and translation work into a queue. A worker pool can reuse browser contexts, enforce robots.txt and per-host rate limits, retry transient failures, and persist crawl snapshots in object storage. Page and translation results should be cached by URL plus content hash, while approved catalogues can be served from a CDN. Pagination, job cancellation, structured logs, and provider fallback would complete the operational layer without changing the dashboard workflow.
