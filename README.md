# Website Localization Prototype

Monorepo for the AI-powered website localization assignment.

## Workspace layout

- `apps/dashboard` - reviewer dashboard and translation workflow
- `apps/api` - Bun API service
- `packages/domain` - shared domain types and validation
- `packages/embed` - browser runtime published as a single script

## Setup

```bash
bun install
bun run dev
```

Keep provider keys in local environment files; never commit secrets.

Groq is used only by the API. If `GROQ_API_KEY` is empty, local development uses
a visible mock translation mode so the review workflow can still be tested.

## Crawler configuration

The API crawler uses Playwright and defaults to 25 pages and depth 3:

```env
CRAWL_MAX_PAGES=25
CRAWL_MAX_DEPTH=3
```

Install the browser binary once on the development machine:

```bash
bunx playwright install chromium
```

## End-to-end demo

1. Start the workspace with `bun run dev`.
2. Open `http://localhost:5173`, add a website, crawl it, translate the selected page, and approve the segments.
3. Select **Publish**. The dashboard returns a single script tag for the approved translations.
4. Add that tag to the website, or test the included harness at `http://localhost:8765/sample-site/index.html?project=YOUR_PROJECT_ID&lang=es` after running `python3 -m http.server 8765` from the repository root.

The published runtime is available at `/publisher/localizer.js`. It detects the visitor language from `?lang=`, the browser language, or its configured target language, fetches approved translations, updates text and common attributes, and observes dynamically added content. It is intentionally a prototype: pages must be crawled again when their structure changes, and selectors are scoped to the generated DOM shape.

See [DOM_MATCHING_AND_SCALING.md](./DOM_MATCHING_AND_SCALING.md) for the selector strategy and the production scaling path.
