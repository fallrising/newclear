# Mini-SDD: Immutable proposal import core

Status: **Root-ACKed contract; execution evidence is tracked in PLAN and traceability**.
Parent: `accepted-spec-admission.md` HAI-ADMISSION-001/003/008;
`acceptance-persistence-schema.md` HAI-V2-005; ADR-001/004/005.
Baseline: `e58840115bc93deceaf3cde053159d0ee2cc799e`.
The original design snapshot and preimplementation ACK are retained in PLAN.
Oracle execution and acceptance are recorded separately; this document defines the contract.

## Authority and package boundary

**HAI-IMPORT-001**: This child is a trusted-call foundation. Add only
`backend/internal/specification` (pure typed import/codec) and
`backend/internal/gitobject` (bounded local object adapter), with tests in those
packages. The caller supplies a previously approved binding and local configuration; this child
cannot authenticate actors, approve repositories, query projects/WorkItems, deduplicate durable
records, acquire writer locks, persist proposals or move heads. No command, Store, SQL, transport,
runtime, dependency or workflow change follows. Future commands authenticate and authorize before
constructing/calling this foundation and recheck the captured binding version in their transaction.
The legacy repository string is never converted into approval here.

Use existing `domain.Digest`, `domain.ACRevisionBinding`, `reconcile.Node`, `reconcile.Edge` and
`reconcile.NewGraph`. Do not alter Graph validation, DiffGraphs or accepted-head semantics. Git
object identity is a separate format-tagged type; application content identities remain SHA-256.
Read Modern Go Guidelines for the module before each future Go edit batch.

## Exact public API

**HAI-IMPORT-002**: These signatures and field meanings are normative. The declarations omit
imports and private storage only. ID aliases reuse domain/reconcile types; there is no generic
untyped options, command, filesystem or subprocess type in the pure reader port.

```go
// package specification
type ObjectFormat string
const (
    SHA1 ObjectFormat = "sha1"
    SHA256 ObjectFormat = "sha256"
)
type ObjectID struct { /* private format ObjectFormat; hex string */ }
func ParseObjectID(format ObjectFormat, value string) (ObjectID, error)
func (id ObjectID) Format() ObjectFormat
func (id ObjectID) String() string
func (id ObjectID) IsZero() bool

type ObjectKind string
const (
    CommitObject ObjectKind = "commit"
    TreeObject ObjectKind = "tree"
    BlobObject ObjectKind = "blob"
)
type Object struct { Kind ObjectKind; Data []byte }
type Reader interface {
    Open(ctx context.Context, ref string) (Snapshot, error)
}
type Snapshot interface {
    Commit() ObjectID
    ReadObject(ctx context.Context, id ObjectID, maximumBytes int64) (Object, error)
    Close() error
}
type RepositoryBinding struct {
    ProjectID domain.ProjectID
    ID string
    Version uint64
    Digest domain.Digest
    ObjectFormat ObjectFormat
}
type Request struct {
    Binding RepositoryBinding
    Ref string
    ManifestPath string
}
type NodeBinding struct {
    WorkItemIDs []domain.WorkItemID
    RequiredACRevisions []domain.ACRevisionBinding
    RecipeDigest domain.Digest
}
type ImportedNode struct {
    ID reconcile.NodeID
    Path string
    BlobOID ObjectID
    ContentDigest domain.Digest
    Required bool
    Binding NodeBinding
}
type Manifest struct { /* private validated, sorted nodes/edges */ }
func ParseManifest(data []byte) (Manifest, error)
func (manifest Manifest) CanonicalJSON() []byte
type Proposal struct { /* private immutable captured fields, graph and encodings */ }
func Import(ctx context.Context, reader Reader, request Request) (Proposal, error)
func DecodeCanonicalProposal(data []byte, expected domain.Digest) (Proposal, error)
func (proposal Proposal) Digest() domain.Digest
func (proposal Proposal) Binding() RepositoryBinding
func (proposal Proposal) Commit() ObjectID
func (proposal Proposal) ManifestPath() string
func (proposal Proposal) ManifestBlobOID() ObjectID
func (proposal Proposal) ManifestDigest() domain.Digest
func (proposal Proposal) Nodes() []ImportedNode
func (proposal Proposal) Graph() reconcile.Graph
func (proposal Proposal) CanonicalJSON() []byte
func (proposal Proposal) NormativeJSON() []byte

type ErrorCode string
const (
    Invalid ErrorCode = "invalid"
    Capacity ErrorCode = "capacity"
    Integrity ErrorCode = "integrity"
    Unavailable ErrorCode = "unavailable"
)
type Error struct { Code ErrorCode; Field string; /* private cause error */ }
func (err *Error) Error() string
func (err *Error) Unwrap() error
```

