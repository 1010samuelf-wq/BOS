// fetch wrapper: base URL from Vite env, bearer token injection, and the
// backend's uniform { error: { code, message } } surfaced as ApiRequestError.

// Empty in production: the dashboard's own nginx proxies /api to the backend, so
// the whole app is one origin (locked-down devices only need the dashboard domain
// allowlisted). Falls back to the local dev backend when unset.
export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const V1 = `${API_URL}/api/v1`;

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

// The shift token expires (12h) — when a request comes back 401, the token is
// dead and never becoming valid again, so drop straight back to login instead
// of leaving the app stuck showing a stale error. AuthProvider registers the
// actual logout() here (this module has no React/router access of its own).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}
function checkUnauthorized(status: number) {
  if (status === 401) onUnauthorized?.();
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<T> {
  const url = new URL(`${V1}${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    checkUnauthorized(res.status);
    let code = "http_error";
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) {
        code = data.error.code;
        message = data.error.message;
      }
    } catch {
      /* non-JSON error */
    }
    throw new ApiRequestError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function wsUrl(token: string): string {
  // API_URL is empty in production (same-origin) → build from the page origin.
  const origin = API_URL || window.location.origin;
  return `${origin.replace(/^http/, "ws")}/api/v1/ws?token=${encodeURIComponent(token)}`;
}

// Authenticated file download: the export endpoints require a bearer token, so a
// bare <a href> would 401. Fetch with the header, then trigger a browser save.
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await fetch(`${V1}${path}`, {
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
  });
  if (!res.ok) {
    checkUnauthorized(res.status);
    throw new ApiRequestError(res.status, "export_failed", "Export failed.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Multipart file upload (e.g. a product photo picked from disk). Body must be
// FormData with no explicit Content-Type — the browser sets the multipart
// boundary itself.
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${V1}${path}`, {
    method: "POST",
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: form,
  });
  if (!res.ok) {
    checkUnauthorized(res.status);
    let code = "http_error";
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) {
        code = data.error.code;
        message = data.error.message;
      }
    } catch {
      /* non-JSON error */
    }
    throw new ApiRequestError(res.status, code, message);
  }
  return (await res.json()) as T;
}

// Open an authenticated PDF in a new tab (for viewing + browser print).
export async function openPdf(path: string): Promise<void> {
  const res = await fetch(`${V1}${path}`, {
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
  });
  if (!res.ok) {
    checkUnauthorized(res.status);
    throw new ApiRequestError(res.status, "pdf_failed", "Could not open PDF.");
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
