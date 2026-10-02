# Dairy & Milk Cooperative Management System — Microservices Scaffolding

This directory contains the structural scaffolding and boundary definitions for migrating the monolithic backend to a decoupled microservices architecture.

## Services Overview & Port Map

| Service | Port | Directory | Domain Responsibility |
|---|---|---|---|
| **API Gateway** | `4000` | `services/api-gateway` | Reverse proxy, JWT validation, rate limiting, route dispatching |
| **Auth Service** | `4001` | `services/auth-service` | User accounts, credentials, role management, token issuance & verification |
| **Merchant Service** | `4002` | `services/merchant-service` | Dairy franchise profiles, assigned shifts, counter contacts & status |
| **Product Service** | `4003` | `services/product-service` | Standardized catalog, official retail rates, quality testing logs |
| **Inventory Service** | `4004` | `services/inventory-service` | Stock entries (inflow), available quantities, stock reservation API |
| **Sales Service** | `4005` | `services/sales-service` | Point of Sale orchestration, sales orders, line items, invoice generation |
| **Payment Service** | `4006` | `services/payment-service` | Cashfree integration, QR checkout, payment ledger, webhook processing |
| **Reporting Service** | `4007` | `services/reporting-service` | Audit summaries, payment discrepancies, stock variance calculations |

> **Note**: The original monolithic backend located at `/backend` remains 100% active, untouched, and fully operational during this scaffolding phase.
