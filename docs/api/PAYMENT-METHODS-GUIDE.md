# Payment Methods — Front-End Guide

**Backend:** plugin 1.5.0 + app from 2026-09-01. Per-clinic gate: plugin 1.7.0 + app from 2026-10.
**Spec:** `docs/superpowers/specs/2026-09-01-paypal-payment-design.md`,
`docs/superpowers/specs/2026-10-06-international-clinic-payment-design.md`

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

## International clinics only (plugin 1.7.0)

`paypal` and `card` are accepted **only for a clinic flagged International**. Every other
clinic takes `xendit` only. The backend enforces this; the FE only hides the buttons.

Each international clinic has its own rate (rupiah per 1 USD), percentage markup and fixed
rupiah fee, edited through `GET`/`PUT /api/v1/practices/{id}/payment-settings` (see
[`PRACTICES-AND-SERVICES-GUIDE.md`](PRACTICES-AND-SERVICES-GUIDE.md) §4.16). Xendit is
unchanged for every clinic: rupiah, no markup, no fee.

**Where the FE reads what to offer.** Never decide from a clinic's `international` flag
(it is for an admin badge) — use these fields:

| Response | Fields | Use them for |
| --- | --- | --- |
| `GET /public/professionals/{id}/services`, each row | `clinicId`, `paymentMethods`, `usd` | the price shown and the method picker |
| `POST /public/appointments` (201, and the 200 idempotent replay) | `paymentMethods`, `usd` | the success screen's pay buttons — authoritative |
| `GET /public/appointments/{token}` | `paymentMethods`, `usd` | the same, after a reload |
| `GET /public/practices`, `GET /public/practices/{id}` | `paymentMethods` | the clinic page |

A missing `paymentMethods` (an older backend) means `["xendit"]`. If the method the patient
picked earlier is not in the booking's `paymentMethods`, reset it before calling pay.

`usd` is `null` or:

```json
{ "price": "12.23", "taxes": [{ "name": "PPN", "amount": "1.35" }], "fee": "1.39", "total": "14.97" }
```

- Every amount is a 2-decimal string. `fee` is the "International service fee" line, `null`
  when the clinic has no fixed fee.
- `usd` is set only when the clinic is international, a usable rate exists and the row costs
  more than Rp 0.
- When it is set, show the USD figure as the main price with the rupiah `price` small
  underneath. For PayPal or card the summary shows these lines; for Xendit it shows rupiah.
- **Never convert currency in the FE.** Every USD figure comes from the backend, computed by
  the same function that builds the charge. If the rate changes between display and payment,
  the patient pays at the new rate; the final amount is always the one on PayPal's own page.

**Book into the row's clinic.** A service id repeats across a professional's clinics. Send the
selected row's `clinicId` in `POST /public/appointments` and to `/public/booking/slots`;
otherwise the booking can land in another clinic and be charged differently from what was shown.

Worked example (rate 18,000, markup 10 %, fee Rp 25,000, service Rp 200,000): the service is
`ceil(200000 × 110 / 18000)` = 1,223 cents → `12.23`, the fee `ceil(25000 × 100 / 18000)` =
139 cents → `1.39`, total `13.62`.

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

## Errors

Both payment routes answer coded `problem+json` (`{ type, title, status, code, detail }`).
Branch on `code`, never on the status alone:

| Status | `code` | Meaning | Show the patient |
| --- | --- | --- | --- |
| 403 | `payment_method_not_allowed` | `paypal`/`card` on a clinic that is not international, or on a free booking | "Metode ini tidak tersedia untuk klinik ini", then the valid methods |
| 503 | `paypal_rate_missing` | International clinic with no usable rate. This includes a global markup or rate that is set but unusable (e.g. `1e1`): it is never read as "not set", it voids the rate and is logged | "PayPal sementara tidak tersedia, silakan pakai Xendit" |
| 503 | `payment_method_unavailable` | The PayPal gateway is not available in WooCommerce | same as above |
| 503 | `payment_settings_unavailable` | The clinic settings could not be read — retryable | a retry message |
| 503 | `payment_unavailable` | WordPress/WooCommerce unreachable — retryable | a retry message |
| 502 | `charge_mismatch` | The order total differed from the quote; no order was kept | a retry message |
| 502 | `payment_start_failed`, `payment_gateway_rejected` | Any other failure while starting the payment | a retry message |
| 422 | `discount_not_supported` | Staff route only: `paypal`/`card` on a bill with a discount | pay that bill with Xendit |

None of these is a 409, so the existing 409 branches (`payment_already_initiated`,
`appointment_not_pending`) are unaffected. The 503 configuration codes
(`paypal_rate_missing`, `payment_method_unavailable`) carry no `Retry-After`.

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
