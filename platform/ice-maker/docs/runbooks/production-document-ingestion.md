# Production document ingestion

## Capability doctor

Run `scripts/document-ingestion-doctor.sh` on the intended host; append
`--json` for stable machine-readable evidence. It is read-only and offline,
prints no environment values, creates no persistent files, and returns 0 for
`runtime-ready`, 1 for `host-capable`, and 2 for `unsupported`.

The floor is Linux x86-64, 4 logical CPUs, 8 GiB available memory, and 20 GiB
free data-volume space. Host capability additionally requires reachable Docker
with cgroup limits, seccomp, and AppArmor. Runtime readiness additionally
requires Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), Tesseract with configured
languages, and Pillow, FastAPI, Uvicorn, and python-multipart. GPU absence is
not a failure.

## Measured host observation

Observation date: 2026-09-03. This is dated evidence, not a hard-coded doctor
result, and must be refreshed on the deployment host.

- Linux x86-64; 6 logical CPUs.
- 25 GiB total RAM and 16 GiB available RAM.
- 147 GiB free data-volume disk space.
- No GPU observed.
- Docker reachable; cgroup resource limits, seccomp, and AppArmor usable.
- Python 3.11 available.
- Host Poppler/Tesseract parser and OCR commands, and host Python packages,
  were missing at observation time.

This clears the capacity and Docker host floor but is not runtime-ready until
the pinned local container supplies the missing stack.

## Supported capability and evidence boundary

The current local capability is a single-operator, loopback-only service for a
canonical batch of at most 100 PDF, PNG, JPEG, or WebP files. It performs
native PDF extraction, page-level OCR fallback, width-aware long-image tiling,
NFKC text normalization, local FTS5 indexing, content-addressed cache reuse,
and durable restart recovery. One item may contribute at most 10,000 chunks;
the complete local index is bounded at 1,000,000 chunks. The tracked hard
ceiling is two parser/OCR workers; the measured host should start with one
10-document pilot before attempting 100 files.

Generated tests are control evidence only. They prove the service and
coordinator contracts with exactly 70 PDF-shaped and 30 image-shaped inputs,
including native/scanned/mixed routing markers, a long-image rectangle,
duplicate content, one corrupt item, one denied item, and separate unsupported
and over-limit uploads. They do not prove OCR accuracy, Poppler compatibility
with the owner's PDFs, or safe execution of hostile files. Rootless and
network-disabled sandbox evidence, representative real-corpus results, and
owner-attested limits, languages, rights, data classes, and quality thresholds
remain external gates. The maximum status is `DEVELOPMENT_COMPLETE`, never
`PRODUCTION_READY`.

## Build and start

Run these commands from the Ice Maker repository. The data directory must be a
new, absolute, non-home directory on a volume with at least 20 GiB free. It
contains raw uploads and derived text, so give it private permissions and never
place it inside a Git checkout.

```sh
scripts/document-ingestion-doctor.sh --json

install -d -m 0700 /absolute/private/ice-maker-data
scripts/build-document-service.sh
scripts/run-document-service.sh /absolute/private/ice-maker-data 18080
curl --fail --silent --show-error http://127.0.0.1:18080/healthz
```

Doctor exit code 0 means the host runtime is ready; exit code 1 means the host
capacity and Docker isolation floor pass and the container must supply missing
runtime packages; exit code 2 is unsupported. The first image build may need
network access to obtain the digest-pinned base and snapshot-pinned packages.
Runtime parsing has no network. The accepted local build used image revision
`832ce5d089a0a8523be394cf99d041a9a8844f14fa384e159f7ce0716fa93086`;
rerun the build script whenever tracked runtime source changes because the
revision label is source-derived.

The parser container has `--network none` and no published ports. A separate
restricted relay binds only `127.0.0.1`, mounts only the Unix-socket runtime
directory, and cannot see the document data tree. Open
`http://127.0.0.1:18080/` in a browser to use the upload form. Do not expose
this port through a reverse proxy, tunnel, LAN bind, or firewall rule; there is
no authentication or remote-access security profile.

## Prepare metadata and upload

For the browser form, select 1–100 files and choose one rights/data-class pair
for that upload. Use `chi_tra,eng` for Traditional Chinese plus English. If
files have different policies, split them into separate uploads or use the API
with one metadata object per file. An API request has this exact shape:

```sh
metadata='[{"data_class":"internal","languages":["chi_tra","eng"],"name":"architecture.pdf","rights":"confirmed","size":12345}]'
curl --fail-with-body --silent --show-error \
  -F 'files=@/absolute/corpus/architecture.pdf;filename=architecture.pdf' \
  -F "metadata=$metadata" \
  http://127.0.0.1:18080/api/batches
```

