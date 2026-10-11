const encoder = new TextEncoder();

/** Constant-time comparison for equal-length inputs. Only the length can leak. */
export function timingSafeEqual(expected: string, candidate: string): boolean {
  const a = encoder.encode(expected);
  const b = encoder.encode(candidate);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function isAuthorized(request: Request, appToken: string | undefined): boolean {
  // An unset or short token means the Worker is not configured: refuse everything.
  if (!appToken || appToken.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match?.[1]) return false;
  return timingSafeEqual(appToken, match[1]);
}