There is no exported arbitrary Proposal constructor. Zero Proposal/Manifest is invalid and is never
returned with nil error. Import copies request values before I/O, validates them before Open,
calls Open exactly once, validates its nonnil Snapshot/Commit, and always closes the acquired
Snapshot on success/failure. Close failure discards the result; cancellation retains
`errors.Is(err, context.Canceled/context.DeadlineExceeded)` through wrapping. The reader is a trusted
port implementation, but every returned object is independently verified by the pure core. A nil
reader/context/snapshot, including typed-nil interface values, fails Invalid rather than panicking.
A Snapshot owns only one capture;
calls are sequential, never concurrent. The concrete Reader may serve independent Opens concurrently.

Errors do not contain source root, Git stderr, commit message, blob bytes or environment values.
Field names use bounded schema/path-component labels, never arbitrary source data. Graph validation
errors are wrapped as Invalid and remain inspectable with errors.As. No error class implies retry.

```go
// package gitobject; imports specification
type Config struct {
    GitExecutable string // trusted absolute regular executable, never PATH lookup
    GitDir string        // trusted absolute ordinary .git or bare Git directory
    ScratchDir string    // trusted absolute private scratch parent, same filesystem as objects
    ObjectFormat specification.ObjectFormat
    AllowedRefs []string // exact full refs, cloned at construction
}
type Reader struct { /* private cloned config */ }
func New(config Config) (*Reader, error)
func (reader *Reader) Open(ctx context.Context, ref string) (specification.Snapshot, error)
```

New validates configuration shape without running Git or inspecting a working tree. Open owns the
bounded filesystem checks/capture and sets its own 30-second deadline for direct callers as well
as Import; earlier caller deadlines win. Snapshot.ReadObject accepts maximumBytes only in
1..10 MiB, rejects larger/zero/negative values before execution, and independently sets its
2-second deadline. A Snapshot's private temporary facade is deleted by Close.
ScratchDir cannot overlap GitDir or its ancestors/descendants. Reject shared-worktree `commondir`
and .git indirection files: the trusted caller supplies the actual ordinary/bare Git directory.
These are local caller restrictions, not repository approval evidence.

## Strict manifest and validation

**HAI-IMPORT-003**: V1 input has exactly this schema; every field is required, including empty
arrays. Below `HEX64` means a nonzero lowercase SHA-256 string, not a literal fixture value.

```json
{"schema_version":1,"nodes":[{"id":"SPEC-A","path":"docs/a.md","required":true,"work_item_ids":["wi_A"],"required_ac_revisions":[{"ac_id":"AC-A","ac_revision_digest":"HEX64"}],"recipe_digest":"HEX64"}],"edges":[]}
```

Reject unknown/case-variant/duplicate member names at every level, invalid UTF-8, malformed string
escapes/lone surrogates, BOM, trailing JSON, null anywhere, missing fields, coercions, wrong
types and schema_version other than the integer token `1`. Object member ordering and insignificant
input whitespace are allowed; canonical output ordering is fixed below. Use strict Go 1.27
`encoding/json/v2` decoding with unknown-member rejection plus an explicit presence/type pass
where zero values cannot distinguish absence. Duplicate-name and UTF-8 rejection must remain
enabled; numeric tokens are checked, not rounded/coerced into a supported version.

