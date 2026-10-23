#!/usr/bin/env bash
# Same-commit mainline qualification for systems/ojbquay; logs in $2.
set -uo pipefail
R="$1"; L="$2"; S="$3"
RUN="docker run --rm --network host -u $(id -u):$(id -g) --group-add $(stat -c %g /var/run/docker.sock) -e HOME=/tmp -v /var/run/docker.sock:/var/run/docker.sock -v $R:$R -v $S/checks:/checks:ro -w $R"
step() { local name="$1"; shift; echo "== $name $(date -u +%FT%TZ)"; if "$@" >"$L/$name.log" 2>&1; then echo "PASS $name"; else echo "FAIL $name (exit $?)"; fi; }
cd "$R"
echo "source $(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l)"
step teardown $RUN -e KEEP_STACK=0 ojbquay-runner:local sh -c 'docker compose -p ojbquay-e2e -f deploy/compose/docker-compose.yml --profile e2e down --volumes'
step gradle-build $RUN -e TESTCONTAINERS_RYUK_DISABLED=true -e GRADLE_USER_HOME=/gh -e HOME=/gh -v "$S/gradle:/gh" eclipse-temurin:25-jdk ./gradlew clean build --no-daemon --no-parallel --no-build-cache --console=plain
step go-test sh -c 'cd sdk/go && go vet ./... && go test -count=1 ./...'
step validate-deploy $RUN ojbquay-runner:local make validate-deploy
step compose-e2e $RUN -e KEEP_STACK=1 ojbquay-runner:local make e2e
line="$(grep COMPOSE_E2E_OK "$L/compose-e2e.log")"
topic="$(sed -n 's/.* topic=\([^ ]*\).*/\1/p' <<<"$line")"; sub="$(sed -n 's/.* subscription=\([^ ]*\).*/\1/p' <<<"$line")"
step ac01-ac07 $RUN ojbquay-runner:local bash /checks/extra.sh "$R" "$topic" "$sub"
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:28080/actuator/health/readiness >/dev/null 2>&1 && break; sleep 2; done
step console-stack docker run --rm --network host --ipc=host -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$R/console-web:$R/console-web" -w "$R/console-web" mcr.microsoft.com/playwright:v1.62.0-noble ./node_modules/.bin/playwright test -c playwright.stack.config.ts
step console-mock sh -c "cd console-web && pnpm test && pnpm build && docker run --rm --network host --ipc=host -u $(id -u):$(id -g) -e HOME=/tmp -v $R/console-web:$R/console-web -w $R/console-web mcr.microsoft.com/playwright:v1.62.0-noble ./node_modules/.bin/playwright test"
step teardown-e2e $RUN ojbquay-runner:local sh -c 'docker compose -p ojbquay-e2e -f deploy/compose/docker-compose.yml --profile e2e down --volumes'
step pull-interop $RUN -e OJBQUAY_GRADLE_CACHE=$S/gradle-interop -e OJBQUAY_GO_CACHE=$S/go-interop -v $S:$S ojbquay-runner:local ./e2e/pull_share.sh
step teardown-interop $RUN ojbquay-runner:local sh -c 'docker compose -f deploy/compose/docker-compose.yml down --volumes'
echo "== done $(date -u +%FT%TZ)"
