# mcp-workato

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes the [Workato Platform API](https://docs.workato.com/develop-and-distribute/api-docs/) to **Claude Desktop** (and any other MCP-compatible client).

With this server connected, you can ask Claude things like:

- *"List my Workato recipes that are currently running."*
- *"Show me the last 10 failed jobs for recipe 12345."*
- *"Stop recipe 67890."*
- *"Get the source code of custom connector 111."*

---

## Features

Exposes the following Workato operations as MCP **tools**:

| Tool | Description |
| --- | --- |
| `ping` | Validate credentials / return current user |
| **Recipes** | |
| `list_recipes` | List recipes (filter by folder, adapters, running status, date range, paginate) |
| `search_recipes` | Search recipes by name (case-insensitive, auto-paginating) |
| `get_recipe` | Get full recipe details via `/api/recipes/:id` (config + code + tags) |
| `start_recipe` | Start (enable) a recipe — `PUT /api/recipes/:id/start` |
| `stop_recipe` | Stop (disable) a recipe — `PUT /api/recipes/:id/stop` |
| `force_run_recipe` | Force-run a recipe on demand — `POST /api/recipes/:id/force_run` |
| `delete_recipe` | Delete a recipe permanently |
| `reset_recipe_trigger` | Reset trigger cursor (re-sync data) — polling/scheduled triggers only |
| **Jobs** | |
| `list_jobs` | List jobs (filter by recipe/status/date range) |
| `get_job` | Get job details (input/output/error trace) |
| **Connections** | |
| `list_connections` | List connections |
| `get_connection` | Get a connection by id |
| **Folders** | |
| `list_folders` | List project folders |
| `get_folder` | Get a folder/project by id |
| **Custom Connectors** | |
| `list_custom_connectors` | List custom connectors |
| `get_custom_connector` | Get custom connector metadata |
| `get_custom_connector_code` | Get a custom connector's source code |
| **Account** | |
| `list_account_properties` | List account properties (named constants) |

---

## Prerequisites

- **Node.js 18+** (tested on Node 22) — required for the built-in `fetch` API.
- A **Workato** account with API access enabled.
- Your Workato credentials — choose **one** of three authentication methods:

This server supports **three authentication methods**. The auth mode is auto-detected:

| You provide | Detected mode |
| --- | --- |
| `WORKATO_TOKEN` *(only)* | **api_token** *(default, simplest)* |
| `WORKATO_TOKEN` + `WORKATO_USER_ID` | access_token *(legacy)* |
| `WORKATO_CLIENT_ID` + `WORKATO_CLIENT_SECRET` | OAuth2 |
| `WORKATO_AUTH_MODE=...` | *(forces a specific mode)* |

---

### Method 1: API Token ⭐ (simplest — all you need is one token)

This is the simplest method and works with the single token shown on Workato's **API Clients** page
(`https://app.<pod>.workato.com/members/api/clients`). The token is sent as
`Authorization: Bearer <token>`.

1. Sign in to Workato.
2. Open **API Clients**:
   `https://app.<your-pod>.workato.com/members/api/clients`
   (e.g. for Singapore: `https://app.sg.workato.com/members/api/clients`).
3. Copy the **API Token** shown on that page → `WORKATO_TOKEN`.

That's it — no user id, no client id/secret needed.

```json
{
  "WORKATO_TOKEN": "YOUR_API_TOKEN",
  "WORKATO_POD": "sg"
}
```

> 💡 Make sure `WORKATO_POD` matches the subdomain of your Workato URL
> (`app.sg.workato.com` → `sg`, `app.eu.workato.com` → `eu`, etc.).

---

### Method 2: API Client / OAuth2 (for automation / service accounts)

Uses Workato's OAuth2 `client_credentials` flow. You need a **Client ID** and **Client Secret**.

1. Sign in to Workato.
2. Go to **Tools → API Clients** (or **App Console → API Clients** on some plans).
3. Click **"Create API Client"** (or "New Client").
4. Copy the **Client ID** → `WORKATO_CLIENT_ID`
5. Copy the **Client Secret** (shown once!) → `WORKATO_CLIENT_SECRET`

> 💡 With this method, you do **NOT** need `WORKATO_TOKEN` or `WORKATO_USER_ID`.
> The server automatically exchanges client_id + client_secret for a Bearer access token.

---

### Method 3: Access Token (legacy personal API token)

Uses the `x-client-secret` + `x-user-id` header scheme. You need a **token** and **user ID**.

1. Sign in to Workato.
2. Go to **Account → API Tokens** (or **Settings → Account → API Tokens**).
3. Click an existing token, or **Create Token**.
4. Copy the **Access token** → `WORKATO_TOKEN`
5. Copy the **User ID** (a number like `12345`) → `WORKATO_USER_ID`

> ⚠️ **User ID** is a numeric id, NOT your email/username. Find it next to the token, or in **Settings → Profile**.

---

### Data center / pod

All auth methods need to know your Workato data center. Look at the Workato URL:

| URL | Pod |
| --- | --- |
| `https://www.workato.com` | `us` (default) |
| `https://app.eu.workato.com` | `eu` |
| `https://app.sg.workato.com` | `sg` |
| `https://app.jp.workato.com` | `jp` |
| `https://app.au.workato.com` | `au` |
| `https://app.il.workato.com` | `il` |
| `https://app.kr.workato.com` | `kr` |
| `https://app.workatoapp.cn` | `cn` |
| `https://app.trial.workato.com` | `trial` |

---

## Installation

```bash
git clone <this-repo> mcp_workato
cd mcp_workato
npm install
npm run build
```

This produces the compiled server at `dist/index.js`.

---

## Configuration

Configuration is read from **environment variables** (or command-line `--key value` args). See [`.env.example`](.env.example).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WORKATO_TOKEN` | ⚠️ | — | API token (mode 1) / access token (mode 3). Required for modes 1 & 3 |
| `WORKATO_USER_ID` | ⚠️ | — | Numeric Workato user id (mode 3 only) |
| `WORKATO_CLIENT_ID` | ⚠️ | — | OAuth2 client id (mode 2 only) |
| `WORKATO_CLIENT_SECRET` | ⚠️ | — | OAuth2 client secret (mode 2 only) |
| `WORKATO_AUTH_MODE` | ❌ | *(auto)* | Force mode: `api_token`, `access_token`, or `oauth2` |
| `WORKATO_POD` | ❌ | `us` | Data center: `us`, `eu`, `sg`, `jp`, `au`, `il`, `kr`, `cn`, `trial` |
| `WORKATO_BASE_URL` | ❌ | *(from pod)* | Override the API base URL completely |
| `WORKATO_TIMEOUT_MS` | ❌ | `60000` | HTTP request timeout |
| `WORKATO_DEBUG` | ❌ | `false` | Log each API request to stderr |

---

## Connect to Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

> 💡 On Windows, replace `D:\\Projects\\Pribadi\\mcp_workato` below with the absolute path to **your** project folder. Use double backslashes (`\\`) in JSON.

Add the `mcp-workato` server:

**Simplest — API Token mode (Method 1):**

```json
{
  "mcpServers": {
    "workato": {
      "command": "node",
      "args": ["D:\\Projects\\Pribadi\\mcp_workato\\dist\\index.js"],
      "env": {
        "WORKATO_TOKEN": "your_api_token_here",
        "WORKATO_POD": "sg"
      }
    }
  }
}
```

**Or, with OAuth2 (Method 2):**

```json
{
  "mcpServers": {
    "workato": {
      "command": "node",
      "args": ["D:\\Projects\\Pribadi\\mcp_workato\\dist\\index.js"],
      "env": {
        "WORKATO_CLIENT_ID": "your_client_id",
        "WORKATO_CLIENT_SECRET": "your_client_secret",
        "WORKATO_POD": "us"
      }
    }
  }
}
```

Then:

1. **Save** the file.
2. **Quit Claude Desktop completely** (system tray → Quit, not just close the window).
3. **Restart Claude Desktop.**
4. Start a new chat. You should see the **workato** server's tools available. Try asking: *"Can you list my Workato recipes?"*

### Verify your credentials (ping test)

Before wiring the server into Claude, test that your Workato credentials work. There are three ways:

**Option 1 — `npm run ping` (recommended, easiest)**

```bash
# Simplest: API token only (Method 1)
npm run ping -- --token YOUR_TOKEN --pod sg

# Or set env vars first (Windows)
set WORKATO_TOKEN=YOUR_TOKEN
set WORKATO_POD=sg
npm run ping

# OAuth2 mode (Method 2)
npm run ping -- --client-id YOUR_ID --client-secret YOUR_SECRET
```

Expected output with valid credentials:
```
✅ MCP handshake OK: { name: 'mcp-workato', version: '1.0.0' }
⏳ Calling ping tool...
✅ Ping SUCCESS! Workato responded with:
{ "id": 12345, "name": "Your Name", ... }
```

If credentials are wrong you'll see:
```
❌ Ping FAILED:
Error: Workato API error: GET .../api/users/me -> 401 Unauthorized
```

**Option 2 — MCP inspector (interactive UI)**

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

This opens a web UI where you can connect, list tools, and call `ping` manually.

**Option 3 — Through Claude Desktop**

Once configured (see below), just ask Claude: *"Can you ping Workato to check the connection?"*

---

## Run from CLI args (alternative to env vars)

Every setting can also be passed as a command-line argument:

```bash
# API token only (Method 1 - simplest)
node dist/index.js --token "YOUR_TOKEN" --pod sg --debug

# OAuth2 mode (Method 2)
node dist/index.js --client-id "YOUR_ID" --client-secret "YOUR_SECRET" --pod eu
```

| Flag | Env var equivalent |
| --- | --- |
| `--token` | `WORKATO_TOKEN` |
| `--user-id` | `WORKATO_USER_ID` |
| `--client-id` | `WORKATO_CLIENT_ID` |
| `--client-secret` | `WORKATO_CLIENT_SECRET` |
| `--auth-mode` | `WORKATO_AUTH_MODE` |
| `--pod` | `WORKATO_POD` |
| `--base-url` | `WORKATO_BASE_URL` |
| `--token-url` | `WORKATO_TOKEN_URL` |
| `--timeout-ms` | `WORKATO_TIMEOUT_MS` |
| `--debug` | `WORKATO_DEBUG` |

---

## Development

```bash
npm run build     # compile TypeScript -> dist/
npm run lint      # type-check without emitting
npm start         # run the compiled server
npm run dev       # build + run in one step
```

### Project structure

```
mcp_workato/
├── src/
│   ├── index.ts            # MCP server entry (stdio transport)
│   ├── tools.ts            # MCP tool definitions + zod schemas
│   ├── workato-client.ts   # Workato REST API client
│   └── config.ts           # env/arg config loader
├── dist/                   # compiled output (after build)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## How it works

```
Claude Desktop  ──stdio──►  mcp-workato (this server)  ──HTTPS──►  Workato Platform API
```

- Claude Desktop spawns the server as a child process and talks to it over **stdin/stdout** using the JSON-RPC–based MCP protocol.
- The server authenticates to Workato using one of three methods (see above): `Authorization: Bearer <token>` (api_token), the OAuth2 client_credentials flow, or the legacy `x-client-secret` + `x-user-id` headers.
- Each MCP tool maps to one Workato API endpoint; results are returned as JSON text content that Claude can read and reason about.

---

## Security notes

- Your Workato token is powerful. Treat it like a password.
- The token is only stored in your local `claude_desktop_config.json` (or env). It is **not** sent anywhere except Workato.
- Set `WORKATO_DEBUG=true` only for troubleshooting — it logs request URLs (not secrets) to stderr.

---

## Troubleshooting

**"Missing required Workato configuration"**
→ The required env vars for your chosen auth mode aren't set in the Claude Desktop config's `env` block. At minimum, provide `WORKATO_TOKEN` (for api_token mode), plus `WORKATO_USER_ID` (access_token mode), or `WORKATO_CLIENT_ID` + `WORKATO_CLIENT_SECRET` (oauth2 mode).

**401 / "Unauthorized" from Workato**
→ Token is wrong/expired, or the user id doesn't match the token. Regenerate the token in Workato.

**Wrong data center / 404**
→ Set `WORKATO_POD` to match your Workato URL (e.g. `eu`, `sg`), or set `WORKATO_BASE_URL` directly.

**Claude Desktop doesn't see the tools**
→ Fully quit and restart Claude Desktop. Check the project path uses double backslashes on Windows. Check Claude's logs (`%APPDATA%\Claude\logs`).

---

## License

MIT