IDs are 1..120 UTF-8 bytes with no Unicode control characters, whitespace, slash or backslash.
AC IDs use the same rule. Binding ProjectID/ID use this rule, Version is 1..2^63-1 (canonical
decoder requires the minimal unsigned decimal integer token, never fraction/exponent/negative), Digest is nonzero
and ObjectFormat is SHA1/SHA256. Binding digest is an opaque approved-configuration assertion;
this child cannot recompute approval or inspect binding_content. Strict digest decoding first
requires `[0-9a-f]{64}` then nonzero domain.ParseDigest; the domain parser alone is insufficient
because it currently accepts uppercase. OIDs similarly require lowercase 40/64 hex by format
and reject all-zero. All decoded object references must match the captured format.

Paths are 1..512 UTF-8 bytes, at most 32 slash-separated components each at most 255 bytes;
no absolute prefix, empty component, `.`, `..`, backslash, colon, NUL, Unicode control or whitespace.
No normalization, URL decoding, Windows separator translation or glob evaluation occurs. Reject
duplicate node IDs, duplicate node paths and a source path equal to ManifestPath. Require 1..10,000
nodes and 0..20,000 edges. Each node has 0..1,024 work_item_ids and 0..1,024 required_ac_revisions;
aggregate counts of each binding list are at most 20,000. Duplicate WorkItem IDs/AC IDs within a
node reject; shared IDs between nodes are legal. The same AC ID appearing anywhere must bind the
same revision digest. RecipeDigest is nonzero for every node. Required nodes need nonempty
WorkItem and AC lists; optional nodes may have empty lists. Mapped means work_item_ids is nonempty;
clients cannot submit mapped/binding_digest/content_digest/graph_revision_digest assertions.

Edges have exactly `from`, `to`, `kind`; allowed kinds are the four existing Graph kinds.
ParseManifest sorts and constructs reconcile.NewGraph using a fixed safe nonzero structural
placeholder (`domain.HashString("proposal-manifest-structural/v1")`) for revision/content fields
not yet read; this graph is private and never becomes an imported or normative revision. It rejects
duplicate/dangling edges, cycles and
unmapped required nodes. No AI/Markdown semantic inference or new edge direction exists. V1 has
no tombstone representation; null/missing source, tombstone extension and absent required source
reject, never produce a zero-digest required node. Future commands still validate actual project
membership and complete WorkItem required sets; a syntactically valid WorkItem ID is no authority.
Import rebuilds the actual Graph with verified source digests and rederived normative revision;
no placeholder escapes through Proposal or canonical encodings.

## Captured, normative and canonical identities

**HAI-IMPORT-004**: Every canonical encoder uses compact UTF-8 JSON, no BOM/newline/extra whitespace,
all declared keys present, explicit empty arrays, unsigned minimal decimal integer spelling and
lowercase hex. Keys occur in the exact order listed below, not map iteration. Encode strings with
the module's json/v2 canonical scalar encoder (no HTML escaping); a future version change that
alters bytes requires a new schema. Sort nodes by ID; edges by (from,to,kind); work_item_ids by ID;
required_ac_revisions by AC ID. Lexical comparisons are UTF-8 byte comparisons. Never silently
compact duplicates. Golden literal byte vectors bind field order, escaping and array sorting.

