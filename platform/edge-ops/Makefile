.PHONY: check test-backend test-agent test-workerd test-browser demo

# Offline, credential-free gates; see docs/quickstart.md.
check: test-backend test-agent
	npm run check

test-backend:
	cd backend && npm ci && npm run check

test-agent:
	cd agent && test -z "$$(gofmt -l .)" && go vet ./... && go test -count=1 ./...

test-workerd:
	cd backend && npm ci && npm run test:workerd

test-browser:
	cd web && npm ci && npm run build && npm run test:e2e

# Loopback demo: built UI + API on http://127.0.0.1:8787 with seeded synthetic nodes.
demo:
	cd web && npm ci
	npm run demo
