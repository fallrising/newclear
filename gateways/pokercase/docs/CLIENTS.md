# Client configuration

Point any OpenAI-compatible or Anthropic Messages client at thinrouter.

Default base: `http://127.0.0.1:20128/v1`  
Auth: `Authorization: Bearer <gateway-key>` or `x-api-key: <gateway-key>`  
Enabled gateway keys are required by default, including when no keys exist or all keys are disabled. Explicit `--allow-keyless-bootstrap` allows requests with no credential headers only on an exact loopback listener, for direct (non-forwarded) requests, with zero total keys. See [cost safety](cost-safety.md).

Model values:

| `model` | Meaning |
|---------|---------|
| `route-name` | Named route (fallback / round_robin targets) |
| `connection/model` | Direct upstream model on that connection |
| `connection` | Connection `default_model` |

---

## curl (OpenAI)

```bash
curl -s http://127.0.0.1:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cheap",
    "messages": [{"role":"user","content":"hi"}],
    "stream": false
  }'
```

Stream: set `"stream": true`.

## curl (Anthropic Messages)

```bash
curl -s http://127.0.0.1:20128/v1/messages \
  -H "Authorization: Bearer YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "cheap",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"hi"}]
  }'
```

thinrouter translates to OpenAI-compatible upstreams and maps the response back.

---

## Cursor

1. Settings → Models → OpenAI-compatible / custom base URL.
2. **Base URL:** `http://127.0.0.1:20128/v1`
3. **API Key:** your thinrouter gateway key. Clients that require a key cannot use keyless bootstrap.
4. **Model:** your route name (e.g. `cheap`) or `connection/model`.

If Cursor only supports OpenAI shape, use `/v1/chat/completions` (default).

---

## Claude Code (OpenAI-compatible mode)

When Claude Code is configured to use an OpenAI-compatible endpoint:

```bash
export ANTHROPIC_BASE_URL=   # leave unset if using OpenAI mode
export OPENAI_BASE_URL=http://127.0.0.1:20128/v1
export OPENAI_API_KEY=YOUR_GATEWAY_KEY
```

Or for native Anthropic Messages against the proxy:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:20128
export ANTHROPIC_API_KEY=YOUR_GATEWAY_KEY
# model: your route name
```

Exact env names vary by Claude Code version — prefer UI settings if available.  
The important parts: **base URL ends at `/v1` for OpenAI**, and **model = route name**.

---

## Continue.dev

`config.json` fragment:

```json
{
  "models": [{
    "title": "thinrouter",
    "provider": "openai",
    "model": "cheap",
    "apiBase": "http://127.0.0.1:20128/v1",
    "apiKey": "YOUR_GATEWAY_KEY"
  }]
}
```

---

## Cline / Roo

- Provider: OpenAI Compatible  
- Base URL: `http://127.0.0.1:20128/v1`  
- API Key: gateway key  
- Model ID: route name  

---

## Notes

- **Admin UI:** `http://127.0.0.1:20128/admin`  
  Open `/admin/login` first with the admin token (`--admin-token`, or `cat ~/.thinrouter/admin-token`).
- **Docker:** publish port `20128`, set `THINROUTER_HOST=0.0.0.0`.
- **Health:** `GET /health`