| Encoding | Exact ordered fields; nested object fields |
| --- | --- |
| ManifestV1 | schema_version,nodes,edges; node: id,path,required,work_item_ids,required_ac_revisions,recipe_digest; AC: ac_id,ac_revision_digest; edge: from,to,kind |
| NodeBindingV1 | schema_version,work_item_ids (canonical full list) |
| RequiredACV1 | schema_version,required_ac_revisions (canonical full AC list) |
| NormativeGraphV1 | schema_version,nodes,edges; node: id,content_digest,binding_digest,required_ac_digest,recipe_digest,required,mapped; edge as ManifestV1 |
| ProposalV1 | schema_version,repository_binding,object_format,commit_oid,manifest_path,manifest_blob_oid,manifest_digest,manifest,nodes,edges,graph_revision_digest; binding: project_id,id,version,digest; node: id,path,blob_oid,content_digest,required,work_item_ids,required_ac_revisions,recipe_digest; edge as ManifestV1 |

ProposalV1 `manifest` is the canonical decoded ManifestV1 JSON object, not a string/base64 value.
The proposal's nodes add only derived captured blob_oid/content_digest to each manifest node.
`manifest_digest` = SHA256(exact raw manifest blob bytes), so formatting changes create a different
proposal even when decoded meaning agrees. ContentDigest = SHA256(exact raw source blob bytes),
with no newline/BOM/Markdown conversion. BindingDigest = SHA256(NodeBindingV1);
RequiredACDigest = SHA256(RequiredACV1); RecipeDigest is the declared digest. Optional empty sets
still have the nonzero SHA-256 digest of their explicit empty-list envelope.

Graph.Revision() = SHA256(NormativeGraphV1); Graph.Node.Path retains the captured source path.
The normative encoding includes precisely the normative fields compared by DiffGraphs, and typed
edge topology; it excludes paths, manifest formatting, object-format/OIDs, commit, repository binding
and local/ref names. A stable-ID byte-identical rename, new commit or different approved repository
capture therefore changes Proposal identity while preserving graph revision and zero DiffGraphs
changes. Changing content, AC, WorkItem mapping, recipe, required/mapped or edges changes normative
revision. RequiredACDigest and BindingDigest must not include provenance by accident.

Proposal.Digest() = SHA256(ProposalV1). Git SHA1/SHA256 OIDs never substitute for any application
digest. Ref, absolute filesystem paths, timestamps, actor, Git version, output limits and scratch
location are excluded from identity. Identical binding/commit/manifest captures are deterministic
across Readers/restarts; deduplication remains a future durable command.

DecodeCanonicalProposal bounds input, verifies expected nonzero digest against exact input bytes,
strictly decodes all nested fields, reruns path/domain/mapping/Graph validation, regenerates ManifestV1
and both derived node binding digests and normative graph encoding, then verifies every duplicated
manifest/node/edge field, OID format, graph revision and byte-for-byte ProposalV1 canonical equality.
It requires raw captured `manifest_digest` and blob content digests to be valid, but cannot prove
their relation to absent raw Git objects: object verification is Import's responsibility. Decoder
success proves internal canonical/digest consistency, never repository authenticity. No silent
repair or re-import occurs. Mutating an input/output byte slice, Nodes' nested lists or Graph's
returned lists cannot mutate Proposal; all constructors and accessors make the necessary copies.

## Immutable object import

**HAI-IMPORT-005**: Import opens one snapshot after request validation, takes its single commit OID
and uses only explicit OIDs thereafter. Verify every raw returned object with:
`OID = Hash(object-kind + " " + decimal(len(data)) + NUL + data)` using SHA1 or SHA256 according
to captured format. Reject kind mismatch, wrong length/hash and unknown object kinds before parsing
or using any bytes. This check runs in the pure core even for a fake or hostile Reader.

Read the commit as raw commit bytes (not pretty output). Require one first-line
`tree <lowercase-full-OID>`, LF-terminated headers and a blank-line separator within the header
limit; reject repeated tree headers and malformed tree OID. Parent/author/message data are not
identity inputs and are never executed. The entire commit bytes are hashed. Annotated tag objects
are unsupported; an allowed tag ref is accepted only when it points directly to a commit.

