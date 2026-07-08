// Wire shapes from the backend Pydantic schemas — identical to the tablet's.
// Money is a decimal string ("3.50"); don't do float math on it for display we
// only render, and adjustments are entered as strings.

export type Role = "cashier" | "manager" | "admin";
export type FulfillmentType = "pickup" | "delivery";
export type PaymentMethod = "cash" | "card" | "etransfer";
export type PaidStatus = "unpaid" | "paid";
export type OrderStatus = "pending" | "in_progress" | "ready" | "cancelled";
export type FulfillmentStatus = "pending" | "fulfilled";
export type ItemType = "ingredient" | "product";

export interface TokenOut {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: number;
  name: string;
  role: Role;
  sections: string[]; // effective sections this employee can access
}
export interface RosterEntry {
  id: number;
  name: string;
  role: Role;
}

export interface Product {
  id: number;
  name: string;
  price: string;
  category: string | null;
  active: boolean;
  photo_url: string | null;
}
export interface Ingredient {
  id: number;
  name: string;
  unit: string;
  cost_per_unit: string;
  low_stock_threshold: string;
  active: boolean;
}
export interface RecipeItem {
  ingredient_id: number;
  quantity: string;
}
export interface Recipe {
  id: number;
  product_id: number;
  yield_qty: number;
  items: RecipeItem[];
}
export interface TimeEntry {
  id: number;
  user_id: number;
  clock_in: string;
  clock_out: string | null;
}

export interface OrderItemOut {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: string;
  note: string | null;
}
export type NoteType = "general" | "payment";
export type PaymentTiming = "now" | "later";

export interface OrderNoteOut {
  id: number;
  text: string;
  type: NoteType;
  done: boolean;
  done_at: string | null;
  done_by: number | null;
  created_at: string;
}
export interface Order {
  id: number;
  client_name: string;
  client_phone: string | null;
  order_date: string;
  needed_for_date: string | null;
  fulfillment_type: FulfillmentType;
  delivery_price: string | null;
  delivery_address: string | null;
  delivery_name: string | null;
  card_message: string | null;
  payment_timing: PaymentTiming;
  payment_method: PaymentMethod | null;
  paid_status: PaidStatus;
  status: OrderStatus;
  fulfillment_status: FulfillmentStatus;
  total: string;
  locked_by: number | null;
  items: OrderItemOut[];
  notes: OrderNoteOut[];
}

// Payload for POST /orders (mirrors backend OrderCreate).
export interface OrderCreatePayload {
  idempotency_key: string;
  client_name: string;
  client_phone?: string | null;
  needed_for_date?: string | null;
  fulfillment_type: FulfillmentType;
  delivery_price?: string | null;
  delivery_address?: string | null;
  delivery_name?: string | null;
  card_message?: string | null;
  payment_timing: PaymentTiming;
  payment_method?: PaymentMethod | null;
  items: { product_id: number; quantity: number; note?: string | null }[];
  notes: { text: string; type: NoteType }[];
}

export interface WeeklyHours {
  user_id: number;
  week_start: string;
  week_end: string;
  days: { day: string; hours: number }[];
  total_hours: number;
  open_entry: { id: number; clock_in: string; clock_out: string | null } | null;
}
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface StockLevel {
  item_type: ItemType;
  item_id: number;
  quantity: string;
  updated_at: string;
  name: string | null;
  low_stock_threshold: string | null;
  is_low: boolean | null;
}

export interface DayHours {
  day: string;
  hours: number;
}
export interface StaffHoursRow {
  user_id: number;
  name: string;
  total_hours: number;
}
export interface HoursReport {
  week_start: string;
  week_end: string;
  rows: StaffHoursRow[];
  grand_total_hours: number;
}

export interface DeliveryRow {
  order_id: number;
  needed_for_date: string | null;
  client_name: string;
  client_phone: string | null;
  delivery_address: string | null;
  delivery_name: string | null;
  items: { product_name: string; quantity: number }[];
  box_count: number;
  total: string;
  paid_status: PaidStatus;
}
export interface Deliveries {
  from_date: string;
  to_date: string;
  rows: DeliveryRow[];
}

export interface ProductionRow {
  product_id: number;
  product_name: string;
  total_quantity: number;
  order_count: number;
  in_stock: string;
  to_bake: string;
}
export interface ProductionReport {
  from_date: string;
  to_date: string;
  rows: ProductionRow[];
  total_needed: number;
  total_to_bake: string;
}

export interface PaymentBreakdown {
  cash: string;
  card: string;
  etransfer: string;
  unspecified: string;
  unpaid: string;
}
export interface ExpenseOut {
  id: number;
  description: string;
  amount: string;
  category: string | null;
  spent_on: string;
  logged_by: number | null;
}
export interface SalesReport {
  from_date: string;
  to_date: string;
  revenue: string;
  order_count: number;
  ingredient_cost: string;
  expenses_total: string;
  profit: string;
  payment_breakdown: PaymentBreakdown;
  expenses: ExpenseOut[];
}

export interface Task {
  id: number;
  description: string;
  assigned_to: number;
  assigned_by: number;
  due_date: string | null;
  done: boolean;
  is_overdue: boolean;
  created_at: string;
}
export interface Employee {
  id: number;
  name: string;
  role: Role;
  active: boolean;
  pin_set: boolean;
  permissions: string[] | null;      // raw override (null = using role default)
  effective_sections: string[];      // what they can actually access
  setup_code?: string | null;        // one-time first-login code (create/reset only)
}
export interface Notification {
  id: number;
  type: string;
  message: string;
  related_order_id: number | null;
  related_task_id: number | null;
  related_item_type: ItemType | null;
  related_item_id: number | null;
  read: boolean;
  created_at: string;
}
export interface BusinessProfile {
  business_name: string | null;
  business_address: string | null;
  business_phone: string | null;
}

export type RealtimeEvent =
  | { type: "orders_changed" }
  | { type: "stock_changed" }
  | { type: "notification"; notification: { type: string; message: string } };
