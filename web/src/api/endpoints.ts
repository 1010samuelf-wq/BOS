// Typed API calls the web client uses. The web is now a full client at parity
// with the tablet (user decision): order-taking, first-login PIN, clock in/out,
// and order management — plus the oversight screens (reports, production,
// deliveries, stock, employees & hours, tasks, notifications, Admin/Settings).

import { api, downloadCsv, openPdf } from "./client";
import type {
  BusinessProfile,
  Deliveries,
  Employee,
  HoursReport,
  Ingredient,
  Notification,
  Order,
  OrderCreatePayload,
  Page,
  Product,
  ProductionReport,
  Recipe,
  RosterEntry,
  SalesReport,
  StockLevel,
  Task,
  TimeEntry,
  TokenOut,
  WeeklyHours,
} from "./types";

// ---- auth ----
export const fetchRoster = () => api<RosterEntry[]>("/auth/roster");
export const login = (user_id: number, pin: string) =>
  api<TokenOut>("/auth/login", { method: "POST", body: { user_id, pin } });
export const setPin = (user_id: number, pin: string, setup_code: string) =>
  api<void>("/auth/set-pin", { method: "POST", body: { user_id, pin, setup_code } });

// ---- orders: take + manage ----
export const searchProducts = (q: string) =>
  api<Product[]>("/products/search", { query: { q, limit: 8 } });
export const createOrder = (payload: OrderCreatePayload) =>
  api<Order>("/orders", { method: "POST", body: payload });
export const listOrders = (params: {
  limit?: number;
  offset?: number;
  fulfillment_status?: string;
  fulfillment_type?: string;
  status?: string;
  paid_status?: string;
  payment_method?: string;
  product_name?: string;
  from?: string;
  to?: string;
  date_field?: string;
  exclude_cancelled?: boolean;
}) => api<Page<Order>>("/orders", { query: params });
export const getOrder = (id: number) => api<Order>(`/orders/${id}`);
export const updateOrderStatus = (id: number, status: string) =>
  api<Order>(`/orders/${id}`, { method: "PUT", body: { status } });
export const markPaid = (id: number, payment_method?: string) =>
  api<Order>(`/orders/${id}/mark-paid`, { method: "POST", body: payment_method ? { payment_method } : {} });
export const fulfillOrder = (id: number) => api<Order>(`/orders/${id}/fulfill`, { method: "POST" });
export const cancelOrder = (id: number, reverse_stock: boolean) =>
  api<Order>(`/orders/${id}/cancel`, { method: "POST", body: { reverse_stock } });
export const addOrderNote = (id: number, text: string) =>
  api<Order>(`/orders/${id}/notes`, { method: "POST", body: { text, type: "general" } });
export const toggleOrderNote = (id: number, noteId: number) =>
  api<Order>(`/orders/${id}/notes/${noteId}/done`, { method: "POST" });
export const receiptPdf = (id: number) => openPdf(`/orders/${id}/receipt`);

// ---- time: clock in/out + my hours ----
export const clockIn = () => api<unknown>("/time/clock-in", { method: "POST" });
export const clockOut = () => api<unknown>("/time/clock-out", { method: "POST" });
export const myHours = () => api<WeeklyHours>("/time/hours", {});
export const getWeeklyHours = (employee_id: number | undefined, week: string) =>
  api<WeeklyHours>("/time/hours", { query: { employee_id, week } });
export const listTimeEntries = (params: { employee_id?: number; from?: string; to?: string }) =>
  api<TimeEntry[]>("/time/entries", { query: params });
export const createTimeEntry = (body: { user_id: number; clock_in: string; clock_out?: string | null }) =>
  api<TimeEntry>("/time/entries", { method: "POST", body });
export const updateTimeEntry = (id: number, body: { clock_in?: string; clock_out?: string | null }) =>
  api<TimeEntry>(`/time/entries/${id}`, { method: "PUT", body });
export const deleteTimeEntry = (id: number) =>
  api<void>(`/time/entries/${id}`, { method: "DELETE" });

// ---- reports ----
export const getDailyReport = (day?: string) => api<SalesReport>("/reports/daily", { query: { day } });
export const getMonthlyReport = (year?: number, month?: number) =>
  api<SalesReport>("/reports/monthly", { query: { year, month } });
export const getSummary = (from: string, to: string) =>
  api<SalesReport>("/reports/summary", { query: { from, to } });
export const getProduction = (params: { from?: string; to?: string; fulfillment?: string }) =>
  api<ProductionReport>("/reports/production", { query: params });