Decode raw Git tree records `mode SP name NUL raw-OID` with format-sized binary OIDs, no textual
`ls-tree` parsing. Validate termination, unique names, exact modes and nonzero OIDs. Traverse only
manifest/source path components from the commit's root tree. Intermediate entries require mode
`40000` and tree type; referenced leaf entries require `100644` and blob type. Referenced or
traversed `120000`, `160000`, `100755`, malformed modes/names or type mismatches reject. Other
unreferenced tree entries are structurally decoded but not traversed or imported. Git pathspecs,
`commit:path`, shell quoting, symlink following and submodule recursion never occur. Cache verified
objects by format/OID for this single import only, counting unique raw bytes once; all paths are
still resolved independently against the same immutable root. Dirty working-tree files are never
inputs: this API has no worktree input mode or dirty-tree fallback. Their presence cannot replace
committed bytes and requires no working-tree inspection.

| Fixed limit | Value and accounting |
| --- | --- |
| Manifest | 1 MiB exact raw bytes |
| Source blob | 10 MiB each |
| Commit / commit headers | 1 MiB / 64 KiB |
| Tree | 4 MiB each; 20,000 records per decoded tree |
| Total object data | 50 MiB unique raw commit/tree/manifest/source bytes, verified before reuse |
| Unique objects / traversed depth | 50,000 / 32 path components |
| Canonical proposal / normative encoding | 16 MiB / 8 MiB |
| Whole Import / each subprocess | 30 seconds / 2 seconds; earlier caller deadline wins |
| Source object inventory | 100,000 entries including directories and ignored metadata, 2 GiB aggregate regular-file sizes; metadata only, no whole-pack copy |
| Loose ref / packed-refs | 256 bytes / 8 MiB; 100,000 packed records |
| Git stdout / stderr | requested object cap + 128-byte framing / 8 KiB |

Check aggregate limits using overflow-safe arithmetic before allocation/append. Include manifest
and source data once if their OID coincides; do not exclude tree/commit bytes from total accounting.
Exactly-at-limit controls pass; limit+1 fails Capacity, never truncates. Parsing/encoding/path loops
check context at bounded intervals. Import's private deadline wraps the caller for fake and real
readers; a trusted custom fake must honor context (an arbitrary malicious blocking Go method
cannot be forcibly stopped by this core). Git adapter also enforces every subprocess deadline.

## Sterile Git adapter and confinement

**HAI-IMPORT-006**: Only source object bytes and the one allowed ref value enter the facade.
Open validates an exact cloned allowlist entry; full refs must start `refs/heads/` or `refs/tags/`,
be at most 200 ASCII bytes and satisfy Git's full-ref rules without expressions, option prefixes,
`..`, `@{`, controls, colon, backslash, repeated/trailing slash/dot or `.lock` components.
There is no HEAD, abbreviation, revision expression or arbitrary command argument.

Resolve that exact ref once in Go: bounded regular-file read of `GitDir/<ref>` if present;
otherwise one bounded read of packed-refs. Reject symlinked path components, symbolic `ref:`
contents, duplicates/malformed relevant records and invalid/mismatched OIDs. Packed-refs comments
and valid peeled `^` records may be parsed but never supply the commit. A loose read cannot fall
back to packed-refs after malformed content. A ref moving afterward cannot change this snapshot.
Do not call Git against the source GitDir to resolve refs, discover format or inspect config.

Create a unique mode-0700 scratch facade. Generate `HEAD` with the captured OID and empty refs
directory, and generate a minimal config: core.bare=true, core.repositoryFormatVersion=0 for SHA1;
core.repositoryFormatVersion=1 and extensions.objectFormat=sha256 for SHA256. The config contains
only generated scalar constants. Never copy or include source config, hooks, refs, info, shallow,
commondir, objects/info, alternates, grafts, replacement refs, attributes, index, working tree,
commit-graph or multi-pack-index. Source shallow/partial/promisor/alternate metadata is rejected
when present (`shallow`, `objects/info/alternates`, `objects/info/http-alternates`, any
`objects/pack/*.promisor`); source replacement/graft/config include content is simply inaccessible
and cannot influence objects. A config-only partial-clone declaration causes no fetch because the
config is never read and the facade is complete only to its available captured objects.

