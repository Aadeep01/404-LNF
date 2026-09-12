import { resolve } from "node:path";
import { config } from "dotenv";

// The API can run from the workspace root or apps/api. Always load the shared
// root .env in development; deployment environments can still provide vars.
config({ path: resolve(import.meta.dir, "../../../.env") });
