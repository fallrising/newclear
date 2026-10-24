# Issue548 — retain process-observation reasons

AC-D4: a precise fixed process-edge reason survives repeated fail-closed reads,
shutdown's snapshot and command cleanup into strict failure diagnostics. No
admission, signal, deletion, deadline, output schema or success gate is relaxed.

Implementation scope: five ProcessObservationError rethrows in lab.py, meaningful
regression coverage in tests/test_lab.py and diagnostic contract/status evidence.
Historical M4/AC-05 attribution is outside the proven correction and stays open.

Verification: deterministic failure before correction, real owned-process causal
probe, focused and whole Python3.11 offline checks, source invariance and child
collection, independent review, project/index checks, exact-head CI and normal
merge/readback. No local original-runtime replay is needed to prove reason
propagation; existing runtime evidence does not become a new candidate pass.
