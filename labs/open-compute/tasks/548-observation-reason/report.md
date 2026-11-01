# Issue548 — diagnostic reason retention

The original precise process-edge error was lost when shutdown called snapshot
again: the sticky rethrow defaulted to unknown and overwrote observation_reason.
Four sticky read boundaries and the command cleanup rethrow now propagate the
existing reason through ProcessObservationError's fixed allowlist. All prior
refusals and lifecycle behavior remain intact.

Regression evidence: the extended seven-reason/six-boundary test produced42
failing subcases on unchanged production. After correction25 focused process
tests pass. Coverage verifies no additional scan/admission/signal, no clean
success and the exact strict storage diagnostic. Missing/private reasons remain
unknown and a secret canary never reaches the public record.

Root whole discovery on Python3.11.17 with PYTHONPATH unset passes319 tests in
31.458s, zero failures/errors/skips. The reviewed wrapper verifies all source
hashes unchanged, accounts for the exact known M5 SIGKILL fixture orphan and
requires actual ECHILD with no unexpected descendants. Source manifest digest:
`063b5ed454bb3a742294a163be8cc71653ba11eb98214bd435f39f9373e6bfb6`.
An initial verification-wrapper import failed before tests started; its explicit
trusted component path was corrected. That invocation remains recorded separately.

Independent author-other review accepts all seven files and verifies production
AST equality after removing exactly the five new reason arguments. Its25 focused
tests and one real-process probe pass: child_missing survives stop/projection,
cleanup still refuses success, exact owned children are reaped and threads close.
The corresponding original-source probe recorded child_missing becoming unknown;
a first probe profile-name typo is retained separately. Root also passes42 project
contracts, five navigation indexes and staged whitespace checks. Final hosted
CI/publication remain required. No local upstream
runtime was rerun; historical M4/AC-05 remains failed/unresolved, mainline
incomplete and usable_tag none. This fixes diagnosis, not the unknown old race.
