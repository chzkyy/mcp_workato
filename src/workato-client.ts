/**
 * Workato Platform API client.
 *
 * Wraps the Workato REST API and exposes typed helper methods used by the
 * MCP tools. Supports THREE authentication methods:
 *
 * 1. **API Token** (single bearer token from API Clients page):
 *    Send `Authorization: Bearer <token>`. Only needs the token.
 *
 * 2. **Access Token** (legacy personal API token):
 *    Headers `x-client-secret` (token) + `x-user-id`.
 *
 * 3. **API Client / OAuth2** (client credentials flow):
 *    Exchange `client_id` + `client_secret` for a Bearer access token via the
 *    OAuth2 token endpoint, then send `Authorization: Bearer <token>`.
 *    Tokens are cached and auto-refreshed before expiry.
 *
 * Docs: https://docs.workato.com/develop-and-distribute/api-docs/
 */

/**
 * Known Workato data centers mapped to their public Developer API host.
 *
 * Per the official Workato Developer API docs
 * (https://docs.workato.com/en/workato-api#base-url), the hosts are the "app."
 * / "www." hosts, NOT "apim." (the older API Management host).
 *
 *   US:  https://www.workato.com
 *   EU:  https://app.eu.workato.com
 *   SG:  https://app.sg.workato.com
 *   JP:  https://app.jp.workato.com
 *   AU:  https://app.au.workato.com
 *   IL:  https://app.il.workato.com
 *   KR:  https://app.kr.workato.com
 *   CN:  https://app.workatoapp.cn
 *   Trial (self-service): https://app.trial.workato.com
 */
export const WORKATO_POD_HOSTS: Record<string, string> = {
  us: "https://www.workato.com",
  eu: "https://app.eu.workato.com",
  sg: "https://app.sg.workato.com",
  jp: "https://app.jp.workato.com",
  au: "https://app.au.workato.com",
  il: "https://app.il.workato.com",
  kr: "https://app.kr.workato.com",
  cn: "https://app.workatoapp.cn",
  trial: "https://app.trial.workato.com",
};

/**
 * Known Workato OAuth2 token endpoints per pod.
 * Follows the same host pattern as the Developer API.
 */
export const WORKATO_OAUTH_HOSTS: Record<string, string> = {
  us: "https://www.workato.com",
  eu: "https://app.eu.workato.com",
  sg: "https://app.sg.workato.com",
  jp: "https://app.jp.workato.com",
  au: "https://app.au.workato.com",
  il: "https://app.il.workato.com",
  kr: "https://app.kr.workato.com",
  cn: "https://app.workatoapp.cn",
  trial: "https://app.trial.workato.com",
};

/** Error thrown when the Workato API returns a non-2xx response. */
export class WorkatoApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
    public readonly method: string,
    message?: string,
    public readonly body?: unknown,
  ) {
    super(
      `Workato API error: ${method} ${url} -> ${status} ${statusText}${
        message ? `: ${message}` : ""
      }`,
    );
    this.name = "WorkatoApiError";
  }
}

export type AuthMode = "api_token" | "access_token" | "oauth2";

export interface WorkatoClientOptions {
  /** Authentication mode. Defaults to "api_token". */
  authMode?: AuthMode;

  // --- api_token / access_token mode fields ---
  /** API token / access token / client secret. */
  token?: string;
  /** Workato user id that owns the token (for access_token mode only). */
  userId?: string | number;

  // --- oauth2 (API Client) mode fields ---
  /** OAuth2 client id (for oauth2 mode). */
  clientId?: string;
  /** OAuth2 client secret (for oauth2 mode). */
  clientSecret?: string;
  /** OAuth2 token endpoint URL (for oauth2 mode). */
  tokenUrl?: string;

  // --- shared ---
  /** Base URL, e.g. https://www.workato.com. Must not end with a slash. */
  baseUrl: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Optional request hook for debug logging. */
  onRequest?: (info: { method: string; url: string }) => void;
}

type QueryValue = string | number | boolean | undefined | null;

interface OAuthToken {
  accessToken: string;
  /** Absolute expiry timestamp (ms since epoch). */
  expiresAt: number;
}

