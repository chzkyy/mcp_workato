#!/usr/bin/env node
/**
 * Quick credential tester for the Workato MCP server.
 *
 * Spawns the compiled MCP server (`dist/index.js`) as a child process,
 * performs the MCP handshake (initialize + initialized), and calls the
 * `ping` tool to verify your Workato credentials work.
 *
 * Supports ALL THREE auth modes:
 *   - api_token:  --token XXX                       (simplest, default)
 *   - access_token: --token XXX --user-id 12345     (legacy)
 *   - oauth2 (API Client): --client-id XXX --client-secret YYY
 *
 * Usage:
 *   node scripts/ping.mjs --token XXX
 *   node scripts/ping.mjs --token XXX --user-id 12345
 *   node scripts/ping.mjs --client-id XXX --client-secret YYY
 *
 *   # Or via env vars:
 *   WORKATO_TOKEN=xxx node scripts/ping.mjs
 *   WORKATO_TOKEN=xxx WORKATO_USER_ID=12345 node scripts/ping.mjs
 *   WORKATO_CLIENT_ID=xxx WORKATO_CLIENT_SECRET=yyy node scripts/ping.mjs
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "..", "dist", "index.js");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

const PLACEHOLDER_RE =
  /^(your_token|your[_-]?token|your[_-]?client[_-]?id|your[_-]?client[_-]?secret|xxx|placeholder|changeme|example[_-]?token|token_kamu|client_id_kamu|client_secret_kamu|xxxxx)$/i;

function isPlaceholder(value) {
  return !value || PLACEHOLDER_RE.test(value.trim());
}

const args = parseArgs(process.argv.slice(2));

// --- Determine auth mode (mirror config.ts logic) ---
// Priority:
//   1. explicit --auth-mode / WORKATO_AUTH_MODE
//   2. client-id present        -> oauth2
//   3. token + user-id present  -> access_token (legacy)
//   4. token only               -> api_token   (default)
const authModeRaw = (
  args["auth-mode"] ??
  process.env.WORKATO_AUTH_MODE ??
  ""
)
  .trim()
  .toLowerCase();

const clientId = args["client-id"] ?? process.env.WORKATO_CLIENT_ID ?? "";
const clientSecret =
  args["client-secret"] ?? process.env.WORKATO_CLIENT_SECRET ?? "";
const token = args.token ?? process.env.WORKATO_TOKEN ?? "";
const userId = args["user-id"] ?? process.env.WORKATO_USER_ID ?? "";

let authMode;
if (
  authModeRaw === "oauth2" ||
  authModeRaw === "access_token" ||
  authModeRaw === "api_token"
) {
  authMode = authModeRaw;
} else if (clientId) {
  authMode = "oauth2";
} else if (token && userId) {
  authMode = "access_token";
} else {
  authMode = "api_token";
}

// --- Validate credentials ---
const missing = [];
if (authMode === "oauth2") {
  if (isPlaceholder(clientId)) missing.push("WORKATO_CLIENT_ID");
  if (isPlaceholder(clientSecret)) missing.push("WORKATO_CLIENT_SECRET");
} else if (authMode === "access_token") {
  if (isPlaceholder(token)) missing.push("WORKATO_TOKEN");
  if (isPlaceholder(userId)) missing.push("WORKATO_USER_ID");
} else {
  // api_token (default, simplest)
  if (isPlaceholder(token)) missing.push("WORKATO_TOKEN");
}

if (missing.length > 0) {
  console.error("");
  console.error("┌─────────────────────────────────────────────────────────────────┐");
  console.error("│  🔑 Workato credentials required to run ping                    │");
  console.error("└─────────────────────────────────────────────────────────────────┘");
  console.error("");
  console.error(`Auth mode detected: ${authMode}`);
  console.error("");
  console.error(`Missing: ${missing.join(", ")}`);
  console.error("");

  if (authMode === "oauth2") {
    console.error("You need TWO things from Workato (API Client / OAuth2):");
    console.error("  1. Client ID      — from Workato → Tools → API Clients");
    console.error("  2. Client Secret  — shown once when you create the API Client");
    console.error("");
    console.error("Then run:");
    console.error('  npm run ping -- --client-id "YOUR_ID" --client-secret "YOUR_SECRET"');
  } else if (authMode === "access_token") {
    console.error("You need TWO things from Workato (Account → API Tokens):");
    console.error("  1. Access Token  — a long secret string");
    console.error("  2. User ID       — a number like 12345 (NOT your email)");
    console.error("");
    console.error("Then run:");
    console.error('  npm run ping -- --token "YOUR_SECRET_TOKEN" --user-id 12345');
  } else {
    console.error("Simplest mode (api_token) — you only need ONE thing:");
    console.error("  API Token — copy it from Workato's API Clients page:");
    console.error("    https://app.<pod>.workato.com/members/api/clients");
    console.error("  (e.g. https://app.sg.workato.com/members/api/clients)");
    console.error("");
    console.error("Then run:");
    console.error('  npm run ping -- --token "YOUR_API_TOKEN" --pod sg');
  }

  console.error("");
  console.error("Or set env vars:");
  console.error("  set WORKATO_TOKEN=xxx             (api_token mode — simplest)");
  console.error("  set WORKATO_USER_ID=12345         (only for access_token mode)");
  console.error("  set WORKATO_CLIENT_ID=xxx         (oauth2 mode)");
  console.error("  set WORKATO_CLIENT_SECRET=yyy");
  console.error("  npm run ping");
  console.error("");
  console.error("💡 Only have a single API token? Use --token only (no --user-id).");
  console.error("   Make sure --pod matches your Workato URL (sg, eu, us, ...).");
  console.error("");
  process.exit(1);
}

// --- Build env for child process ---
const env = {
  ...process.env,
  WORKATO_AUTH_MODE: authMode,
  WORKATO_TOKEN: token,
  WORKATO_USER_ID: userId,
  WORKATO_CLIENT_ID: clientId,
  WORKATO_CLIENT_SECRET: clientSecret,
  WORKATO_POD: args.pod ?? process.env.WORKATO_POD ?? "sg",
};

const child = spawn(process.execPath, [serverPath], {
  env,
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }
    }, 15000);
  });
}

function notify(method, params) {
  const msg = { jsonrpc: "2.0", method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }
});

async function main() {
  // 1. initialize
  const initResult = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ping-test", version: "1.0" },
  });
  console.log("✅ MCP handshake OK:", initResult.serverInfo);

  // 2. initialized notification
  notify("notifications/initialized", {});

  // 3. call ping
  console.log(`\n⏳ Calling ping tool (auth mode: ${authMode})...`);
  const toolResult = await send("tools/call", { name: "ping", arguments: {} });

  if (toolResult.isError) {
    console.error("\n❌ Ping FAILED:");
    console.error(toolResult.content[0]?.text);
    child.kill();
    process.exit(1);
  }

  console.log("\n✅ Ping SUCCESS! Workato responded with:");
  try {
    const data = JSON.parse(toolResult.content[0]?.text ?? "null");
    console.log(JSON.stringify(data, null, 2));
  } catch {
    console.log(toolResult.content[0]?.text);
  }

  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  child.kill();
  process.exit(1);
});