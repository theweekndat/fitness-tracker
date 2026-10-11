import type { Env } from "./env";

/** Minimal in-memory KV with the subset of the API the Worker uses. */
export class FakeKV {
  store = new Map<string, { value: string; metadata?: unknown; ttl?: number }>();
  puts: { key: string; ttl?: number }[] = [];

  async get(key: string, type?: "text" | "json"): Promise<unknown> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return type === "json" ? JSON.parse(entry.value) : entry.value;
  }
  async getWithMetadata(key: string, type?: "text" | "json") {
    const entry = this.store.get(key);
    return { value: entry ? await this.get(key, type) : null, metadata: entry?.metadata ?? null };
  }
  async put(key: string, value: string, opts: { expirationTtl?: number; metadata?: unknown } = {}) {
    this.store.set(key, { value, metadata: opts.metadata, ttl: opts.expirationTtl });
    this.puts.push({ key, ttl: opts.expirationTtl });
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

export const TOKEN = "t".repeat(48);

export function makeEnv(overrides: Partial<Env> = {}): Env & { KV: FakeKV } {
  const env = {
    ASSETS: { fetch: async () => new Response("asset") },
    KV: new FakeKV(),
    APP_TOKEN: TOKEN,
    HEVY_API_KEY: "hevy-key",
    OURA_CLIENT_ID: "cid",
    OURA_CLIENT_SECRET: "csecret",
    OFF_CONTACT: "github.com/example",
    OFF_BASE: "https://off.test",
    HEVY_BASE: "https://hevy.test/v1",
    OURA_AUTHORIZE_URL: "https://oura-auth.test/oauth/authorize",
    OURA_TOKEN_URL: "https://oura-api.test/oauth/token",
    OURA_API_BASE: "https://oura-api.test/v2/usercollection",
    OURA_SCOPES: "personal daily",
    VAPID_SUBJECT: "https://example.test",
    ...overrides,
  };
  return env as unknown as Env & { KV: FakeKV };
}

export function req(path: string, init: RequestInit & { auth?: boolean } = {}): Request {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth) headers.set("authorization", `Bearer ${TOKEN}`);
  return new Request(`https://hub.example.workers.dev${path}`, { ...rest, headers });
}
