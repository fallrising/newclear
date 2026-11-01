# #379 owned-runner signals

Source base: d8ca3c40. Scope: offline owned runner SIGINT cleanup only.

- SIG-01: reproduce inherited ignored SIGINT on original fixture; establish explicit cooperative startup before resources/readiness, test ordinary/ignored states and real runner using owned fake Docker.
- SIG-02: preserve production 45-second timeout, ownership checks and incomplete-cleanup escalation.
- Verification: launcher-wrapped focused tests, offline component checks, project success index and whitespace; retained RED/GREEN logs.

No real Docker/database/VM/provider operations. Full #379/M4 remains incomplete. Parent owns commits, PR and independent acceptance.
