# Safcodes Customer Portal v4

This package adds a live Next.js customer workspace to the existing Safcodes React Admin, Node API, and PostgreSQL database. Keep using the Admin project and database you already set up. The ZIP contains a fresh customer frontend in `portal` and a small overlay for the Admin project in `admin-update`.

## Update an existing v4 installation

Stop Next.js and the Admin Node API with **Ctrl+C** in their respective windows. Extract this ZIP to a separate folder. Update both apps together. The customer portal shows a notice when it detects an older Admin API, which may be missing prices or newer actions.

This release uses the existing schema. If you skipped the previous update, check for `005_customer_preferences` in the database named by `PGDATABASE` in the Admin API `.env`.

```sql
SELECT current_database(), version, installed_at
FROM safcodes.schema_versions
WHERE version = '005_customer_preferences';
```

If no row appears, back up the database and run `admin-update/database/11_customer_preferences.sql` in pgAdmin as the database owner. It requires `004_customer_portal`.

Open **PowerShell** in the extracted `Safcodes_Customer_Portal_Live` folder, where `portal` and `admin-update` are visible. Back up any files you have customised before replacing them. Adjust the destinations if you installed the projects elsewhere.

```powershell
$portal = 'D:\www\SafcodesPortal-v4'
$admin = 'D:\www\Safcodes_Admin_Live'

if (-not (Test-Path (Join-Path $portal 'src\Portal.jsx')) -or -not (Test-Path (Join-Path $admin 'api\lib\customer-workspace.mjs'))) {
  throw 'Check both folder paths before copying the v4 update.'
}

Copy-Item .\portal\src\* -Destination (Join-Path $portal 'src') -Force
Copy-Item .\portal\app\live.css -Destination (Join-Path $portal 'app') -Force
Copy-Item .\admin-update\* -Destination $admin -Recurse -Force
```

Keep your existing `api\.env` and `.env.local`. Before starting the API, check `TAX_RATE` as described below and confirm that `SAFCODES_API_ORIGIN` in the customer `.env.local` points to this Admin API. Rebuild Admin to make the **Link requested** filter available.

```powershell
Set-Location D:\www\Safcodes_Admin_Live
npm run build
npm --prefix api start
```

Start Next.js in a second PowerShell window.

