# International Clinic Payment Settings — Design

**Date:** 2026-10-06
**Status:** Approved section by section (user, 2026-10-06). Revised 2026-10-07 after an
adversarial review (36 confirmed findings, merged here). Awaiting review of this written spec.
**Builds on:** `2026-09-01-paypal-payment-design.md`,
`2026-07-14-appointment-payment-xendit-woocommerce-design.md`

## Problem

PayPal and card payments already work. They are charged in USD through WooCommerce PayPal
Payments, which `praktiqu-endpoint` drives server-side. But every setting is global and
nothing is gated:

- The FX rate and markup are two global WP options,
  `praktiqu_endpoint_paypal_idr_rate` and `praktiqu_endpoint_paypal_markup_percent`. They can
  only be edited in wp-admin (Settings → PraktiQU Endpoint).
- Any clinic can be paid with `xendit`, `paypal` or `card`. The API routes accept all three
  for every clinic, and the Laravel booking page always shows all three.
- The payment chain does not carry the clinic. `CreateWcOrderInput` has no `clinicId`, although
  Next.js knows it (`appt.clinicId`, `bill.clinic.id`).

The product wants a per-clinic **International** flag:

- Only an international clinic accepts PayPal and card.
- Each international clinic has its own exchange rate, percentage markup and fixed additional
  fee.
- These settings are edited from the Laravel front-end.
- An international clinic's booking page shows prices in USD from the first render.

## Decisions (made by the user during brainstorming, 2026-10-06)

| # | Question | Decision |
|---|---|---|
| 1 | Where to store the settings | One `wp_options` row per clinic. `wp_postmeta` cannot be used: clinics are rows in `wp_kc_clinics`, not `wp_posts`, so there is no post id to attach meta to |
| 2 | Clinic values vs the global ones | The clinic value overrides. An empty clinic field falls back to the global value. With neither, PayPal and card fail closed |
| 3 | Shape of the additional fee | A percentage markup **and** a fixed fee |
| 4 | Currency of the fixed fee | Rupiah, converted with the clinic's rate. It is one separate line per order and does **not** get the markup |
| 5 | Methods offered | International clinic: `xendit`, `paypal` and `card`. Other clinics: `xendit` only. The backend enforces this; the FE only hides the buttons |
| 6 | Who may edit | `SUPER_ADMIN` for any clinic. `CLINIC_ADMIN` for their own clinic only. Not receptionists |
| 7 | Showing USD before checkout | Yes. International clinics show USD from the first render |
| 8 | Price format on the booking page | USD is the main figure, with rupiah small underneath. The summary follows the chosen method |
| 9 | Where the conversion is computed | Next.js only (approach A). One TypeScript function produces both the displayed and the charged USD amounts. The plugin builds the WooCommerce order from the finished lines |

Defaults accepted without objection:

- **USD only.** "Kurs" means rupiah per 1 USD. Other currencies are a separate project.
- **No global fixed fee.** An empty clinic fee means Rp 0. Only the rate and the markup have
  global values.
- **The staff bill flow** (`POST /api/v1/sessions/payment-verify`) gets the same backend gate.
  No FE UI is added for it.
- **Disbursement is unchanged.** Every order records the clinic id and the values used, so a
  later settings change cannot rewrite history.
- **KiviCare's own booking widget is out of scope.** Its native PayPal gateway sends rupiah
  unconverted. That is tracked separately.

## 1. Storage

### The option

There is one option per clinic, written with `autoload = no`. Its name is
`praktiqu_endpoint_clinic_{clinicId}_payment`, and its shape is:

```json
{
  "international": true,
  "fx_rate": 16500,
  "markup_percent": 10,
  "fixed_fee_idr": 25000,
  "updated_at": "2026-10-06T08:00:00Z",
  "updated_by": 123
}
```

| Key | JSON type | Meaning |
|---|---|---|
| `international` | boolean | The flag |
| `fx_rate` | number or null | Rupiah per 1 USD. `null` means use the global rate |
| `markup_percent` | number or null | 0–100. `null` means use the global markup |
| `fixed_fee_idr` | integer or null | `null` or `0` means no fixed fee |
| `updated_at` | ISO-8601 UTC string | Stamped by the plugin |
| `updated_by` | integer or null | `wp_users.ID` of the editor, as sent by Next.js. `null` when the editor's `users` row has no WordPress link |

**Encoding: the stored value is a JSON string, never a PHP array.**

- The plugin writes `update_option($key, wp_json_encode($data), false)`.
- Every reader decodes JSON. The plugin uses `json_decode((string) get_option($key, ''), true)`;
  Next.js uses `JSON.parse(KcOption.optionValue)`.
- If the plugin passed an array instead, WordPress would `maybe_serialize()` it to `a:6:{…}`.
  Next.js cannot parse that. Under rule 4 every clinic would then silently become not
  international. A value that starts with `a:` is therefore treated as malformed and logged as
  `clinic_payment_option_serialized`.
- Keys are snake_case in storage. The Next.js API uses camelCase and maps between the two.
- Next.js converts numbers with `new Prisma.Decimal(String(n))`.

**Why this store:**

- It is where the global rate and markup already live.
- KiviCare already uses the same pattern for itself
  (`kivicare_clinic_notifications_enabled_{id}`).
