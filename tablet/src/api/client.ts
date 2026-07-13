// Thin fetch wrapper: base URL from app config, bearer token injection, and the
// backend's uniform error shape ({error: {code, message}}) surfaced as ApiError.

import Constants from "expo-constants";

export const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://10.0.2.2:8000";

const V1 = `${API_URL}/api/v1`;

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}
export function getAuthToken(): string | null {
  return authToken;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  // Build the URL by plain string concatenation, not `new URL()` — under
  // concurrent calls (several queries firing on mount) the URL/URLSearchParams
  // polyfill on this device produced corrupted, doubled-up URLs (e.g. the path
  // segment ending up containing a second copy of the full absolute URL). This
  // sidesteps that class of bug entirely.
  const params = Object.entries(options.query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const fullUrl = `${V1}${path}${params ? `?${params}` : ""}`;

  const res = await fetch(fullUrl, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let code = "http_error";
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) {
        code = data.error.code;
        message = data.error.message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function wsUrl(token: string): string {
  return `${V1.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
}