The filename and declared byte size must match exactly. Rights are
`confirmed`, `unconfirmed`, or `denied`; data classes are `public`, `internal`,
`confidential`, or `restricted`. Begin conservatively with `unconfirmed` and
`restricted`. A denied item is retained as a safe rejection, not processed.
Never infer rights or sensitivity from a filename.

For a uniformly classified directory, the following copy-paste command builds
the multipart argv without evaluating filenames. It accepts only simple unique
filenames and supported extensions. Set the three paths first; the evidence
directory must be outside both Git and the service data directory.

```sh
INPUT_DIR=/absolute/corpus
EVIDENCE_DIR=/absolute/private/ice-maker-evidence
SERVICE_URL=http://127.0.0.1:18080
install -d -m 0700 "$EVIDENCE_DIR"
python3 - "$INPUT_DIR" "$SERVICE_URL" "$EVIDENCE_DIR/upload.json" <<'PY'
import json, pathlib, re, subprocess, sys

root = pathlib.Path(sys.argv[1])
url = sys.argv[2]
evidence = pathlib.Path(sys.argv[3])
files = sorted(path for path in root.iterdir() if path.is_file())
if not 1 <= len(files) <= 100:
    raise SystemExit("expected 1 through 100 ordinary files")
if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", path.name) for path in files):
    raise SystemExit("rename files to simple safe basenames before upload")
if len({path.name.casefold() for path in files}) != len(files):
    raise SystemExit("filenames must be unique after case folding")
if any(path.suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".webp"} for path in files):
    raise SystemExit("unsupported extension present")
metadata = [
    {"data_class": "restricted", "languages": ["chi_tra", "eng"],
     "name": path.name, "rights": "unconfirmed", "size": path.stat().st_size}
    for path in files
]
argv = ["/usr/bin/curl", "--fail-with-body", "--silent", "--show-error"]
for path in files:
    argv.extend(["-F", f"files=@{path};filename={path.name}"])
argv.extend(["-F", "metadata=" + json.dumps(metadata, sort_keys=True, separators=(",", ":")),
             url + "/api/batches"])
completed = subprocess.run(argv, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           text=True, timeout=1800)
response = json.loads(completed.stdout)
if set(response) != {"batch_id"} or not re.fullmatch(r"[0-9a-f]{64}", response["batch_id"]):
    raise SystemExit("service returned an invalid batch identity")
evidence.write_text(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")
print(response["batch_id"])
PY
```

This example deliberately defaults to `unconfirmed`/`restricted`; edit the
generated metadata only after classifying each file. The service stores
per-item policy in the immutable batch manifest even when duplicate bytes reuse
one extraction cache entry.

## Status, interruption, stop, and resume

Record the returned 64-character batch ID, then poll only the bounded status
surface:

```sh
BATCH_ID=<64-lowercase-hex-batch-id>
curl --fail --silent --show-error \
  "http://127.0.0.1:18080/api/batches/$BATCH_ID"
```

Status is `queued`, `running`, `completed`, or `failed`; counts contain only
`processed`, `duplicate`, `rejected`, and `failed`. Mixed item failures produce
a completed batch result with non-zero rejected/failed counts. They do not
erase successful independent items. Extracted text and absolute host paths are
not returned by the status API.

## Readable results

After status reports `completed`, the browser flow displays the processed
source list. Open a listed source hash to preview its escaped Markdown in the
fixed browser page, or use **Download Markdown**. The preview and download are
read-only local reconstruction from the validated SQLite index; they do not
summarize, rewrite, or publish the source. Tables are not layout-perfect and
this path makes no new OCR-accuracy claim.

The equivalent loopback endpoints are:

```sh
curl --fail --silent --show-error "http://127.0.0.1:18080/api/batches/$BATCH_ID"
curl --fail --silent --show-error "http://127.0.0.1:18080/api/batches/$BATCH_ID/documents"
curl --fail --silent --show-error "http://127.0.0.1:18080/batches/$BATCH_ID/documents/$SOURCE_SHA256"
curl --fail --silent --show-error -o "document-$SOURCE_SHA256.md" \
  "http://127.0.0.1:18080/api/batches/$BATCH_ID/documents/$SOURCE_SHA256/markdown"
```

