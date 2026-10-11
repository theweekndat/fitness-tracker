import { isAuthorized } from "./auth";
import { APP_VERSION, error, json, UpstreamError, type Env } from "./env";
import { handleHevy } from "./hevy";
import { handleOffProduct, handleOffSearch } from "./off";
import { handleOuraCallback, handleOuraData, handleOuraDisconnect, handleOuraStart, ouraStatus } from "./oura";
import { handlePushKey, handlePushSubscribe, handlePushTest, pushStatus } from "./push";

async function handleStatus(env: Env): Promise<Response> {
  return json({
    version: APP_VERSION,
    time: new Date().toISOString(),
    hevy: { configured: Boolean(env.HEVY_API_KEY) },
    oura: await ouraStatus(env),
    off: { contact_set: Boolean(env.OFF_CONTACT) },
    push: await pushStatus(env),
  });
}

export async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  const path = pathname.slice("/api/".length);

  // The OAuth redirect from Oura cannot carry our bearer token; it is protected by the KV state check.
  if (path === "oura/callback") return handleOuraCallback(request, env);

  if (!isAuthorized(request, env.APP_TOKEN)) return error(401, "unauthorized", "Missing or invalid bearer token");

  if (path === "status") return handleStatus(env);
  if (path.startsWith("hevy/")) return handleHevy(request, env, path.slice("hevy/".length));
  if (path === "oura/start") return handleOuraStart(request, env);
  if (path === "oura/disconnect") return handleOuraDisconnect(request, env);
  if (path.startsWith("oura/data/")) return handleOuraData(request, env, path.slice("oura/data/".length));
  if (path.startsWith("off/product/")) return handleOffProduct(request, env, path.slice("off/product/".length));
  if (path === "off/search") return handleOffSearch(request, env);
  if (path === "push/key") return handlePushKey(env);
  if (path === "push/subscribe") return handlePushSubscribe(request, env);
  if (path === "push/test") return handlePushTest(request, env);

  return error(404, "not_found", "Unknown API route");
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof UpstreamError) return error(502, "upstream_unreachable", e.message);
      // Never echo details: they could contain tokens or health values.
      return error(500, "internal", "Internal error");
    }
  },
} satisfies ExportedHandler<Env>;