export class WorkatoClient {
  private readonly authMode: AuthMode;
  private readonly token?: string;
  private readonly userId?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly tokenUrl?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onRequest?: (info: { method: string; url: string }) => void;

  /** Cached OAuth2 token (oauth2 mode only). */
  private cachedToken: OAuthToken | null = null;

  constructor(opts: WorkatoClientOptions) {
    this.authMode = opts.authMode ?? "api_token";
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.onRequest = opts.onRequest;

    if (this.authMode === "api_token") {
      if (!opts.token) throw new Error("Workato token is required (api_token mode)");
      this.token = opts.token;
    } else if (this.authMode === "access_token") {
      if (!opts.token) throw new Error("Workato token is required (access_token mode)");
      if (opts.userId === undefined || opts.userId === null || opts.userId === "")
        throw new Error("Workato user id is required (access_token mode)");
      this.token = opts.token;
      this.userId = String(opts.userId);
    } else {
      // oauth2 mode
      if (!opts.clientId) throw new Error("Workato client id is required (oauth2 mode)");
      if (!opts.clientSecret)
        throw new Error("Workato client secret is required (oauth2 mode)");
      if (!opts.tokenUrl) throw new Error("Workato token URL is required (oauth2 mode)");
      this.clientId = opts.clientId;
      this.clientSecret = opts.clientSecret;
      this.tokenUrl = opts.tokenUrl;
    }
  }

  /** Resolve the API base URL from a pod code or explicit URL. */
  static resolveBaseUrl(pod?: string, explicitUrl?: string): string {
    if (explicitUrl) return explicitUrl.replace(/\/+$/, "");
    const key = (pod ?? "us").toLowerCase();
    const host = WORKATO_POD_HOSTS[key];
    if (!host) {
      throw new Error(
        `Unknown Workato pod "${pod}". Valid pods: ${Object.keys(
          WORKATO_POD_HOSTS,
        ).join(", ")}`,
      );
    }
    return host;
  }

  /** Resolve the OAuth2 token endpoint from a pod code or explicit URL. */
  static resolveTokenUrl(pod?: string, explicitUrl?: string): string {
    if (explicitUrl) return explicitUrl.replace(/\/+$/, "");
    const key = (pod ?? "us").toLowerCase();
    const host = WORKATO_OAUTH_HOSTS[key];
    if (!host) {
      throw new Error(
        `Unknown Workato pod "${pod}". Valid pods: ${Object.keys(
          WORKATO_OAUTH_HOSTS,
        ).join(", ")}`,
      );
    }
    return `${host}/oauth/token`;
  }

  // ----- OAuth2 token management --------------------------------------------

  /**
   * Exchange client credentials for an OAuth2 access token via Workato's
   * token endpoint. Uses client_credentials grant type.
   */
  private async fetchOAuthToken(): Promise<OAuthToken> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      // Workato's OAuth2 token endpoint accepts application/x-www-form-urlencoded
      const body = new URLSearchParams();
      body.set("grant_type", "client_credentials");
      body.set("client_id", this.clientId!);
      body.set("client_secret", this.clientSecret!);

