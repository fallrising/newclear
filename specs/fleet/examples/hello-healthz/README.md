# hello-healthz

Minimal Fleet Catalog workload: `GET /` and `GET /healthz`.

```bash
docker build -t hello-healthz .
docker run --rm -p 127.0.0.1:8080:8080 hello-healthz
curl -sS http://127.0.0.1:8080/healthz
```

CI overlay: set `spec.image` via `POST /api/v1/deploy` (see `contrib/github-actions/deploy.yml`).
