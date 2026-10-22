ROLE: WORKER
AGENT: native independent document reviewer
ID: T-460
Goal: Independently review concrete AC05 measurement amendment proposal without approving product acceptance.
Why: Original approved SDD still fails; owner requires originaltext/reason/exactdifference/impact before any new contract agreement. This is expressly a new proposal, not interpretation of previous consent.
Inputs to read first: thisworktree SDD diff vs874517a8; docs/test-reports/retry-contract-decision-20261022.md; root docs/project-success/evidence/ojbquay-timing-decision-20261022; owner latest constraints; desk operating-method §0N3/§6; T455/T459 reports in siblingretry-repair.
Scope (may touch): .team/reports/T-0368-ojbquay-460.md only. Allsource/docs/evidence read-only.
Out of scope (must not touch): source/test/SDD edits, git mutations, contractapproval, dependency/deployment/tag, recursiveworkers or externalmodels.
Definition of done:
- [ ] Check exact proposed change is explicit response-completion→next fullbodyarrival versus originaladjacentarrivals, no runtimeanchor/warmup/fixture/numericlimit change. FixedACIDs preserved, onlyAC05 amended. Oldfailures unchanged, newdiagnosticnotqualification, originalv1 effectiveuntilowneragreement.
- [ ] Validate pairedintervals fromactualXML/source and reportedcounts/constraints; flag any misleading equivalence/guarantee/missingapproval/source evidence. Check document consistency and relative links. Report ACCEPT forreviewableproposal or findings; neverapproveproduct.
Verify with: gitdiff, readactualXML/log/source, scriptvalidators ifneeded; noheavybuildwhileotherworkersactive; teamctlreportvalidation.
Budget: onepass20min plusone root-requestedfollowup; norecursion.
