/**
 * Ask's tools as a stdio MCP server, for the subscription path: `claude -p` starts it
 * (ask/subscription.ts) and calls the same tools the API loop does, through the same
 * `runTool`. It reads DATABASE_URL_READONLY from the environment claude passes down.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createDb } from "../db/client.ts";
import { env } from "../env.ts";
import { runTool, TOOLS } from "./tools.ts";

const url = env().DATABASE_URL_READONLY;
if (!url) throw new Error("DATABASE_URL_READONLY is not set: Ask's tools only use the read-only role");
const { db } = createDb(url);

const server = new McpServer({ name: "jobregator", version: "1.0.0" });
for (const tool of TOOLS) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (input) => {
    const result = await runTool(db, tool.name, input);
    return { content: [{ type: "text", text: result.content }], isError: !result.ok };
  });
}
await server.connect(new StdioServerTransport());