- KiviCare never writes these keys. `wp_kc_clinics.extra`, by contrast, gets overwritten:
  saving a currency prefix in KiviCare's General Settings replaces the default clinic's whole
  `extra` (`SettingsController/General.php`, the `clinic_currency` block).
- There is no DDL, no new table and no Prisma schema change. `payment_orders` stays as it is.
- Each clinic has its own key, so saves on two clinics at the same time cannot overwrite each
  other.

### Validation

These rules are checked when a value is **written** (zod `.strict()` in Next.js, then again in
the plugin) and again when it is **read** (in `resolveClinicPayment`).

| Field | Rule |
|---|---|
| `international` | Boolean, required |
| `fxRate` | `null`, or a number from 1,000 to 100,000 with at most 2 decimals. The range rejects an inverted or mistyped entry, such as 0.00006, or "16.500" read as 16.5 |
| `markupPercent` | `null`, or a number from 0 to 100 with at most 2 decimals |
| `fixedFeeIdr` | `null`, or an integer from 0 to 10,000,000 |
| cross-field | `international: true` requires a **usable rate**, from the clinic or from the global option. Otherwise the save is rejected with 422 `fx_rate_required`. When `international` is false, the rate fields are validated but not required |

A **usable rate** is a number from 1,000 to 100,000. This applies to the clinic value and to the
global fallback alike.

### Resolution rules

The rules live in one Next.js function, `resolveClinicPayment(clinicId)`:

1. **The option is missing, or `international` is false.** `international` is false, methods
   are `['xendit']`, and prices are shown in rupiah.
2. **`international` is true.**
   - The rate is the clinic's `fx_rate` if it is usable, otherwise the global
     `praktiqu_endpoint_paypal_idr_rate` if that is usable.
   - The markup is the clinic's `markup_percent`, otherwise the global markup, otherwise 0.
   - The fee is the clinic's `fixed_fee_idr`, otherwise 0.
   - The function records where each value came from: `clinic`, `global` or `default`.
3. **`international` is true, but no rate is usable.** The clinic and global rates are both
   missing or outside 1,000–100,000, or the global markup that would be used is outside 0–100.
   `international` **stays true** in the result, which is what lets the payment gate return
   503 instead of 403. Methods are `['xendit']` and there is no USD display. Any out-of-range
   value is logged.
4. **The option cannot be used.** The JSON is unparseable or PHP-serialized, or a stored
   clinic field fails validation. The clinic is treated as not international, and the problem
   is logged. The function never falls back silently to the global values.
5. **The read itself fails** (a database error). Display paths treat the clinic as rule 1 and
   log the error. The payment gate does **not**: it returns a retryable 503, as described in §2.

### Write and read paths

**Write:** FE → `PUT /api/v1/practices/{id}/payment-settings` (Next.js) →
`PUT /praktiqu/v1/clinics/{id}/payment-settings` (plugin, with the service token) →
`update_option`.

- The plugin PUT body uses the storage keys:
  `{ international, fx_rate, markup_percent, fixed_fee_idr, updated_by }`.
- Next.js sets `updated_by` from the actor's `User.wpUserId`, or `null` when that is empty.
  It does not use `resolveKcActor`, which skips SUPER_ADMIN and returns 403 for an account with
  no WordPress link.
- The plugin never uses `get_current_user_id()`, which is always 0 on a service-token request.
- Writing through WordPress keeps any object cache consistent.
- A PUT replaces the clinic's whole object.

**Read:** Next.js reads `wp_options` directly through the existing `KcOption` model. That
covers the per-clinic option and both global options.

**Audit:** Next.js calls
`logging.audit('clinic.payment_settings.updated', { userId: actor.id, resource: 'clinic', resourceId: String(clinicId), metadata: { wpUserId, before, after } })`.

- This writes a `log_entries` row with level AUDIT, the same way `practice.update` is logged.
- `userId` is the caller's `users.id` (a cuid), never `wp_users.ID`. `log_entries.userId` is a
  foreign key to `users.id`, and `logging.write` swallows insert errors, so a wrong id would
  drop the row silently.
- `audit_logs` is not used. Its `eventType` is a closed enum, and adding a value would be DDL.
- The permanent record of each charge is the WooCommerce order meta snapshot (§4).

**Cleanup:** an option left behind by a deleted clinic does no harm. `uninstall.php` gets a
delete for `LIKE 'praktiqu_endpoint_clinic\_%\_payment'`.

## 2. Pricing module and payment flow

### `src/services/payments/intl-pricing.ts` (new)

**`resolveClinicPayment(clinicId)`** returns
`{ international, methods, rate, markupPercent, fixedFeeIdr, source }` and follows the rules in
§1. On a database error it throws `PaymentSettingsUnavailableError`. Display callers catch this
and apply rule 5.

**`buildUsdQuote(itemsIdr, taxesIdr, settings)`** returns the USD lines, or `null` when the
order is free.

- **Item lines.** Every rupiah item becomes exactly one item line, even when it converts to
  0.00. This keeps the lines matched 1:1 with the rupiah `items`.
  `cents = ceil(idr × (100 + markup) / rate)`.
- **Tax lines.** A tax line with an amount ≤ 0 is skipped, as the plugin skips it today. Every
  other tax line uses the same formula as an item line.
