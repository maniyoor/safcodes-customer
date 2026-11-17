# Safcodes customer API

All routes are under `/api/client/v1`. The Next.js frontend proxies them to the existing Node server. There is no browser database connection. Signed-in requests use an HttpOnly, SameSite=Strict session cookie scoped to the customer API, with Secure enabled for an HTTPS customer origin. The password and OTP are used only by the Node API. The cookie is issued after sign-in OTP verification.

POST requests use JSON, `X-Safcodes-API: 1` and the configured customer origin. Command requests also require a UUID in `Idempotency-Key`. Retrying the same request with the same key returns the original result. Reusing that key for a different payload returns 409.

## Authentication and profile

| Method and path | Body | Result |
| --- | --- | --- |
| POST `/auth/login` | `{ email, password }` | `{ challengeId, next }`. The next step is `verify` for regular sign-in or `activate` for a local temporary password. |
| POST `/auth/verify` | `{ challengeId, code }` | Sets the customer session cookie. |
| POST `/auth/activate` | `{ challengeId, code, password, confirmation }` | Activates the admin-approved membership and sets the initial customer password. Sign in normally afterward. |
| POST `/auth/reset/request` | `{ email }` | Returns a generic result and challenge ID. An eligible customer receives a reset OTP. |
| POST `/auth/reset/confirm` | `{ challengeId, code, password, confirmation }` | Updates the password and revokes existing sessions. |
| GET `/session` | — | Signed-in user's display name, email and profile photo, and active companies with role permissions. |
| POST `/profile` | `{ display_name, avatar? }` | Saves the display name and optional JPEG data URL. Send `avatar: null` to remove the photo, or omit it to keep the current one. |
| POST `/auth/logout` | `{}` | Revokes the current session and clears the cookie. |

## Accounts

Use a company ID returned by `/session` in place of `{accountId}`.

| Method and path | Details |
| --- | --- |
| GET `/accounts/{accountId}/workspace` | Returns `asOf`, the configured decimal `taxRate`, catalogue and plans, services, projects, contracts, orders, issued invoices with balances, payment links and receipts, and tickets. Project details include the assigned staff lead and completion date when recorded. Billing and support are scoped by customer role. |
| POST `/accounts/{accountId}/estimate` | Body includes `kind`, `existing_service_id`, and either `requested_plan_id` or `requested_quantity`. Returns the estimate, term, days remaining, tax basis, `netPrices` before VAT, and the server-calculated `charge` with `net`, `vat` and `total`. |
| POST `/accounts/{accountId}/commands` | Body is `{ action, data }`. Returns `{ id, message }`. |
| POST `/accounts/{accountId}/payment-portal` | Body is `{}`. Returns a short-lived Stripe test portal URL for the linked account owner when enabled. Workspace returns the `paymentMethodsEnabled` flag. |

### Command actions

| Action | Data |
| --- | --- |
| `request`, product or service | `kind` (`new_product` or `new_service`), `catalog_item_id`, `brief`, and a `title` where a domain-based title is not generated. Priced products use `requested_plan_id` and `domain_name` where applicable. `requested_years` and `requested_quantity` carry the term and email seats. |
| `request`, AMC | `kind: "new_service"`, `amc_request: true`, `existing_service_id` and `brief`. Opens a service request for the selected project or service. |
| `request`, renewal | `kind: "renewal"`, `existing_service_id`, `brief`, optional `request_payment_link: true`. Renewal requests are for one year. Billing access is required to request a payment link, which can be added to a renewal already in review and is queued when Admin issues the invoice. |
| `request`, hosting upgrade | `kind: "hosting_upgrade"`, `existing_service_id`, `requested_plan_id`, `brief`. |
| `request`, email scale | `kind: "email_scale"`, `existing_service_id`, `requested_quantity`, `brief`. Quantity is the new total. |
| `accept_quote` | `id` (order UUID), `quote_id` (latest unexpired quote UUID). Requires billing access. |
| `payment_link` | `id` (issued invoice UUID). Creates or reuses an open payment-link request for the outstanding invoice. |
| `ticket` | `subject`, `department`, `priority`, `body`, optional `service_id`. |
| `ticket_status` | `id` (ticket UUID) and `status` (`closed` or `open`). Requires support access to the ticket's company. |
| `reply` | `id`, `collection` (`orders` or `tickets`), `body`. |

Requests return JSON errors with an `error` string. Common statuses include 400 for invalid data, 401 for an invalid sign-in or expired session, 403 for a role or origin restriction, 404 for an unavailable account or record, 409 for a workflow conflict, and 429 for rate limits. Monetary database values use AED and retain PostgreSQL precision in API strings where selected directly. Prices and proration are server-calculated. Staff controls issuance and verified settlement.
