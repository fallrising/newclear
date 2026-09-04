# Deploying clarkQ

## Docker Compose

```bash
# from repo root
cd deploy
export CLARKQ_API_KEY=dev-key
docker compose up --build -d

curl -H "X-API-Key: dev-key" http://localhost:8080/health
curl -H "X-API-Key: dev-key" -X POST http://localhost:8080/api/v1/queue/orders \
  -H "Content-Type: application/json" -d '{"body":"hello"}'
```

Data (snapshot + WAL) is stored in the `clarkq-data` volume at `/data`.

### Sharded cluster demo

Minimal 2-node Compose (manual curl):

```bash
docker compose -f docker-compose.cluster.yml up --build -d
# clients may use either node:
curl -H "X-API-Key: dev-key" http://localhost:8081/health
curl -H "X-API-Key: dev-key" http://localhost:8082/health
```

Queue ownership is consistent-hashed across nodes; non-owners reverse-proxy.

**Automated multi-node scenarios** (recommended): 3-process or 3-container
suite under [`../demo/cluster/`](../demo/cluster/) — membership, shard forward,
replication, failover, quorum smoke, concurrent load:

```bash
cd ../demo/cluster && ./run-cluster-demo.sh
```

## Prometheus metrics & alerts

Scrape **`GET /metrics`** (public). Example scrape config and alert rules:

```text
deploy/prometheus/
  README.md
  scrape.example.yml
  alerts.yml          # ClarkQTargetDown, ReplicationErrors, OutboxBacklog, …
```

See [prometheus/README.md](prometheus/README.md).

## Helm

```bash
# build/push image first, then:
helm install clarkq ./helm/clarkq \
  --set image.repository=your-registry/clarkq \
  --set image.tag=latest \
  --set config.apiKey=change-me
```

Enable HTTPS + mTLS:

```bash
helm upgrade --install clarkq ./helm/clarkq \
  --set tls.enabled=true \
  --set tls.secretName=clarkq-tls \
  --set tls.clientCASecretName=clarkq-client-ca
```

Create TLS secrets beforehand:

```bash
kubectl create secret tls clarkq-tls --cert=server.crt --key=server.key
kubectl create secret generic clarkq-client-ca --from-file=ca.crt=client-ca.crt
```
