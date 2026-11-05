import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Only the read-only role from .env, for the SQL guard's tests (src/ask/sql.test.ts); without it they're skipped.
const dotenv = path.resolve(import.meta.dirname, "../../.env");
const readonlyUrl =
  process.env.DATABASE_URL_READONLY ?? (existsSync(dotenv) ? parseEnv(readFileSync(dotenv, "utf8")).DATABASE_URL_READONLY : undefined);

export default defineConfig({
  // Tests run on the fictional example candidate, never on data/search.json (the server runs them against its live data/).
  test: {
    include: ["src/**/*.test.ts"],
    env: { SEARCH_CONFIG_PATH: "seeds/search.example.json", ...(readonlyUrl && { DATABASE_URL_READONLY: readonlyUrl }) },
  },
});