`SOURCE_SHA256` must be a hash returned by the completed-batch listing. The
listing contains at most 100 processed source identities and is capped at
64 KiB; each source may contain at most 10,000 chunks. Markdown and HTML are
each capped at 256 KiB. Identical source bytes appear once and resolve to the
same readable result when at least one matching item was processed. Stable
failures are HTTP 404 `readable_result_not_found` for an unknown, failed,
rejected, or foreign source; HTTP 409 `readable_result_unavailable` for a batch
that is not completed; HTTP 409 `readable_state_invalid` for corrupt state; and
HTTP 413 `readable_result_too_large` for any ceiling violation.

To stop cleanly, inspect the exact owned names, stop the relay first, and remove
only those stopped containers. Removing containers does not remove the mounted
data directory or the local image.

```sh
docker inspect ice-maker-document-relay ice-maker-document-service
docker stop ice-maker-document-relay
docker stop ice-maker-document-service
docker rm ice-maker-document-relay
docker rm ice-maker-document-service
```

To test recovery, issue those commands while a batch is `running`, then start
again with the identical canonical data directory and port:

```sh
scripts/run-document-service.sh /absolute/private/ice-maker-data 18080
curl --fail --silent --show-error \
  "http://127.0.0.1:18080/api/batches/$BATCH_ID"
```

The service converts an abandoned durable running attempt to a new queued
attempt. The coordinator validates content/config/tool-bound cache and progress
records and does not repeat completed extraction. If the data path, image,
port, runtime policy, socket, or container identity conflicts, startup fails
closed instead of replacing it.

## Writable state, backup, and cleanup

The selected data directory is the only parser writable mount. Its relevant
children are:

- `batches/<batch-id>/`: immutable uploaded bytes, per-item manifest, attempts,
  and bounded final result;
- `knowledge/batch-cache/`: extracted text and provenance cache;
- `knowledge/batch-progress/`: immutable completed-item progress;
- `knowledge/batch-index.sqlite3*`: local searchable FTS5 content;
- `.document-service-runtime/`: relay PID file and Unix socket only.

Treat the whole directory at the highest source sensitivity. Stop both
containers before backup, use an organization-approved encrypted destination,
preserve modes/ownership, and verify a restore into a different private path
before calling the backup usable. Do not back it up to GitHub. The cache and
index are rebuildable from originals plus manifest/config/tool identity, but
the original uploads are not disposable unless another verified copy exists.

Before cleanup, inspect the exact canonical path, stop/remove only the two
owned containers above, retain the evidence and any required original copy,
then move the specific data directory to an operator-approved trash or secure
deletion workflow. This runbook intentionally provides no recursive deletion
command.

## Ten-document pilot

Select ten documents representative of language, scan quality, page count,
tables, and long screenshots. Keep corrupt or password-protected examples out
of the first pilot. Upload them as above, wait for completion, and record:

- source count, file/page/image dimensions, rights, data class, languages, and
  tool/image revision;
- elapsed duration and peak CPU/memory from `docker stats --no-stream
  ice-maker-document-service ice-maker-document-relay`;
- non-empty native/OCR page rate;
- manually sampled character accuracy against a human transcription;
- whether every sampled hit's source hash plus page/text range or original
  image rectangle opens the expected evidence;
- failures and their stable reason codes;
- second-run duration and unchanged batch ID/progress evidence for cache or
  idempotent reuse.

Do not proceed if any required language is unavailable, coordinate evidence is
invalid, failures are unexplained, or sampled accuracy is below the threshold
chosen for the intended study. Ten documents are a calibration gate, not a
statistical accuracy guarantee.

### Measured private pilot

On 2026-09-03 the measured host processed a local, conservatively classified
`unconfirmed`/`restricted` pilot without provider access. Only aggregate
evidence is recorded here; source names and extracted text remain outside Git.

- Input: 10 ordinary files, 2 PDFs and 8 PNG screenshots, 40,118,553 bytes.
- Shape: one 37-page native-text PDF, one 9-page scanned PDF, and screenshots
  from 1447x815 through 2607x12185 pixels.
- Result: 10 processed, 0 duplicate, 0 rejected, 0 failed in 247.713 seconds;
  10 cache and 10 progress records were published.
- Index: 16,168 chunks: 16,131 OCR word rectangles and 37 native-text page
  chunks. All rectangles were independently checked against the decoded image
  or rendered-page bounds with zero violations; all indexed text was NFKC
  stable. A container-native FTS5 search above the former 10,000-row boundary
  returned bounded, fully cited results.
- Content checks: 58/58 manually selected cross-document topic terms were
  present. The native PDF matched an independent Poppler extraction on 37/37
  pages and 5,973 normalized characters. A visual review of the scanned PDF
  found 21/22 complete section-heading phrases (95.5%); every word in the one
  fragmented heading was present. This is heading recall, not a body-text or
  table-reconstruction accuracy guarantee.
