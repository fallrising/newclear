# Spring Pool

Follow the repository's engineering and delivery agreement. Start with
[SUCCESS.md](SUCCESS.md), the unchanged [SDD](docs/SDD.md), its
[API contract](contracts/openapi.json), and the [task board](docs/tasks/BOARD.md).

The SDD's fixed `T-*` scenarios remain the acceptance authority. The success
document groups them for navigation; it does not replace or relax them. Keep
local synthetic evidence separate from protected staging and owner acceptance.
Preserve the private API, verified actor, CSRF, immutable revisions and no-execution
boundaries when filling the missing web implementation.

Record exact checks and remaining gaps before delivery. The existing package
scripts, Rust checks and root index checks are the verification entry points.
