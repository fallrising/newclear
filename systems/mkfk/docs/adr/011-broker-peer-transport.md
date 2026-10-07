# ADR-011 — Broker process, peer HTTP/JSON transport, and bind policy

- Status: accepted
- Date: 2026-10-07
- Applies to: M7 and later; refines CSR ADR-008 and §9.5, §12.1, §12.3

## Decision

### Broker process

`cmd/mkfk format` initializes an empty data directory; `cmd/mkfk serve` never formats. Serve follows CSR §12.1: parse the exact topology bytes, take the data-dir lock, check the storage manifest, recover every local replica, start one `internal/partition` actor per replica (each with its own election timeout drawn from the OS random source), open the peer listener, then the client and admin listeners. `readyz` is true only while all three listeners serve and no partition actor has failed; it never means "leads every partition". SIGINT or SIGTERM stops admission, drains in-flight requests within `--shutdown-timeout` (an unfinished produce still answers `outcome: unknown`), stops the actors and their links, closes the logs, and releases the lock.

### Peer transport

Each Raft request is one HTTP POST on the peer listener. The receiver steps it on the partition's actor and answers with the algorithm-level reply in the body; responses never travel as separate requests.

| Path | Message |
| --- | --- |
| `/peer/v1/request-vote` | `request_vote`; reply `request_vote_response` with `vote_granted` |
| `/peer/v1/append-entries` | `append_entries` without a read context; reply with `success`, `matched_index`, `conflict_index` |
| `/peer/v1/read-barrier` | `append_entries` carrying a ReadIndex `read_context` |
| `/peer/v1/high-watermark` | HW proof request (below) |

Every message carries `cluster_id`, `config_hash` (SHA-256 of the exact topology bytes), `partition {topic,id}`, `kind`, `from`, `to`, `term`, and `rpc_id`. 64-bit values are canonical decimal strings; entry payloads are base64 so WAL bytes cross the wire unchanged. Bodies are capped at 8 MiB (one AppendEntries holds at most 128 entries and 4 MiB of frames before base64). Unknown fields, duplicate keys, a kind that does not match its path, bad base64, or an invalid topic are rejected before any actor sees them; a cluster or hash mismatch answers `IDENTITY_MISMATCH`. Raft still re-validates identity, term, and log matching.

Each local replica has one bounded FIFO link (256 messages, 1 s per call) per peer replica. A full link drops the message and a failed call is counted; Raft retransmits. A slow peer delays only its own link of that partition.

### High-watermark proof

`/peer/v1/high-watermark` answers only on the data partition's leader, after a current-term ReadIndex barrier (ADR-010 M7 section). A follower answers `NOT_LEADER` with the leader it last heard from; no broker forwards a proof request. The coordinator's proof source asks its local replica, then the named leader, then each other replica.

### Bind policy

The topology may list non-loopback listener addresses (an isolated Compose network, a private benchmark network), but they must be literal `IP:port`. `mkfk serve` refuses to bind a non-loopback listener unless `--allow-insecure-bind` is passed, and then logs a warning: there is no TLS or authentication (X4). The M0 rule that every manifest address is loopback moves from manifest validation to this serve-time check.

### Client routing

`NOT_LEADER` and `NOT_COORDINATOR` errors carry `details.leader_id` and `leader_term` when the broker knows the leader. `GET /v1/metadata` reports the leaders the answering broker observes. The Go `ClusterTransport` routes each call to the cached leader (or coordinator), follows a hint or moves to the next broker on a routing error and retries at once (those answers are `not_applied`), and on a connection error moves the route but returns the error, because its outcome is unknown and the caller resends the identical request.

## Consequences

- Peers are trusted: anyone who can reach a peer listener can join Raft traffic. Loopback-only or an isolated network is a hard requirement until X4.
- `GET /v1/fetch` answers immediately; `max_wait_ms` is validated but long polling is not implemented.
- Links send one request at a time per partition and peer; there is no pipelining. Throughput numbers from M7 benchmarks reflect this.

## Rejected alternatives

- One-way peer messages with responses sent back as requests: it would satisfy delivery but not CSR §9.5's rule that the HTTP body carries the algorithm-level answer.
- Forwarding client requests from followers to the leader: it hides leadership from clients and adds a second unknown-outcome hop; hints keep the retry decision with the client that owns the identity.
