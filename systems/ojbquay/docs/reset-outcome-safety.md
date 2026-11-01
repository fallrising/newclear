# Reset outcome safety

Part of AC-09 in the [SDD](../SDD.md).


Preparation uses the existing expiring lease. Immediately before submitting Kafka alter (after target validation), the owning physical PostgreSQL session checks its advisory key and atomically changes its matching, unexpired token lease to `expires_at = infinity`. This commit must succeed before submission. Expired or replaced owners fail closed. Once armed, the row cannot expire while a suspended owner or a timed-out Kafka operation may still mutate offsets.

Only successful alter acknowledgement plus matching offset readback clears the local uncertainty flag; cleanup then restores the original subscription state and deletes only its matching lease token. Any exception after arming retains the paused subscription and durable quarantine, returning `GROUP_RESET_OUTCOME_UNKNOWN`. Physical advisory sessions still close normally. Errors before arming retain existing restoration semantics. A lost SQL acknowledgement while arming is also treated conservatively.

There is deliberately no automatic timeout-based unlock or reconciliation endpoint. Merely waiting, observing the desired offsets once, or restarting the console does not by itself prove the outcome; the operator follows [Offset reset outcome unknown](operations.md#offset-reset-outcome-unknown): stop the original executor, read and if needed set the broker offsets, then release the fence and resume.

Acceptance: real PostgreSQL demonstrates persisted quarantine after an unverified call, rejection of resume and subsequent reset, and no submission by an expired lease. Kafka adapter tests prove the guard precedes alter and readback is required. Successful/reset-preparation failure paths keep existing behavior.