Use os.Root for source/facade traversal and confinement, with Lstat on each traversed component;
an in-root symlink is also forbidden even when os.Root could follow it safely. Open bounded ref
and packed-ref files with nonblocking read flags, then f.Stat and require a regular file with
the same identity as Lstat before reading: FIFO/device/socket inputs never block or enter Git.
Inventory only the source objects directory with no symlink traversal; reject any symlink or
nonregular object file, enforce metadata limits and context. Bound directory enumeration itself
with incremental ReadDir batches and the entry counter, never unlimited os.ReadDir before counting.
Whitelist loose object files named
two lowercase hex directory characters plus the remaining format-specific hex characters, and
`pack/pack-<full-format-OID>.pack` with its matching `.idx`. Reject pack files lacking an index;
ignore other regular metadata (but reject `.promisor` as above). Never copy `info` data. Hardlink
only whitelisted regular loose/pack/index files into fresh facade object directories; no source
directories or symlinks are mounted/linked. Require same-file identity before/after link using
Lstat and os.SameFile; fail if source changes identity. Do not fall back to source GitDir,
GIT_OBJECT_DIRECTORY, alternates or byte copies on failure/cross-filesystem links. Fresh facade
directories cannot acquire source alternates/promisor/replace metadata through a directory link.
All writes/removals target the private scratch facade, never repository files.

The trusted local filesystem/OS must protect GitDir, ScratchDir and the executable from hostile
same-UID replacement during Open/use; an attacker controlling these or the process itself is outside
this foundation. Concurrent normal append-only object creation/ref updates are supported; races
with pruning or object replacement fail closed. Hardlinks preserve files across ordinary unlinking;
in-place object/pack corruption can cause an error or independently detected OID mismatch, never
change a verified Proposal. This confinement does not promise an OS sandbox for a compromised Git
binary or pack decoder. Per-process time/output/metadata limits bound this child's own work; OS
memory/CPU sandboxing is a separately authorized concern.

Invoke only the trusted absolute Git executable with the fixed argv prefix:

```text
--no-pager --no-replace-objects --git-dir=<private-facade> -c protocol.allow=never
-c core.hooksPath=<private-empty-hooks> cat-file --batch
```

Use exec.CommandContext directly, no shell, no path interpolation into revision expressions.
Send exactly `<validated-full-OID>\n` as stdin, then close stdin. Batch output is one
`<same-OID> <commit|tree|blob> <decimal-size>\n`, exact raw data and one terminal newline;
reject missing-object replies, oversized/malformed header/size, unexpected OID/type, truncated bytes,
extra output or nonzero exit. Read/bound the header before allocating object data. Bounded stdout
and stderr writers stop the process on excess; never CombinedOutput/ReadAll without a limit.
No `--filters`, `--textconv`, checkout, fsck, rev-list, fetch, diff, gc, init or subprocess-selected
program is used. Missing objects return Unavailable and cannot contact a remote.

The child receives an exact replacement environment, never os.Environ plus overrides: fixed
`LC_ALL=C`, `LANG=C`, `TZ=UTC`, private `HOME`/`XDG_CONFIG_HOME`,
`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_TERMINAL_PROMPT=0`, `GIT_NO_REPLACE_OBJECTS=1`, `GIT_OPTIONAL_LOCKS=0`, and
`GIT_ATTR_NOSYSTEM=1`. No inherited PATH/GIT_*/SSH/HTTP proxy/config-count/alternate-object variables
or provider credentials; command.Dir is the private facade. Only trusted absolute executable runs.
Drain pipes concurrently, cancel/kill on deadline/output excess, set WaitDelay at most 1 second and
always Wait; no leaked subprocess or facade on error. The fake runner for this private seam uses
one deterministic helper subprocess, never a production runtime hook.

