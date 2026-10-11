import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorized, timingSafeEqual } from "./auth";
import { isAllowedHevyPath } from "./hevy";
import { route } from "./index";
import type { OuraTokens } from "./oura";
import { vapidJwt } from "./push";
import { makeEnv, req, TOKEN } from "./testing";

type FetchArgs = [string, RequestInit | undefined];
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const calls = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls as unknown as FetchArgs[];

afterEach(() => vi.unstubAllGlobals());

describe("auth", () => {
  it("compares tokens", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("rejects missing, wrong and unconfigured tokens", () => {
    expect(isAuthorized(req("/api/status"), TOKEN)).toBe(true);
    expect(isAuthorized(req("/api/status", { auth: false }), TOKEN)).toBe(false);
    expect(isAuthorized(req("/api/status", { headers: { authorization: "Bearer nope" }, auth: false }), TOKEN)).toBe(false);
    expect(isAuthorized(req("/api/status"), undefined)).toBe(false);
    expect(isAuthorized(req("/api/status", { headers: { authorization: "Bearer short" }, auth: false }), "short")).toBe(false);
  });

  it("returns 401 on API routes without a token", async () => {
    const res = await route(req("/api/status", { auth: false }), makeEnv());
    expect(res.status).toBe(401);
  });

  it("serves static assets without a token", async () => {
    const res = await route(req("/index.html", { auth: false }), makeEnv());
    expect(await res.text()).toBe("asset");
  });

  it("reports status without leaking secrets", async () => {
    const res = await route(req("/api/status"), makeEnv());
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("hevy-key");
    expect(text).not.toContain("csecret");
    expect(JSON.parse(text).hevy.configured).toBe(true);
  });
});

describe("hevy proxy", () => {
  it("allowlists read paths only", () => {
    for (const p of ["workouts", "workouts/count", "workouts/events", "workouts/abc-123", "exercise_templates", "routines", "routine_folders"]) {
      expect(isAllowedHevyPath(p)).toBe(true);
    }
    for (const p of ["user/info", "workouts/../user", "routines/x/y", "", "webhook-subscription"]) {
      expect(isAllowedHevyPath(p)).toBe(false);
    }
  });

  it("rejects non-allowlisted paths and writes before calling upstream", async () => {
    const fetchFn = mockFetch(() => new Response("{}"));
    expect((await route(req("/api/hevy/user/info"), makeEnv())).status).toBe(403);
    expect((await route(req("/api/hevy/workouts", { method: "POST" }), makeEnv())).status).toBe(405);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("passes the key server-side and forwards only known params", async () => {
    const fetchFn = mockFetch(() => new Response('{"page":1}', { headers: { "content-type": "application/json" } }));
    const res = await route(req("/api/hevy/workouts?page=2&pageSize=10&evil=1"), makeEnv());
    expect(await res.text()).toBe('{"page":1}');
    const [url, init] = calls(fetchFn)[0]!;
    expect(url).toBe("https://hevy.test/v1/workouts?page=2&pageSize=10");
    expect(new Headers(init?.headers).get("api-key")).toBe("hevy-key");
  });
});

describe("oura oauth", () => {
  it("start stores a state with a 10 minute TTL", async () => {
    const env = makeEnv();
    const res = await route(req("/api/oura/start", { method: "POST" }), env);
    const { url } = (await res.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    expect(new URL(url).searchParams.get("redirect_uri")).toBe("https://hub.example.workers.dev/api/oura/callback");
    expect(env.KV.store.get(`oura:state:${state}`)?.ttl).toBe(600);
  });

  it("callback rejects an unknown state without calling Oura", async () => {
    const fetchFn = mockFetch(() => new Response("{}"));
    const res = await route(req("/api/oura/callback?code=c&state=forged", { auth: false }), makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("invalid_state");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("callback exchanges the code, stores tokens and consumes the state", async () => {
    const env = makeEnv();
    await env.KV.put("oura:state:good", "1");
    const fetchFn = mockFetch(() =>
      Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 86400, token_type: "bearer" }),
    );
    const res = await route(req("/api/oura/callback?code=c&state=good", { auth: false }), env);
    expect(res.headers.get("location")).toContain("oura=connected");
    const body = new URLSearchParams(String(calls(fetchFn)[0]![1]?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("https://hub.example.workers.dev/api/oura/callback");
    expect((await env.KV.get("oura:tokens", "json")) as OuraTokens).toMatchObject({ access_token: "a1", refresh_token: "r1" });
    expect(await env.KV.get("oura:state:good")).toBeNull();
  });

  it("refreshes an expired token and stores the new single-use refresh token", async () => {
    const env = makeEnv();
    const old: OuraTokens = { access_token: "a0", refresh_token: "r0", expires_at: Date.now() - 1, obtained_at: 0 };
    await env.KV.put("oura:tokens", JSON.stringify(old));
    const fetchFn = mockFetch((url) =>
      url.includes("/oauth/token")
        ? Response.json({ access_token: "a1", refresh_token: "r1", expires_in: 86400 })
        : Response.json({ data: [] }),
    );
    const res = await route(req("/api/oura/data/daily_sleep?start_date=2026-10-01&end_date=2026-10-02"), env);
    expect(res.status).toBe(200);
    const refreshBody = new URLSearchParams(String(calls(fetchFn)[0]![1]?.body));
    expect(refreshBody.get("grant_type")).toBe("refresh_token");
    expect(refreshBody.get("refresh_token")).toBe("r0");
    const [dataUrl, dataInit] = calls(fetchFn)[1]!;
    expect(dataUrl).toBe("https://oura-api.test/v2/usercollection/daily_sleep?start_date=2026-10-01&end_date=2026-10-02");
    expect(new Headers(dataInit?.headers).get("authorization")).toBe("Bearer a1");
    expect((await env.KV.get("oura:tokens", "json")) as OuraTokens).toMatchObject({ refresh_token: "r1" });
  });

  it("flags reconnect when refresh fails", async () => {
    const env = makeEnv();
    await env.KV.put("oura:tokens", JSON.stringify({ access_token: "a0", refresh_token: "r0", expires_at: 0, obtained_at: 0 }));
    mockFetch(() => new Response("bad", { status: 400 }));
    const res = await route(req("/api/oura/data/sleep"), env);
    expect(res.status).toBe(409);
    expect(((await env.KV.get("oura:status", "json")) as { reconnect_required: boolean }).reconnect_required).toBe(true);
  });

  it("rejects unknown collections and bad dates", async () => {
    const env = makeEnv();
    await env.KV.put("oura:tokens", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: Date.now() + 1e7, obtained_at: 0 }));
    expect((await route(req("/api/oura/data/personal_info"), env)).status).toBe(403);
    expect((await route(req("/api/oura/data/sleep?start_date=yesterday"), env)).status).toBe(400);
  });
});

describe("open food facts proxy", () => {
  it("sets the User-Agent, caches hits in KV for 30 days, and serves the second read from cache", async () => {
    const env = makeEnv();
    const fetchFn = mockFetch(() => new Response('{"status":1}', { status: 200 }));
    const first = await route(req("/api/off/product/9300633603454"), env);
    expect(first.headers.get("x-hub-cache")).toBe("miss");
    expect(new Headers(calls(fetchFn)[0]![1]?.headers).get("user-agent")).toBe("Hub/0.0.1 (github.com/example)");
    expect(env.KV.store.get("off:p:9300633603454")?.ttl).toBe(30 * 24 * 3600);
    const second = await route(req("/api/off/product/9300633603454"), env);
    expect(second.headers.get("x-hub-cache")).toBe("hit");
    expect(await second.text()).toBe('{"status":1}');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not cache upstream errors", async () => {
    const env = makeEnv();
    mockFetch(() => new Response("busy", { status: 503 }));
    await route(req("/api/off/product/12345678"), env);
    expect(env.KV.store.size).toBe(0);
  });

  it("rejects malformed barcodes", async () => {
    expect((await route(req("/api/off/product/abc"), makeEnv())).status).toBe(400);
  });
});

describe("web push", () => {
  it("signs a verifiable ES256 VAPID JWT", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const jwt = await vapidJwt(jwk, "https://web.push.apple.com", "https://example.test", 0);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    const claims = JSON.parse(atob(c.replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims).toEqual({ aud: "https://web.push.apple.com", exp: 12 * 3600, sub: "https://example.test" });
    const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe("vapid keys", () => {
  it("are generated once and reused", async () => {
    const env = makeEnv();
    const a = (await (await route(req("/api/push/key"), env)).json()) as { publicKey: string };
    const b = (await (await route(req("/api/push/key"), env)).json()) as { publicKey: string };
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(b.publicKey).toBe(a.publicKey);
    expect(await route(req("/api/push/test", { method: "POST" }), env).then((r) => r.status)).toBe(409);
  });
});

describe("upstream failures", () => {
  it("returns 502 when an upstream host is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const res = await (await import("./index")).default.fetch(req("/api/off/product/12345678") as never, makeEnv());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("upstream unreachable: off.test");
  });
});
