-- =============================================================================
-- Bakery Operations System — PostgreSQL schema (reference)
-- =============================================================================
-- The models in app/models/ are the single source of truth; migrations are run
-- with Alembic (`alembic upgrade head`). This file is a human-readable mirror
-- of the resulting schema for review and documentation (spec §5, §9).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---- enum types -------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('cashier', 'manager', 'admin');
CREATE TYPE fulfillment_type   AS ENUM ('pickup', 'delivery');
CREATE TYPE payment_timing     AS ENUM ('now', 'later');
CREATE TYPE payment_method     AS ENUM ('cash', 'card', 'etransfer');
CREATE TYPE paid_status        AS ENUM ('unpaid', 'paid');
CREATE TYPE order_status       AS ENUM ('pending', 'in_progress', 'ready', 'cancelled');
CREATE TYPE fulfillment_status AS ENUM ('pending', 'fulfilled');
CREATE TYPE note_type          AS ENUM ('general', 'payment');
CREATE TYPE stock_item_type    AS ENUM ('ingredient', 'product');

-- ---- users / employees ------------------------------------------------------
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL UNIQUE,
    role        user_role NOT NULL DEFAULT 'cashier',
    pin_hash    VARCHAR(255),            -- set by employee on first login
    pin_set     BOOLEAN NOT NULL DEFAULT FALSE,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- catalog: products, ingredients, recipes --------------------------------
CREATE TABLE products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    category    VARCHAR(100),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    photo_url   VARCHAR(500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_products_name       ON products (name);
-- trigram index for order-screen typeahead / fuzzy search (§5)
CREATE INDEX ix_products_name_trgm  ON products USING gin (name gin_trgm_ops);

CREATE TABLE ingredients (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(200) NOT NULL,
    unit                VARCHAR(20) NOT NULL,      -- kg / g / unit / ...
    cost_per_unit       NUMERIC(10,4) NOT NULL,    -- feeds recipe cost calc
    low_stock_threshold NUMERIC(12,3) NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ingredients_name ON ingredients (name);

CREATE TABLE recipes (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recipe_items (
    id            SERIAL PRIMARY KEY,
    recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantity      NUMERIC(12,3) NOT NULL,
    CONSTRAINT uq_recipe_ingredient UNIQUE (recipe_id, ingredient_id)
);

-- ---- orders -----------------------------------------------------------------
CREATE TABLE orders (
    id                  SERIAL PRIMARY KEY,
    idempotency_key     VARCHAR(64) NOT NULL UNIQUE,
    request_fingerprint VARCHAR(64),               -- payload hash for dedup/409
    client_name         VARCHAR(200) NOT NULL,
    client_phone        VARCHAR(40),
    order_date          TIMESTAMPTZ NOT NULL,       -- server-set at creation
    needed_for_date     TIMESTAMPTZ,                -- drives the overdue flag
    fulfillment_type    fulfillment_type NOT NULL,
    delivery_price      NUMERIC(10,2),              -- manual, delivery only
    delivery_address    TEXT,
    card_message        TEXT,
    payment_timing      payment_timing NOT NULL,
    payment_method      payment_method,
    paid_status         paid_status NOT NULL DEFAULT 'unpaid',
    paid_at             TIMESTAMPTZ,
    paid_by             INTEGER REFERENCES users(id),
    status              order_status NOT NULL DEFAULT 'pending',
    fulfillment_status  fulfillment_status NOT NULL DEFAULT 'pending',
    fulfilled_at        TIMESTAMPTZ,
    fulfilled_by        INTEGER REFERENCES users(id),
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        INTEGER REFERENCES users(id),
    stock_reversed      BOOLEAN NOT NULL DEFAULT FALSE,
    total               NUMERIC(10,2) NOT NULL DEFAULT 0,
    locked_by           INTEGER REFERENCES users(id),  -- row-level edit lock
    locked_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_orders_idempotency_key ON orders (idempotency_key);

CREATE TABLE order_items (
    id           SERIAL PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity     INTEGER NOT NULL,
    product_name VARCHAR(200) NOT NULL,   -- snapshot at sale time
    unit_price   NUMERIC(10,2) NOT NULL,  -- snapshot at sale time
    note         TEXT
);
CREATE INDEX ix_order_items_order_id ON order_items (order_id);

CREATE TABLE order_notes (
    id         SERIAL PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    type       note_type NOT NULL DEFAULT 'general',
    done       BOOLEAN NOT NULL DEFAULT FALSE,
    done_at    TIMESTAMPTZ,
    done_by    INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_order_notes_order_id ON order_notes (order_id);

-- ---- stock ------------------------------------------------------------------
CREATE TABLE stock_levels (
    id         SERIAL PRIMARY KEY,
    item_type  stock_item_type NOT NULL,
    item_id    INTEGER NOT NULL,
    quantity   NUMERIC(12,3) NOT NULL DEFAULT 0,   -- may go negative (advisory)
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_stock_item UNIQUE (item_type, item_id)
);

CREATE TABLE stock_adjustments (
    id          SERIAL PRIMARY KEY,
    item_type   stock_item_type NOT NULL,
    item_id     INTEGER NOT NULL,
    delta       NUMERIC(12,3) NOT NULL,   -- signed: +restock / -sale/waste
    reason      VARCHAR(255) NOT NULL,
    order_id    INTEGER REFERENCES orders(id),
    adjusted_by INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL
);

-- ---- bookkeeping / later-phase tables (present now, wired later) ------------
CREATE TABLE expenses (
    id          SERIAL PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    amount      NUMERIC(10,2) NOT NULL,
    category    VARCHAR(100),
    spent_on    DATE NOT NULL,
    logged_by   INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE time_entries (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    clock_in  TIMESTAMPTZ NOT NULL,
    clock_out TIMESTAMPTZ
);
CREATE INDEX ix_time_entries_user_id ON time_entries (user_id);

CREATE TABLE daily_reports (
    id              SERIAL PRIMARY KEY,
    report_date     DATE NOT NULL UNIQUE,
    revenue         NUMERIC(12,2) NOT NULL DEFAULT 0,
    order_count     INTEGER NOT NULL DEFAULT 0,
    ingredient_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    generated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE tasks (
    id          SERIAL PRIMARY KEY,
    description TEXT NOT NULL,
    assigned_to INTEGER NOT NULL REFERENCES users(id),
    assigned_by INTEGER NOT NULL REFERENCES users(id),
    due_date    TIMESTAMPTZ,
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    done_at     TIMESTAMPTZ,
    done_by     INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE notifications (
    id                SERIAL PRIMARY KEY,
    type              VARCHAR(40) NOT NULL,   -- low_stock / overdue_order / overdue_task
    message           TEXT NOT NULL,
    related_order_id  INTEGER REFERENCES orders(id),
    related_task_id   INTEGER REFERENCES tasks(id),
    related_item_type stock_item_type,
    related_item_id   INTEGER,
    read              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL
);

-- singleton app settings: business profile (spec §2I/§4).
-- One row (id=1), created lazily by the settings service.
CREATE TABLE app_settings (
    id               INTEGER PRIMARY KEY,
    business_name    VARCHAR(200),
    business_address VARCHAR(400),
    business_phone   VARCHAR(40),
    updated_at       TIMESTAMPTZ
);

-- seed the fallback system user used by the Phase-1 auth stand-in
INSERT INTO users (name, role, pin_set, active)
VALUES ('system', 'admin', FALSE, TRUE);
