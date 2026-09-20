type ErrorBody = {
  error?: unknown;
  message?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function responseErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = body as ErrorBody;
    const direct = text(value.error) ?? text(value.message);
    if (direct) return direct;
    if (value.error && typeof value.error === "object" && !Array.isArray(value.error)) {
      const nested = value.error as { message?: unknown; code?: unknown };
      const message = text(nested.message) ?? text(nested.code);
      if (message) return message;
    }
  }
  return fallback;
}

export async function readResponseError(res: Response): Promise<string> {
  const fallback = res.statusText || `Erreur HTTP ${res.status}`;
  try {
    return responseErrorMessage(await res.json(), fallback);
  } catch {
    return fallback;
  }
}
