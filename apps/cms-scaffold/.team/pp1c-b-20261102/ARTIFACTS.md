# Evidence representation

`EVIDENCE.md` maps checks to their original artifact names. Generated logs and diffs containing trailing whitespace are published as lossless `<original-name>.encoded.json` files; `artifact-encoding.json` maps each original path to its encoded path, byte size and SHA-256. The JSON `text` field encodes the exact UTF-8 bytes. Raw originals remain in this worktree and the private evidence backup. This representation preserves failed output and permits the repository's whitespace check without editing historical tool output.

To inspect an encoded artifact, read its `text` field. To verify bytes independently, UTF-8 encode that field and compare its SHA-256 and length to the envelope. Do not overwrite an existing raw artifact with a different payload.

Source snapshots and checkpoint counts are historical inputs, not additional product modules. Runtime data, secrets, raw inventories, dumps, media, generated classes and local containers are not Git publication artifacts. Runtime summaries contain only fixed codes, counts, hashes and opaque identifiers.