- **Fixed fee.** One line named **"International service fee"**, without the markup:
  `cents = ceil(feeIdr × 100 / rate)`. It is left out when the fee is 0.
- **Free orders.** If items plus taxes come to Rp 0 or less, the function returns `null`. A
  free order is never charged in USD and never gets the fee on its own. It keeps going through
  the existing free path.
- **Arithmetic.** Use `Prisma.Decimal`, not floats. Decimal division rounds to 20 significant
  digits, so the order of operations is fixed: every multiplication first, then exactly one
  division, then `ceil`. For example:
  `new Decimal(idr).mul(new Decimal(100).plus(markup)).div(rate).ceil()`.
  Do **not** port the plugin's `(idr / rate) × (1 + markup/100) × 100` order. Dividing first
  can push an exact amount up by a cent: Rp 90,000 at a rate of 16,500 with 10% markup gives
  601 cents instead of 600. With a single division the result is exact for every input §1
  allows. The rounding policy is the same as the plugin's `Money::idr_to_foreign`: ceiling per
  line, with the markup inside the ceiling.
- **Output.**
  - `lines[]`: each has a kind (`item`, `tax` or `fee`), a name, the rupiah amount and the USD
    amount.
  - `totalUsd`.
  - `expectedIdr`: items plus taxes, **excluding** the fee. For a public booking this is what
    the clinic is owed.
  - `effectiveFxRate`: `rate / (1 + markup/100)`. This has the same meaning as
    `payment_orders.fxRate` today and does not account for the fee.
  - `snapshot`: the clinic id, rate, markup and fee, and where each came from.
  - Every USD amount is a 2-decimal string produced by `Decimal.toFixed(2)`.

**Worked example** (rate 18,000, markup 10%, fee Rp 25,000, service Rp 200,000):

| Line | Computation | USD |
|---|---|---|
| Service | ceil(200000 × 110 / 18000) = ceil(1222.2…) = 1223 cents | 12.23 |
| International service fee | ceil(25000 × 100 / 18000) = ceil(138.8…) = 139 cents | 1.39 |
| **Total** | | **13.62** |

**Golden vectors.** These come from the 2026-09-02 sandbox run and must be reproduced exactly:

| Rupiah | Rate | Markup | USD |
|---|---|---|---|
| 800,000 | 18,000 | 10% | 48.89 |
| 900,000 | 18,000 | 10% | 55.00 |
| 200,000 | 18,000 | 10% | 12.23 |
| 200,000 | 18,000 | 0% | 11.12 |
| 90,000 | 16,500 | 10% | 6.00 (a divide-first implementation would give 6.01) |

### The payment gate

The gate runs only for `paypal` and `card`, and only when a **new** order is about to be
created. It runs after the rupiah amounts are computed, because it needs them to recognise a
free order. Existing checks keep their current order and behaviour: appointment status, an
existing pending order (`PaymentAlreadyInitiatedError`), and staff reuse of a pending order.
The gate is evaluated in this order, before any WooCommerce order exists:

1. **The settings read throws.** Return 503 `payment_settings_unavailable`, which the client
   may retry. A temporary database error must not look like a permanent "not allowed".
2. **The clinic is not international, or the order is free** (`buildUsdQuote` would return
   `null`). Return **403 `payment_method_not_allowed`**.
3. **The clinic is international but has no usable rate** (rule 3). Return 503
   `paypal_rate_missing`.

The gate checks the flag, the rate and the amount. It never checks `methods`, because under rule
3 `methods` is `['xendit']`, and checking it first would turn every 503 into a 403. `methods`
only drives what clients show.

**Why 403 and not 409.** On `/public/payments`, the live FE's `BookingApi::startPayment`
treats every 409 except `appointment_not_pending` as "an order is already pending". It then
hides every pay button. A 400 or 422 would be shown by the FE's `friendly()` as an invalid
token. A 403 has no special handling, so during the deploy gap the old FE shows its generic
error and its existing Xendit fallback.

### Public payment (`initiatePublicPayment`)

1. Run the existing checks: appointment status, then an existing pending order.
2. `computePublicAmount` produces the rupiah items and taxes, as today. The gate needs them to
   recognise a free order.
3. For `paypal` or `card`, run the gate above, keyed on `appt.clinicId`. Then `buildUsdQuote`
   turns the rupiah lines into USD lines. `createWcOrder` sends the rupiah `items` and `taxes`
   (the plugin still derives `praktiqu_expected_idr` from them) **plus** a new `charge` object,
   described in §4.
4. **Plugin rejects the total.** The plugin checks its own total against `charge.total` before
   calling PayPal (§4 step 4). If they differ, it cancels the order and answers 502
   `charge_mismatch`. Next.js passes that on and writes no `payment_orders` row.
5. **Backstop for version skew.** An older plugin may ignore `charge`, so Next.js also compares
   the returned `chargedAmount` with `quote.totalUsd`, in integer cents. If they differ,
   Next.js:
   - enqueues `praktiqu_payment_auto_cancel` with `{ wcOrderId }` and `runAt = now`. This is the
     existing job; Next.js has no direct cancel route.
   - writes **no** `payment_orders` row. A row would let the resulting `payment.expired` cancel
     the appointment, and a retry would then hit `payment_already_initiated`.
   - discards the `checkoutUrl` and returns 502 `charge_mismatch`.

   The appointment stays PENDING. A guest booking is still released by
   `praktiqu_booking_unpaid_cancel`, which is scheduled when the booking is made. The cancelled
   order's `payment.expired` webhook gets 404 "Unknown order". That is expected and harmless.