```powershell
Set-Location D:\www\SafcodesPortal-v4
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). If your setup uses a different URL, open the exact origin in `CUSTOMER_ORIGIN` from the API `.env`, including its hostname and port. Follow steps 1–4 below if you are installing the live portal for the first time.

## Prices and VAT

The portal separates the plan amount, VAT and the total. Set `TAX_RATE=0.05` in the Admin API `.env` if the standard 5% UAE VAT rate applies to the amounts you are testing. A rate of `0` adds no VAT. Restart the API after editing the file. [Federal Tax Authority VAT FAQ](https://tax.gov.ae/en/faq.aspx?keyword=What+is+the+standard+rate+of+VAT+in+the+UAE%3F)

For catalogue prices that already represent the amount before VAT, select **VAT added to amount** under **Catalogue → Product plans → Edit plan**. A legacy plan stored as AED 105 including VAT displays AED 100 before VAT, AED 5 VAT and AED 105 total at a configured rate of 0.05. Existing subscriptions keep their recorded rates. Issued invoices and accepted quotes keep their recorded subtotals, VAT and totals.

## Renewals and payment links

**Past Due** shows expired terms. **30 Days** includes today through day 30. **90 Days** includes today through day 90. The expiry badge turns red at 30 days or less, including overdue items.

For an issued invoice with a balance, choose **Request Payment Link** in the customer portal. The request is stored in PostgreSQL and appears in **Invoices & Payments → Link requested** and the notification inbox in Admin. Open the invoice and select **Manage payment link** to save the approved HTTPS URL. The hostname must be listed in `PAYMENT_LINK_HOSTS` in the Admin API `.env`. Refresh the customer workspace to see **Pay Now**. For a renewal awaiting an invoice, the request appears on the renewal order and enters the invoice queue when staff issues the invoice.

## Optional saved-card test setup

**Billing → Payment methods** is available for account owners once you enable and link a Stripe test customer. Use a test account with synthetic customer data. Stripe's hosted page handles adding and removing test cards, and Safcodes stores only the linked test customer reference. The existing Safcodes invoice payment links continue to use their configured provider.

1. In your Stripe sandbox, create a test customer and a [customer portal configuration](https://docs.stripe.com/customer-management/configure-portal) that enables payment method updates. Disable the configuration's other editing, invoice history, and subscription features if it is for card management only.
2. Add the following settings to the Admin API's local `.env`, with your real test values. The API accepts test keys only for this feature. A restricted key needs permission to create billing portal sessions.

```dotenv
STRIPE_TEST_SECRET_KEY=sk_test_REPLACE
STRIPE_TEST_PORTAL_CONFIGURATION=bpc_REPLACE
```

3. In pgAdmin, link the Stripe `cus_…` ID to the intended rehearsal customer. Replace both values before running this statement.

```sql
UPDATE safcodes.customers
SET stripe_test_customer_id = 'cus_REPLACE'
WHERE customer_no = 'CUS-REPLACE';
```

4. Restart the API and sign in as the test customer's company account owner. Open **Billing → Payment methods → Manage cards**. Use Stripe's test card numbers in the hosted page. To disable the integration, remove both settings from `.env` and restart the API.

## Optional sample data for Securemax Solutions

1. Check `PGDATABASE` in `D:\www\Safcodes_Admin_Live\api\.env` and back up that local rehearsal database. The scripts are set to `safcodes_admin_v2_rehearsal`. If your local rehearsal database has a different name, update `target_database` in both SQL files before running them.
2. In pgAdmin, open **Query Tool** on the rehearsal database as its owner. Use **Open File** to load `sample-data/01_add_customer_preview.sql` and execute the entire file. The script checks for the existing customer `CUS-24B9AF17A500` and its active `ameenmnr@gmail.com` login. It requires the current seeded Safcodes catalogue. Running it again leaves the sample records in place.
3. Sign in as the existing customer and refresh the dashboard. The sample records include two domains, shared and cloud hosting, Microsoft 365, Google Workspace, website and store projects, digital marketing, an AMC agreement, a pending order, a ticket, and two unpaid invoices.
4. Open **Domains** and use the action menu to renew the `safcodes-preview-….example` domain. Choose **Request payment link**. The order appears in Admin, and issuing its renewal invoice also queues a link request. The `safcodes-renewal-….example` domain already has an unpaid renewal invoice for testing the invoice path. Open **AMC / SLA** to review the seeded overdue instalment and request a link for its invoice. **Pay now** becomes available after an approved payment link is added in Admin.
5. To remove the preview records, open `sample-data/02_remove_customer_preview.sql` and run it with `apply_changes` set to `false`. Check the counts in **Messages**, change `apply_changes` to `true`, then run the full file again. It keeps the customer login and refuses cleanup when scoped records have quotes, recorded payments, credits, or mixed references. Restore your rehearsal backup if you need to undo further workflow changes made during testing.

## 1. Back up and upgrade the rehearsal database

1. Stop the Admin API with **Ctrl+C** in its PowerShell window.
2. Back up the database from pgAdmin. Use the same database specified by `PGDATABASE` in `D:\www\Safcodes_Admin_Live\api\.env`.
3. In pgAdmin, open **Query Tool** on that database as its owner. Use **Open File** to run `admin-update/database/10_customer_portal.sql` and then `admin-update/database/11_customer_preferences.sql`. The first file requires `003_admin_api`. Both can be run again safely.
4. Verify the result.

```sql
SELECT current_database() AS database_name, version, installed_at
FROM safcodes.schema_versions
WHERE version IN ('004_customer_portal','005_customer_preferences')
ORDER BY version;
```

Expect two rows. The upgrade inserts no customer samples.

## 2. Update your existing Admin project

Back up your Admin source if you have made local edits. If you customised an included file, compare the two copies before replacing it. Run the following from the **extracted** `Safcodes_Customer_Portal_Live` folder in PowerShell. Adjust the paths if your folders differ.

```powershell
$admin = 'D:\www\Safcodes_Admin_Live'
$portal = 'D:\www\SafcodesPortal-v4'

if (-not (Test-Path (Join-Path $admin 'api\lib\http.mjs'))) {
  throw 'Set $admin to the existing live Safcodes Admin folder.'
}
if (Test-Path $portal) {
  throw 'Choose a new folder for the v4 customer portal.'
}

Copy-Item .\admin-update\* -Destination $admin -Recurse -Force
Copy-Item .\portal -Destination $portal -Recurse
```

The overlay includes the customer API, Admin screens, migrations and an integration test. Your current `api/.env`, `api/.local-mail`, and database connection settings are outside the overlay.

Add the following lines to the existing `D:\www\Safcodes_Admin_Live\api\.env` file. Edit any matching lines that already exist. Keep your existing `AUTH_SECRET`, `PG*`, Admin port, and Admin `PUBLIC_ORIGIN`.

```dotenv
CUSTOMER_ORIGIN=http://127.0.0.1:3000
CLIENT_INVITE_MODE=setup_link
MAIL_MODE=preview
```

If you want to use the current Admin UI for renewal requests and see the extra request fields, rebuild it once. In the Admin folder run:

```powershell
cd D:\www\Safcodes_Admin_Live
npm ci --include=optional
npm run build
npm --prefix api start
```

Keep that PowerShell window open. Admin normally runs at `http://127.0.0.1:5173`. The existing `npm start` in the Admin root runs the static demo.

## 3. Start the new customer frontend

Open a second PowerShell window. Use Node.js 22.13 or later.

