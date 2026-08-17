#!/usr/bin/env node
/**
 * Workato MCP server entry point.
 *
 * Implements a stdio-based Model Context Protocol server that exposes a curated
 * set of Workato Platform API operations as tools for Claude Desktop (and other
 * MCP clients).
 *
 * Configuration is loaded from env vars / CLI args via `loadConfig()`. When
 * required configuration is missing the server exits with a helpful message.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ServerResult,
} from "@modelcontextprotocol/sdk/types.js";

import { buildClient, loadConfig } from "./config.js";
import { tools, zodToJsonSchema, type ToolResult } from "./tools.js";
import { WorkatoApiError } from "./workato-client.js";

const SERVER_NAME = "mcp-workato";
const SERVER_VERSION = "1.0.0";

function errorContent(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[mcp-workato] Configuration error: ${message}\n`);
    process.stderr.write(
      "[mcp-workato] See .env.example / README.md for required variables.\n",
    );
    process.exitCode = 1;
    return;
  }

  const client = buildClient(config);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
    },
  );

  // List available tools ------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.schema),
      })),
    };
  });

  // Dispatch tool calls -------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);

    let result: ToolResult;
    if (!tool) {
      result = errorContent(`Unknown tool: ${name}`);
    } else {
      // Validate / coerce arguments with the zod schema.
      const parsed = tool.schema.safeParse(args ?? {});
      if (!parsed.success) {
        result = errorContent(
          `Invalid arguments for "${name}": ${parsed.error.message}`,
        );
      } else {
        try {
          result = await tool.run(client, parsed.data);
        } catch (err) {
          if (err instanceof WorkatoApiError) {
            result = errorContent(err.message);
          } else {
            const message = err instanceof Error ? err.message : String(err);
            result = errorContent(message);
          }
        }
      }
    }

    // Cast to the SDK's ServerResult. Our ToolResult is structurally a valid
    // CallToolResult (content + isError); the cast bridges the SDK's complex
    // union type which also includes task-bearing variants we don't use.
    return result as unknown as ServerResult;
  });

  // Run over stdio ------------------------------------------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const authInfo =
    config.authMode === "oauth2"
      ? `OAuth2 API Client (${config.clientId})`
      : config.authMode === "api_token"
        ? "API Token"
        : `user ${config.userId}`;
  process.stderr.write(
    `[mcp-workato] Connected to Workato (${config.baseUrl}) as ${authInfo}. Server ready on stdio.\n`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mcp-workato] Fatal: ${message}\n`);
  process.exitCode = 1;
});