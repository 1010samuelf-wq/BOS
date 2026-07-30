// Talks only to the public, unauthenticated endpoints — no token, no cookies.
// Mirrors the shape of web/tablet's client but deliberately has no auth.

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const V1 = `${API_URL}/api/v1`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${V1}${path}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
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
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export interface PublicProduct {
  id: number;
  name: string;
  price: string;
  category: string | null;
  photo_url: string | null;
}

export const listProducts = () => request<PublicProduct[]>("/public/products");

export const listCategories = () => request<string[]>("/public/categories");

export interface PublicContact {
  business_name: string | null;
  business_phone: string | null;
}

export const getContact = () => request<PublicContact>("/public/contact");

export interface InquiryItemIn {
  product_id: number;
  quantity: number;
}

export const submitInquiry = (body: {
  customer_name: string;
  customer_phone: string;
  note?: string;
  items: InquiryItemIn[];
}) => request<{ id: number }>("/public/inquiries", { method: "POST", body });
