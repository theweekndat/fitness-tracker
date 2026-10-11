const TOKEN_KEY = "hub.appToken";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    // Storage blocked: the token only lives for this page view.
  }
}

export interface ApiResult {
  status: number;
  ok: boolean;
  body: unknown;
  headers: Headers;
  ms: number;
}

/** Calls the Worker with the bearer token. Always resolves; network failures return status 0. */
export async function api(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const started = performance.now();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${getToken()}`);
  try {
    const res = await fetch(`/api/${path}`, { ...init, headers });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body: keep the text.
    }
    return { status: res.status, ok: res.ok, body, headers: res.headers, ms: Math.round(performance.now() - started) };
  } catch (e) {
    return { status: 0, ok: false, body: String(e), headers: new Headers(), ms: Math.round(performance.now() - started) };
  }
}
