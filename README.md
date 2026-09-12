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
