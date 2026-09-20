# <Feature title> verification

## Environment and source
- Spec: `<relative spec path>`
- Base SHA: `<40 or 64 hex immutable commit SHA>`
- Verification time (UTC): `<YYYY-MM-DDThh:mm:ssZ>`
- Data/provider classification: `<synthetic/local/provider alias>`

## Acceptance evidence

| Criterion | Status (pass/fail/not-tested) | Command or evidence ID | Exit code | Notes |
|---|---|---|---:|---|
| <criterion ID/text> | not-tested | <command or evidence ID> | <0 or -> | <result/limitation> |

## Checks run

| Command | Exit code | Result |
|---|---:|---|
| `<repository-native command>` | <0> | <summary> |

## Changed paths and security
- Changed files: `<list or none>`
- Allowlist check: <pass/fail/not-tested>
- Symlink/path escape check: <pass/fail/not-tested>
- Secret scan: <pass/fail/not-tested>

## Final assessment
- Gate: <PASS | CODE_COMPLETE_EXTERNAL_PENDING | BLOCKED>
- External evidence still required: <none or explicit items>
- Risks and open questions: <none or explicit items>
