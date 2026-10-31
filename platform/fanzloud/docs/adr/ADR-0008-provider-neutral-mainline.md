---
id: ADR-0008
title: Provider-neutral Web mainline rebaseline
status: proposed
date: 2026-10-31
deciders: [owner]
---

# Context

Owner requests the original provider-neutral Web coding-agent product, finite milestones and final user acceptance before further implementation. The Codex Cloud P0 path has actual browser/Rust/fake evidence, but live submission remains unrun. Successful private login and empty environment catalogs do not establish a working live path or prove every possible upstream interface unusable.

# Proposed decision

Adopt [SDD](../../SDD.md) as the finite delivery proposal: D0 document agreement, M1 one real Web task, M2 two vendors/two isolated tasks, M3 recovery and bounded fixed-candidate review. All FN-01–07 remain NOT_RUN.

Fanzloud owns the product entry and result presentation. Agent Platform is the first candidate for the sole isolated execution authority; compatibility is a qualification gate, not an asserted capability. Agent Workforce contracts are references, not a required daemon. Do not build another native agent loop or VM manager. The subscription/API route remains an explicit operator choice, with no paid fallback or credential-boundary relaxation.

This proposal requests a change to the delivery priority in TD §1.2–1.5 and the separate-product relationship. Effectiveness requires the owner’s desk-ledger decision; PORTFOLIO is subsequently synchronized as a summary, not the investment authority. It does not amend neighboring projects' accepted SDDs by implication. A compatible public adapter may be consumed; any change to their contracts needs its own bounded scope and review before integration.

# Supersession boundary

Until owner approval, existing accepted TD and ADRs remain normative for existing production code. On approval, this ADR and the SDD take precedence only for the new mainline delivery order and ownership described above. ADR-0002's private single-operator and secret-isolation requirements remain mandatory. ADR-0003's prohibition on presenting a provider-specific P0 orchestrator as a generic backend remains mandatory: the new adapter contract must be explicitly specified before implementation.

The existing Cloud adapter remains version-pinned and regression-tested; its live AC-04 stays pending and off the critical path. No historical acceptance is deleted, reclassified as live, or used to pass FN acceptance. No existing actor/store library is declared integrated by this decision.

# Evidence and decision gate

See [document review](../acceptance/REBASELINE-20261031.md). This is a proposed architecture, not a qualification receipt. The first executable qualification and final acceptance are defined in SDD §§4–6. Owner approval of the document does not certify an untested route, authorize new spending, or authorize deployment.
