# clarkQ client SDKs

Minimal HTTP client skeletons for talking to a clarkQ server.

| Language | Path | Notes |
|----------|------|--------|
| Go | [`go/clarkq`](go/clarkq) | Importable package, zero deps |
| Python | [`python/clarkq`](python/clarkq) | stdlib `urllib` only |
| JavaScript | [`js`](js) | Node 18+ / browser `fetch` |

These clients cover **plaintext / auth / enqueue / dequeue / peek / long-poll / clear / list**, plus **crypto helpers** for `client` and `server_rsa` modes.

| Lang | Crypto helpers |
|------|----------------|
| Go | `EncryptClientAES`, `DecryptClientAES`, `DecryptServerRSA`, `LoadRSAPrivateKeyFile` |
| Python | `encrypt_client_aes`, `decrypt_client_aes`, `decrypt_server_rsa` (needs `pip install cryptography`) |
| JS | `encryptClientAES`, `decryptClientAES`, `decryptServerRSA` in `crypto.js` (Web Crypto) |

## Quick examples

### Go

```bash
# from repo root (module replace not required if you copy the package)
cd sdk/go
# with a running server:
CLARKQ_URL=http://localhost:8080 CLARKQ_API_KEY=dev-key \
  go run ./example
```

```go
client := clarkq.New("http://localhost:8080", "dev-key")
client.Enqueue(ctx, "jobs", `{"task":"email"}`, nil, nil)
msg, _ := client.Dequeue(ctx, "jobs", clarkq.ReadOptions{Timeout: 5 * time.Second})
```

### Python

```bash
python sdk/python/example.py
```

```python
from clarkq import Client
c = Client("http://localhost:8080", api_key="dev-key")
c.enqueue("jobs", "payload", metadata={"source": "worker"})
msg = c.dequeue("jobs", timeout=5)
```

### JavaScript

```bash
node sdk/js/example.mjs
```

```js
import { Client } from "./clarkq.js";
const c = new Client("http://localhost:8080", "dev-key");
await c.enqueue("jobs", "payload", { source: "worker" });
const msg = await c.dequeue("jobs", { timeout: 5 });
```

## Auth

When the server enables API keys and/or JWT:

```http
X-API-Key: <key>
Authorization: Bearer <jwt-or-key>
```

Go client:

```go
c := clarkq.New(url, "api-key")
c.BearerToken = accessToken // OIDC / JWT
```
