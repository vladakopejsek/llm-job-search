import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Generating migrations needs no database, so a missing .env is fine until you migrate.
const envFile = path.resolve("../../.env"); // drizzle-kit runs from packages/core
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