6. Write `payment_orders` as today: `gateway`, `expectedAmount` = `quote.expectedIdr`,
   `chargedAmount`, `chargedCurrency`, and `fxRate` = `effectiveFxRate`. Then enqueue the
   normal delayed auto-cancel.

### Staff payment (`ensureSessionPayment`)

- The same gate, in the same order, keyed on `bill.clinic.id`. A clinic id of 0 or null counts
  as not international.
- **Discounts are not supported in USD.** `computeSessionAmountFromBill` sends the bill's gross
  service and tax lines, and `expectedAmount` is the net `bill.total_amount`. A USD quote built
  from the gross lines would overcharge a discounted bill without any error. So `paypal` or
  `card` on a bill with `discount > 0` returns **422 `discount_not_supported`**, before any
  WooCommerce order is created.
- `expectedAmount` for session orders stays `bill.total_amount`, as today.
- The quote is built from the same lines as today.

### Xendit

Xendit does not change for any clinic, international or not: rupiah, no markup, no fixed fee.

### Accepted behaviour

If the rate changes between the patient seeing the price and clicking pay, the patient is
charged at the new rate. The final amount is always the one on PayPal's own page.

## 3. Next.js API contract

### New: `GET` / `PUT /api/v1/practices/{id}/payment-settings`

**Access**

- `SUPER_ADMIN` may use any clinic.
- `CLINIC_ADMIN` may use only their own clinic, through the existing `assertPracticeInScope`.
  Another clinic returns 404.
- Every other role gets 403 from `requireRoles`.
- `assertPracticeInScope` does not check that a clinic exists when the caller is SUPER_ADMIN.
  So after the scope check, both GET and PUT load the clinic with `findClinicById` and return
  404 (`PracticeNotFoundError`) if there is no row. A PUT for an unknown id never creates an
  option.

**GET response**

| Field | Content |
|---|---|
| `stored` | The clinic's own values. With no option, this is `{ international: false, fxRate: null, markupPercent: null, fixedFeeIdr: null }` |
| `effective` | Rate, markup and fee resolved with their sources, whatever the flag (the rate may be null), plus `methods` |
| `globalDefaults` | The global rate and markup, used as form placeholders |
| `example` | `buildUsdQuote` of Rp 200,000 with the effective values. It is computed whenever a usable rate exists, even before the clinic is flagged, so the admin can preview. Otherwise `null` |
| `updatedAt` | Timestamp, or `null` |
| `updatedBy` | `null` or `{ wpUserId, name }`. The name comes from `users.displayName`, falling back to `wp_users.display_name` |

**PUT**

- Body: `{ international, fxRate, markupPercent, fixedFeeIdr }`, validated as described in §1.
- Next.js maps the body to the plugin's snake_case body, adds `updated_by`, and forwards it.
  It writes the audit entry, then answers with the same shape as GET, built by **re-reading the
  option through `KcOption`**. A storage-format mismatch therefore shows up on the first save.
- If the plugin answers `fx_rate_required`, Next.js returns 422 with the same issue shape as a
  zod validation error.
- This is deliberately a separate route, not part of `PATCH /practices/{id}/settings`. That
  route writes `extra` and records `actorId: null`, while money settings need a clear audit
  trail.

### Fields added to existing endpoints

| Endpoint | Added |
|---|---|
| `GET /practices`, `GET /practices/{id}` | `international: boolean` (read only) |
| `GET /public/practices`, `GET /public/practices/{id}` (both use the `PublicClinic` mapper) | `international`, `paymentMethods` |
| `GET /public/professionals/{id}/services` | Per row: `clinicId`, `paymentMethods`, `usd` |
| The public booking submit response, and `GET /public/appointments/{token}` | `paymentMethods`, `usd` |

- **`usd`** is either `null` or `{ price, taxes: [{ name, amount }], fee, total }`. Every
  amount is a 2-decimal string, and `fee` is `null` when there is no fixed fee. `usd` is filled
  only when all of these hold: the clinic is international, a usable rate exists, and the
  row's rupiah total is above 0.
- **`international`** is the stored flag. It is false when the read fails. It only drives the
  admin badge. Clients decide the USD display and the allowed methods from `usd` and
  `paymentMethods`, never from `international`.
- **`price`** (rupiah) stays as it is, so the current FE keeps working.
- **The services endpoint** computes each row's quote with the same `computePublicAmount` and
  `buildUsdQuote` used to charge. The displayed and charged figures match for the same
  settings, **provided the booking is submitted with the row's `clinicId`** (§5).

### New errors

These apply to `POST /public/payments` and `POST /sessions/payment-verify`.

| Status | Code | When |
|---|---|---|
| 403 | `payment_method_not_allowed` | `paypal` or `card` on a clinic that is not international, or on a free order |
| 503 | `paypal_rate_missing` | The clinic is international but has no usable rate |
| 503 | `payment_settings_unavailable` | The settings read failed. The client may retry |
| 502 | `charge_mismatch` | The order total differs from the quote |
| 422 | `discount_not_supported` | Staff route only: `paypal` or `card` on a bill with `discount > 0` |

