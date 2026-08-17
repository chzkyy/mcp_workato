/**
 * Configuration for the Workato MCP server.
 *
 * Values are read from environment variables (or command-line `--key value`
 * pairs). When running under Claude Desktop the env block of the server's
 * entry in `claude_desktop_config.json` is the most convenient place to set
 * them.
 *
 * Three authentication modes are supported:
 *
 * 1. **api_token** (default, simplest): requires only `WORKATO_TOKEN`. The
 *    token is sent as `Authorization: Bearer <token>`.
 * 2. **access_token** (legacy): requires `WORKATO_TOKEN` + `WORKATO_USER_ID`.
 * 3. **oauth2** (API Client): requires `WORKATO_CLIENT_ID` + `WORKATO_CLIENT_SECRET`.
 *
 * The auth mode is auto-detected:
 *   - if `WORKATO_AUTH_MODE` is set → use it.
 *   - else if `WORKATO_CLIENT_ID` is set → oauth2.
 *   - else if both `WORKATO_TOKEN` + `WORKATO_USER_ID` are set → access_token.
 *   - else if only `WORKATO_TOKEN` is set → api_token.
 */

import { WorkatoClient } from "./workato-client.js";
import type { AuthMode } from "./workato-client.js";

export interface ServerConfig {
  authMode: AuthMode;
  /** access_token mode only */
  token: string;
  userId: string;
  /** oauth2 mode only */
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  /** shared */
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
  )
    .trim()
    .toLowerCase();
  const timeoutRaw = (
    args["timeout-ms"] ??
    env.WORKATO_TIMEOUT_MS ??
    "60000"
  ).trim();
  const debugRaw = (args.debug ?? env.WORKATO_DEBUG ?? "false")
    .trim()
    .toLowerCase();

  // --- Determine auth mode ---
  // Auto-detect priority:
  //   1. explicit WORKATO_AUTH_MODE
  //   2. WORKATO_CLIENT_ID present  -> oauth2
  //   3. token + user-id present    -> access_token (legacy headers)
  //   4. token only                 -> api_token   (bearer)
  let authMode: AuthMode;
  if (
    authModeRaw === "oauth2" ||
    authModeRaw === "access_token" ||
    authModeRaw === "api_token"
  ) {
    authMode = authModeRaw;
  } else if (clientId) {
    authMode = "oauth2";
  } else if (token && userIdRaw) {
    authMode = "access_token";
  } else {
    authMode = "api_token";
  }

  // --- Validate based on auth mode ---
  const missing: string[] = [];
  if (authMode === "api_token") {
    if (!token) missing.push("WORKATO_TOKEN");
  } else if (authMode === "access_token") {
    if (!token) missing.push("WORKATO_TOKEN");
    if (!userIdRaw) missing.push("WORKATO_USER_ID");
  } else {
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
    token: config.token || undefined,
    userId: config.userId || undefined,
    clientId: config.clientId || undefined,
    clientSecret: config.clientSecret || undefined,
    tokenUrl: config.tokenUrl || undefined,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    onRequest: config.debug
      ? ({ method, url }) =>
          process.stderr.write(`[workato] ${method} ${url}\n`)
      : undefined,
  });
}