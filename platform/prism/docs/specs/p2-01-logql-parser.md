# P2-01 — Bounded clean-room LogQL parsing

## Objective and scope

Implement SDD16 sections 1–3.3 and the parser portions of section 4 as a handwritten
lexer and recursive-descent parser producing the existing flat `spi.LogQuery`.
P0-03 IR exists; the Phase1 baseline is already merged. This slice adds no runtime
HTTP routing, database behavior, dependency, public SPI or configuration change.
Regex optimization/LiteralHint, execution and HTTP integration remain P2-02/03/04.

Allowed implementation: `internal/query/logql/**` (token, lexer, parser, errors,
minimal numeric/duration/byte literal conversion, tests and fuzz seeds). Related
spec/inventory/README and precise SDD clarifications are orchestrator-owned.
All implementers append their own signed scope to ADR-004 clean-room declaration
before implementation; only public user documentation and independent fixtures
are permitted. Do not read Loki implementation or tests, or import AGPL code.

## Design and executable contract

- API: `Parse(ctx context.Context, query string, maxRange time.Duration)
  (spi.LogQuery, error)`. The caller supplies positive `maxRange`; do not read
  global config or silently add an HTTP setting. Leave Tenant, Start, End,
  Direction, Limit and aggregation Step zero for future authenticated transport.
- Return zero `spi.LogQuery` on any error; never expose a partially valid query.
  Use a scanner Token with Kind/Lit/Line/Col and one-token lookahead. Positions
  start at 1 and count Unicode runes. Reject malformed UTF-8, unclosed strings,
  bad escapes and trailing input deterministically. Whitespace includes newline;
  `#` is not a comment delimiter. ASCII label identifiers follow existing label
  conventions, while arbitrary valid Unicode is permitted in literal values.
- Double-quoted strings support the exact SDD escapes including slash and Unicode
  (`\uXXXX` and `\UXXXXXXXX`);
  backticks are raw. Validate scalar Unicode escapes; no unchecked surrogate or
  overflow conversion. Signed finite decimal number, one supported duration or
  byte suffix follows SDD16; reject unsupported units and overflow. Duration
  nanoseconds and aggregation K must be exact integers; do not silently truncate
  subnanosecond intervals or fractional K. Float64-valued field literals use
  normal IEEE754 rounding, with nonfinite/underflow results rejected. Duration is an interval,
  not telemetry timestamp conversion. Keep literal conversion local to parsing;
  do not implement P2-02 `Compile` or `ExtractLiteralHint`.
- Structural safety ceilings: query 64 KiB, tokens 16,384, collection terms 1,024,
  syntactic nesting 128, and each decoded regex at most 4,096 bytes (SDD21 T8).
  Validate regex length before selector compilation; apply it to line/field regex
  text too, including patterns inside unsupported constructs. These are parser
  safety bounds, analogous to existing
  bounded query AST checks, not new user-tunable configuration. Bound every
  input-grown collection and recursive unsupported-grammar path; check context
  during scanning/parsing and preserve cancellation classification.
- Stream selectors use existing `spi.NewMatcher` for validated anchored regex
  and `Matches("")` for the non-empty positive matcher requirement. Reject all
  parsed `__`-prefixed user label references (selector/field/grouping) before
  returning IR. No textual substring-only check or tenancy from query strings.
- Line filters precede pipeline stages. Preserve selector/filter/stage/field
  order within the corresponding existing flat slices. Field filters require a
  preceding parser unless the field appears in the selector. All five SDD16§1.1
  semantic rules apply, including exactly one grouping position and positive
  bounded range windows. Grouping lists cannot duplicate labels; topk/bottomk
  require a finite nonnegative integer representable by existing `Agg.K`, with
  no truncation. Other vector functions must not accept the optional K argument.
- String field values populate Value; numeric/duration/byte values also populate
  Num in canonical numeric units (seconds for durations, bytes for sizes).
  Matcher regexes necessarily compile for selector validation; regex line/field
  filters retain their text and nil Compiled/LiteralHint until P2-02. This parser
  result is intermediate IR, not an executable query or a claim of regex parity.