Both routes answer with coded problem+json from `src/lib/problem-details.ts`:
`{ type, title, status, code, detail }`. That file has no 502 helper, so add `badGateway(code)`
next to `serviceUnavailable`. The 503 configuration states (`paypal_rate_missing`,
`payment_method_unavailable`) carry no `Retry-After`. `sessions/payment-verify` switches its
`KcError` and fallback responses to these helpers, so its errors carry `code` too.

### Mapping plugin errors

`WpEndpointError` gains an optional `code`. `createWcOrder` and `wpRequestJson` parse the
WordPress error body `{ code, message, data.status }` into it. Both payment routes map
`WpEndpointError` by `code`; they never pass the status through as-is.

| Plugin code | Next.js response |
|---|---|
| `clinic_not_international` | 403 `payment_method_not_allowed` |
| `charge_mismatch` | 502 `charge_mismatch` |
| `paypal_rate_missing` (legacy path) | 503 `paypal_rate_missing` |
| `gateway_missing` | 503 `payment_method_unavailable` |
| `woocommerce_missing`, or status 0 (unreachable) | 503 `payment_unavailable` |
| `invalid_charge` (our own bug) | 502 `payment_gateway_rejected` |
| Any other code (`payment_start_failed`, `order_create_failed`, `amount_collapsed`, …) | 502 `payment_start_failed` |

The WordPress `message` is logged and never returned to the client.

### Docs

- Update `docs/api/openapi.yaml`, which is the Next.js `/api/v1` contract:
  - add the new route;
  - add the new fields to every endpoint listed above;
  - add the new error responses to both payment routes.
- The root `openapi.yaml` is the KiviCare and plugin spec. Add only the new plugin route there.
- Update `docs/api/PAYMENT-METHODS-GUIDE.md` and `docs/api/PRACTICES-AND-SERVICES-GUIDE.md`.

## 4. WordPress plugin (`praktiqu-endpoint`)

### New route: `GET` / `PUT /praktiqu/v1/clinics/{id}/payment-settings`

- Service token only, the same as the other plugin routes.
- **GET** exists for diagnostics. Next.js reads the option through `KcOption`.
- **PUT**:
  - Returns 404 `clinic_not_found` when `{prefix}kc_clinics` has no row with that id.
  - Re-validates every field with the rules in §1, including the usable-rate cross-field
    check against the global option. A failure returns `fx_rate_required` or
    `invalid_settings`.
  - Stores `updated_by` exactly as received (a positive integer or null; anything else is a
    400) and stamps `updated_at` itself.
  - Writes `update_option($key, wp_json_encode($data), false)`. When `update_option` returns
    false, that counts as success if the stored value already equals the new encoded value (an
    identical re-save). Otherwise it is a 500.

### `create_order`: new optional `charge` argument

**Args schema.** The route gains an args schema that declares only `charge`, as
`['type' => 'object', 'required' => false]`, with no nested `properties`. The legacy keys
(`items`, `taxes`, `method`, …) stay undeclared, so their current loose handling does not
change. Every nested check happens in the handler and fails with 400 `invalid_charge`, never
with WordPress's generic `rest_invalid_param`. This avoids a repeat of the jobs-route incident,
where `'array'` was declared instead of `'object'`.

**Wire format**, exactly as Next.js serialises it:

```json
"charge": {
  "currency": "USD",
  "items": [{ "name": "Konsultasi", "amount": "12.23" }],
  "taxes": [],
  "fee":   { "name": "International service fee", "amount": "1.39" },
  "total": "13.62",
  "snapshot": {
    "clinicId": 4,
    "fxRate": "18000",
    "markupPercent": "10",
    "fixedFeeIdr": "25000",
    "source": { "fxRate": "clinic", "markupPercent": "global", "fixedFeeIdr": "clinic" }
  }
}
```

- Every money amount is a string matching `^\d+\.\d{2}$`.
- `snapshot.clinicId` is a JSON integer. The other snapshot numbers are decimal strings.
- `fee` is left out when there is no fee, and `charge` is left out for Xendit. Neither is ever
  sent as `null`.
  - A null `fee` inside `charge` counts as no fee.
  - The plugin itself rejects a present-but-null `charge` with 400 `invalid_charge`, which
    Next.js maps to 502 `payment_gateway_rejected`. WordPress core treats a null param as
    absent (it skips null args when it sanitizes and validates), so relying on the args schema
    would let a null `charge` fall into the legacy global-rate path and skip the clinic gate.
    Rejecting it in `create_order()` is deliberate; only an absent `charge` key is the
    legacy/xendit path.

**When `charge` is present**, the method must be `paypal` or `card`; otherwise the plugin
returns 400 `invalid_charge`. Then:

1. **Validate the shape.**
   - `currency` is `USD`.
   - Each amount is converted to integer cents **from the string**, by splitting on the dot.
     Never through `(float) × 100`.
   - Item amounts are ≥ 0. Tax amounts, the fee (when present) and `total` are > 0.
   - `items` has exactly as many entries as the rupiah `items`.
   - `taxes` has exactly as many entries as the rupiah taxes with an amount > 0. This is the
     same `<= 0` skip as today.
   - The line cents sum to exactly the `total` cents (`===`). Floats are never summed or
     compared.
