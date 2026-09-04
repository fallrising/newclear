# clarkQ Python client

Stdlib-only HTTP client for clarkQ.

```bash
python example.py
```

```python
from clarkq import Client
c = Client("http://localhost:8080", api_key="dev-key")
c.enqueue("jobs", "hello")
msg = c.dequeue("jobs", timeout=5)
```