- Error text follows SDD16: syntax carries rune line/col; semantic messages are
  direct; valid unsupported constructs get the exact listed unsupported message.
  Preserve `spi.Classify`: syntax/semantic bad_request, unsupported unsupported,
  resource ceilings too_large, cancellation timeout with errors.Is intact.
  A typed parser error can expose Kind/position and unwrap a classified SPI cause
  while its Error method retains the specified public text. Do not echo query
  text, literal values or raw regexp errors into diagnostics.
- Recognize the listed unsupported forms structurally before classifying them:
  unwrap/pattern/regexp/line_format/label_format/drop/keep/decolorize, unwrap-family
  range functions, absent_over_time, binary operators, label_replace and offset/@.
  Missing operands/delimiters or malformed arguments remain syntax errors;
  matching a keyword alone must not disguise invalid syntax as unsupported.
  No AST or backend call is needed to recognize unsupported syntax. A recognized
  unsupported parser stage still satisfies the parser-before-field structural
  prerequisite for later filters; return the unsupported diagnostic without
  emitting executable stages.

## Verification and acceptance

Write focused behavioral tests first and record a failing semantic expectation
before the minimum implementation. Test every supported EBNF production and all
range/vector combinations; all five semantic rules; all unsupported table rows and
malformed neighbors; non-empty-compatible regex selectors; rune positions,
escapes/raw strings; bounds/overflow/reserved names and cancellation. Add a bounded
FuzzParse target with deterministic seeds and no-panic/zero-IR-on-error invariants.

Worker and root run focused race tests; root runs fresh `make lint test`,
`make deps-check`, `go mod verify`, `go build ./...`, normal and integration pinned
lint and integration vet, security suite, and FuzzParse for 60s with bounded workers.
Verify protected source/module hashes, licensed imported dependencies, changed
scope, doc links and clean-room signatures. This pure unwired parser does not
require another Docker/ClickHouse/Compose run: no relevant execution input changes.
It does not claim P2-02 compiler properties, executor/pushdown matrices, actual
Loki API parity or end-to-end query availability. Those remain named later tasks.

After root source/docs freeze and actual checks, Astra independently reviews
implementation, tests, error precedence, safety bounds and raw evidence. Resolve
findings and repeat affected checks before normal PR/CI/merge and exact main
verification. Stop at P2-01.

## Unsupported syntax recognition boundary

SDD16's unsupported table describes families, not executable implementations.
To make its ellipses deterministic, recognize `label_format` as a nonempty list
of distinct destination assignments to a label identifier or string; `drop` and
`keep` as nonempty label/matcher lists. These argument shapes follow the public
[log query documentation](https://grafana.com/docs/loki/latest/query/log_queries/).
Templates are not executed or compiled.

`unwrap` takes a label or one of `duration`, `duration_seconds`, `bytes` applied
to one label. Recognized unwrap-only functions are `rate_counter`,
`sum_over_time`, `avg_over_time`, `min_over_time`, `max_over_time`,
`stdvar_over_time`, `stddev_over_time`, `first_over_time`, `last_over_time`, and
`quantile_over_time` (leading numeric argument). Only the latter eight functions
from `avg_over_time` onward allow trailing grouping. An offset follows the range
selector inside its enclosing function; placing it after that function is
malformed. Its signed duration must be exactly representable, but the range
window positivity/maxRange rule does not apply to the offset. A vector aggregation
may wrap a structurally complete unsupported range function; preserve that
function's unsupported diagnostic rather than rejecting its identifier as syntax.
These recognition rules follow the public
[metric query documentation](https://grafana.com/docs/loki/latest/query/metric_queries/),
read on 2026-10-09. Existing supported `rate` with an unwrap stage still rejects
that stage; none of these recognition paths produces executable unwrap IR.
No Loki implementation or tests were read, and no upstream fixtures were copied.
The broader public language does not expand SDD16's supported EBNF.
