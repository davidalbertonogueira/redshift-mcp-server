-- Sample warehouse data, structured like a typical dbt/SQL tutorial schema.
-- Two schemas are used so listSchemas()/listTables() have something to enumerate.

CREATE TABLE public.clients (
    client_id    INTEGER PRIMARY KEY,
    client_name  VARCHAR(100) NOT NULL,
    email        VARCHAR(255),
    phone        VARCHAR(50),
    signup_date  DATE NOT NULL
);

CREATE TABLE public.orders (
    order_id     INTEGER PRIMARY KEY,
    client_id    INTEGER NOT NULL REFERENCES public.clients (client_id),
    order_date   DATE NOT NULL,
    status       VARCHAR(20) NOT NULL,
    amount       NUMERIC(10, 2) NOT NULL
);

CREATE TABLE public.order_items (
    order_item_id INTEGER PRIMARY KEY,
    order_id      INTEGER NOT NULL REFERENCES public.orders (order_id),
    product_name  VARCHAR(100) NOT NULL,
    quantity      INTEGER NOT NULL,
    unit_price    NUMERIC(10, 2) NOT NULL
);

INSERT INTO public.clients (client_id, client_name, email, phone, signup_date) VALUES
    (1, 'Acme Corp',        'ap@acme.example',       '555-0100', '2024-01-15'),
    (2, 'Globex LLC',       'billing@globex.example','555-0101', '2024-02-20'),
    (3, 'Initech',          'ap@initech.example',    '555-0102', '2024-03-05'),
    (4, 'Umbrella Group',   'ap@umbrella.example',   '555-0103', '2024-04-11'),
    (5, 'Wayne Enterprises','ap@wayne.example',      '555-0104', '2024-05-30');

INSERT INTO public.orders (order_id, client_id, order_date, status, amount) VALUES
    (1001, 1, '2024-06-01', 'completed', 249.99),
    (1002, 1, '2024-06-15', 'completed', 89.50),
    (1003, 2, '2024-06-03', 'completed', 1200.00),
    (1004, 3, '2024-06-10', 'pending',   430.25),
    (1005, 3, '2024-07-01', 'completed', 75.00),
    (1006, 4, '2024-07-04', 'cancelled', 300.00),
    (1007, 5, '2024-07-10', 'completed', 999.99),
    (1008, 5, '2024-07-20', 'pending',   150.00);

INSERT INTO public.order_items (order_item_id, order_id, product_name, quantity, unit_price) VALUES
    (1, 1001, 'Widget A',   2, 99.99),
    (2, 1001, 'Widget B',   1, 50.01),
    (3, 1002, 'Widget A',   1, 89.50),
    (4, 1003, 'Gadget Pro', 4, 300.00),
    (5, 1004, 'Widget C',   5, 86.05),
    (6, 1005, 'Widget A',   1, 75.00),
    (7, 1006, 'Gadget Pro', 1, 300.00),
    (8, 1007, 'Gadget Pro', 3, 333.33),
    (9, 1008, 'Widget B',   3, 50.00);

-- A second, non-default schema so multi-schema listing/search is exercised.
CREATE SCHEMA marketing;

CREATE TABLE marketing.campaigns (
    campaign_id  INTEGER PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    channel      VARCHAR(50) NOT NULL,
    start_date   DATE NOT NULL
);

INSERT INTO marketing.campaigns (campaign_id, name, channel, start_date) VALUES
    (1, 'Summer Sale',   'email', '2024-06-01'),
    (2, 'Referral Push', 'social', '2024-07-15');

-- Populate pg_stat_user_tables (row counts) immediately, since the app's
-- table-statistics queries read live tuple counts rather than doing COUNT(*).
ANALYZE public.clients;
ANALYZE public.orders;
ANALYZE public.order_items;
ANALYZE marketing.campaigns;
