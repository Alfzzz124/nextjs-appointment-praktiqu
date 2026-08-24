# Encounter documents — staging deploy

## Smoke test for `GET /praktiqu/v1/media/{id}`

Run on the staging box, replacing `<id>` with an attachment id from
`SELECT ID FROM wp_posts WHERE post_type='attachment' LIMIT 1;`

    curl -sS -o /tmp/probe.bin -D /tmp/probe.hdr \
      -H "X-PraktiQU-Service-Token: $WP_SERVICE_TOKEN" \
      "https://<wp-host>/wp-json/praktiqu/v1/media/<id>"

Expect in `/tmp/probe.hdr`: `HTTP/… 200`, a `Content-Type` matching the
attachment, and `X-Content-Type-Options: nosniff`.
Expect `/tmp/probe.bin` to open in a viewer. A zero-byte file, or one that
starts with `{`, means the headers were sent after output had already begun.

Without the token the same URL must answer 401.
