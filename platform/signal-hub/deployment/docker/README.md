# Personal Linux Docker package

One non-root instance, one example source, explicit persistent data and backups.
Use Docker Engine and Compose v2 on **Linux**, Python 3.11+ and a non-root user
with access to the selected Docker daemon. Use a local daemon on this host:
bind paths and host networking refer to the daemon host. Docker Desktop, remote
daemons and rootless/user-namespace ownership mappings are not validated here.
No host changes, real-source enrollment or deployment are performed by this
package's tests. See [the personal-use contract](../../docs/sdd/06-security-operations-acceptance.md).

Run these commands from `platform/signal-hub/`. Initialize outside this build
context, in a parent you control. The initializer requires a new, absolute,
normalized path containing only ASCII letters, digits, `/`, `_`, `.` and `-`;
it refuses spaces, shell/env interpolation characters, symlink ancestors and
missing parents. Root UID, effective UID or primary GID and ports outside
1024–65535 are rejected before creation. Existing paths, including broken
symlinks, are never overwritten. Storage errors preserve partial state for
inspection; choose a new name rather than retrying into it.

```sh
mkdir -p "$HOME/.local/state"
STATE="$HOME/.local/state/signalhub-personal"
python3 deployment/docker/init.py --state-dir "$STATE" --port 8080
# Build context includes only allowlisted compilation inputs and bundled web assets.
docker build --tag signalhub:personal .
dc() {
  docker compose --project-name signalhub-personal \
    --env-file "$STATE/compose.env" -f deployment/docker/compose.yaml "$@"
}
dc config --quiet
dc up --detach --no-build --pull never
dc logs --tail 30 hub
```

Do not export conflicting `SIGNALHUB_*` variables: the shell environment takes
precedence over `compose.env`. The initializer writes your UID/GID and creates
0700 directories, 0600 config/env and three distinct 0600 role-token files;
it never prints token values. `config/config.json` enables only the synthetic
`demo` source (`urn:example:demo:` and `demo.event.*`), with no rules,
subscriptions or silence expectation. Review it before configuring one useful
actual source; retain distinct role/source credentials and file references.

The image uses the pinned official Go 1.26.8 multi-platform index, builds a
static binary with bundled IANA time-zone data (`timetzdata`), and copies the
CA bundle into a scratch image. Its default user is 65532; Compose uses your
non-root host UID/GID so private bind mounts remain writable without chown.
Config and secret directories plus the root filesystem are read-only. Data
and backups are the two writable mounts. Compose drops all capabilities,
enables no-new-privileges, caps CPU/memory/processes, and rotates Docker logs.
There is no shell or curl in the image. Keep config changes reviewed; Docker
access itself carries host-level privileges.

The listener is exactly `127.0.0.1:${SIGNALHUB_PORT:-8080}`, with no published
ports. Linux host network shares the host namespace, including outbound access;
it provides **no network isolation**. The local host can reach the service.
An existing approved tailnet-only proxy may reach loopback, but this package
does not configure that ingress. Do not change the listener to a wildcard or
publish it publicly. An occupied port causes startup to fail.

## Send and query one synthetic event

This example reads credentials directly from private files and keeps a stable
JSON envelope. Re-run it to observe HTTP200 with the original seq after HTTP202.
It never places a token in process arguments or prints one.

```sh
python3 - "$STATE" <<'PY'
import http.client, json, pathlib, sys
state = pathlib.Path(sys.argv[1])
settings = dict(line.split('=', 1) for line in (state / 'compose.env').read_text().splitlines())
body = json.dumps({'specversion': '1.0', 'source': 'urn:example:demo:manual',
  'id': 'personal-example-1', 'type': 'demo.event.created',
  'time': '2026-10-17T00:00:00Z', 'summary': 'synthetic first event',
  'data': {'synthetic': True}}).encode()
for method, path, role, payload in [
    ('POST', '/v1/events', 'source', body),
    ('GET', '/v1/events?limit=10', 'readonly', None)]:
    token = (state / 'secrets' / (role + '.token')).read_text().strip()
    conn = http.client.HTTPConnection('127.0.0.1', int(settings['SIGNALHUB_PORT']), timeout=10)
    conn.request(method, path, payload, {'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/cloudevents+json'})
    response = conn.getresponse()
    print(response.status, response.read().decode())
    conn.close()
PY
```

Query responses contain your event content; keep real-source responses private.
An identical retry returns200 with `duplicate: true` and the original `seq`.
Changed content with the same source/id returns409. Stop and investigate
401/403/400/413/409; preserve original bytes when retrying transient failures.

## Restart, stop and recreate

```sh
dc restart hub
dc up --detach --no-build --pull never --force-recreate
# Query the same event/seq again using the example above.
dc down
# Bind-mounted state remains; start it again with dc up.
```

Use one instance per state directory. Do not delete or copy a live SQLite file
as a backup. `down` removes containers, while your data, credential and backup
paths remain. Keep the old tested image/config before choosing an upgrade;
backup schema compatibility is governed by the runtime contract.

