# Payment Methods — Front-End Guide

**Backend:** plugin 1.5.0 + app from 2026-09-01.
**Spec:** `docs/superpowers/specs/2026-09-01-paypal-payment-design.md`

## What changed

Both payment-initiation endpoints now accept an optional `method`. Omitting it keeps
today's behaviour exactly, so **no front-end change is required to keep working**.

| method | Charged in | Patient sees |
| --- | --- | --- |
| `xendit` (default) | IDR | Xendit hosted page: VA, QRIS, e-wallets |
| `paypal` | USD | PayPal hosted page, opening on the PayPal login |
| `card` | USD | The same PayPal page, opening on the debit/credit card form |

`paypal` and `card` reach the same PayPal page; they differ only in which form it opens
on. A payer with no PayPal account can pay by card on either.

## Not available

Card fields rendered inside our own pages, Apple Pay, Google Pay, and PayPal Fastlane all
require PayPal's Advanced Card Processing, for which **Indonesia is not eligible**. These
are unavailable, not merely unbuilt — do not design UI that assumes them.

## Requests

```http
POST /api/v1/public/payments
Content-Type: application/json

{ "token": "<appointment token>", "method": "card" }
```

```http
POST /api/v1/sessions/payment-verify
Authorization: Bearer <jwt>
Content-Type: application/json

{ "billId": "9", "method": "paypal" }
```

`method` is one of `xendit` | `paypal` | `card`. Anything else is **400** — including an
explicit `null`, which is not the same as omitting the key. Omit the key entirely to get
the `xendit` default; a `null` is rejected. Nothing is silently defaulted, because falling
back to Xendit would charge rupiah for a payment the patient chose to make in dollars.

## Responses

`POST /public/payments` → **201**

```json
{
  "data": {
    "checkoutUrl": "https://www.paypal.com/checkoutnow?token=...",
    "chargedAmount": 11.12,
    "chargedCurrency": "USD"
  }
}
```

The status endpoints (`POST /public/payment-verify`, `/sessions/payment-success`,
`/sessions/payment-cancel`) return `chargedAmount` and `chargedCurrency` alongside the
existing `status` and `expectedAmount`.

## Displaying the amount — please read

`expectedAmount` is **always integer rupiah**. It is the clinic's internal figure and is
**not** what a PayPal payer was billed.

Show `chargedAmount` formatted by `chargedCurrency`:

- `IDR` → `Rp 200.000` (no decimals)
- `USD` → `$11.12` (2 decimals)

Showing `expectedAmount` on a PayPal payment displays a rupiah number the patient never
saw on their statement.

## Redirect behaviour

- **Success** → the `returnUrl` the backend supplied; the patient lands back on the
  front-end.
- **Failure or cancel** → the **WooCommerce checkout page**, not the front-end. Both the
  Xendit and PayPal plugins hardcode this and neither exposes a filter. Known technical
  debt, unchanged by this work. Keep polling `/public/payment-verify`; an unpaid
  appointment auto-cancels after 1 hour regardless.
