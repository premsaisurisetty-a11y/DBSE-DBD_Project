-- ============================================================
-- Dairy & Milk Cooperative Merchant Management System
-- Database: dairy_merchant_db
-- ============================================================

DROP DATABASE IF EXISTS dairy_merchant_db;
CREATE DATABASE dairy_merchant_db;
USE dairy_merchant_db;

-- ------------------------------------------------------------
-- 1. USERS  (authentication + role management)
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
    merchant_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL UNIQUE,
    shop_name   VARCHAR(150) NOT NULL,
    phone       VARCHAR(15) NOT NULL,
    address     VARCHAR(255),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
-- 5. STOCK_ENTRIES  (incoming stock)
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
-- 6. INVENTORY  (current available stock per merchant/product)
-- ------------------------------------------------------------
CREATE TABLE inventory (
    inventory_id      INT AUTO_INCREMENT PRIMARY KEY,
    merchant_id       INT NOT NULL,
    product_id        INT NOT NULL,
    quantity_available DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
    last_updated      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_inv_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_product  FOREIGN KEY (product_id)  REFERENCES products(product_id) ON DELETE CASCADE,
    CONSTRAINT uq_inventory UNIQUE (merchant_id, product_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 7. INVOICES  (created before sales FK reference, since sales references invoice)
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
-- 11. AUDIT_LOGS
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
    audit_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT,
    action      VARCHAR(50) NOT NULL,      -- INSERT / UPDATE / DELETE
    table_name  VARCHAR(50) NOT NULL,
    record_id   INT,
    old_value   TEXT,
    new_value   TEXT,
    action_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- INDEXES (performance)
-- ------------------------------------------------------------
CREATE INDEX idx_sales_merchant_date ON sales(merchant_id, sale_date);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);
CREATE INDEX idx_payments_status ON payments(payment_status);
CREATE INDEX idx_stock_merchant_product ON stock_entries(merchant_id, product_id);
CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);

-- ============================================================
-- VIEWS
-- ============================================================

-- Revenue is derived, not stored, per DBSE normalization guidance.
CREATE VIEW vw_merchant_revenue AS
SELECT m.merchant_id, m.shop_name,
       COALESCE(SUM(s.total_amount),0) AS total_sales_amount,
       COALESCE(SUM(CASE WHEN p.payment_status='SUCCESS' THEN p.amount ELSE 0 END),0) AS total_successful_payments
FROM merchants m
LEFT JOIN sales s ON s.merchant_id = m.merchant_id AND s.sale_status='COMPLETED'
LEFT JOIN payments p ON p.sale_id = s.sale_id
GROUP BY m.merchant_id, m.shop_name;

-- Expected vs actual stock, per merchant/product
CREATE VIEW vw_stock_discrepancy AS
SELECT i.merchant_id, i.product_id, pr.product_name,
       COALESCE(SUM(se.quantity),0) AS total_incoming,
       COALESCE(SUM(si.quantity),0) AS total_sold,
       (COALESCE(SUM(se.quantity),0) - COALESCE(SUM(si.quantity),0)) AS expected_stock,
       i.quantity_available AS actual_stock,
       (COALESCE(SUM(se.quantity),0) - COALESCE(SUM(si.quantity),0)) - i.quantity_available AS discrepancy
FROM inventory i
JOIN products pr ON pr.product_id = i.product_id
LEFT JOIN stock_entries se ON se.merchant_id = i.merchant_id AND se.product_id = i.product_id
LEFT JOIN sale_items si ON si.product_id = i.product_id
     AND si.sale_id IN (SELECT sale_id FROM sales WHERE merchant_id = i.merchant_id AND sale_status='COMPLETED')
GROUP BY i.merchant_id, i.product_id, pr.product_name, i.quantity_available;

-- Payment discrepancy per merchant
CREATE VIEW vw_payment_discrepancy AS
SELECT s.merchant_id,
       SUM(s.total_amount) AS total_sales,
       SUM(CASE WHEN p.payment_status='SUCCESS' THEN p.amount ELSE 0 END) AS total_successful_payments,
       SUM(s.total_amount) - SUM(CASE WHEN p.payment_status='SUCCESS' THEN p.amount ELSE 0 END) AS discrepancy
FROM sales s
LEFT JOIN payments p ON p.sale_id = s.sale_id
WHERE s.sale_status = 'COMPLETED'
GROUP BY s.merchant_id;

-- ============================================================
-- SAMPLE DATA
-- ============================================================

