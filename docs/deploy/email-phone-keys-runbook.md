# Phone numbers in KiviCare booking emails — Runbook

**Ships:** plugin `praktiqu-endpoint` 1.8.1 (same release as the paid-booking email fix) →
switch three email templates to the new keys.
**Script:** `docs/deploy/email-phone-keys-switch.php`

## Why

Every KiviCare booking email shows an empty "Client Phone number:", e.g.
`kivicare_doctor_book_appointment` for appointment 3358 on 2026-10-16, although patient #1035
has a number. KiviCare 4.5.6 (prod) and 4.4.0 (repo) share two bugs in core:

1. `KCEmailNotificationInit::fetchAppointmentData` fills `contact_number` from the usermeta
   `contact_number`, which `KCPatient::save()` never writes. The number lives in the JSON
   usermeta `basic_data` → `mobile_number`. Only 2 users on prod have the usermeta.
2. `KCEmailTemplateProcessor::getKeyMapping` then maps `{{patient_contact_number}}` and
   `{{doctor_contact_number}}` from `mobile_number`, a field that data does not have.

Both keys are resolved before any filter runs, so they cannot be overridden without patching
core. Plugin 1.8.1 answers two **new** keys through `kivicare_custom_email_key_value`, reading
`basic_data` → `mobile_number`:

| Old key (always empty) | New key |
| --- | --- |
| `{{patient_contact_number}}` | `{{praktiqu_client_phone}}` |
| `{{doctor_contact_number}}` | `{{praktiqu_professional_phone}}` |

A missing or unreadable number becomes an empty string, never the literal placeholder. The
template editor lists the new keys too (via `kivicare_template_dynamic_keys`).
`kivicare_register_email_dynamic_keys` would have been the obvious hook for that, but the
action that applies it (`kivicare_register_custom_dynamic_keys`) is never fired in either
version.

Templates on prod that use the old keys (post type `kivicare_mail_tmp`, as of 2026-10-16):
`#47 kivicare_doctor_book_appointment`, `#54 kivicare_book_appointment_reminder`,
`#60 kivicare_book_appointment`. The dry run below lists the current set.

## Before you start

- **Run every step with the user present, and only with their explicit go-ahead.** Step 2
  changes the content of live emails that reach real clients and psychologists.
- **Order matters: plugin first, templates second.** A template that uses
  `{{praktiqu_client_phone}}` on a site without plugin 1.8.1 sends the literal placeholder.
  Rolling back is the reverse: templates first, then the plugin.
- SMS/WhatsApp templates (`kivicare_sms_tmp`, KiviCare Pro) are not touched, and it has not
  been checked whether the new keys work there.

| | |
| --- | --- |
| WordPress | Hostinger: `ssh -o ConnectTimeout=40 praktiqu-hostinger`, `~/domains/api-appointment.praktiqu.com/public_html`. `php` is on PATH; `wp-cli` is not used. |

## 1. Deploy plugin 1.8.1

Use the method from `international-clinic-runbook.md` §2.1 steps 1–4 (md5 check against
git history, tar backup, upload to a temp dir, `php -l`, then `cp` + `mv` one file at a
time), with `1.8.0` as the backed-up version and the merged commit of
`fix/email-booking-berbayar`. Swap order:

1. `includes/class-praktiqu-endpoint-email-keys.php` (new)
2. `includes/class-praktiqu-endpoint-appointments.php`,
   `includes/class-praktiqu-endpoint-rest-controller.php`,
   `includes/class-praktiqu-endpoint-plugin.php`
3. `readme.txt`
4. `praktiqu-endpoint.php` **last** — it requires the new class.

Verify the version, that the plugin is still active, and that the new key answers. The phone
is masked so it does not land in a terminal log:

