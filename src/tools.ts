/**
 * MCP tool definitions for the Workato server.
 *
 * Each tool has:
 *  - a name + description (shown to the LLM),
 *  - a zod input schema,
 *  - a handler that calls the WorkatoClient and returns MCP-shaped content.
 */

import { z } from "zod";
import { zodToJsonSchema as zodToJsonSchemaLib } from "zod-to-json-schema";
import type { WorkatoClient } from "./workato-client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyZod = z.ZodType<any, z.ZodTypeDef, any>;

/** A single MCP text content block. */
export interface TextContent {
  type: "text";
  text: string;
}

/**
 * The result shape returned by a tool call.
 *
 * This mirrors a subset of the MCP `CallToolResult` (content + isError) that
 * is sufficient for this server. The handler registration in `index.ts` widens
 * this to the exact SDK-expected type via a cast, keeping the SDK's internal
 * zod typings at arm's length.
 */
export interface ToolResult {
  content: TextContent[];
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: AnyZod;
  run: (
    client: WorkatoClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any,
  ) => Promise<ToolResult>;
}

/** Wrap a value as MCP text content (pretty JSON for objects). */
export function toMcpContent(value: unknown): ToolResult {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

const PositiveInt = z.coerce.number().int().positive().optional();

export const tools: ToolDef[] = [
  {
    name: "ping",
    description:
      "Validate Workato credentials and return the current user. Use this first to confirm the connection works.",
    schema: z.object({}).strict(),
    run: async (client) => toMcpContent(await client.currentUser()),
  },

  // ----- Recipes ------------------------------------------------------------
  {
    name: "list_recipes",
    description:
      "List recipes belonging to the authenticated user (GET /api/recipes). " +
      "Supports filtering by folder, adapters (connectors), running status, " +
      "and date range. Results are paginated (default: per_page=100, max 100). " +
      "Set exclude_code=true to speed up listing for large accounts.\n\n" +
      "Note: The Workato API does NOT support server-side name search. " +
      "To find recipes by name, use the `search_recipes` tool instead.",
    schema: z
      .object({
        folder_id: z.coerce.number().int().optional().describe("Folder/project id to list recipes from"),
        with_subfolders: z.boolean().optional().describe("Include recipes from subfolders (default: false)"),
        adapter_names_all: z.string().optional().describe("Comma-separated adapter names — recipes must use ALL of them"),
        adapter_names_any: z.string().optional().describe("Comma-separated adapter names — recipes must use at least ONE"),
        running: z.boolean().optional().describe("If true, return only running recipes"),
        order: z.enum(["activity", "default"]).optional().describe("Sort order (default: 'default')"),
        since_id: z.coerce.number().int().optional().describe("Return recipes with IDs lower than this value"),
        stopped_after: z.string().optional().describe("ISO 8601 datetime — only recipes stopped after this"),
        updated_after: z.string().optional().describe("ISO 8601 datetime — only recipes updated after this"),
        page: PositiveInt,
        per_page: PositiveInt,
        exclude_code: z.boolean().optional().describe("Exclude recipe code from response (faster for large lists)"),
      })
      .strict(),
    run: async (client, args) =>
      toMcpContent(
        await client.listRecipes({
          folder_id: args.folder_id,
          with_subfolders: args.with_subfolders,
          adapter_names_all: args.adapter_names_all,
          adapter_names_any: args.adapter_names_any,
          running: args.running,
          order: args.order,
          since_id: args.since_id,
          stopped_after: args.stopped_after,
          updated_after: args.updated_after,
          page: args.page,
          per_page: args.per_page,
          exclude_code: args.exclude_code,
        }),
      ),
  },
  {
    name: "search_recipes",
    description:
      "Search recipes by name (case-insensitive). Since the Workato API has no " +
      "server-side text search, this tool auto-paginates through all recipes " +
      "and filters client-side by name.\n\n" +
      "Example: search_recipes({ name: 'PRDI Recipe 04 - PRDI AR DOKU Transactions' })",
    schema: z
      .object({
        name: z
          .string()
          .describe(
            "Recipe name (or part of it) to search for. Case-insensitive. " +
              "Example: 'PRDI AR DOKU' matches 'PRDI Recipe 04 - PRDI AR DOKU Transactions (Sync AR Receipt, ...)'",
          ),
        folder_id: z.coerce.number().int().optional().describe("Optional: limit search to a specific folder"),
        with_subfolders: z.boolean().optional(),
        running: z.boolean().optional().describe("Optional: limit to running recipes only"),
      })
      .strict(),
    run: async (client, args) =>
      toMcpContent(
        await client.listAllRecipes({
          nameContains: args.name,
          folder_id: args.folder_id,
          with_subfolders: args.with_subfolders,
          running: args.running,
        }),
      ),
  },
  {
    name: "get_recipe",
    description:
      "Get full details of a single recipe by id (GET /api/recipes/:id). " +
      "Returns name, description, code (recipe DSL), config (connections), " +
      "trigger, running status, job counts, tags, version info, etc.\n\n" +
      "Pass includes=['tags'] to also retrieve the recipe's tag handles.",
    schema: z
      .object({
        id: z.coerce.number().int().describe("Recipe numeric id, e.g. 12345"),
        includes: z
          .array(z.string())
          .optional()
          .describe("Additional fields to include. Accepted value: ['tags']"),
      })
      .strict(),
    run: async (client, args) =>
      toMcpContent(await client.getRecipe(args.id, args.includes)),
  },
  {
    name: "start_recipe",
    description: "Start (enable) a recipe (PUT /api/recipes/:id/start).",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.startRecipe(args.id)),
  },
  {
    name: "stop_recipe",
    description: "Stop (disable) a recipe (PUT /api/recipes/:id/stop).",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.stopRecipe(args.id)),
  },
  {
    name: "force_run_recipe",
    description:
      "Force-run a recipe on demand (POST /api/recipes/:recipe_id/force_run). " +
      "Rate limit: 1 request per second.",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.forceRunRecipe(args.id)),
  },
  {
    name: "delete_recipe",
    description: "Delete a recipe permanently (DELETE /api/recipes/:id).",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.deleteRecipe(args.id)),
  },
  {
    name: "reset_recipe_trigger",
    description:
      "Reset a recipe trigger cursor (POST /api/recipes/:recipe_id/reset_trigger). " +
      "Use to re-sync data from the source. Only works with polling and scheduled " +
      "triggers. The recipe must handle duplicate records.",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.resetRecipeTrigger(args.id)),
  },

  // ----- Jobs ---------------------------------------------------------------
  {
    name: "list_jobs",
    description:
      "List jobs, optionally filtered by recipe_id, status, or date range. Useful for monitoring recipe execution history.",
    schema: z
      .object({
        recipe_id: z.coerce.number().int().optional(),
        flow_id: z.coerce.number().int().optional(),
        status: z
          .enum(["succeeded", "failed", "aborted", "running", "pending"])
          .optional(),
        start_date: z
          .string()
          .optional()
          .describe("ISO 8601 datetime, e.g. 2024-01-01T00:00:00Z"),
        end_date: z.string().optional(),
        page: PositiveInt,
        per_page: PositiveInt,
      })
      .strict(),
    run: async (client, args) =>
      toMcpContent(
        await client.listJobs({
          recipe_id: args.recipe_id,
          flow_id: args.flow_id,
          status: args.status,
          start_date: args.start_date,
          end_date: args.end_date,
          page: args.page,
          per_page: args.per_page,
        }),
      ),
  },
  {
    name: "get_job",
    description: "Get details of a single job by id, including its input/output and error trace.",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.getJob(args.id)),
  },

  // ----- Connections --------------------------------------------------------
  {
    name: "list_connections",
    description: "List connections configured in the account.",
    schema: z
      .object({ page: PositiveInt, per_page: PositiveInt })
      .strict(),
    run: async (client, args) =>
      toMcpContent(
        await client.listConnections({ page: args.page, per_page: args.per_page }),
      ),
  },
  {
    name: "get_connection",
    description: "Get details of a single connection by id.",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.getConnection(args.id)),
  },

  // ----- Folders / projects -------------------------------------------------
  {
    name: "list_folders",
    description: "List project folders in the account. Folders group recipes and connections.",
    schema: z
      .object({ page: PositiveInt, per_page: PositiveInt })
      .strict(),
    run: async (client, args) =>
      toMcpContent(
        await client.listFolders({ page: args.page, per_page: args.per_page }),
      ),
  },
  {
    name: "get_folder",
    description: "Get details of a folder/project by id.",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) => toMcpContent(await client.getFolder(args.id)),
  },

  // ----- Custom connectors --------------------------------------------------
  {
    name: "list_custom_connectors",
    description: "List custom connectors in the account.",
    schema: z
      .object({ page: PositiveInt, per_page: PositiveInt })
      .strict(),
    run: async (client, args) =>
      toMcpContent(
        await client.listCustomConnectors({
          page: args.page,
          per_page: args.per_page,
        }),
      ),
  },
  {
    name: "get_custom_connector",
    description: "Get metadata of a custom connector by id.",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) =>
      toMcpContent(await client.getCustomConnector(args.id)),
  },
  {
    name: "get_custom_connector_code",
    description: "Get the source code (block DSL) of a custom connector by id.",
    schema: z.object({ id: z.coerce.number().int() }).strict(),
    run: async (client, args) =>
      toMcpContent(await client.getCustomConnectorCode(args.id)),
  },

  // ----- Account ------------------------------------------------------------
  {
    name: "list_account_properties",
    description:
      "List account properties (named constants) defined in the Workato account.",
    schema: z.object({}).strict(),
    run: async (client) => toMcpContent(await client.listAccountProperties()),
  },
];

/**
 * Convert a zod schema to the JSON Schema object the MCP SDK expects.
 *
 * Uses the well-tested `zod-to-json-schema` library instead of a hand-rolled
 * traversal, which was brittle around `z.coerce.*` / `ZodEffects` types and
 * caused `tools/list` to fail with -32603 Internal Error in Claude Desktop.
 */
export function zodToJsonSchema(schema: AnyZod): Record<string, unknown> {
  const result = zodToJsonSchemaLib(
    schema,
    { $ref: false } as unknown as Parameters<typeof zodToJsonSchemaLib>[1],
  );
  if (result && typeof result === "object" && "$schema" in result) {
    delete (result as Record<string, unknown>).$schema;
  }
  return result as Record<string, unknown>;
}
