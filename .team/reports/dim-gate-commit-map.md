# dim-gate M0 Git transport evidence

The local HTTPS Git push failed before publishing any ref: `fatal: could not read Username for https://github.com: No such device or address`. The already-authorized GitHub connector supports Git blob/tree/commit/ref creation. The orchestrator used that supported API, verified each complete tree SHA, and created only `agent/dim-gate/mainline/m0-foundation`. No credential extraction, global setting change, force update or main write occurred.

The connector's commit operation cannot set author/committer timestamps, so its commit hashes differ from local objects even with identical trees. Original local hashes remain in immutable worker reports; use this mapping to retrieve their complete source trees from the remote repository. Commit messages also preserve local-commit and verified-tree trailers.

| Local commit | Durable remote equivalent | Identical complete tree |
| --- | --- | --- |
| `9c79e627265124555bec83b3033b3a88b360519c` | `8127742d3e9964e9ee3b7d255c6ddbdf283053eb` | `65778c6bdecfdc296c802e374bccd0a1fed5b063` |
| `a8258b08f0f1a1720f81362e555fd04415b23e42` | `f9efc5c399f90572bb8e765c4ee5e96ff72ec74b` | `e6285a14e4d134effae3703c58c6a7aee5c945b3` |
| `352ce0a39af29d3190e0af213d61e727ddae5256` | `3fd07ab235b437b27bf63bddc1c3d4a272fb686a` | `d2a57ac10b32f71f5bd2ebbbfe68349ab2ba2ec1` |
| `56ca8d0b1f1445f1473ccf3725ec53e0b4a9d45a` | `e7d74275b1bbf157ab8d1888e3d482e95fb647b2` | `9880368a9bfde197a2172d5f5108fb383eef9633` |

Fresh-install local native checks and the initial independent review targeted local `56ca8d0`. [Initial CI run](https://github.com/fallrising/newclear/actions/runs/35509526982) checked synthetic PR merge `c2601922d9c8b6b5f71baf74379691e8612ab544`, with parents source main `1117d297aa3efef9472d847c9dfa5714eb6c4460` and remote `e7d7427`. Its full tree was verified through the GitHub Git Commit API to be the same `9880368a...`. This proves source equivalence, not acceptance: review found issues after those tests passed, and later correction evidence supersedes it.

The original local history is preserved on `agent/dim-gate/mainline/m0-local-history`. The working branch was cleanly recreated at the remote equivalent after an empty full-tree diff. Future continuation should fetch the named remote branch, not assume local-only object IDs resolve on GitHub. [PLAN](../PLAN.md) and the final integration report identify the accepted durable implementation and checkpoint.