-- Passwords below are a real bcrypt hash (10 rounds) of "password123" — for demo login only.
-- Regenerate for production: node -e "require('bcryptjs').hash('yourpassword',10).then(console.log)"
INSERT INTO users (name, email, password_hash, role, status) VALUES
('System Admin', 'admin@dairycoop.com', '$2a$10$YWExTPIGBb1kNuPV.Ft2n.Z4K1jw26UgET7HNPdSY/dkD7Pxr0s46', 'ADMIN', 'ACTIVE'),
('Ravi Kumar', 'ravi.merchant@dairycoop.com', '$2a$10$YWExTPIGBb1kNuPV.Ft2n.Z4K1jw26UgET7HNPdSY/dkD7Pxr0s46', 'MERCHANT', 'ACTIVE'),
('Lakshmi Devi', 'lakshmi.merchant@dairycoop.com', '$2a$10$YWExTPIGBb1kNuPV.Ft2n.Z4K1jw26UgET7HNPdSY/dkD7Pxr0s46', 'MERCHANT', 'ACTIVE'),
('Suresh Reddy', 'suresh.merchant@dairycoop.com', '$2a$10$YWExTPIGBb1kNuPV.Ft2n.Z4K1jw26UgET7HNPdSY/dkD7Pxr0s46', 'MERCHANT', 'ACTIVE');

-- Optional seeded owner account for demo purposes (password = password123)
INSERT INTO users (name, email, password_hash, role, status) VALUES
('Platform Owner', 'owner@dairycoop.com', '$2a$10$YWExTPIGBb1kNuPV.Ft2n.Z4K1jw26UgET7HNPdSY/dkD7Pxr0s46', 'OWNER', 'ACTIVE');

INSERT INTO merchants (user_id, shop_name, phone, address) VALUES
(2, 'Ravi Dairy Parlour', '9876543210', 'Kukatpally, Hyderabad'),
(3, 'Lakshmi Milk Center', '9876543211', 'Miyapur, Hyderabad'),
(4, 'Suresh Fresh Dairy', '9876543212', 'Kompally, Hyderabad');

INSERT INTO products (product_name, category, unit, selling_price) VALUES
('Milk', 'Dairy', 'Litre', 55.00),
('Curd', 'Dairy', 'Kg', 70.00),
('Paneer', 'Dairy', 'Kg', 320.00),
('Ghee', 'Dairy', 'Kg', 650.00),
('Buttermilk', 'Dairy', 'Litre', 25.00);

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
(2, 5, 60, 15.00, '2026-08-28'),
(3, 1, 120, 40.00, '2026-08-28'),
(3, 4, 10, 500.00, '2026-08-28');

-- Inventory: deliberately introduce ONE stock discrepancy (merchant 1, product 1: actual less than expected)
INSERT INTO inventory (merchant_id, product_id, quantity_available) VALUES
(1, 1, 60),   -- expected 100 - sold(30) = 70, actual 60 -> discrepancy of 10
(1, 2, 35),
(1, 3, 15),
(2, 1, 65),
(2, 5, 60),
(3, 1, 115),
(3, 4, 10);

-- Invoices
INSERT INTO invoices (merchant_id, invoice_number, invoice_date, total_amount) VALUES
(1, 'INV-1001', '2026-08-29', 1650.00),
(1, 'INV-1002', '2026-08-29', 700.00),
(2, 'INV-1003', '2026-08-29', 825.00),
(3, 'INV-1004', '2026-08-29', 275.00);

-- Sales
INSERT INTO sales (merchant_id, invoice_id, sale_date, subtotal, tax, discount, total_amount, sale_status) VALUES
(1, 1, '2026-08-29 09:15:00', 1600.00, 50.00, 0.00, 1650.00, 'COMPLETED'),
(1, 2, '2026-08-29 11:30:00', 700.00, 0.00, 0.00, 700.00, 'COMPLETED'),
(2, 3, '2026-08-29 10:00:00', 800.00, 25.00, 0.00, 825.00, 'COMPLETED'),
(3, 4, '2026-08-29 14:00:00', 275.00, 0.00, 0.00, 275.00, 'COMPLETED');

-- Sale items (sale 1: 30 Milk, sale 2: 10 Curd, sale 3: 15 Milk, sale 4: 5 Milk)
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES
(1, 1, 30, 55.00),
(2, 2, 10, 70.00),
(3, 1, 15, 55.00),
(4, 1, 5, 55.00);