This intentionally uses Git operations available in both required environments, Git 2.39.5 and
2.47.3; it does not depend on newer `--batch-command`, `--output-object-format` or
`GIT_NO_LAZY_FETCH` behavior. Compatibility is an executable oracle, not a version-string inference.
Both versions must run SHA1 and SHA256 fixtures (loose and packed), including hostile source config
and missing-object denial. No unsupported version silently skips required coverage.

## Private seams, lawful Red and oracle ownership

**HAI-IMPORT-007**: Private implementation functions keep I/O separate from validation:

```go
// specification
func verifyObject(id ObjectID, object Object, maximum int64) error
func commitTree(id ObjectID, data []byte) (ObjectID, error)
func decodeTree(format ObjectFormat, data []byte) ([]treeEntry, error)
func resolveBlob(ctx context.Context, snapshot Snapshot, root ObjectID,
    path string, budget *readBudget) (ObjectID, []byte, error)
func buildProposal(request Request, commit, manifestOID ObjectID, rawManifest []byte,
    manifest Manifest, nodes []ImportedNode) (Proposal, error)
// gitobject
func resolveRef(ctx context.Context, config Config, ref string) (specification.ObjectID, error)
func captureObjects(ctx context.Context, config Config, facade string) error
func (snapshot *snapshot) readObject(ctx context.Context, facade string, id specification.ObjectID,
    maximum int64) (specification.Object, error)
```

treeEntry contains private mode/name/id; readBudget contains private verified-object cache,
byte/object counters and context. Private DTOs preserve required-field presence and explicit types;
canonical DTOs/encoders never marshal private domain.Digest as a struct. No public adjustable
limits, alternate Git argv, process-runner injection or arbitrary object-store registry is added.
Root's pre-adapter clarification: the private readObject receiver owns the cloned trusted
configuration/executable. A private runBatch helper may receive that executable for deterministic
process tests; this is not a public injection point or global registry. The receiver fixes the
omitted executable/configuration dependency in the initial design sketch without changing its
public API, bounds, fixed argv or replacement environment.
Private test-only runner/budget seams can exercise exact boundary and cancellation behavior with
small data; all real production constants also receive positive/negative controls where affordable.
The 1 MiB public manifest budget and structural cardinalities are independent ceilings, not a
promise that one public fixture can reach every ceiling simultaneously. Test 10,000 nodes/20,000
edges and binding cardinality exact/+1 through private typed structural-validation seams with
valid IDs/digests and topology; separately assert that an otherwise structurally valid serialized
manifest exceeding 1 MiB is rejected by public ParseManifest/Import. Public positive controls
must fit all applicable ceilings; never label an impossible public fixture as an exact-limit pass.

T-151 owns exactly seven named top-level oracle groups: the four TestProposalCore groups live only
in specification; the three TestGitReader groups live only in gitobject. Each top-level name has
one source definition; adapter tests use specification's public API and their own private seams,
never reach across into private core helpers. Core budget/cancellation assertions are subtests
of ImmutableCapture/StrictManifest/CanonicalReadAndCopies as appropriate.
Subtests do not invent additional ownership.
T-152 independently reruns them and adds read-only attacks. T-153 checks name/hash inventory only.

