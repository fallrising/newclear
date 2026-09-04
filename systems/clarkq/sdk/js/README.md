# clarkQ JavaScript client

Fetch-based client for Node 18+ and modern browsers.

```bash
node example.mjs
```

```js
import { Client } from "./clarkq.js";
const c = new Client("http://localhost:8080", "dev-key");
await c.enqueue("jobs", "hello");
const msg = await c.dequeue("jobs", { timeout: 5 });
```
