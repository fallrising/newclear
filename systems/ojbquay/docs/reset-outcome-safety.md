# Reset outcome safety

T-0374; approved SDD adca0174, AC09 remains partial.

Preparation uses the existing expiring lease. Immediately before submitting Kafka alter (after target validation), the owning physical PostgreSQL session checks its advisory key and atomically changes its matching, unexpired token lease to `expires_at = infinity`. This commit must succeed before submission. Expired or replaced owners fail closed. Once armed, the row cannot expire while a suspended owner or a timed-out Kafka operation may still mutate offsets.

Only successful alter acknowledgement plus matching offset readback clears the local uncertainty flag; cleanup then restores the original subscription state and deletes only its matching lease token. Any exception after arming retains the paused subscription and durable quarantine, returning `GROUP_RESET_OUTCOME_UNKNOWN`. Physical advisory sessions still close normally. Errors before arming retain existing restoration semantics. A lost SQL acknowledgement while arming is also treated conservatively.

There is deliberately no automatic timeout-based unlock or reconciliation endpoint in this slice. An operator must first fence/terminate the original executor and establish that its Kafka operations can no longer write, then reconcile the actual broker offsets and desired subscription state under exclusive maintenance. Merely waiting, observing the desired offsets once, or restarting the console is insufficient evidence. Do not delete the quarantine row based on those signals. A supported audited recovery workflow remains outstanding; leave the group paused until that workflow or a separately reviewed incident procedure is available.

Acceptance: real PostgreSQL demonstrates persisted quarantine after an unverified call, rejection of resume and subsequent reset, and no submission by an expired lease. Kafka adapter tests prove the guard precedes alter and readback is required. Successful/reset-preparation failure paths keep existing behavior. Tests do not claim real delayed-broker or two-runtime end-to-end acceptance.