| Named oracle | Required assertions |
| --- | --- |
| `TestProposalCore_ImmutableCapture` | Deterministic fake raw Git objects built from literal independent hashes; valid full import, binding/commit/manifest/source provenance and one Open; ref changes after Open ignored; sources change only by new commit; SHA1 and SHA256 recomputation reject forged commit/tree/blob/type; absent/malformed source and referenced symlink/gitlink/executable reject; typed nil, exact/+1 commit/tree/unique-object/raw-byte budgets, pre-cancel and context-honoring fake cancellation, Close counts and overflow-safe accounting |
| `TestProposalCore_StrictManifest` | Complete presence/unknown/duplicate/case/null/type/UTF8/version/path/ID/digest tables; canonical input reordering positive; duplicate mapping/conflicting shared AC, required unmapped, tombstone, cycle/dangling/duplicate typed edge negatives; public exact/+1 manifest byte controls and private exact/+1 node/edge/binding structural controls as distinguished above |
| `TestProposalCore_NormativeIdentity` | Independent literal canonical/golden hashes; ordering equality; change each binding/content/AC/recipe/required/edge dimension changes graph; rename, raw manifest formatting, commit/repository/OID-only changes preserve normative graph while changing proposal; actual DiffGraphs returns no rename change and correct substantive changes |
| `TestProposalCore_CanonicalReadAndCopies` | Import->canonical->decode equality; expected digest, internal field/graph/manifest mismatch, noncanonical bytes, uppercase/zero OID/digest, missing nested fields and +1 canonical budget reject even when outer digest is recomputed; byte/nested slice/Graph accessor mutations leave original unchanged; decode does not pretend absent raw objects were verified |
| `TestGitReader_RealObjectsAndRefCapture` | Real local SHA1/SHA256 loose and packed repos on Git 2.39.5 and 2.47.3; full Import through public adapter, independent exact object/content hashes; direct loose/packed ref, moving ref deterministic capture, dirty working-tree bytes ignored, tag-object/type mismatch and missing objects fail; no second source-ref resolution |
| `TestGitReader_Confinement` | Hostile config includes/hooks/filter/textconv/remote/replace/graft and poisoned inherited GIT_*/HOME/PATH/proxy env cannot execute marker helper or alter capture; source alternates/promisor/shallow/symlink/commondir and path escape reject; isolated source config cannot trigger missing-object fetch; constructor clone, source/scratch preservation and every failure cleans facade |
| `TestGitReader_BoundsAndCancellation` | Exact/+1 object inventory and object-size limits, caller-size range rejection; bounded stdout/stderr/header/truncated/extra/nonzero replies; direct-Open timeout, pre-cancel and cancellation during inventory/object read and hung helper subprocess; typed errors, Wait/Close counts, no surviving child, subsequent import succeeds; exact limit positive controls against the actual adapter accounting rule |

The preimplementation Red is lawful for new packages: after root ACK and Go-guideline read,
T-151 first adds minimal compileable public declarations and an Import stub returning a typed
Unavailable error with field `not_implemented`; it adds a valid independently hashed fake fixture
and the positive semantic assertion in `TestProposalCore_ImmutableCapture`. Run the focused test
on that stub, retaining its failing assertion `valid immutable import failed: not_implemented`
(or equivalent typed error). Both packages/module must compile; missing package/symbol/toolchain
or fixture corruption is not Red. Freeze that exact test/fixture before replacing the stub with
behavior. Adapter positive real-fixture subtests similarly fail semantically against its compileable
Open stub before implementation; negative input scaffolding must not be relabeled as baseline
behavior. Goldens are authored from literal JSON/raw-object byte vectors and independent SHA
calculations, never solely by invoking the encoder under test.

Required verification includes focused seven-group tests, full module tests/race/vet/build and
format/module checks, both Git versions' real-object fixtures, root diff/scope/task/report checks
and fresh independent native semantic review. Required unavailable tools/versions are explicit
NotRun and block implementation acceptance; they cannot become skips under passing named groups.
This design does not claim `TestAdmission_ProposalProvenanceAndCrashIsolation` durable completion:
auth, binding-version recheck, transaction/idempotency/result/audit, crash-orphan protocol and head
isolation are owned by the later command child. No first acceptance, activation, current-head
consumer, restore, runtime/UI or real-agent execution is implemented here.