2. **Defence in depth.** Read and `json_decode` `praktiqu_endpoint_clinic_{clinicId}_payment`
   and require `international === true`. Otherwise return 409 `clinic_not_international`, which
   Next.js maps to 403. A missing or undecodable option counts as not international. This guards
   against Next.js bugs, not against a compromised caller: whoever holds the service token is
   trusted with the amounts, as Next.js already is today for rupiah prices.
3. **Build the order** from the given USD amounts.
   - Set the order currency to USD.
   - Add the item lines and the tax fee lines.
   - Add the fixed fee as a `WC_Order_Item_Fee`.
   - Keep the existing 2-decimal pinning around `calculate_totals()`.
4. **Check the total before any gateway call.** Right after `calculate_totals()`, at the same
   place as the existing `amount_collapsed` guard and before `resolve_gateway()` and
   `process_payment()`, compare `(int) round($order->get_total() * 100)` with the `total`
   cents. If they differ, for example because WooCommerce applied its own tax rates, set the
   order to `cancelled` with a PraktiQU note and return `WP_Error('charge_mismatch', …, 502)`.
   PayPal is never contacted. This checks that WooCommerce kept the amounts it was given. It
   does not recompute the conversion.
5. **Write meta.**
   - Existing keys: `praktiqu_method`, `praktiqu_charge_currency`, `praktiqu_expected_idr`, and
     `praktiqu_fx_rate` / `praktiqu_markup_percent` (now taken from the snapshot).
   - New keys: `praktiqu_clinic_id`, `praktiqu_fixed_fee_idr`, and `praktiqu_fx_source` (JSON).
6. **Respond** with the same shape as today: `orderId`, `checkoutUrl`, `chargedAmount`,
   `chargedCurrency`, and `fxRate` (the effective rate, computed from the snapshot).

**When `charge` is absent** for `paypal` or `card`, the existing global path runs unchanged.
This path exists **only for the deploy transition**, while an older Next.js may still call it.
It is removed in the next plugin release.

### Other plugin changes

- Tighten `sanitize_fx_rate` to the 1,000–100,000 range, keeping the previous value on
  rejection as it does today. This also protects the legacy path during the transition.
- Relabel the wp-admin settings as the **global default** rate and markup.
- Add the `uninstall.php` cleanup.
- Bump the plugin version.

## 5. Laravel front-end (`raakanaka/laravel-praktiqu`)

### Settings page: `/dashboard/klinik/{id}/pembayaran-internasional`

The page has its own controller and view, following `GoogleCalendarController` and
`dashboard/kalender.blade.php`. It does not go into the `dashboard.blade.php` monolith.

**Form fields:**

- A toggle "Klinik Internasional", with the hint "terima PayPal & Kartu, dibayar dalam USD".
- "Kurs (Rp per 1 USD)", with the placeholder "kosong = kurs global Rp …".
- "Markup %", with the global value as its placeholder.
- "Fee flat (Rp)".

**Below the form:**

- The backend's `example` conversion. It is hidden when `example` is null.
- "terakhir diubah oleh {updatedBy.name} pada {updatedAt}". The "oleh …" part is left out when
  `updatedBy` is null.

**Behaviour:**

- Backend validation errors are shown per field, using the existing
  `ResourceController::rincianValidasi` pattern.
- After a successful save, call `Cache::forget('pq_public_practices')` and clear any related
  catalogue cache key, so the booking page does not wait out the 5-minute cache.

### Access

The FE currently folds clinic admins and receptionists into a single `admin` role
(`AuthController::roleOf`). To tell them apart:

- The session profile gains `canManageClinicPayment`. It is true when the raw backend role is
  `SUPER_ADMIN` or `CLINIC_ADMIN`, and false otherwise. The raw role is `role`, else
  `roles[0]`, read before `roleOf` folds it.
- In `AuthController::login()`, compute the flag once, **after** the `/auth/me` block, because
  that block rebuilds `$profile` from scratch. Take the role from `$meUser` when `/auth/me`
  returned a user with a recognised role, and from the login `$user` otherwise.
- Do not bump `PROFILE_VERSION`. `validProfile()` would then reject every existing session.
  Sessions created before the change have no flag, and it reads as **false**. The new entry
  points appear after the next login, and nobody is forced to log out.

Where the entry points appear:

- **Super admin:** an "International" badge and a "Pengaturan pembayaran" link on each clinic
  card.
- **Clinic admin:** a menu entry under Pengaturan, only for `profile.practiceId`. Any other
  `{id}` returns 404. The backend enforces the same rule on its own.

### Booking page (`booking.blade.php`, `BookingApi`, `BookingController`)

**The booking must go to the clinic whose price was shown.** A service row's `id` is the
KiviCare service id, and the same id repeats across a professional's clinics. Today the page
fetches services for every clinic, `mapServices` merges rows on name, duration and price, and
the submit sends no `clinicId`. The backend then books into the first mapping for that service
id (`public-booking.service.ts`, `createPublicAppointment`), which may not be the row the
patient picked. So:

- **Clinic page:** pass the tenant's `clinicId` to `fetchServices`, in both `resolveTenant` and
  `BookingController::services`. Every row then belongs to that clinic.
