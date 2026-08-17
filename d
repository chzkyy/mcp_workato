/**
 * Configuration for the Workato MCP server.
 *
 * Values are read from environment variables (or command-line `--key value`
 * pairs). When running under Claude Desktop the env block of the server's
 * entry in `claude_desktop_config.json` is the most convenient place to set
 * them.
 *
 * Two authentication modes are supported:
 *
 * 1. **access_token** (default): requires `WORKATO_TOKEN` + `WORKATO_USER_ID`.
 * 2. **oauth2** (API Client): requires `WORKATO_CLIENT_ID` + `WORKATO_CLIENT_SECRET`.
 *    The auth mode is auto-detected: if `WORKATO_CLIENT_ID` is set, oauth2 mode
 *    is used. You can force it with `WORKATO_AUTH_MODE=oauth2|access_token`.
 */

import { WorkatoClient, type AuthMode } from "./workato-client.js";

export interface ServerConfig {
  authMode: AuthMode;
  // access_token mode
  token: string;
  userId: string;
  // oauth2 mode
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  // shared
  baseUrl: string;
  timeoutMs: number;
  debug: boolean;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

export function loadConfig(): ServerConfig {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;

  const token = (args.token ?? env.WORKATO_TOKEN ?? "").trim();
  const userIdRaw = (args["user-id"] ?? env.WORKATO_USER_ID ?? "").trim();
  const clientId = (args["client-id"] ?? env.WORKATO_CLIENT_ID ?? "").trim();
  const clientSecret = (
    args["client-secret"] ??
    env.WORKATO_CLIENT_SECRET ??
    ""
  ).trim();
  const pod = (args.pod ?? env.WORKATO_POD ?? "us").trim();
  const explicitUrl = (args["base-url"] ?? env.WORKATO_BASE_URL ?? "").trim();
  const explicitTokenUrl = (
    args["token-url"] ??
    env.WORKATO_TOKEN_URL ??
    ""
  ).trim();
  const authModeRaw = (
    args["auth-mode"] ??
    env.WORKATO_AUTH_MODE ??
    ""
  ).trim().toLowerCase();
  const timeoutRaw = (
    args["timeout-ms"] ??
    env.WORKATO_TIMEOUT_MS ??
    "60000"
  ).trim();
  const debugRaw = (args.debug ?? env.WORKATO_DEBUG ?? "false")
    .trim()
    .toLowerCase();

  // --- Determine auth mode ---
  // Auto-detect: if client_id is provided, use oauth2. Otherwise access_token.
  let authMode: AuthMode;
  if (authModeRaw === "oauth2" || authModeRaw === "access_token") {
    authMode = authModeRaw;
  } else if (clientId) {
    authMode = "oauth2";
  } else {
    authMode = "access_token";
  }

  // --- Validate based on auth mode ---
  const missing: string[] = [];
  if (authMode === "access_token") {
    if (!token) missing.push("WORKATO_TOKEN");
    if (!userIdRaw) missing.push("WORKATO_USER_ID");
  } else {
    // oauth2 mode
    if (!clientId) missing.push("WORKATO_CLIENT_ID");
    if (!clientSecret) missing.push("WORKATO_CLIENT_SECRET");
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required Workato configuration: ${missing.join(", ")}. ` +
        "Set them via environment variables or command-line args " +
        "(see .env.example and README.md).",
    );
  }

  const baseUrl = WorkatoClient.resolveBaseUrl(
    pod || undefined,
    explicitUrl || undefined,
  );

  const tokenUrl = WorkatoClient.resolveTokenUrl(
    pod || undefined,
    explicitTokenUrl || undefined,
  );

  const timeoutMs = Number.parseInt(timeoutRaw, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Invalid WORKATO_TIMEOUT_MS value: "${timeoutRaw}". Must be a positive integer.`,
    );
  }

  return {
    authMode,
    token,
    userId: userIdRaw,
    clientId,
    clientSecret,
    tokenUrl,
    baseUrl,
    timeoutMs,
    debug: debugRaw === "true" || debugRaw === "1",
  };
}

/** Build a WorkatoClient from the loaded configuration. */
export function buildClient(config: ServerConfig): WorkatoClient {
  return new WorkatoClient({
    authMode: config.authMode,
    // access_token mode
    token: config.token || undefined,
    userId: config.userId || undefined,
    // oauth2 mode
    clientId: config.clientId || undefined,
    clientSecret: config.clientSecret || undefined,
    tokenUrl: config.tokenUrl || undefined,
    // shared
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    onRequest: config.debug
      ? ({ method, url }) =>
          process.stderr.write(`[workato] ${method} ${url}\n`)
      : undefined,
  });
}