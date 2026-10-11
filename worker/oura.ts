import { error, json, passThrough, upstreamFetch, type Env } from "./env";

// KV keys
const STATE_PREFIX = "oura:state:";
const TOKENS_KEY = "oura:tokens";
const STATUS_KEY = "oura:status";

export const OURA_COLLECTIONS = ["daily_sleep", "sleep", "daily_readiness", "daily_activity"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REFRESH_MARGIN_MS = 60_000;

export interface OuraTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms. */
  expires_at: number;
  obtained_at: number;
}

export interface OuraStatus {
  reconnect_required: boolean;
  last_error?: string;
  last_refresh_at?: number;
  last_data_at?: number;
  /** Field names seen in the token response, recorded for the Phase 0 findings (no values). */
  token_response_keys?: string[];
}

function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}/api/oura/callback`;
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readStatus(env: Env): Promise<OuraStatus> {
  return (await env.KV.get<OuraStatus>(STATUS_KEY, "json")) ?? { reconnect_required: false };
}

async function writeStatus(env: Env, patch: Partial<OuraStatus>): Promise<void> {
  await env.KV.put(STATUS_KEY, JSON.stringify({ ...(await readStatus(env)), ...patch }));
}

export async function ouraStatus(env: Env) {
  const tokens = await env.KV.get<OuraTokens>(TOKENS_KEY, "json");
  const status = await readStatus(env);
  return {
    configured: Boolean(env.OURA_CLIENT_ID && env.OURA_CLIENT_SECRET),
    connected: Boolean(tokens),
    access_expires_at: tokens?.expires_at ?? null,
    ...status,
  };
}

export async function handleOuraStart(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed", "Use POST");
  if (!env.OURA_CLIENT_ID) return error(503, "oura_not_configured", "OURA_CLIENT_ID secret is not set");
  const state = randomState();
  await env.KV.put(STATE_PREFIX + state, "1", { expirationTtl: 600 });
  const url = new URL(env.OURA_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.OURA_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(request));
  url.searchParams.set("scope", env.OURA_SCOPES);
  url.searchParams.set("state", state);
  return json({ url: url.toString() });
}

function appRedirect(request: Request, params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString();
  return Response.redirect(`${new URL(request.url).origin}/#/spike?${qs}`, 302);
}

/** Exchange a code or a refresh token. Returns tokens or an error string. */
async function tokenRequest(
  env: Env,
  form: Record<string, string>,
  previousRefresh?: string,
): Promise<{ tokens: OuraTokens; keys: string[] } | { error: string }> {
  const body = new URLSearchParams({
    ...form,
    client_id: env.OURA_CLIENT_ID ?? "",
    client_secret: env.OURA_CLIENT_SECRET ?? "",
  });
  const res = await upstreamFetch(env.OURA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!res.ok) return { error: `token endpoint returned ${res.status}` };
  const data = (await res.json()) as Record<string, unknown>;
  const access = data["access_token"];
  const refresh = data["refresh_token"] ?? previousRefresh;
  const expiresIn = Number(data["expires_in"] ?? 0);
  if (typeof access !== "string" || typeof refresh !== "string") {
    return { error: "token response missing access_token or refresh_token" };
  }
  const now = Date.now();
  return {
    tokens: {
      access_token: access,
      refresh_token: refresh,
      expires_at: now + (expiresIn > 0 ? expiresIn * 1000 : 3600_000),
      obtained_at: now,
    },
    keys: Object.keys(data).sort(),
  };
}

export async function handleOuraCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return appRedirect(request, { oura: "error", reason: oauthError.slice(0, 64) });
  if (!state || !code) return appRedirect(request, { oura: "error", reason: "missing_code_or_state" });

  const stateKey = STATE_PREFIX + state;
  if (!(await env.KV.get(stateKey))) return appRedirect(request, { oura: "error", reason: "invalid_state" });
  await env.KV.delete(stateKey);

  const result = await tokenRequest(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(request),
  });
  if ("error" in result) {
    await writeStatus(env, { reconnect_required: true, last_error: result.error });
    return appRedirect(request, { oura: "error", reason: "token_exchange_failed" });
  }
  await env.KV.put(TOKENS_KEY, JSON.stringify(result.tokens));
  await writeStatus(env, { reconnect_required: false, last_error: undefined, token_response_keys: result.keys });
  return appRedirect(request, { oura: "connected" });
}

/**
 * Refresh tokens are single-use: the new refresh token must be stored before anything else,
 * and the app must call Oura routes one at a time so two refreshes never race.
 */
export async function refreshTokens(env: Env, current: OuraTokens): Promise<OuraTokens | null> {
  const result = await tokenRequest(
    env,
    { grant_type: "refresh_token", refresh_token: current.refresh_token },
    current.refresh_token,
  );
  if ("error" in result) {
    await writeStatus(env, { reconnect_required: true, last_error: `refresh failed: ${result.error}` });
    return null;
  }
  await env.KV.put(TOKENS_KEY, JSON.stringify(result.tokens));
  await writeStatus(env, { reconnect_required: false, last_error: undefined, last_refresh_at: Date.now() });
  return result.tokens;
}

function reconnect(): Response {
  return error(409, "oura_reconnect_required", "Oura connection expired. Reconnect Oura in Settings.");
}

export async function handleOuraData(request: Request, env: Env, collection: string): Promise<Response> {
  if (request.method !== "GET") return error(405, "method_not_allowed", "Use GET");
  if (!(OURA_COLLECTIONS as readonly string[]).includes(collection)) {
    return error(403, "collection_not_allowed", "Collection is not on the Oura allowlist");
  }
  let tokens = await env.KV.get<OuraTokens>(TOKENS_KEY, "json");
  if (!tokens) return error(409, "oura_not_connected", "Connect Oura first");

  const incoming = new URL(request.url);
  const upstream = new URL(`${env.OURA_API_BASE}/${collection}`);
  for (const k of ["start_date", "end_date"]) {
    const v = incoming.searchParams.get(k);
    if (v !== null) {
      if (!DATE_RE.test(v)) return error(400, "bad_date", `${k} must be YYYY-MM-DD`);
      upstream.searchParams.set(k, v);
    }
  }
  const next = incoming.searchParams.get("next_token");
  if (next) upstream.searchParams.set("next_token", next);

  if (tokens.expires_at - REFRESH_MARGIN_MS <= Date.now()) {
    tokens = await refreshTokens(env, tokens);
    if (!tokens) return reconnect();
  }

  const call = (t: OuraTokens) =>
    upstreamFetch(upstream.toString(), { headers: { authorization: `Bearer ${t.access_token}`, accept: "application/json" } });

  let res = await call(tokens);
  if (res.status === 401) {
    tokens = await refreshTokens(env, tokens);
    if (!tokens) return reconnect();
    res = await call(tokens);
  }
  if (res.ok) await writeStatus(env, { last_data_at: Date.now() });
  return passThrough(res);
}

export async function handleOuraDisconnect(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed", "Use POST");
  await env.KV.delete(TOKENS_KEY);
  await env.KV.delete(STATUS_KEY);
  return json({ ok: true });
}