- **Personal link** (`/{nama-psikolog}`): add `clinicId` to the `mapServices` merge key.
- **Every page:** send the selected row's `clinicId` to `/public/booking/slots` and in the
  `POST /public/appointments` body, by adding it to `$slot` in `BookingController::submit`. The
  backend already accepts it and only narrows the choice to the psychologist's real clinics.

**Display:**

- **Service list:** when a row's `usd` is not null, the main price is the USD figure (`$12.23`)
  with "Rp 200.000" small underneath. Otherwise the price is in rupiah, as today.
- **Method picker (step 5):** shows only the selected row's `paymentMethods`. If that is
  missing, it falls back to `['xendit']`.
- **Summary:** for PayPal or card it shows the USD lines from `usd`: service, taxes,
  "International service fee" and total. For Xendit it shows rupiah, as today.
- **Success screen:** the method pills come from `paymentMethods` in the submit response, which
  is authoritative. If the method picked in step 5 is not in that list, the screen resets it to
  a valid one before calling pay.
- The FE never converts currency. Every USD figure comes from the backend.

**Errors**, keyed on the problem+json `code`, never on status alone:

| Code | What the patient sees |
|---|---|
| `payment_method_not_allowed` | "Metode ini tidak tersedia untuk klinik ini", then the valid pills |
| `paypal_rate_missing`, `payment_method_unavailable` | "PayPal sementara tidak tersedia, silakan pakai Xendit" |
| `payment_settings_unavailable`, `payment_unavailable`, `charge_mismatch`, `payment_start_failed` | A retry message |

- These branches go into `BookingController::friendly()`. The existing `payGagalMetode` path
  then offers Xendit.
- `BookingApi::startPayment` keeps its 409 branches unchanged:
  `payment_already_initiated` → pending, and `appointment_not_pending` →
  `bukanMenungguBayar`. The new codes are not 409, so they never reach those branches.

### Delivery

Use a branch, `feat/klinik-internasional`, and open a PR to Rafiq's repo. Never push to `main`,
which auto-deploys to terpadu.praktiqu.com.

## 6. Error handling

Every failure fails closed.

| Condition | Result |
|---|---|
| Clinic option missing, malformed, serialized, or holding an invalid field | Treated as not international (Xendit only, rupiah); logged |
| Settings read throws (DB error) | Display: rupiah and Xendit only, logged. Payment: 503 `payment_settings_unavailable`, retryable |
| International, no usable rate (including an out-of-range global rate) | `usd: null`, PayPal and card hidden; a payment attempt gets 503 `paypal_rate_missing` |
| USD method on a non-international clinic or a free order | 403 in Next.js before any WooCommerce order. The plugin answers 409 `clinic_not_international` as a second guard, and Next.js maps that to the same 403 |
| USD method on a discounted staff bill | 422 `discount_not_supported`, before any WooCommerce order |
| WooCommerce total ≠ `charge.total` | The plugin cancels the order before calling PayPal and returns 502 `charge_mismatch`. No `payment_orders` row is written |
| Returned `chargedAmount` ≠ quote (version skew) | Next.js enqueues an immediate auto-cancel, writes no row, and returns 502 `charge_mismatch`. The appointment stays PENDING |
| Any other plugin error | Mapped by code as listed in §3; the WordPress message is logged only |

## 7. Testing

### Next.js (vitest)

**`intl-pricing` unit tests:**

- The golden vectors, including the divide-first trap (Rp 90,000 → 6.00), and the worked
  example.
- The fee line has no markup. A fee of 0 produces no line.
- A Rp 0 item next to a paid item keeps a 0.00 line, so the counts match.
- A tax ≤ 0 is skipped.
- A free order (total Rp 0) with a clinic fee set returns `null`.
- Value sources: clinic, global and default.
- Rate validation on read: a clinic or global rate of 16.5 or 500,000 counts as missing, and a
  global markup of 150 counts as rule 3.
- Fail-closed handling: a missing option, malformed JSON, a PHP-serialized `a:…` value, and an
  invalid stored field all resolve to not international and are logged. A database error
  throws `PaymentSettingsUnavailableError`.

**Route tests:**

- `payment-settings`:
  - the role matrix;
  - 404 for an out-of-scope clinic (CLINIC_ADMIN);
  - 404 for a nonexistent clinic (SUPER_ADMIN, GET and PUT), with no plugin call made;
  - 422 cases, including `fx_rate_required` with an out-of-range global rate;
  - a `log_entries` AUDIT row with action `clinic.payment_settings.updated`, `userId` equal to
    the caller's cuid, and `before` / `after` in `metadata`;
  - `updated_by` forwarded from `User.wpUserId`, and `null` when the account has no WP link.
- `public/payments` and `sessions/payment-verify`:
  - 403 for a non-international clinic;
  - 503 `paypal_rate_missing` for an international clinic with no usable rate (not 403);
  - 503 `payment_settings_unavailable` on a read error;
  - 502 `charge_mismatch` from the plugin;
  - 502 `charge_mismatch` from the backstop, with an immediate auto-cancel enqueued and no
    `payment_orders` row;
  - each plugin error-code mapping;
  - 422 `discount_not_supported` (staff route only).
- Catalogue: `usd` is present only for an international clinic with a usable rate and a
  non-zero total, and its amounts are 2-decimal strings.

