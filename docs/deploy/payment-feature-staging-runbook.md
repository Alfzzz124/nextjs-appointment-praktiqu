# Payment feature (Xendit via WooCommerce) — staging deploy runbook

Consolidates the steps scattered across `docs/deploy/staging-schema-2026-07-14-payment-orders.sql`, `.env.example`, and the `praktiqu-endpoint` plugin readme into one checklist. Staging deploy itself is out of scope for the implementation work (see the design spec's "Out of scope" section) — this runbook is what to follow *when* that deploy happens.

## 1. Apply the `payment_orders` table

```bash
mysql -h <staging-host> -u <user> -p <staging-db> < docs/deploy/staging-schema-2026-07-14-payment-orders.sql
```

Never run `prisma migrate deploy` / `prisma db push` against this database — see the SQL file's own header for why (shared schema with the live WordPress `wp_*` tables).

## 2. Set `PAYMENT_WEBHOOK_SECRET` on the Next.js app

Per the staging deploy mechanics (`.htaccess` `SetEnv`, not a `.env` file):

```apache
SetEnv PAYMENT_WEBHOOK_SECRET "<generate-with-openssl-rand-base64-32>"
```

This secret is **separate** from `AUTH_SECRET` and `WORDPRESS_WEBHOOK_SECRET` — do not reuse either.

## 3. Configure the payment webhook in WordPress admin

**Settings → PraktiQU Endpoint** (added by this feature, alongside the existing general webhook fields):

- **Payment Webhook URL**: `https://<staging-host>/api/v1/sessions/payment-webhook`
- **Payment Webhook Secret**: the exact same value set in step 2.

This is a separate URL/secret pair from the plugin's general webhook fields (used for password/user-lifecycle events) — do not point both at the same secret.

## 4. Confirm WooCommerce + the Xendit gateway are active

- WooCommerce plugin active.
- Xendit WooCommerce gateway plugin installed, active, and configured with valid API keys (test-mode keys for staging).
- Xendit invoice expiry set to **1 hour**, matching this feature's auto-cancel window (`AUTO_CANCEL_MS` in `src/services/payments/payment.service.ts`) — a mismatch here means either a payment could complete after PraktiQU has already released the slot, or a slot stays held longer than the customer's Xendit invoice is actually valid for.

## Smoke test after deploy

Don't just check `GET /wp-json/praktiqu/v1/health` — that only confirms the plugin boots, not that the payment wiring works. At minimum:

1. Create a real appointment through the public booking flow, then call `POST /api/v1/public/payments` for it and confirm a real WooCommerce order + checkout URL come back (`praktiqu_appointment_id` meta present on the WC order — check via wp-admin or `wc_get_order()`).
2. Manually complete that order in WooCommerce (or use Xendit's test-mode instant-pay), and confirm the webhook fires and the appointment transitions `PENDING → BOOKED` in PraktiQU.
3. Create a second test order and manually cancel it in wp-admin, and confirm the appointment transitions `PENDING → CANCELLED` (this exercises the `payment.expired`-on-cancel path, not just the 1-hour auto-cancel job — see `Payments::on_order_status_changed()`).

A curl-created WC order with no `praktiqu_*` meta will *not* exercise any of this — `is_praktiqu_order()` will correctly ignore it, which is expected behavior, not a smoke-test pass.
