import { APP_VERSION, error, upstreamFetch, type Env } from "./env";

// Cache API is a no-op on *.workers.dev, so the 30-day product cache lives in KV instead.
const PRODUCT_TTL_S = 30 * 24 * 3600;
const NOT_FOUND_TTL_S = 24 * 3600;
const SEARCH_TTL_S = 24 * 3600;

const PRODUCT_FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "brands",
  "quantity",
  "serving_size",
  "serving_quantity",
  "nutriments",
  "nutrition_data_per",
  "countries_tags",
  "image_front_small_url",
].join(",");

const BARCODE_RE = /^\d{8,14}$/;

interface CacheMeta {
  status: number;
  fetched_at: number;
}

function userAgent(env: Env): string {
  return `Hub/${APP_VERSION} (${env.OFF_CONTACT})`;
}

function jsonText(body: string, status: number, cache: "hit" | "miss", fetchedAt: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-hub-cache": cache,
      "x-hub-fetched-at": String(fetchedAt),
    },
  });
}

/** Fetch through a KV cache. Bodies are stored as text, never parsed. */
async function cachedFetch(env: Env, key: string, url: string, okTtl: number): Promise<Response> {
  const cached = await env.KV.getWithMetadata<CacheMeta>(key, "text");
  if (cached.value !== null && cached.metadata) {
    return jsonText(cached.value, cached.metadata.status, "hit", cached.metadata.fetched_at);
  }

  const res = await upstreamFetch(url, { headers: { "user-agent": userAgent(env), accept: "application/json" } });
  const body = await res.text();
  const fetchedAt = Date.now();
  // Cache successes for the full TTL and not-founds briefly; never cache 5xx or rate limits.
  const ttl = res.ok ? okTtl : res.status === 404 ? NOT_FOUND_TTL_S : 0;
  if (ttl > 0) {
    const metadata: CacheMeta = { status: res.status, fetched_at: fetchedAt };
    await env.KV.put(key, body, { expirationTtl: ttl, metadata });
  }
  return jsonText(body, res.status, "miss", fetchedAt);
}

export async function handleOffProduct(request: Request, env: Env, barcode: string): Promise<Response> {
  if (request.method !== "GET") return error(405, "method_not_allowed", "Use GET");
  if (!BARCODE_RE.test(barcode)) return error(400, "bad_barcode", "Barcode must be 8 to 14 digits");
  const url = `${env.OFF_BASE}/api/v2/product/${barcode}.json?fields=${PRODUCT_FIELDS}`;
  return cachedFetch(env, `off:p:${barcode}`, url, PRODUCT_TTL_S);
}

export async function handleOffSearch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return error(405, "method_not_allowed", "Use GET");
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2 || q.length > 100) return error(400, "bad_query", "q must be 2 to 100 characters");
  const url = new URL(`${env.OFF_BASE}/cgi/search.pl`);
  url.searchParams.set("search_terms", q);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "20");
  url.searchParams.set("fields", PRODUCT_FIELDS);
  return cachedFetch(env, `off:s:${q}`, url.toString(), SEARCH_TTL_S);
}