```powershell
cd D:\www\SafcodesPortal-v4
Copy-Item .env.local.example .env.local
npm ci
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Use that exact host and port so browser requests match `CUSTOMER_ORIGIN`. If Admin runs on a different port, set `SAFCODES_API_ORIGIN` in the frontend's `.env.local` to the same value as the Admin API's `PUBLIC_ORIGIN`. If the customer port must change, update `CUSTOMER_ORIGIN` and start Next with `npm run dev -- --port 3001` or your chosen port. Restart the affected processes after changing environment variables.

For a local production-mode check, stop Next dev and use `npm run build` followed by `npm start` from the customer project. Next runs a server-side proxy, so keep the existing Node API running alongside it.

## 4. Test customer access and email

1. In the live Admin, create an active client with a test email or use an existing test client. Open that client's details and click **Approve & create access**. The registered portal email is used, with billing email as fallback.
2. Open the newest **Safcodes client access** message in `D:\www\Safcodes_Admin_Live\api\.local-mail\`. Sort by **Date modified**. Open the `.eml` in your mail app or use the body in a text editor.
3. In the default mode, follow the customer-portal link and enter the invitation code. Set and confirm a password of at least 12 characters. The invitation is single use and expires in 24 hours. When it expires, issue another invitation from the client details.
4. Sign in at the customer URL with the registered email and new password. Open the new **Safcodes customer sign-in code** email in the same folder and enter its six-digit code within five minutes. Customer accounts with multiple active memberships can switch companies after signing in.
5. Assign the test client a product or contract in Admin. Refresh the customer dashboard to see it. Submit a request from the customer portal and open it in Admin. Update its review status, issue a quote, accept the quote from the customer account, then issue the invoice from Admin. Refresh the customer portal and verify the invoice appears.
6. With `PAYMENT_LINK_HOSTS` set to the exact hostnames Safcodes approves, an Admin-entered HTTPS link appears under **Pay now** on the issued invoice. A link request appears in Admin until staff adds one. The portal reflects verified payments recorded in Admin. It does not charge a card, call a gateway, or mark an invoice paid when a link is opened.

### Optional local temporary passwords

Set `CLIENT_INVITE_MODE=temporary_password` with `MAIL_MODE=preview` and restart the API. Then approve a new test client. The generated password is in the local **Safcodes client access** email. The customer signs in with that password, receives a separate six-digit **Safcodes first sign-in code**, and must choose a new password before getting access. Temporary passwords expire in 24 hours, are hashed in PostgreSQL, and are replaced on setup. Local preview messages contain sensitive credentials or codes. Keep this folder private and remove the test emails when finished.

For actual customer onboarding, use the default `setup_link` mode. For a browser-based local inbox, run Mailpit on loopback with its web port 8025 and SMTP port 1025. Use default invitation mode with these API settings:

```dotenv
CLIENT_INVITE_MODE=setup_link
MAIL_MODE=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_REQUIRE_TLS=false
```

Open [Mailpit's local inbox](http://127.0.0.1:8025). Bind both Mailpit listeners to loopback. For real customer email, configure your own authorized SMTP sender and TLS settings. Browser and API endpoints in this package bind to loopback for local use.

## Day-to-day workflows

| Customer portal | Admin |
| --- | --- |
| Annual renewals and expiry dates | Open the renewal request or service and issue the one-year renewal invoice. If the customer asked for a payment link, issuance queues the request. The expiry advances after full payment is verified. |
| Shared and cloud hosting upgrades, business email license increases | Review the server-prorated request, issue a quote, and invoice it after acceptance. Verified settlement applies an eligible change to the existing subscription term. |
| Domain, hosting, business email, project and marketing requests | Use the live catalogue and its prices. Track product orders and service requests in Orders & Requests. |
| AMC / SLA, retainers and projects | View agreements and project details. **Request AMC Contract** opens an order tied to the selected service. |
| Quotes, invoices and payment links | Publish quotes, issue approved invoices, review **Link requested**, save the payment link and record a verified receipt. |
| Support and request conversations | Customers can close and reopen tickets. Use customer-visible notes to reply. Internal notes stay in Admin. |

See [Customer API](docs/CUSTOMER_API.md) for endpoints and request shapes. To run the PostgreSQL integration tests from the Admin folder after copying the overlay:

```powershell
npm --prefix api ci
node --test .\api\test\customer.test.mjs
```

The test creates a disposable PostgreSQL fixture using PGlite and sends only test mail to an in-process capture.

## Validation

The Admin and customer HTTP tests passed against a disposable PostgreSQL fixture with the Safcodes migrations and restricted worker role. The browser journey covered invitation and OTP sign-in, the dashboard, all product and service views, renewal windows, VAT and proration, AMC requests, support, quotes, invoices, and sign-out. It verified that a customer payment-link request appears in the Admin queue, that the link saved in Admin appears for the customer, and that a verified receipt settles the invoice. The checkout page was simulated.

The browser checks also covered the older API response, both agreement layouts, profile photo upload, and layout and navigation at 390 px.