```bash
ssh -o ConnectTimeout=40 praktiqu-hostinger "cd ~/domains/api-appointment.praktiqu.com/public_html && php -r 'define(\"WP_USE_THEMES\", false); require \"wp-load.php\"; echo PRAKTIQU_ENDPOINT_VERSION, PHP_EOL; var_dump(in_array(\"praktiqu-endpoint/praktiqu-endpoint.php\", (array) get_option(\"active_plugins\"), true)); \$v = (string) apply_filters(\"kivicare_custom_email_key_value\", null, \"praktiqu_client_phone\", [\"patient\" => [\"id\" => 1035]]); echo \$v === \"\" ? \"(empty)\" : str_repeat(\"*\", strlen(\$v) - 3) . substr(\$v, -3), PHP_EOL;'"
```

→ `1.8.1`, `bool(true)`, and a masked number such as `***********890`. `(empty)` means
the plugin is not answering, or patient #1035 has no number any more: stop and find out
which.

## 2. Switch the templates (ask first)

```bash
ssh -o ConnectTimeout=40 praktiqu-hostinger 'mkdir -p ~/email-phone-keys && chmod 700 ~/email-phone-keys'
scp -o ConnectTimeout=40 docs/deploy/email-phone-keys-switch.php praktiqu-hostinger:~/email-phone-keys/
# Dry run — writes nothing, lists every template that still uses an old key.
ssh -o ConnectTimeout=40 praktiqu-hostinger "php ~/email-phone-keys/email-phone-keys-switch.php ~/domains/api-appointment.praktiqu.com/public_html"
```

The script lives outside `public_html` and refuses to run from the web. Show the dry run to
the user. Expect #47, #54 and #60. Any other template is a decision for the user, not a
reason to include it silently. Then, with their go-ahead, pass exactly the ids they approved:

```bash
ssh -o ConnectTimeout=40 praktiqu-hostinger "php ~/email-phone-keys/email-phone-keys-switch.php ~/domains/api-appointment.praktiqu.com/public_html --apply --ids=47,54,60"
```

What it does:

- Writes `~/email-phone-keys/email-phone-keys-backup-<UTC>.json` (mode 600) with the full
  old `post_content` of every listed template **before** the first write. If the backup
  cannot be written, it stops and writes nothing.
- Refuses ids that are not in the dry-run list, before writing anything.
- Replaces only the two old keys (also in the `{{ key }}` spelling KiviCare accepts).
  Everything else in the template stays byte for byte, because it writes through `$wpdb`
  and not `wp_update_post()` (no kses pass).
- Skips a template that was edited between the read and the write instead of overwriting it.
- Prints each switched template's key counts. Expect `{{praktiqu_client_phone}} × 1` for #47.

Copy the backup to your machine:

```bash
scp -o ConnectTimeout=40 'praktiqu-hostinger:~/email-phone-keys/email-phone-keys-backup-*.json' ./
```

## 3. Verify

- Run the dry run again: `Templates using a broken phone key (0)` (or only the ones the
  user chose to leave).
- wp-admin → KiviCare → Settings → Email templates → "Doctor Booking" (#47): the body shows
  `{{praktiqu_client_phone}}`, and the key list offers it.
- The next real booking email to a psychologist shows the client's number. To check without
  waiting, ask the user whether to book a test session with a test client who has a phone
  number. Do not resend to real clients for this.

## Rollback

Templates first, then (if needed) the plugin:

```bash
ssh -o ConnectTimeout=40 praktiqu-hostinger "php ~/email-phone-keys/email-phone-keys-switch.php ~/domains/api-appointment.praktiqu.com/public_html --restore=\$HOME/email-phone-keys/email-phone-keys-backup-<UTC>.json"
```

This puts back the exact old `post_content` of each template in the backup. Then restore the
plugin from its tar backup (step 1), if needed.

## Afterwards

Delete the script from the server once step 3 passes:
`ssh praktiqu-hostinger 'rm ~/email-phone-keys/email-phone-keys-switch.php'`. Keep the
backup until the user says otherwise.