## Backup and isolated restore

Compose enables existing `-backup-dir`: a consistent SQLite snapshot and
`<snapshot>.manifest.json` are created at startup and every24 hours. Archive
purging is disabled. Backups are never automatically deleted. Same-host backups
are **not offsite backups**, and this cadence does not imply that losing24 hours
is acceptable. Choose additional manual/scheduled backups and approved offsite
storage according to the data's value; monitor disk usage.

Create a fresh named pair while the hub runs, using SQLite's backup mechanism:

```sh
SNAPSHOT="manual-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite"
dc exec --no-TTY hub /signalhub backup \
  --db /var/lib/signalhub/events.sqlite \
  --output "/var/backups/signalhub/$SNAPSHOT"
```

Retain the snapshot and its adjacent `.manifest.json` together, unchanged. The
restore CLI validates their size/hash/schema and refuses an existing destination.
Use a new directory, new credentials and an isolated network namespace. The
following restore command exits without starting a daemon:

```sh
RECOVERY="$HOME/.local/state/signalhub-recovery-$(date -u +%Y%m%dT%H%M%SZ)-$$"
python3 deployment/docker/init.py --state-dir "$RECOVERY"
docker run --rm --network none --read-only \
  --user "$(id -u):$(id -g)" --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 512m --cpus 1 --pids-limit 64 \
  --mount "type=bind,src=$STATE/backups,dst=/input,readonly" \
  --mount "type=bind,src=$RECOVERY/data,dst=/data" \
  signalhub:personal restore --backup "/input/$SNAPSHOT" \
  --db /data/restored.sqlite --reason 'isolated personal recovery check'
```

The new initializer config has no subscriptions, rules or external destinations,
and uses new role credentials. Do not replace it with a live config: persisted
queues must not reach real targets. A network-none startup checks that the
restored copy can initialize with this safe config:

```sh
RECOVERY_CONTAINER="signalhub-recovery-check-$$"
docker run --detach --rm --name "$RECOVERY_CONTAINER" \
  --network none --read-only --user "$(id -u):$(id -g)" --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 512m --cpus 1 --pids-limit 64 \
  --mount "type=bind,src=$RECOVERY/data,dst=/data" \
  --mount "type=bind,src=$RECOVERY/config,dst=/etc/signalhub,readonly" \
  --mount "type=bind,src=$RECOVERY/secrets,dst=/run/secrets,readonly" \
  signalhub:personal -config /etc/signalhub/config.json -db /data/restored.sqlite \
  -owner-token-ref file:/run/secrets/owner.token \
  -readonly-token-ref file:/run/secrets/readonly.token -listen 127.0.0.1:8080
# Wait for "signalhub listening on 127.0.0.1:8080"; investigate any startup error.
docker logs "$RECOVERY_CONTAINER"
docker stop --time 20 "$RECOVERY_CONTAINER"
# Query only the stopped restored copy; mode=ro refuses to create a missing DB.
python3 - "$RECOVERY/data/restored.sqlite" <<'PY'
import pathlib, sqlite3, sys
with sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri() + '?mode=ro', uri=True) as db:
    print('integrity:', db.execute('PRAGMA integrity_check').fetchone()[0])
    print('events:', db.execute('SELECT COUNT(*) FROM events').fetchone()[0])
    print('recent identities:', db.execute('SELECT seq,source,id FROM events ORDER BY seq DESC LIMIT 10').fetchall())
PY
```

This is an isolated startup plus a **SQLite query**, not an HTTP query from the
host; the recovery loopback is inside its own network namespace. It does not
prove resumed queue delivery. Keep the original pair and restored copy for
inspection. Do not replace a live DB, re-enable subscriptions or switch traffic
as part of this check. Actual recovery and replay require the selected instance's
reviewed procedure.

## Package verification

```sh
python3 -m unittest discover -s scripts -p test_docker_setup.py -v
python3 -m py_compile deployment/docker/init.py scripts/test_docker_setup.py scripts/e2e_docker.py
python3 scripts/e2e_docker.py --help
git diff --check
# Built separately above; choose a fresh path with an existing parent.
python3 scripts/e2e_docker.py --image signalhub:personal \
  --state-dir "$HOME/.local/state/signalhub-package-smoke"
```

The smoke selects an unused loopback port unless `--port` is supplied, runs the
actual Compose file with its production mounts/security/network, checks401/403,
202/200 and stable seq, recreates the container, verifies startup/manual backup,
then restores/starts a new network-none copy and queries it via read-only SQLite.
It requires local Docker and Compose; unavailable prerequisites fail clearly.
It never builds/pulls images, prunes resources, changes host configuration or
touches real state. Only uniquely named containers with the exact smoke-run
label are removed. Synthetic private state is preserved, with sanitized
`evidence/result.json`, `cleanup.json`, security facts and runtime logs kept
separately from credentials and DB files. A failed command retains evidence and
exits nonzero. Use this evidence for package wiring only, not actual deployment
or useful-source acceptance.
