type WindowState = { startedAt: number; hits: number };

const windows = new Map<string, WindowState>();

export type McpRateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
};

export function checkMcpRateLimit(
  bucket: string,
  limit: number,
  windowMs: number,
): McpRateLimitResult {
  const now = Date.now();
  let state = windows.get(bucket);
  if (!state || now - state.startedAt >= windowMs) {
    state = { startedAt: now, hits: 0 };
    windows.set(bucket, state);
  }
  const retryAfter = Math.max(
    1,
    Math.ceil((state.startedAt + windowMs - now) / 1000),
  );
  if (state.hits >= limit) {
    return { ok: false, limit, remaining: 0, retryAfter };
  }
  state.hits += 1;
  return {
    ok: true,
    limit,
    remaining: Math.max(0, limit - state.hits),
    retryAfter,
  };
}

export function rateLimitHeaders(
  result: McpRateLimitResult,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    ...(result.ok ? {} : { "Retry-After": String(result.retryAfter) }),
  };
}

/** Réservé aux tests ciblés. */
export function resetMcpRateLimits(): void {
  windows.clear();
}
