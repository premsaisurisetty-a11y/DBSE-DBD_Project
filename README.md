# Dairy & Milk Cooperative Merchant Management System

A merchant-focused (not customer e-commerce) system for dairy parlour merchants to manage
products, stock, inventory, sales, payments and invoices, with admin-side discrepancy
("fraud indicator") monitoring across Stock → Inventory → Sales → Payments → Revenue.

Stack: **React (Vite) → Node.js/Express → MySQL**. React never talks to MySQL directly.

---

## 1. ER Design (summary)

```
users (1)───(1) merchants (1)───(*) stock_entries
  │                 │
  │                 ├───(*) inventory ───(1) products ───(*) product_quality
  │                 ├───(*) invoices ───(1) sales ───(*) sale_items ───(1) products
  │                 └───(*) sales ───(1) payments
  └───(*) audit_logs
```

- `users` holds login + role (ADMIN/MERCHANT); `merchants` extends a MERCHANT user with shop info.
- `inventory` is the **current** stock per (merchant, product) — unique constraint on that pair.
- `stock_entries` is the **incoming stock ledger**; inventory is derived/updated from it + sales.
- `sales` → `sale_items` (one sale, many products) → each sale has one `invoice` and one `payment`.
- Revenue is **not stored** — it's computed via SQL from `sales`/`payments` (see views), per
  normalization guidance in the brief.
- `audit_logs` records INSERT/UPDATE/DELETE/LOGIN actions for traceability.

Full DDL, constraints, indexes, 3 discrepancy-detection **views**, and 14 demonstration
queries (joins, GROUP BY/HAVING, subquery, window function `RANK()`) are in
`database/schema.sql`.

## 2. Fraud/Discrepancy logic

- **Stock discrepancy** = (incoming stock − sold quantity) − actual inventory on hand.
- **Payment discrepancy** = total sales amount − total *successful* payments.
- These are surfaced as **indicators**, not proof of fraud — the Admin reviews them manually
  on the Discrepancies page.
- The seed data intentionally includes one of each so the Review 2 demo has something to show:
  Ravi Dairy Parlour has a 10-unit Milk stock discrepancy and a ₹700 payment discrepancy
  (one FAILED cash payment).

## 3. Setup — Database

```bash
mysql -u root -p < database/schema.sql
```

This creates `dairy_merchant_db` with all 11 tables, 3 views, indexes, and demo data
(1 admin, 3 merchants, 5 products, stock/sales/payments/invoices/audit history).

Demo logins (password for all: **password123**):
| Role | Email |
|---|---|
| Admin | admin@dairycoop.com |
| Merchant | ravi.merchant@dairycoop.com |
| Merchant | lakshmi.merchant@dairycoop.com |
| Merchant | suresh.merchant@dairycoop.com |

## 4. Setup — Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env: set DB_PASSWORD to your MySQL root password, and JWT_SECRET to a random string
npm run dev        # or: npm start
```
Runs on `http://localhost:5000`. Health check: `GET /api/health`.

## 5. Setup — Frontend

```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173` (Vite dev server proxies `/api` to port 5000 — see `vite.config.js`).

Open the app, log in as admin or a merchant, and you'll land on the role-appropriate dashboard.

## 6. What's implemented (Phase 1 + 2, per Review-2 priority)

- Login (JWT, bcrypt password hashing, role-based redirect)
- Admin: Dashboard, Merchants (activate/deactivate), Products (CRUD), Sales (view all),
  Payments (view all), Inventory (view all), **Discrepancies (fraud monitoring)**, Audit Logs
- Merchant: Dashboard, Products (view), Record Stock, Inventory (own), **Record Sale**
  (multi-item, wrapped in a MySQL transaction: validates stock → creates sale → sale_items →
  reduces inventory → payment → invoice → audit log → COMMIT, with ROLLBACK on any failure),
  Payments (own)
- Invoices and product-quality endpoints exist on the backend (`/api/invoices`,
  `/api/products/:id/quality`) — wire up dedicated pages for Phase 3 if the review needs them
  visually.

## 7. Mapping to DBSE/DBD concepts (for the review)

| Concept | Where |
|---|---|
| Primary/Foreign keys, constraints, normalization | `database/schema.sql` DDL |
| Transactions (BEGIN/COMMIT/ROLLBACK) | `salesController.createSale`, `inventoryController.addStock` |
| Joins, GROUP BY/HAVING, subquery, window function | commented queries at bottom of `schema.sql` |
| Views | `vw_merchant_revenue`, `vw_stock_discrepancy`, `vw_payment_discrepancy` |
| React → Express → MySQL flow | `frontend/src/services/api.js` → `backend/routes/*` → `backend/config/db.js` |
| Role-based auth | `middleware/authMiddleware.js` + `middleware/roleMiddleware.js`, JWT |

## 8. Root-level convenience

If you prefer a single command to start both backend and frontend during development, a root-level helper is available.

Install the root dev helper (from the repo root):

```bash
npm install
```

Then run both servers together:

```bash
npm run dev
```

This runs the backend and frontend dev scripts concurrently. If you prefer to install dependencies for both projects before running, use:

```bash
npm run install-all
```

Note: `npm run dev` at repo root previously failed with ENOENT if run without a root `package.json`. You can still run each project individually by `cd backend` / `cd frontend` and using their `npm` scripts.

