# Production Auth rollback point — 2026-09-05 (P0 OAuth incident)

Captured BEFORE any change, so the exact prior state can be restored.
Project: sxqpjxhslzzcdrdctatm (Production).

## Values as found

```
SITE_URL       = http://127.0.0.1:3000
URI_ALLOW_LIST = https://127.0.0.1:3000,nexpec://reset-password,nexpec://oauth-callback,nexpec://*,exp://127.0.0.1:8081/--/reset-password
```

## Restore command

```bash
curl -X PATCH \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  https://api.supabase.com/v1/projects/sxqpjxhslzzcdrdctatm/config/auth \
  -d '{"site_url": "http://127.0.0.1:3000", "uri_allow_list": "https://127.0.0.1:3000,nexpec://reset-password,nexpec://oauth-callback,nexpec://*,exp://127.0.0.1:8081/--/reset-password"}'
```

No secrets are recorded here. Google client id/secret, JWT secret and SMTP
credentials were not read, not changed and are not part of this rollback.