export const getStaffHours = (week?: string) => api<HoursReport>("/reports/hours", { query: { week } });
export const exportSummaryCsv = (from: string, to: string) =>
  downloadCsv(`/reports/summary/export?from=${from}&to=${to}`, `sales_${from}_${to}.csv`);
export const openSummaryPdf = (from: string, to: string) =>
  openPdf(`/reports/summary/pdf?from=${from}&to=${to}`);

// ---- deliveries ----
export const getDeliveries = (params: { from?: string; to?: string }) =>
  api<Deliveries>("/deliveries", { query: params });
export const exportDeliveriesCsv = (from: string, to: string) =>
  downloadCsv(`/deliveries/export?from=${from}&to=${to}`, `deliveries_${from}_${to}.csv`);
export const exportProductionCsv = (from: string, to: string) =>
  downloadCsv(`/reports/production/export?from=${from}&to=${to}`, `production_${from}_${to}.csv`);

// ---- stock ----
export const getStock = (params: { item_type?: string; low_only?: boolean; q?: string }) =>
  api<StockLevel[]>("/stock", { query: params });
export const adjustStock = (body: { item_type: string; item_id: number; delta: string; reason: string }) =>
  api<unknown>("/stock/adjust", { method: "POST", body });

// ---- expenses ----
export const createExpense = (body: { description: string; amount: string; category?: string; spent_on?: string }) =>
  api<unknown>("/expenses", { method: "POST", body });
export const updateExpense = (id: number, body: { description?: string; amount?: string }) =>
  api<unknown>(`/expenses/${id}`, { method: "PUT", body });

// ---- catalog (Admin) ----
export const listProducts = () => api<Product[]>("/products");
export const createProduct = (body: { name: string; price: string; category?: string | null; photo_url?: string | null }) =>
  api<Product>("/products", { method: "POST", body });
export const updateProduct = (id: number, body: Partial<Product>) =>
  api<Product>(`/products/${id}`, { method: "PUT", body });
export const listIngredients = (active?: boolean) =>
  api<Ingredient[]>("/ingredients", { query: active === undefined ? {} : { active } });
export const createIngredient = (body: {
  name: string;
  unit: string;
  cost_per_unit: string;
  low_stock_threshold: string;
}) => api<Ingredient>("/ingredients", { method: "POST", body });
export const updateIngredient = (id: number, body: Partial<Ingredient>) =>
  api<Ingredient>(`/ingredients/${id}`, { method: "PUT", body });
export const getRecipe = (productId: number) => api<Recipe>(`/recipes/${productId}`);
export const upsertRecipe = (body: { product_id: number; yield_qty: number; items: { ingredient_id: number; quantity: string }[] }) =>
  api<Recipe>("/recipes", { method: "POST", body });

// ---- settings (Admin) ----
export const getBusinessProfile = () => api<BusinessProfile>("/settings/business-profile");
export const updateBusinessProfile = (body: BusinessProfile) =>
  api<BusinessProfile>("/settings/business-profile", { method: "PUT", body });

// ---- employees (Admin) ----
export const listEmployees = (include_inactive = false) =>
  api<Employee[]>("/employees", { query: { include_inactive } });
export const createEmployee = (body: { name: string; role: string }) =>
  api<Employee>("/employees", { method: "POST", body });
export const resetPin = (id: number) => api<Employee>(`/employees/${id}/reset-pin`, { method: "POST" });
export const deactivateEmployee = (id: number) => api<Employee>(`/employees/${id}`, { method: "DELETE" });
export const deleteEmployee = (id: number) =>
  api<Employee>(`/employees/${id}`, { method: "DELETE", query: { hard: true } });
export const grantableSections = () => api<string[]>("/employees/sections");
export const updateEmployee = (
  id: number,
  body: { name?: string; role?: string; active?: boolean; permissions?: string[] | null },
) => api<Employee>(`/employees/${id}`, { method: "PUT", body });

// ---- tasks ----
export const listTasks = (params: { employee_id?: number; done?: boolean; date?: string }) =>
  api<Task[]>("/tasks", { query: params });
export const createTask = (body: { description: string; assigned_to: number; due_date?: string | null }) =>
  api<Task>("/tasks", { method: "POST", body });
export const toggleTaskDone = (id: number) => api<Task>(`/tasks/${id}/done`, { method: "POST" });

// ---- notifications ----
export const listNotifications = (params: { unread_only?: boolean; limit?: number }) =>
  api<Page<Notification>>("/notifications", { query: params });
export const markNotificationRead = (id: number) =>
  api<Notification>(`/notifications/${id}/read`, { method: "POST" });
export const markAllNotificationsRead = () => api<{ unread: number }>("/notifications/read-all", { method: "POST" });
export const unreadCount = () => api<{ unread: number }>("/notifications/unread-count");
