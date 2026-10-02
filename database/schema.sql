-- ============================================================
-- Dairy & Milk Cooperative Merchant Management System
-- Database: dairy_merchant_db
-- ============================================================

DROP DATABASE IF EXISTS dairy_merchant_db;
CREATE DATABASE dairy_merchant_db;
USE dairy_merchant_db;

-- ------------------------------------------------------------
-- 1. USERS (authentication + role management)
-- ------------------------------------------------------------
CREATE TABLE users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('ADMIN','MERCHANT','OWNER') NOT NULL,
    status        ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 2. MERCHANTS
-- ------------------------------------------------------------
CREATE TABLE merchants (
    merchant_id   INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL UNIQUE,
    merchant_code VARCHAR(20) NOT NULL UNIQUE,
    shift         ENUM('MORNING','EVENING') NOT NULL DEFAULT 'MORNING',
    shop_name     VARCHAR(150) NOT NULL,
    phone         VARCHAR(15) NOT NULL,
    address       VARCHAR(255),
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_merchant_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 3. PRODUCTS
-- ------------------------------------------------------------
CREATE TABLE products (
    product_id    INT AUTO_INCREMENT PRIMARY KEY,
    product_name  VARCHAR(100) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    unit          VARCHAR(20) NOT NULL,          -- e.g. Litre, Kg
    selling_price DECIMAL(10,2) NOT NULL CHECK (selling_price >= 0),
    status        ENUM('ACTIVE','DISCONTINUED') DEFAULT 'ACTIVE',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 4. PRODUCT_QUALITY
-- ------------------------------------------------------------
CREATE TABLE product_quality (
    quality_id   INT AUTO_INCREMENT PRIMARY KEY,
    product_id   INT NOT NULL,
    fat_percent  DECIMAL(5,2),
    snf_percent  DECIMAL(5,2),
    grade        ENUM('A','B','C') NOT NULL,
    tested_date  DATE NOT NULL,
    CONSTRAINT fk_quality_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 5. STOCK_ENTRIES (incoming stock)
-- ------------------------------------------------------------
CREATE TABLE stock_entries (
    stock_entry_id INT AUTO_INCREMENT PRIMARY KEY,
    merchant_id    INT NOT NULL,
    product_id     INT NOT NULL,
    quantity       DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
    cost_per_unit  DECIMAL(10,2) NOT NULL CHECK (cost_per_unit >= 0),
    total_cost     DECIMAL(12,2) GENERATED ALWAYS AS (quantity * cost_per_unit) STORED,
    entry_date     DATE NOT NULL,
    CONSTRAINT fk_stock_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE,
    CONSTRAINT fk_stock_product  FOREIGN KEY (product_id)  REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 6. INVENTORY (current available stock per merchant/product)
-- ------------------------------------------------------------
CREATE TABLE inventory (
    inventory_id       INT AUTO_INCREMENT PRIMARY KEY,
    merchant_id        INT NOT NULL,
    product_id         INT NOT NULL,
    quantity_available DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
    last_updated       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_inv_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_product  FOREIGN KEY (product_id)  REFERENCES products(product_id) ON DELETE CASCADE,
    CONSTRAINT uq_inventory UNIQUE (merchant_id, product_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 7. INVOICES
-- ------------------------------------------------------------
CREATE TABLE invoices (
    invoice_id     INT AUTO_INCREMENT PRIMARY KEY,
    merchant_id    INT NOT NULL,
    invoice_number VARCHAR(30) NOT NULL UNIQUE,
    invoice_date   DATE NOT NULL,
    total_amount   DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
    CONSTRAINT fk_invoice_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 8. SALES
-- ------------------------------------------------------------
CREATE TABLE sales (
    sale_id      INT AUTO_INCREMENT PRIMARY KEY,
    merchant_id  INT NOT NULL,
    invoice_id   INT UNIQUE,
    sale_date    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subtotal     DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
    tax          DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount     DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
    sale_status  ENUM('COMPLETED','CANCELLED') NOT NULL DEFAULT 'COMPLETED',
    CONSTRAINT fk_sale_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE,
    CONSTRAINT fk_sale_invoice  FOREIGN KEY (invoice_id)  REFERENCES invoices(invoice_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 9. SALE_ITEMS
-- ------------------------------------------------------------
CREATE TABLE sale_items (
    sale_item_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id      INT NOT NULL,
    product_id   INT NOT NULL,
    quantity     DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
    unit_price   DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price  DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    CONSTRAINT fk_item_sale    FOREIGN KEY (sale_id)    REFERENCES sales(sale_id) ON DELETE CASCADE,
    CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 10. PAYMENTS
-- ------------------------------------------------------------
CREATE TABLE payments (
    payment_id      INT AUTO_INCREMENT PRIMARY KEY,
    sale_id         INT NOT NULL,
    payment_method  ENUM('CASH','UPI','CARD','ONLINE') NOT NULL,
    amount          DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    transaction_ref VARCHAR(50) UNIQUE,
    payment_status  ENUM('PENDING','SUCCESS','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
    payment_date    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payment_sale FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- INDEXES (performance)
-- ------------------------------------------------------------
CREATE INDEX idx_sales_merchant_date ON sales(merchant_id, sale_date);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);
CREATE INDEX idx_payments_status ON payments(payment_status);
CREATE INDEX idx_stock_merchant_product ON stock_entries(merchant_id, product_id);

-- ============================================================
-- VIEWS
-- ============================================================

-- 1. Merchant Revenue View (avoiding Cartesian joins)
CREATE OR REPLACE VIEW vw_merchant_revenue AS
SELECT m.merchant_id, m.shop_name,
       COALESCE(s.total_sales_amount, 0) AS total_sales_amount,
       COALESCE(p.total_successful_payments, 0) AS total_successful_payments
FROM merchants m
LEFT JOIN (
    SELECT merchant_id, SUM(total_amount) AS total_sales_amount
    FROM sales
    WHERE sale_status = 'COMPLETED'
    GROUP BY merchant_id
) s ON s.merchant_id = m.merchant_id
LEFT JOIN (
    SELECT s2.merchant_id, SUM(pay.amount) AS total_successful_payments
    FROM payments pay
    JOIN sales s2 ON s2.sale_id = pay.sale_id
    WHERE pay.payment_status = 'SUCCESS'
    GROUP BY s2.merchant_id
) p ON p.merchant_id = m.merchant_id;

-- 2. Stock Discrepancy View (separate aggregation subqueries to eliminate Cartesian products)
CREATE OR REPLACE VIEW vw_stock_discrepancy AS
SELECT i.merchant_id, i.product_id, pr.product_name,
       COALESCE(se.total_incoming, 0) AS total_incoming,
       COALESCE(si.total_sold, 0) AS total_sold,
       (COALESCE(se.total_incoming, 0) - COALESCE(si.total_sold, 0)) AS expected_stock,
       i.quantity_available AS actual_stock,
       ((COALESCE(se.total_incoming, 0) - COALESCE(si.total_sold, 0)) - i.quantity_available) AS discrepancy
FROM inventory i
JOIN products pr ON pr.product_id = i.product_id
LEFT JOIN (
    SELECT merchant_id, product_id, SUM(quantity) AS total_incoming
    FROM stock_entries
    GROUP BY merchant_id, product_id
) se ON se.merchant_id = i.merchant_id AND se.product_id = i.product_id
LEFT JOIN (
    SELECT s.merchant_id, it.product_id, SUM(it.quantity) AS total_sold
    FROM sale_items it
    JOIN sales s ON s.sale_id = it.sale_id
    WHERE s.sale_status = 'COMPLETED'
    GROUP BY s.merchant_id, it.product_id
) si ON si.merchant_id = i.merchant_id AND si.product_id = i.product_id;

-- 3. Payment Discrepancy View
CREATE OR REPLACE VIEW vw_payment_discrepancy AS
SELECT m.merchant_id,
       COALESCE(s.total_sales, 0) AS total_sales,
       COALESCE(p.total_successful_payments, 0) AS total_successful_payments,
       (COALESCE(s.total_sales, 0) - COALESCE(p.total_successful_payments, 0)) AS discrepancy
FROM merchants m
LEFT JOIN (
    SELECT merchant_id, SUM(total_amount) AS total_sales
    FROM sales
    WHERE sale_status = 'COMPLETED'
    GROUP BY merchant_id
) s ON s.merchant_id = m.merchant_id
LEFT JOIN (
    SELECT s2.merchant_id, SUM(pay.amount) AS total_successful_payments
    FROM payments pay
    JOIN sales s2 ON s2.sale_id = pay.sale_id
    WHERE pay.payment_status = 'SUCCESS'
    GROUP BY s2.merchant_id
) p ON p.merchant_id = m.merchant_id;

-- ============================================================
-- SAMPLE DATA
-- ============================================================

-- Users:
-- Admin: admin@dairycoop.com (password123)
-- Merchant 1: koteshwar.merchant@dairycoop.com / M1 (P1 or password123)
-- Merchant 2: lakshmaiah.merchant@dairycoop.com / M2 (P2 or password123)
-- Owner: owner@dairycoop.com / premsaisurisetty@gmail.com (0206 or password123)

INSERT INTO users (user_id, name, email, password_hash, role, status) VALUES
(1, 'System Admin', 'admin@dairycoop.com', '$2a$10$nKx1x93P0dSD3.DxXd2LRudG2AXyAwPAj/6Ff6G9HgH8vWn2Eigh6', 'ADMIN', 'ACTIVE'),
(2, 'Koteshwar Rao', 'koteshwar.merchant@dairycoop.com', '$2a$10$iskXe4T/ewb8uJOBxt17wOtktuJpjXEGTfBbde1moBPxvh0W0lnXK', 'MERCHANT', 'ACTIVE'),
(3, 'Lakshmaiah Setty', 'lakshmaiah.merchant@dairycoop.com', '$2a$10$5g2Rz50ACQAWA/r0/yte3eUQL7R7LUJSHNQ6KdX897vu5NLxUZxwO', 'MERCHANT', 'ACTIVE'),
(4, 'Platform Owner', 'premsaisurisetty@gmail.com', '$2a$10$VHrg3t9k2UUAJeKrqBy2qOLRfJ.QmP2Sr0rvnivbJeVCnZ0A/mt3q', 'OWNER', 'ACTIVE'),
(5, 'Cooperative Owner', 'owner@dairycoop.com', '$2a$10$VHrg3t9k2UUAJeKrqBy2qOLRfJ.QmP2Sr0rvnivbJeVCnZ0A/mt3q', 'OWNER', 'ACTIVE');

INSERT INTO merchants (merchant_id, user_id, merchant_code, shift, shop_name, phone, address) VALUES
(1, 2, 'M1', 'MORNING', 'Koteshwar Dairy Parlour', '9876543210', 'Kukatpally, Hyderabad'),
(2, 3, 'M2', 'EVENING', 'Lakshmaiah Milk Center', '9876543211', 'Miyapur, Hyderabad');

INSERT INTO products (product_id, product_name, category, unit, selling_price) VALUES
(1, 'Full Cream Milk', 'Milk', 'Litre', 55.00),
(2, 'Fresh Curd', 'Dairy', 'Kg', 70.00),
(3, 'Farm Paneer', 'Dairy', 'Kg', 320.00),
(4, 'Pure Cow Ghee', 'Dairy', 'Kg', 650.00),
(5, 'Spiced Buttermilk', 'Beverages', 'Litre', 25.00);

INSERT INTO product_quality (product_id, fat_percent, snf_percent, grade, tested_date) VALUES
(1, 4.2, 8.5, 'A', '2026-08-25'),
(1, 3.8, 8.2, 'B', '2026-08-27'),
(2, 3.9, 8.0, 'A', '2026-08-26'),
(4, 99.5, NULL, 'A', '2026-08-20');

-- Stock entries (incoming)
INSERT INTO stock_entries (merchant_id, product_id, quantity, cost_per_unit, entry_date) VALUES
(1, 1, 100, 40.00, '2026-08-28'),
(1, 2, 40, 50.00, '2026-08-28'),
(1, 3, 15, 250.00, '2026-08-28'),
(2, 1, 80, 40.00, '2026-08-28'),
(2, 5, 60, 15.00, '2026-08-28');

-- Inventory: merchant 1 has intentional stock discrepancy on product 1
INSERT INTO inventory (merchant_id, product_id, quantity_available) VALUES
(1, 1, 60),   -- expected 100 - sold(30) = 70, actual 60 -> discrepancy of 10
(1, 2, 30),   -- expected 40 - sold(10) = 30
(1, 3, 15),
(2, 1, 65),   -- expected 80 - sold(15) = 65
(2, 5, 60);

-- Invoices
INSERT INTO invoices (invoice_id, merchant_id, invoice_number, invoice_date, total_amount) VALUES
(1, 1, 'INV-1001', '2026-08-29', 1650.00),
(2, 1, 'INV-1002', '2026-08-29', 700.00),
(3, 2, 'INV-1003', '2026-08-29', 825.00);

-- Sales
INSERT INTO sales (sale_id, merchant_id, invoice_id, sale_date, subtotal, tax, discount, total_amount, sale_status) VALUES
(1, 1, 1, '2026-08-29 09:15:00', 1600.00, 50.00, 0.00, 1650.00, 'COMPLETED'),
(2, 1, 2, '2026-08-29 11:30:00', 700.00, 0.00, 0.00, 700.00, 'COMPLETED'),
(3, 2, 3, '2026-08-29 10:00:00', 800.00, 25.00, 0.00, 825.00, 'COMPLETED');

-- Sale items (sale 1: 30 Milk, sale 2: 10 Curd, sale 3: 15 Milk)
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES
(1, 1, 30, 55.00),
(2, 2, 10, 70.00),
(3, 1, 15, 55.00);

-- Payments (deliberately introduce ONE payment discrepancy on merchant 1: sale 2 payment FAILED)
INSERT INTO payments (payment_id, sale_id, payment_method, amount, transaction_ref, payment_status, payment_date) VALUES
(1, 1, 'UPI', 1650.00, 'TXN-90001', 'SUCCESS', '2026-08-29 09:16:00'),
(2, 2, 'CASH', 700.00, NULL, 'FAILED', '2026-08-29 11:31:00'),
(3, 3, 'CARD', 825.00, 'TXN-90003', 'SUCCESS', '2026-08-29 10:01:00');