      response = await fetch(this.tokenUrl!, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `OAuth2 token request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw err;
    }
    clearTimeout(timer);

    const rawText = await response.text();
    let parsed: unknown;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = rawText;
    }

    if (!response.ok) {
      const message =
        typeof parsed === "object" &&
        parsed !== null &&
        "error_description" in parsed &&
        typeof (parsed as { error_description: unknown }).error_description === "string"
          ? (parsed as { error_description: string }).error_description
          : typeof parsed === "object" &&
              parsed !== null &&
              "error" in parsed &&
              typeof (parsed as { error: unknown }).error === "string"
            ? (parsed as { error: string }).error
            : undefined;
      throw new WorkatoApiError(
        response.status,
        response.statusText,
        this.tokenUrl!,
        "POST",
        `OAuth2 token exchange failed${message ? `: ${message}` : ""}`,
        parsed,
      );
    }

    const tokenData = parsed as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    };

    if (!tokenData.access_token) {
      throw new Error("OAuth2 token response missing access_token");
    }

    const expiresIn = tokenData.expires_in ?? 3600;
    // Refresh slightly early (10s buffer) to avoid edge-case expiry.
    return {
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + expiresIn * 1000 - 10_000,
    };
  }

  /**
   * Get a valid OAuth2 access token, fetching or refreshing as needed.
   * Only used in oauth2 mode.
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.accessToken;
    }
    this.onRequest?.({ method: "POST", url: this.tokenUrl! });
    this.cachedToken = await this.fetchOAuthToken();
    return this.cachedToken.accessToken;
  }

  /** Force-refresh the OAuth2 token (clears cache). */
  invalidateToken(): void {
    this.cachedToken = null;
  }

  // ----- core HTTP -----------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(this.baseUrl + cleanPath);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    opts: {
      query?: Record<string, QueryValue>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    this.onRequest?.({ method, url });

    // Build auth headers based on auth mode.
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (this.authMode === "oauth2") {
      const accessToken = await this.getAccessToken();
      headers["authorization"] = `Bearer ${accessToken}`;
    } else if (this.authMode === "api_token") {
      headers["authorization"] = `Bearer ${this.token!}`;
    } else {
      headers["x-client-secret"] = this.token!;
      headers["x-user-id"] = this.userId!;
    }

    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Workato request timed out after ${this.timeoutMs}ms: ${method} ${url}`,
        );
      }
      throw err;
    }
    clearTimeout(timer);

    // If we get a 401 in oauth2 mode, the token may have expired early.
    // Invalidate and retry once.
    if (response.status === 401 && this.authMode === "oauth2" && !opts.query?.["_retried"]) {
      this.invalidateToken();
      return this.request<T>(method, path, {
        ...opts,
        query: { ...opts.query, _retried: "true" as QueryValue },
      });
    }

    const rawText = await response.text();
    let parsed: unknown = undefined;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = rawText;
      }
    }

    if (!response.ok) {
      const message =
        typeof parsed === "object" &&
        parsed !== null &&
        "message" in parsed &&
        typeof (parsed as { message: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : undefined;
      throw new WorkatoApiError(
        response.status,
        response.statusText,
        url,
        method,
        message ?? (typeof parsed === "string" ? parsed : undefined),
        parsed,
      );
    }

    // Some Workato endpoints (start/stop recipe) return no body.
    return (parsed === undefined ? (null as unknown) : parsed) as T;
  }

  get<T = unknown>(path: string, query?: Record<string, QueryValue>) {
    return this.request<T>("GET", path, { query });
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body });
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body });
  }

  delete<T = unknown>(path: string, query?: Record<string, QueryValue>) {
    return this.request<T>("DELETE", path, { query });
  }

  // ----- convenience API methods --------------------------------------------

  /** Validate credentials and return the current user. */
  currentUser() {
    return this.get<unknown>("/api/users/me");
  }

  // Recipes ------------------------------------------------------------------
  /**
   * List recipes belonging to the authenticated user.
   * GET /api/recipes — returns { items: [...], count, page, per_page }
   *
   * Note: The Workato API does NOT support free-text search (no `q` param).
   * To search by name, use listAllRecipes + client-side filtering.
   */
  listRecipes(params: {
    folder_id?: number | string;
    with_subfolders?: boolean;
    adapter_names_all?: string;
    adapter_names_any?: string;
    running?: boolean;
    order?: "activity" | "default";
    since_id?: number;
    stopped_after?: string;
    stop_cause?: string;
    updated_after?: string;
    page?: number;
    per_page?: number;
    exclude_code?: boolean;
  } = {}) {
    return this.get<{ items?: unknown[]; count?: number; page?: number; per_page?: number }>(
      "/api/recipes",
      params as Record<string, QueryValue>,
    );
  }

  /**
   * Fetch ALL recipes (auto-paginating) and optionally filter by name.
   * Since the Workato API has no server-side search, we paginate + filter
   * client-side.
   */
  async listAllRecipes(opts: {
    nameContains?: string;
    folder_id?: number | string;
    with_subfolders?: boolean;
    running?: boolean;
    maxPages?: number;
  } = {}): Promise<unknown[]> {
    const { nameContains, maxPages = 50 } = opts;
    const all: unknown[] = [];
    let page = 1;
    const perPage = 100;
    for (let i = 0; i < maxPages; i++) {
      const resp = await this.listRecipes({
        folder_id: opts.folder_id,
        with_subfolders: opts.with_subfolders,
        running: opts.running,
        page,
        per_page: perPage,
        exclude_code: true,
      });
      const items = resp?.items ?? [];
      if (items.length === 0) break;
      all.push(...items);
      if (items.length < perPage) break;
      page++;
    }
    // Client-side name filter
    if (nameContains) {
      const needle = nameContains.toLowerCase();
      return all.filter((r) => {
        const name = (r as Record<string, unknown>)?.name;
        return typeof name === "string" && name.toLowerCase().includes(needle);
      });
    }
    return all;
  }

  /**
   * Get recipe details.
   * GET /api/recipes/:id
   * Pass includes=["tags"] to also get tags.
   */
  getRecipe(id: number | string, includes?: string[]) {
    const query: Record<string, QueryValue> = {};
    if (includes && includes.length > 0) {
      // Workato uses includes[]=tags format
      includes.forEach((inc, i) => {
        query[`includes[${i}]`] = inc;
      });
    }
    return this.get<unknown>(`/api/recipes/${id}`, query);
  }

  /** Start (enable) a recipe. PUT /api/recipes/:id/start */
  startRecipe(id: number | string) {
    return this.put<unknown>(`/api/recipes/${id}/start`);
  }

  /** Stop (disable) a recipe. PUT /api/recipes/:id/stop */
  stopRecipe(id: number | string) {
    return this.put<unknown>(`/api/recipes/${id}/stop`);
  }

  /** Delete a recipe. DELETE /api/recipes/:id */
  deleteRecipe(id: number | string) {
    return this.delete<unknown>(`/api/recipes/${id}`);
  }

  /**
   * Force-run a recipe on demand.
   * POST /api/recipes/:recipe_id/force_run
   * Rate limit: 1 request per second.
   */
  forceRunRecipe(id: number | string) {
    return this.post<unknown>(`/api/recipes/${id}/force_run`);
  }

  /**
   * Reset recipe trigger (re-sync data).
   * POST /api/recipes/:recipe_id/reset_trigger
   * Only compatible with polling and scheduled triggers.
   */
  resetRecipeTrigger(id: number | string) {
    return this.post<unknown>(`/api/recipes/${id}/reset_trigger`);
  }

  // Jobs ---------------------------------------------------------------------
  listJobs(params: {
    recipe_id?: number | string;
    flow_id?: number | string;
    status?: string;
    page?: number;
    per_page?: number;
    start_date?: string;
    end_date?: string;
  } = {}) {
    return this.get<{ data?: unknown[]; items?: unknown[] } | unknown[]>(
      "/api/jobs",
      params as Record<string, QueryValue>,
    );
  }

  getJob(id: number | string) {
    return this.get<unknown>(`/api/jobs/${id}`);
  }

  // Connections --------------------------------------------------------------
  listConnections(params: { page?: number; per_page?: number } = {}) {
    return this.get<{ data?: unknown[]; items?: unknown[] } | unknown[]>(
      "/api/connections",
      params as Record<string, QueryValue>,
    );
  }

  getConnection(id: number | string) {
    return this.get<unknown>(`/api/connections/${id}`);
  }

  // Folders / projects -------------------------------------------------------
  listFolders(params: { page?: number; per_page?: number } = {}) {
    return this.get<{ data?: unknown[]; items?: unknown[] } | unknown[]>(
      "/api/folders",
      params as Record<string, QueryValue>,
    );
  }

  getFolder(id: number | string) {
    return this.get<unknown>(`/api/folders/${id}`);
  }

  // Custom connectors --------------------------------------------------------
  listCustomConnectors(params: { page?: number; per_page?: number } = {}) {
    return this.get<{ data?: unknown[]; items?: unknown[] } | unknown[]>(
      "/api/custom_connectors",
      params as Record<string, QueryValue>,
    );
  }

  getCustomConnector(id: number | string) {
    return this.get<unknown>(`/api/custom_connectors/${id}`);
  }

  getCustomConnectorCode(id: number | string) {
    return this.get<unknown>(`/api/custom_connectors/${id}/code`);
  }

  // Account info -------------------------------------------------------------
  listAccountProperties() {
    return this.get<unknown>("/api/account_properties");
  }
}