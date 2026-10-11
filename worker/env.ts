export interface Env {
  ASSETS: Fetcher;
  KV: KVNamespace;

  // Secrets
  APP_TOKEN?: string;
  HEVY_API_KEY?: string;
  OURA_CLIENT_ID?: string;
  OURA_CLIENT_SECRET?: string;

  // Plain vars (wrangler.jsonc)
  OFF_CONTACT: string;
  OFF_BASE: string;
  HEVY_BASE: string;
  OURA_AUTHORIZE_URL: string;
  OURA_TOKEN_URL: string;
  OURA_API_BASE: string;
  OURA_SCOPES: string;
  VAPID_SUBJECT: string;
}

export const APP_VERSION = "0.0.1";

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** Pass an upstream body straight through without parsing it (10 ms CPU budget). */
export function passThrough(upstream: Response, extra: HeadersInit = {}): Response {
  const headers = new Headers({ "cache-control": "no-store", ...extra });
  const type = upstream.headers.get("content-type");
  if (type) headers.set("content-type", type);
  return new Response(upstream.body, { status: upstream.status, headers });
}

export class UpstreamError extends Error {
  constructor(readonly host: string) {
    super(`upstream unreachable: ${host}`);
  }
}

/** fetch() that turns network failures into UpstreamError, reported as 502 by the router. */
export async function upstreamFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new UpstreamError(new URL(url).host);
  }
}
