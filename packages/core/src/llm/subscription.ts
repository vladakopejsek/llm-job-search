/**
 * The other runtime: a skill run in Claude Code on the subscription login, for what the API
 * can't do when there's no key or credit left (apiUsable in client.ts decides). The Gmail
 * step (the /replies skill) runs there too.
 */
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/**
 * The environment `claude` runs in. The API key is left out: with a key, `claude -p` bills
 * the API and doesn't load claude.ai connectors. The installer puts claude in ~/.local/bin,
 * which a scheduler's PATH often lacks.
 */
export function claudeEnv(): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _, ...env } = process.env;
  return { ...env, PATH: `${path.join(homedir(), ".local/bin")}:${env.PATH ?? ""}` };
}

/**
 * Runs `claude -p <prompt>` from the repo and resolves with its output; rejects on a
 * non-zero exit or the timeout, with the output's last line. `allowedTools` adds tools this
 * run may use beyond the project's allowlist (.claude/settings.json).
 */
export async function onSubscription(prompt: string, timeoutMinutes: number, allowedTools: string[] = []): Promise<string> {
  // data/ may be a symlink to outside the repo, and Claude Code reads only inside its workspace.
  const args = ["-p", prompt, "--add-dir", await realpath(path.join(REPO_ROOT, "data"))];
  if (allowedTools.length) args.push("--allowedTools", ...allowedTools);
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      args,
      { cwd: REPO_ROOT, env: claudeEnv(), timeout: timeoutMinutes * 60_000, maxBuffer: 16 * 2 ** 20 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const last = `${stdout}\n${stderr}`.trim().split("\n").at(-1);
        reject(new Error(`claude -p ${prompt.split(" ")[0]} failed (${error.code ?? error.signal}): ${last || error.message}`));
      },
    );
  });
}
