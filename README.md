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

The initial implementation will be added in the next step. Keep provider keys in
local environment files; never commit secrets.

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
