import { error, json, upstreamFetch, type Env } from "./env";

// Phase 0 push test: one stored subscription, an empty-payload push signed with VAPID (RFC 8292).
// No payload means no RFC 8291 encryption; the service worker shows a fixed test notification.
const SUB_KEY = "push:subscription";
const VAPID_KEY = "push:vapid";

interface VapidKeys {
  publicKey: string;
  privateJwk: JsonWebKey;
}

interface StoredSubscription {
  endpoint: string;
  saved_at: number;
}

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function vapidJwt(privateJwk: JsonWebKey, audience: string, subject: string, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })),
  );
  const input = `${header}.${claims}`;
  // WebCrypto returns the raw r||s signature, which is the JWS ES256 format.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input));
  return `${input}.${b64url(sig)}`;
}

/** VAPID keys are generated once by the Worker and kept in KV, so there is no key to paste anywhere. */
export async function getVapidKeys(env: Env): Promise<VapidKeys> {
  const existing = await env.KV.get<VapidKeys>(VAPID_KEY, "json");
  if (existing) return existing;
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  const keys: VapidKeys = {
    publicKey: b64url(raw),
    privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
  };
  await env.KV.put(VAPID_KEY, JSON.stringify(keys));
  return keys;
}

export async function handlePushKey(env: Env): Promise<Response> {
  return json({ publicKey: (await getVapidKeys(env)).publicKey });
}

export async function handlePushSubscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed", "Use POST");
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    return error(400, "bad_subscription", "Body must be a PushSubscription with an https endpoint");
  }
  const stored: StoredSubscription = { endpoint, saved_at: Date.now() };
  await env.KV.put(SUB_KEY, JSON.stringify(stored));
  return json({ ok: true, push_host: new URL(endpoint).host });
}

export async function handlePushTest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed", "Use POST");
  const sub = await env.KV.get<StoredSubscription>(SUB_KEY, "json");
  if (!sub) return error(409, "no_subscription", "Subscribe on the device first");

  const keys = await getVapidKeys(env);
  const endpoint = new URL(sub.endpoint);
  const jwt = await vapidJwt(keys.privateJwk, endpoint.origin, env.VAPID_SUBJECT);
  const res = await upstreamFetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
      ttl: "300",
      urgency: "high",
      "content-length": "0",
    },
  });
  const detail = res.ok ? "" : (await res.text()).slice(0, 300);
  if (res.status === 404 || res.status === 410) await env.KV.delete(SUB_KEY);
  return json({ ok: res.ok, upstream_status: res.status, push_host: endpoint.host, detail });
}

export async function pushStatus(env: Env) {
  const sub = await env.KV.get<StoredSubscription>(SUB_KEY, "json");
  return {
    keys_created: Boolean(await env.KV.get(VAPID_KEY)),
    subscribed: Boolean(sub),
    push_host: sub ? new URL(sub.endpoint).host : null,
  };
}
