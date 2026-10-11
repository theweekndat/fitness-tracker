import { error, passThrough, upstreamFetch, type Env } from "./env";

// Read-only allowlist (brief §3). Anything else is rejected before any upstream call.
const ALLOWED: RegExp[] = [
  /^workouts$/,
  /^workouts\/count$/,
  /^workouts\/events$/,
  /^workouts\/[A-Za-z0-9-]{1,64}$/,
  /^exercise_templates$/,
  /^exercise_templates\/[A-Za-z0-9-]{1,64}$/,
  /^routines$/,
  /^routine_folders$/,
];

const ALLOWED_PARAMS = new Set(["page", "pageSize", "since"]);

export function isAllowedHevyPath(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}

export async function handleHevy(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== "GET") return error(405, "method_not_allowed", "Hevy proxy is read-only");
  if (!isAllowedHevyPath(path)) return error(403, "path_not_allowed", "Path is not on the Hevy allowlist");
  if (!env.HEVY_API_KEY) return error(503, "hevy_not_configured", "HEVY_API_KEY secret is not set");

  const incoming = new URL(request.url);
  const upstream = new URL(`${env.HEVY_BASE}/${path}`);
  for (const [k, v] of incoming.searchParams) {
    if (ALLOWED_PARAMS.has(k)) upstream.searchParams.set(k, v);
  }

  const res = await upstreamFetch(upstream.toString(), {
    headers: { "api-key": env.HEVY_API_KEY, accept: "application/json" },
  });
  return passThrough(res);
}
