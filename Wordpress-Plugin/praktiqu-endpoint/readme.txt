=== PraktiQU Endpoint ===
Contributors: praktiquteam
Tags: authentication, rest-api, jwt, sso
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.2.0
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

= 1.2.0 =
* Payments: Xendit-via-WooCommerce bridge. New /payments/order (create) and
  /payments/order/{id} (status) endpoints, praktiqu_payment_auto_cancel job,
  and a dedicated payment webhook URL/secret (independent of the general
  webhook secret) dispatching payment.completed/failed/expired.

= 1.0.0 =
* Initial release: authenticate, lookup, change-password, health endpoints; webhook dispatcher on user-state changes; admin settings page.
