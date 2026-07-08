// Typed API calls used by the screens. One function per endpoint keeps the
// screens free of paths/param wrangling.

import { api } from "./client";
import type {
  Deliveries,
  Employee,
  HoursReport,
  Notification,
  Order,
  OrderCreatePayload,
  Page,
  Product,
  ProductionReport,
  RosterEntry,
  SalesReport,
  StockLevel,
  Task,
  TokenOut,
  WeeklyHours,
} from "./types";

// ---- auth ----
export const fetchRoster = () => api<RosterEntry[]>("/auth/roster");

export const login = (user_id: number, pin: string) =>
  api<TokenOut>("/auth/login", { method: "POST", body: { user_id, pin } });

export const setPin = (user_id: number, pin: string) =>
  api<void>("/auth/set-pin", { method: "POST", body: { user_id, pin } });

// ---- products ----
export const searchProducts = (q: string) =>
  api<Product[]>("/products/search", { query: { q, limit: 8 } });

// ---- orders ----
export const createOrder = (payload: OrderCreatePayload) =>
  api<Order>("/orders", { method: "POST", body: payload });

export const listOrders = (params: {
  limit?: number;
  offset?: number;
  status?: string;
  paid_status?: string;
  fulfillment_type?: string;
  fulfillment_status?: string;
  product_name?: string;
}) => api<Page<Order>>("/orders", { query: params });

export const getOrder = (id: number) => api<Order>(`/orders/${id}`);

export const updateOrder = (
  id: number,
  patch: Partial<{ status: string; client_name: string; client_phone: string }>,
) => api<Order>(`/orders/${id}`, { method: "PUT", body: patch });

export const lockOrder = (id: number) =>
  api<Order>(`/orders/${id}/lock`, { method: "POST" });
export const releaseLock = (id: number) =>
  api<Order>(`/orders/${id}/release-lock`, { method: "POST" });

export const cancelOrder = (id: number, reverse_stock: boolean) =>
  api<Order>(`/orders/${id}/cancel`, { method: "POST", body: { reverse_stock } });

export const markPaid = (id: number, payment_method?: string) =>
  api<Order>(`/orders/${id}/mark-paid`, {
    method: "POST",
    body: payment_method ? { payment_method } : {},
  });

export const fulfillOrder = (id: number) =>
  api<Order>(`/orders/${id}/fulfill`, { method: "POST" });

export const addNote = (id: number, text: string, type: "general" | "payment" = "general") =>
  api<Order>(`/orders/${id}/notes`, { method: "POST", body: { text, type } });

export const toggleNoteDone = (id: number, noteId: number) =>
  api<Order>(`/orders/${id}/notes/${noteId}/done`, { method: "POST" });

// ---- stock ----
export const getStock = (params: { item_type?: string; low_only?: boolean; q?: string }) =>
  api<StockLevel[]>("/stock", { query: params });

export const adjustStock = (body: {
  item_type: string;
  item_id: number;
  delta: string;
  reason: string;
}) => api<unknown>("/stock/adjust", { method: "POST", body });

// ---- time ----
export const clockIn = () => api<unknown>("/time/clock-in", { method: "POST" });
export const clockOut = () => api<unknown>("/time/clock-out", { method: "POST" });
export const getHours = (params: { employee_id?: number; week?: string }) =>
  api<WeeklyHours>("/time/hours", { query: params });

// ---- deliveries ----
export const getDeliveries = (params: { from?: string; to?: string }) =>
  api<Deliveries>("/deliveries", { query: params });

// ---- reports ----
export const getDailyReport = (day?: string) =>
  api<SalesReport>("/reports/daily", { query: { day } });
export const getMonthlyReport = (year?: number, month?: number) =>
  api<SalesReport>("/reports/monthly", { query: { year, month } });
export const getProduction = (params: { from?: string; to?: string; fulfillment?: string }) =>
  api<ProductionReport>("/reports/production", { query: params });
export const getStaffHours = (week?: string) =>
  api<HoursReport>("/reports/hours", { query: { week } });

// ---- tasks ----
export const listTasks = (params: { employee_id?: number; date?: string; done?: boolean }) =>
  api<Task[]>("/tasks", { query: params });
export const createTask = (body: { description: string; assigned_to: number; due_date?: string | null }) =>
  api<Task>("/tasks", { method: "POST", body });
export const toggleTaskDone = (id: number) =>
  api<Task>(`/tasks/${id}/done`, { method: "POST" });

// ---- employees ----
export const listEmployees = (include_inactive = false) =>
  api<Employee[]>("/employees", { query: { include_inactive } });
export const createEmployee = (body: { name: string; role: string }) =>
  api<Employee>("/employees", { method: "POST", body });
export const resetPin = (id: number) =>
  api<Employee>(`/employees/${id}/reset-pin`, { method: "POST" });
export const deactivateEmployee = (id: number) =>
  api<Employee>(`/employees/${id}`, { method: "DELETE" });

// ---- notifications ----
export const listNotifications = (params: { unread_only?: boolean; limit?: number }) =>
  api<Page<Notification>>("/notifications", { query: params });
export const markNotificationRead = (id: number) =>
  api<Notification>(`/notifications/${id}/read`, { method: "POST" });
export const markAllNotificationsRead = () =>
  api<{ unread: number }>("/notifications/read-all", { method: "POST" });
export const unreadCount = () =>
  api<{ unread: number }>("/notifications/unread-count");
