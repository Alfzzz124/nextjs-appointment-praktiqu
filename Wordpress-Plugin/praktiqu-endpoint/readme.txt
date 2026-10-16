=== PraktiQU Endpoint ===
Contributors: praktiquteam
Tags: authentication, rest-api, jwt, sso
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.8.1
License: Proprietary
License URI: https://praktiqu.local/license

Service-to-service REST endpoint for the PraktiQU Next.js app. Verifies WordPress user credentials, changes passwords, and emits signed webhooks for user-state changes.

== Description ==

PraktiQU is a Next.js Psychology Practice Management System that runs alongside WordPress on a shared MySQL instance. This plugin is the bridge: it exposes a small, hardened REST API that the PraktiQU backend calls for credential verification, password changes, and identity lookups.

The plugin is intentionally minimal. It does NOT replace the KiviCare plugin, nor does it provide any user-facing UI. All functionality is REST-only and protected by a shared service token.

== Endpoints ==

All endpoints live under the `/wp-json/praktiqu/v1/` namespace and require the `X-PraktiQU-Service-Token` request header.

* `POST /authenticate` — verify email + password, return user identity
* `GET  /users/{id}` — get user identity by WordPress user ID
* `POST /users/lookup` — get user identity by email
* `POST /users/{id}/change-password` — change a user's password
* `GET  /health` — liveness probe
* `POST /payments/order` — create a WooCommerce order for an appointment or bill
* `GET  /payments/order/{id}` — read WooCommerce order status
* `GET|PUT /clinics/{id}/payment-settings` — one clinic's international payment settings

== Configuration ==

1. Add a long random service token to `wp-config.php`:
   ```php
   define('PRAKTIQU_SERVICE_TOKEN', 'PASTE-A-LONG-RANDOM-STRING-HERE');
   ```
   Generate with: `openssl rand -base64 48`

2. Set the matching token in the PraktiQU Next.js app's `.env`:
   ```
   WORDPRESS_SERVICE_TOKEN=PASTE-A-LONG-RANDOM-STRING-HERE
   ```

3. Optionally, configure the PraktiQU webhook URL in **Settings → PraktiQU Endpoint** to receive signed notifications when user state changes on this WordPress site (password resets, role changes, deactivations, deletions, failed logins).

== Security ==

* Service token is constant-time compared (`hash_equals`).
* Failed authentication runs a dummy `wp_check_password` to mitigate user-enumeration timing.
* No data is stored outside the standard WordPress user / usermeta tables, plus two custom usermeta keys:
  * `praktiqu_user_status` — `'active'` | `'inactive'` | `'blocked'`
  * `praktiqu_password_changed_at` — MySQL datetime; updated on every password change
* Webhooks are signed with HMAC-SHA256 over the JSON body; receivers must verify the signature in `X-PraktiQU-Webhook-Signature`.

== Changelog ==

= 1.8.1 =
* Paid public bookings now send KiviCare's booking emails to patient, doctor and
  clinic. POST /appointments/{id}/status accepts an optional
  `payment` { gateway, wc_order_id, transaction_id }; when it rides on status 1 and
  the row is PENDING, the row is claimed with a conditional UPDATE and
  kc_appointment_payment_completed fires once — a second or concurrent confirmation
  of the same order fires nothing. Before, a paid booking (created PENDING, so
  kc_after_create_appointment was skipped) reached only kc_appointment_status_update,
  whose sole listener handles check-in/check-out. A plain status change, including a
  staff approval of an unpaid booking, behaves as in 1.8.0. A listener that throws
  is logged and does not fail the request. The response gains `payment_confirmed`.

= 1.8.0 =
* New POST /clinic-admins creates the admin account of a clinic the Next.js app
  just created: wp_insert_user with the kiviCare_clinic_admin role, a conditional
  claim of wp_kc_clinics.clinic_admin_id (only while it is 0), KiviCare's
  clinic_admin_registration email (WordPress's new-user email as fallback) and the
  kivicare_clinic_admin_registered action. Answers 400 praktiqu_invalid_email /
  praktiqu_invalid_name / praktiqu_missing_clinic, 404 praktiqu_clinic_not_found,
  409 praktiqu_clinic_has_admin / praktiqu_email_taken. The password is never
  returned.

= 1.7.0 =
* International clinics. New GET|PUT /clinics/{id}/payment-settings stores one
  clinic's flag, FX rate, markup and fixed fee as a JSON string in the
  praktiqu_endpoint_clinic_{id}_payment option (autoload off). PUT answers 404
  clinic_not_found, 400 invalid_settings, 422 fx_rate_required or 500
  save_failed.
* POST /payments/order accepts an optional `charge` object for paypal/card:
  the USD lines PraktiQU already computed. The order is built from them as
  given, after checking the shape (400 invalid_charge) and that the clinic is
  international (409 clinic_not_international). If the WooCommerce total
  differs from charge.total the order is cancelled before PayPal is contacted
  (502 charge_mismatch). New order meta: praktiqu_clinic_id,
  praktiqu_fixed_fee_idr, praktiqu_fx_source. Without `charge` the old global
  rate path still runs; it is kept only for the deploy transition. A
  present-but-null `charge` is rejected with 400 invalid_charge (WordPress
  core treats a null param as absent, so the plugin checks it itself).
* The wp-admin FX rate and markup are now the global defaults, and the rate
  must be from 1,000 to 100,000 rupiah per 1 USD, written with digits only.
* Uninstall also removes every per-clinic payment option.
* Requires WooCommerce -> Settings -> General -> "Enable tax rates and
  calculations" OFF. With it on, WooCommerce adds its own tax to every
  charged order, the total no longer matches charge.total, and each such
  order is cancelled with charge_mismatch.

= 1.6.8 =
* Security (SEC-9): POST /authenticate checks the password BEFORE the
  account status. A wrong password for an inactive or blocked account now
  answers 401 invalid_credentials like any other wrong password, instead of
  403 inactive, which let anyone learn an account was deactivated without
  knowing its password. Only a correct password reveals the inactive state.

= 1.6.7 =
* New job hook praktiqu_booking_unpaid_cancel. PraktiQU schedules it when a
  guest booking is created; when it fires the plugin calls back with
  booking.unpaid_cancel and PraktiQU cancels the booking if it is still
  PENDING with no pending or paid payment. Guest bookings abandoned before
  checkout no longer hold their slot forever.

= 1.4.0 =
* Payment hand-off now returns the Xendit hosted invoice URL (all enabled
  methods on one page) instead of the WooCommerce order-pay page. WC order is
  still created. Patients return to the app frontend on success via
  woocommerce_get_return_url.

= 1.3.0 =
* Added POST /media — sideload a file into the WordPress media library.

= 1.2.0 =
* Payments: Xendit-via-WooCommerce bridge. New /payments/order (create) and
  /payments/order/{id} (status) endpoints, praktiqu_payment_auto_cancel job,
  and a dedicated payment webhook URL/secret (independent of the general
  webhook secret) dispatching payment.completed/failed/expired.

= 1.0.0 =
* Initial release: authenticate, lookup, change-password, health endpoints; webhook dispatcher on user-state changes; admin settings page.
