# ADR-014 — Raft pre-vote: evaluated, not implemented

- Status: accepted as a decision not to implement
- Date: 2026-10-19
- Applies to: the election in [02 §3](../sdd/02-replication.md). This ADR does not change that section, the persistent format, or any invariant.

## Context

A follower that times out becomes a candidate, increments `currentTerm`, persists a vote for itself, and sends `RequestVote`. A receiver of a higher term persists that term and steps down to follower before it decides the vote. Both rules are in 02 §3, and `raft.(*Node).Step` follows them: any higher term calls `becomeFollower` first. For a higher-term `RequestVote`, only a granted vote resets the election timer. `AppendEntries` from the current leader resets it as well (`stepAppendEntries`).

The effect is that one `RequestVote` from a candidate that has not won a quorum deposes the current leader. The vote can then be refused because the candidate's log is stale. The candidate becomes leader only with a majority of granted votes, whether or not that refusal is delivered. The leader has already left the term in which it was serving. `TestHigherTermRequestVoteFromUnconfirmedCandidateStepsDownLeader` records that sequence.

ADR-012 stopped a refused vote from resetting up-to-date election timers, so a stale candidate can no longer prevent an election forever. It does not stop the term bump itself. There is no pre-vote, and there is no check-quorum. `leaderReady == false` in `becomeLeader` and `clearLeaderState` is only the current-term NOOP barrier.

Two observations motivated the question, and they are not the same event:

- On a slow overlay path, RF3 leadership moved through high terms. The write-up infers that heartbeats were late, and attributes the elections to the absence of pre-vote ([adr-013-real-host](../benchmarks/adr-013-real-host.md)). That note records pair RTTs of 29 / 44 / 50 ms. No per-link delay/loss was recorded during the run, so the late-heartbeat account stays an inference.
- On environment B, one follower in `rf3-isr2-b1-p1` did no fsyncs and wrote no logs for a whole 60 s window ([m7-environment-b](../benchmarks/m7-environment-b.md), finding 4). Two later diagnostic reruns on B did not reproduce it. ADR-013 added slow-fsync and actor-stall logs so a rerun could explain it. That rerun is issue #401 and is outside this ADR.

## Options

1. **Pre-vote.** A prospective candidate asks peers whether they would grant a vote at `term+1` without incrementing or persisting its own term. Peers answer without adopting the term or stepping down. Only a quorum of positive answers starts a real election, which then increments the term and sends `RequestVote` as §3 describes today. A node that cannot reach a quorum never publishes the higher term, so it cannot depose a leader that the rest of the group can still hear. This is the extension aimed at the overlay observation. Implementing it changes §3: a timeout would no longer increment the term before a quorum agrees that an election can succeed, and the first message a peer sees would not be a higher-term `RequestVote`. Not implemented.

2. **Check-quorum.** A leader steps down when it has not heard from a quorum of voters inside an election timeout, instead of serving until a higher term arrives. That stops a leader which has lost the majority from accepting writes. It does not stop a follower from raising the term, so it is not a substitute for pre-vote. It also adds a step-down that §3 does not specify (§3 steps a leader down on a higher term). Not implemented.

3. **Longer election timeout** (ADR-013 option 5). A deployment knob. A follower that still times out deposes the leader in the same way, only later. It does not change the `RequestVote` rule.

4. **Ticks separate from fsync** (ADR-013 option 4). Election timing would not wait on the partition actor's sync, so one slow sync would not by itself start an election. ADR-013 does not recommend it without evidence that healthy disks stall often: a leader that cannot persist should not keep claiming leadership, and the change weakens the single-owner model. It does not change the `RequestVote` rule, and it does not explain a follower that logs nothing for 60 s.

## Decision

Do not implement pre-vote or check-quorum. 02 §3 stays as written. Options 3 and 4 stay undecided, as in ADR-013. The deterministic test locks the current step-down. A later change that adds either extension has to edit §3 first and replace that test; this ADR is not permission to do that inside an implementation PR.

## Consequences

- RF3 on a path where heartbeats arrive later than the election timeout can still lose the leader. That matches §3.
- Issue #401 is still the way to learn whether environment B's silent follower happens again. This ADR does not answer it.