-- Payments (deliberately introduce ONE payment discrepancy on merchant 1: sale 2 payment FAILED)
INSERT INTO payments (sale_id, payment_method, amount, transaction_ref, payment_status, payment_date) VALUES
(1, 'UPI', 1650.00, 'TXN-90001', 'SUCCESS', '2026-08-29 09:16:00'),
(2, 'CASH', 700.00, NULL, 'FAILED', '2026-08-29 11:31:00'),
(3, 'CARD', 825.00, 'TXN-90003', 'SUCCESS', '2026-08-29 10:01:00'),
(4, 'UPI', 275.00, 'TXN-90004', 'SUCCESS', '2026-08-29 14:01:00');

-- Audit logs
INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES
(2, 'INSERT', 'sales', 1, NULL, '{"total_amount":1650.00}'),
(2, 'INSERT', 'sales', 2, NULL, '{"total_amount":700.00}'),
(3, 'INSERT', 'sales', 3, NULL, '{"total_amount":825.00}'),
(1, 'UPDATE', 'merchants', 1, '{"status":"PENDING"}', '{"status":"ACTIVE"}');

-- ============================================================
-- ANALYTICAL / DBSE DEMONSTRATION QUERIES
-- ============================================================

-- 1. Merchant-wise total sales
-- SELECT m.shop_name, SUM(s.total_amount) AS total_sales
-- FROM sales s JOIN merchants m ON m.merchant_id = s.merchant_id
-- WHERE s.sale_status='COMPLETED' GROUP BY m.shop_name;

-- 2. Product-wise sales
-- SELECT p.product_name, SUM(si.quantity) AS total_qty, SUM(si.total_price) AS total_revenue
-- FROM sale_items si JOIN products p ON p.product_id = si.product_id
-- GROUP BY p.product_name ORDER BY total_revenue DESC;

-- 3. Daily revenue
-- SELECT DATE(sale_date) AS day, SUM(total_amount) AS revenue
-- FROM sales WHERE sale_status='COMPLETED' GROUP BY DATE(sale_date);

-- 4. Monthly revenue
-- SELECT DATE_FORMAT(sale_date,'%Y-%m') AS month, SUM(total_amount) AS revenue
-- FROM sales WHERE sale_status='COMPLETED' GROUP BY month;

-- 5. Payment method-wise revenue
-- SELECT payment_method, SUM(amount) AS total FROM payments WHERE payment_status='SUCCESS' GROUP BY payment_method;

-- 6. Successful vs failed payments
-- SELECT payment_status, COUNT(*) AS cnt, SUM(amount) AS total FROM payments GROUP BY payment_status;

-- 7. Inventory levels
-- SELECT m.shop_name, p.product_name, i.quantity_available FROM inventory i
-- JOIN merchants m ON m.merchant_id=i.merchant_id JOIN products p ON p.product_id=i.product_id;

-- 8. Low-stock products (threshold = 20)
-- SELECT m.shop_name, p.product_name, i.quantity_available FROM inventory i
-- JOIN merchants m ON m.merchant_id=i.merchant_id JOIN products p ON p.product_id=i.product_id
-- WHERE i.quantity_available < 20;

-- 9. Payment discrepancy detection
-- SELECT * FROM vw_payment_discrepancy HAVING discrepancy <> 0;

-- 10. Stock discrepancy detection
-- SELECT * FROM vw_stock_discrepancy HAVING discrepancy <> 0;

-- 11. Merchant transaction history
-- SELECT s.sale_id, s.sale_date, s.total_amount, p.payment_status
-- FROM sales s LEFT JOIN payments p ON p.sale_id=s.sale_id
-- WHERE s.merchant_id = 1 ORDER BY s.sale_date DESC;

-- 12. Audit history
-- SELECT a.*, u.name FROM audit_logs a JOIN users u ON u.user_id=a.user_id ORDER BY action_time DESC;

-- 13. Top-selling products (subquery)
-- SELECT product_name FROM products WHERE product_id = (
--   SELECT product_id FROM sale_items GROUP BY product_id ORDER BY SUM(quantity) DESC LIMIT 1
-- );

-- 14. Revenue ranking using a window function
-- SELECT m.shop_name, SUM(s.total_amount) AS revenue,
--        RANK() OVER (ORDER BY SUM(s.total_amount) DESC) AS revenue_rank
-- FROM sales s JOIN merchants m ON m.merchant_id=s.merchant_id
-- WHERE s.sale_status='COMPLETED' GROUP BY m.shop_name;