- OCR observations: screenshot mean confidences ranged from 0.812 to 0.906;
  the scanned PDF mean was 0.586. Confidence is parser evidence, not measured
  correctness, so low-confidence body text still requires human review before
  knowledge promotion.
- Runtime samples: parser CPU reached about 203% and sampled memory reached
  334 MiB; the loopback relay used about 11 MiB. These are sampled maxima, not
  instrumented peaks.
- Idempotency: an identical 40 MB resubmission returned the same batch ID in
  0.27 seconds, retained one attempt, and left result/cache/progress content
  fingerprints unchanged. A deliberate mid-run restart in an earlier pilot
  also resumed through a new durable attempt without losing completed items.

The pilot clears the local ten-document calibration gate for the tested
formats and languages. It does not clear the separate 100-document benchmark,
rootless-runtime, formal accuracy-threshold, or production-readiness gates.

### Measured readable-result rerun

On 2026-09-04 the same ten input files were uploaded into a fresh isolated
state root using the readable-result image revision above. This was a complete
re-extraction rather than a read of the prior cache. Aggregate evidence only is
retained in Git.

- Result: 10 processed, 0 duplicate, 0 rejected, and 0 failed in approximately
  546 seconds; all 10 cache and progress records were durable.
- Readable surface: 10 source identities, 54 pages, and 16,168 chunks. The
  bounded listing was 2,458 bytes and contained no source filename, storage
  path, or extracted text.
- Output: every Markdown response was byte-stable across repeated downloads;
  maximum Markdown and escaped HTML sizes were 112,254 and 113,420 bytes.
- Review signal: 5,405 OCR words were visibly marked below the `0.80`
  confidence threshold. This is prioritization evidence, not measured
  character accuracy.
- Failure isolation: an unknown source returned HTTP 404
  `readable_result_not_found` without content or membership disclosure.
- Idempotency: an identical 40 MB resubmission returned the same batch ID in
  0.304 seconds and did not start another extraction attempt.
- Runtime: the parser remained network-disabled with a read-only root; one
  sample observed about 103% CPU and 603 MiB memory, below configured limits.

The rerun proves the new local listing, preview, and Markdown download journey
against representative private inputs. It does not replace the prior content
quality review or the still-open real 70-PDF/30-image benchmark.

## One-hundred-document benchmark

After the pilot passes, place exactly 70 PDFs and 30 PNG/JPEG/WebP screenshots
in the benchmark input directory. Run the uniform-directory uploader above
under `/usr/bin/time`, poll the returned batch, and capture a resource sample:

```sh
/usr/bin/time -v -o "$EVIDENCE_DIR/upload-and-queue.time" \
  python3 /absolute/private/reviewed-upload-driver.py
docker stats --no-stream \
  ice-maker-document-service ice-maker-document-relay \
  > "$EVIDENCE_DIR/container-stats.txt"
docker image inspect ice-maker/document-service:local \
  --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' \
  > "$EVIDENCE_DIR/image-identity.txt"
```

`reviewed-upload-driver.py` means a saved, reviewed copy of the exact standard-
library upload block above with its three absolute values fixed; do not run an
unreviewed downloaded script. Record the following benchmark row before and
after one identical resubmission:

```text
batch_id,total,pdf,image,processed,duplicate,rejected,failed,duration_seconds,
non_empty_pages,total_pages,coordinate_valid,coordinate_sampled,
sampled_characters_correct,sampled_characters_total,cache_or_idempotent_reuse,
peak_cpu,peak_memory,image_revision,poppler_version,tesseract_version,languages
```

The non-empty-page and sampled-character values require human review of local
evidence; do not derive an accuracy claim from item success counts. Coordinate
validity means the cited page exists or every sampled image rectangle has
positive dimensions and remains within the decoded original image. Keep the
benchmark evidence private if it contains source identifiers. A generated
100-item unit test passing is not a substitute for this benchmark.

## Result interpretation

- `processed` means validated extraction and local indexing completed.
- `duplicate` means identical bytes reused an earlier content identity; the
  duplicate item's own rights/data-class metadata remains in the manifest.
- `rejected` means a policy, signature, path, link, size, or aggregate boundary
  prevented extraction.
- `failed` means an isolated parser/OCR/index operation failed safely.

Searchable chunks remain in the private SQLite index with immutable source hash
and page/text-range or original-image rectangle provenance. Knowledge proposals
remain unpromoted. Exporting a reviewed subset to `doc_analysis_study` is a
separate explicit approval and publication workflow; parsing never receives
Git or GitHub capability.
