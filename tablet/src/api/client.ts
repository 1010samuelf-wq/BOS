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

// This device's networking layer corrupts URLs when several fetch() calls are
// in flight at once (screens that fire multiple useQuery calls on mount saw
// requests arrive at the server with a mangled, doubled-up URL; screens firing
// one request at a time never did). Root cause is below the app layer, so the
// robust fix is to never have two requests in flight simultaneously: every
// call is chained onto a single running queue, one at a time.
let queue: Promise<unknown> = Promise.resolve();

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const params = Object.entries(options.query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const fullUrl = `${V1}${path}${params ? `?${params}` : ""}`;

  const run = async (): Promise<T> => {
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
  };

  // Chain onto the queue regardless of whether the previous call succeeded or
  // failed (swallow its rejection here so one failed request doesn't wedge the
  // queue for everyone after it), then run this call and propagate its own result.
  const result = queue.catch(() => undefined).then(run);
  queue = result.catch(() => undefined);
  return result;
}

export function wsUrl(token: string): string {
  return `${V1.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`;
}
