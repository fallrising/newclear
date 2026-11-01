# Proposed contract correction: native forms and referrer policy

Status: APPROVED by owner on2026-11-01, current session:「好，按你建議。」
Approval observed at2026-11-01T10:59:22Z; exact message timestamp unavailable.
Implement only the proposed same-origin correction and preserve the remaining security contract.

Evidence: CI41279465196, source202da39a8ef1558394602c69609b9cf21290052a.
Sandbox preflight and native quality pass. Real browser6failed/2project-selection
skips. The no-JS desktop trace shows GET /scripts/new200 with
Referrer-Policy:no-referrer, then native multipart POST /scripts403 with
Origin:null and a CSRF cookie present. Other browser saves share that failure.
No raw cookie/token is reproduced here.

The unchanged SDD requires no-referrer at line91, exact Origin matching in the
CSRF contract, and no-JS native form operation. These do not compose in the
observed Chromium navigation. Accepting null origins or relying only on the
cookie/token would weaken the prescribed CSRF boundary; injecting Origin in a
test would not prove real browser behavior.

## Exact proposed changes

1. SDD section3 response headers: replace `Referrer-Policy: no-referrer` with
   `Referrer-Policy: same-origin`; explain that this keeps cross-origin referrers
   absent while allowing native same-origin form navigation to carry Origin.
2. web/src/index.tsx security header: same exact single-value replacement.
3. Add a focused response-header assertion; retain all missing/null/wrong-Origin
   rejection cases and double-submit checks. Browser journeys keep native submit
   and all original assertions, including JavaScript disabled.
4. Re-run required unit/integration/browser/PNG/CI gates on the approved source.

No API, identity, CSRF comparison, cookie, dependency, deployment or permission
change. Existing CSP also keeps form-action self. Approval of this correction
does not authorize staging or declare the product complete.

Alternative: preserve the contradictory contract and leave PR196 Draft until a
separate browser/auth design is approved. No compliant merge claim is possible
from the current failed browser evidence.

Primary reference: https://www.w3.org/TR/referrer-policy/#referrer-policy-same-origin — same-origin sends referrer only to the same origin; cross-origin referrer is omitted. Observed Origin behavior is established by the retained Chromium trace, not inferred from this reference alone.
