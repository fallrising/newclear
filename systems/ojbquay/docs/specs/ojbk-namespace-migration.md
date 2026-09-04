# OJBK Namespace Migration

## Context

ojbquay is an independent implementation, but its current source tree retains a
legacy project token in public contracts, package names, metrics, broker
resources, tests, and documentation. Those names create unnecessary provenance
and affiliation ambiguity.

## Goal

Make `ojbk` / `OJBK` the only project namespace throughout the current tree
and all advertised Git history while preserving the implemented product
behavior.

## Non-goals

- Backward-compatible aliases for the legacy namespace.
- Migration of existing local or production data.
- Changing the `ojbquay` product or repository name.
- Making the GitHub repository public.
- Provider-side retention of unreachable objects or caches after every
  repository ref has been cleaned.

## Acceptance Criteria

- Given the current tracked tree,
  when the namespace validator runs,
  then no case-insensitive legacy token exists in tracked file contents or
  tracked paths.
- Given Java production and test sources,
  when the build runs,
  then packages use `dev.ojbk.*` and public SDK types use the `Ojbk*` prefix.
- Given the Protobuf contracts,
  when Java and Go sources are generated,
  then the source path is `ojbk/v1`, the wire package is `ojbk.v1`, and the Go
  package is `ojbkv1`.
- Given SDK production and consumption,
  when Java and Go interoperability runs,
  then clients call the renamed gRPC services and authenticate with
  `x-ojbk-token`.
- Given a fresh runtime stack,
  when configuration, delayed delivery, retry, DLQ, and observability paths
  execute,
  then internal topics, group IDs, headers, and metric families use the OJBK
  namespace.
- Given repository documentation and examples,
  when a user searches them,
  then only the OJBK namespace and independent-product description remain.
- Given a fresh mirror containing remote heads, tags, and pull-request refs,
  when ref names, commit messages, object paths, and reachable blob contents
  are scanned,
  then no case-insensitive legacy token is found.
- Given the tested feature tree before the history rewrite,
  when its rewritten equivalent is inspected,
  then its tree object is unchanged.
- Given the rewritten pull request,
  when the full CI workflow completes and the PR is merged,
  then all six jobs pass and the merged `main` remains private and clean.

## Constraints

- This is an intentional breaking contract rename; do not add aliases or
  fallback reads for the removed namespace.
- Protobuf field numbers and message semantics remain unchanged.
- Generated sources must be regenerated from the renamed Protobuf contracts,
  not edited by hand.
- Existing local Compose volumes are incompatible with renamed internal topics
  and must be recreated.
- GitHub repository visibility remains private.
- History rewriting requires explicit authorization, an exact recovery point,
  ref inventory, lease-protected force pushes, and post-push verification
  before the recovery point is removed.

## Assumptions and Unknowns

- The product has not been released to external users, so a clean contract
  break is preferable to a permanent compatibility layer.
- Existing CI and local environments are disposable and can start with new
  Kafka and PostgreSQL volumes.
- Package consumers will update imports and generated clients together with the
  server deployment.
- Completion of hosted-history removal means no advertised repository ref can
  reach the legacy namespace. Backend garbage collection of unreachable
  provider objects is outside repository-owner control.

## Design

Apply one explicit mapping across owned source and generated boundaries:

| Boundary | New namespace |
|---|---|
| Java group and packages | `dev.ojbk.*` |
| Java SDK public types | `OjbkProducer`, `OjbkConsumer`, `OjbkMessage`, `OjbkDelivery`, `OjbkException` |
| Protobuf source and wire package | `ojbk/v1`, `ojbk.v1` |
| Go generated package | `gen/ojbk/v1`, `ojbkv1` |
| Go SDK package | `ojbk` |
| Authentication and delivery headers | `x-ojbk-*` |
| Metrics | `ojbk_*` |
| Kafka internal topics and groups | `__ojbk.*`, `ojbk.*` |

A repository validator constructs the forbidden token from separate fragments
so the validator does not itself preserve the removed name. It checks both
tracked content and tracked paths and runs in the normal deployment-validation
gate.

## Steps

1. Add the failing namespace validator.
2. Rename hand-written packages, files, public types, contracts, and runtime
   strings.
3. Regenerate Go and Java Protobuf outputs.
4. Update tests, examples, dashboards, alerts, scripts, and documentation.
5. Run focused tests, full builds, SDK interoperability, and the clean Docker
   demo.
6. Inventory every remote head and tag, create an exact temporary recovery
   mirror and bundle, and rewrite paths, contents, and commit messages.
7. Verify tree identity and zero matching reachable history, then atomically
   force-push with explicit leases.
8. Refresh and verify the pull-request refs, run the full private CI workflow,
   merge the PR, and audit a new remote mirror before removing the recovery
   point.

## Verification

- `make generate-proto`
- `./deploy/validate-brand.sh`
- `./gradlew clean build --no-daemon --no-parallel`
- `go test ./...`
- `go vet ./...`
- `pnpm test`
- `pnpm build`
- `make validate-deploy`
- `./e2e/pull_share.sh`
- `make e2e`
- `git fsck --full` in a fresh post-merge mirror
- Case-insensitive scans of every mirrored ref name, commit message, object
  path, and blob reachable from remote heads, tags, and pull-request refs