**Other tests:**

- `wp-endpoint` client: the serialised `charge` payload uses string amounts and leaves out
  `fee` when there is none. A WordPress error body is parsed into `WpEndpointError.code`.
- Integration against the Docker test database: insert the exact `wp_json_encode` output
  captured from the plugin test as a shared fixture, then read it back through `KcOption` and
  `resolveClinicPayment`.

### Plugin

- `php -l` on every changed file.
- The settings PUT stores a string that `json_decode` accepts, beginning with `{`, not a
  serialized array.
- An identical re-save succeeds, and an unknown clinic returns 404.
- `charge` validation:
  - accepts the worked example (12.23 + 1.39 = 13.62);
  - rejects a float-looking amount and a mismatched sum;
  - rejects wrong counts;
  - rejects `charge` together with `xendit`.
- `clinic_not_international` for an unflagged or missing option.
- The total-mismatch path cancels the order and never calls the gateway.
- The meta keys are written.
- `sanitize_fx_rate` rejects values outside 1,000–100,000.

### Laravel FE (PHPUnit in Docker, `php:8.4-cli`)

**Settings page**, modelled on `PengaturanKalenderTest`:

- super admin allowed;
- clinic admin allowed for their own clinic, 404 for another;
- receptionist denied;
- payload forwarded;
- backend errors forwarded;
- example hidden when `null`.

**Login**, modelled on `StaffScopeLookupTest` / `StaffLoginRoleTest`:

- `canManageClinicPayment` is true for SUPER_ADMIN and CLINIC_ADMIN and false for
  RECEPTIONIST;
- covers both the `/auth/me` success path and the failure path.

**Booking:**

- PayPal hidden for a non-international clinic.
- USD display when `usd` is set.
- Fallback to `['xendit']`.
- A psychologist at two clinics, one of them international: the clinic page lists only that
  clinic's rows, and submit forwards the selected row's `clinicId`.
- `/booking/pay` with a backend 403 `payment_method_not_allowed` returns the error message, not
  `pending: true`.
- A 503 `paypal_rate_missing` returns the "PayPal unavailable" message.

**Existing tests:** update `DeadFeatureAuditTest` and `BookingHalamanTest`, which currently
expect PayPal to always show.

## 8. Rollout

### Pre-deploy checks

These are read-only. Ask the user before any database query.

- Is PPCP on Hostinger in live or sandbox mode?
- Is the global rate option set, and is it within 1,000–100,000?
- Are there PayPal rows in Hostinger's `payment_orders`?

**The International flag is now the safety switch.** Until now, PayPal was locked by leaving
the global rate empty. Under this design, a clinic with its own rate can take real money as
soon as it is flagged, if PPCP is live.

### Order

1. **Plugin.** It accepts `charge`, adds the settings route, and tightens the rate sanitizer.
   The legacy path keeps working. Deploy over SSH to Hostinger with the established method:
   md5 comparison, tar backup, `php -l`, then `cp` + `mv`.
2. **Next.js.** From this point PayPal and card are **closed for every clinic**, because none
   is international yet. Until the FE ships, a patient who picks PayPal or card on the old FE
   gets the 403. The old FE shows it as its generic "Gagal membuka halaman pembayaran" plus the
   existing "Bayar dengan Xendit (IDR)" fallback, so the patient can still pay. Keep the gap
   before step 3 short anyway.
3. **Merge the FE PR.** It auto-deploys to terpadu.
4. **Sandbox end to end.**
   - Switch PPCP to sandbox.
   - Flag one test clinic (rate 18,000, markup 10%, fee Rp 25,000).
   - Book it and pay.
   - In sandbox the capture stays `UNILATERAL` pending, so replay the final webhook by hand, as
     in September.
5. **Switch PPCP back to live.** Then enable real clinics one at a time.
6. **Next plugin release:** remove the legacy global path.

## Out of scope (follow-ups)

- PayPal in KiviCare's own booking widget (it sends rupiah unconverted).
- How the markup and fixed fee are split at disbursement.
- Currencies other than USD.
- A payment-method UI for staff in the FE.
- Bill discounts in USD. Xendit already has a separate problem here: it compares gross lines
  against the net `total_amount`.

## Risks

- **Rate direction.** The rate is a divisor (rupiah per 1 USD). The FE label must say
  "Rp per 1 USD". The 1,000–100,000 range applies to both the clinic rate and the global
  fallback, on write and again on read, and rejects an inverted or mistyped entry.
- **`fxRate` leaves out the fee.** `expectedAmount / fxRate` approximates the charge without the
  fixed fee. The fee is recorded separately in WooCommerce meta (`praktiqu_fixed_fee_idr`).
- **Per-line rounding.** Rounding up each line can overcharge an order with n lines by up to n
  cents. This is unchanged from today, and the excess goes to the clinic by design.
- **A rare one-cent difference from the old plugin path.** With a 2-decimal rate or markup,
  when the fractional cent is below 5e-7, the plugin's `round(…, 6)` rounds down and the new
  function charges one cent more. The golden vectors are unaffected.
- **One PayPal merchant for all clinics.** The flag decides whether PayPal is offered, not who
  receives the money.
- **Still unproven against real PayPal:** live capture → webhook → BOOKED, and the tax-line
  path (`wp_kc_taxes` is empty).
