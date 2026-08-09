// Typed API calls used by the screens. One function per endpoint keeps the
// screens free of paths/param wrangling.

import { api, uploadFile } from "./client";
import type {
  BusinessProfile,
  Company,
  CompanyDetail,
  CompanyType,
  Deliveries,
  Employee,
  ExpenseOut,
  HoursReport,
  Ingredient,
  LedgerEntryType,
  Notification,
  Order,
  OrderCreatePayload,
  OrderUpdatePayload,
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

// ---- catalog (Admin) ----
export const searchProducts = (q: string) =>
  api<Product[]>("/products/search", { query: { q, limit: 8 } });

export const listProducts = (activeOnly = true) =>
  api<Product[]>("/products", { query: activeOnly ? { active: true } : {} });
// Active products in one category — backs the order screen's category buttons.
export const listProductsByCategory = (category: string) =>
  api<Product[]>("/products", { query: { category, active: true } });
// Presets plus any category staff have added; also readable by cashiers.
export const listCategories = () => api<string[]>("/products/categories");
export const createProduct = (body: { name: string; price: string; category?: string | null }) =>
  api<Product>("/products", { method: "POST", body });
export const updateProduct = (id: number, body: Partial<Product>) =>
  api<Product>(`/products/${id}`, { method: "PUT", body });
export const uploadProductPhoto = (id: number, asset: { uri: string; name: string; type: string }) =>
  uploadFile<Product>(`/products/${id}/photo`, asset);

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
  payment_method?: string;
  product_name?: string;
  from?: string;
  to?: string;
  date_field?: string;
  exclude_cancelled?: boolean;
}) => api<Page<Order>>("/orders", { query: params });

export const getOrder = (id: number) => api<Order>(`/orders/${id}`);

export const updateOrder = (id: number, patch: OrderUpdatePayload) =>
  api<Order>(`/orders/${id}`, { method: "PUT", body: patch });

export const lockOrder = (id: number) =>
  api<Order>(`/orders/${id}/lock`, { method: "POST" });
export const releaseLock = (id: number) =>
  api<Order>(`/orders/${id}/release-lock`, { method: "POST" });

export const cancelOrder = (id: number, reverse_stock: boolean) =>
  api<Order>(`/orders/${id}/cancel`, { method: "POST", body: { reverse_stock } });

export const deleteOrder = (id: number) => api<void>(`/orders/${id}`, { method: "DELETE" });

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
export const listTimeEntries = (params: { employee_id?: number; from?: string; to?: string }) =>
  api<TimeEntry[]>("/time/entries", { query: params });
export const createTimeEntry = (body: { user_id: number; clock_in: string; clock_out?: string | null }) =>
  api<TimeEntry>("/time/entries", { method: "POST", body });
export const updateTimeEntry = (id: number, body: { clock_in?: string; clock_out?: string | null }) =>
  api<TimeEntry>(`/time/entries/${id}`, { method: "PUT", body });
export const deleteTimeEntry = (id: number) => api<void>(`/time/entries/${id}`, { method: "DELETE" });
export const markTimePaid = (ids: number[], paid: boolean) =>
  api<{ updated: number; paid: boolean }>("/time/entries/mark-paid", { method: "POST", body: { ids, paid } });

// ---- deliveries ----
export const getDeliveries = (params: { from?: string; to?: string }) =>
  api<Deliveries>("/deliveries", { query: params });

// ---- reports ----
export const getDailyReport = (day?: string) =>
  api<SalesReport>("/reports/daily", { query: { day } });
export const getMonthlyReport = (year?: number, month?: number) =>
  api<SalesReport>("/reports/monthly", { query: { year, month } });
export const getSummary = (from: string, to: string) =>
  api<SalesReport>("/reports/summary", { query: { from, to } });
export const getProduction = (params: { from?: string; to?: string; fulfillment?: string }) =>
  api<ProductionReport>("/reports/production", { query: params });
export const getStaffHours = (week?: string) =>
  api<HoursReport>("/reports/hours", { query: { week } });

// ---- expenses ----
export const createExpense = (body: { description: string; amount: string; category?: string; spent_on?: string }) =>
  api<ExpenseOut>("/expenses", { method: "POST", body });

// ---- tasks ----
export const listTasks = (params: { employee_id?: number; date?: string; done?: boolean }) =>
  api<Task[]>("/tasks", { query: params });
export const createTask = (body: { title: string; description?: string; assigned_to: number; due_date?: string | null }) =>
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
export const deleteEmployee = (id: number) =>
  api<Employee>(`/employees/${id}`, { method: "DELETE", query: { hard: true } });
export const updateEmployee = (
  id: number,
  body: { name?: string; role?: string; active?: boolean; hourly_rate?: string },
) => api<Employee>(`/employees/${id}`, { method: "PUT", body });

// ---- bookkeeping (accounts payable/receivable) ----
export const listCompanies = (includeInactive = false) =>
  api<Company[]>("/bookkeeping/companies", { query: { include_inactive: includeInactive } });
export const getCompany = (id: number) => api<CompanyDetail>(`/bookkeeping/companies/${id}`);
export const createCompany = (body: { name: string; type: CompanyType }) =>
  api<Company>("/bookkeeping/companies", { method: "POST", body });
export const updateCompany = (id: number, body: Partial<{ name: string; type: CompanyType; active: boolean }>) =>
  api<Company>(`/bookkeeping/companies/${id}`, { method: "PUT", body });
export const addLedgerEntry = (
  companyId: number,
  body: { entry_date: string; type: LedgerEntryType; amount: string; note?: string | null },
) => api<CompanyDetail>(`/bookkeeping/companies/${companyId}/entries`, { method: "POST", body });
export const deleteLedgerEntry = (companyId: number, entryId: number) =>
  api<CompanyDetail>(`/bookkeeping/companies/${companyId}/entries/${entryId}`, { method: "DELETE" });

// ---- notifications ----
export const listNotifications = (params: { unread_only?: boolean; limit?: number }) =>
  api<Page<Notification>>("/notifications", { query: params });
export const markNotificationRead = (id: number) =>
  api<Notification>(`/notifications/${id}/read`, { method: "POST" });
export const markAllNotificationsRead = () =>
  api<{ unread: number }>("/notifications/read-all", { method: "POST" });
export const unreadCount = () =>
  api<{ unread: number }>("/notifications/unread-count");
