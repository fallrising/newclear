# Authenticated bounded OTLP reception

`New(Submitter, Options)` freezes one authenticated tenant and finite receive
capacities. The submitter is the existing ingest pipeline; the receiver owns no
listeners, backend or lifecycle goroutines. `HTTPHandler` supplies POST
`/v1/metrics`, `/v1/logs`, `/v1/traces`; `NewGRPCServer` registers the standard
three unary OTLP Export services. The caller binds listeners, configures TLS and
transport deadlines, calls `Stop` before draining listeners, then closes the
pipeline and borrowed backend in that order.

Bearer authentication is mandatory even for empty exports. Credential values are
SHA-256 digested at construction and compared in constant time. They are never
interpolated into receiver errors or diagnostics. `X-Scope-OrgID` and
`X-Prism-Tenant` may each appear once and must equal the authenticated tenant;
headers cannot establish identity. Options require a 32–4096 byte credential,
nonempty tenant of at most 2048 bytes, positive receive limits up to 1 GiB, and
1–1024 concurrent requests. These are package maxima, not recommended deployment
settings; the daemon applies its memory budget separately.

HTTP accepts protobuf/JSON and optional gzip. Both compressed wire bytes and
expanded bytes are bounded by `MaxRequestBytes`; malformed, unsupported or
oversized input fails before submission. The pipeline receives the actual
expanded length. JSON log decoding preserves `event_name` in the pinned pdata
version. HTTP status errors use `google.rpc.Status` in the request encoding,
`X-Prism-Error-Class`, and bounded `Retry-After` for safely retryable failures.
Authentication uses the existing `bad_request` class with HTTP status 401 and
`google.rpc.Status` code `Unauthenticated`.

The same nonblocking receiver gate covers HTTP body reading, decoding and
submission, and gRPC message receiving, decoding and submission across all
connections. gRPC acquires it in `InTapHandle` before receiving a message and
releases it in `stats.End`, including malformed and reset streams. Cancellation
alone never releases a permit while decoder or postcommit pipeline CPU work
continues. A finite 16 KiB gRPC header bound and per-connection stream cap provide
additional transport bounds. Both wire and expanded gRPC messages use
`MaxRecvMsgSize`; gzip is registered. `stats.InPayload.Length` supplies the actual
expanded wire length, including unknown and duplicate protobuf fields.

Before pdata decoding, a schema-aware protobuf pass limits message depth to 64
and field visits to 1,000,000. It traverses every OTLP message-bearing field,
including recursive AnyValue arrays/maps and deprecated scope fields; unknown
byte fields, strings, IDs and packed numbers remain opaque. Legacy protobuf
groups are rejected because OTLP declares none. A nonrecursive JSON pass caps
object/array nesting at 64, ignores quoted delimiters and checks JSON grammar.
The pipeline then applies its tighter semantic depth/element/owned-byte bounds.
Validated protobuf also migrates deprecated scope field 1000 to modern field 2
with the same modern-field precedence as pdata's generated gRPC adapter; public
metric ExportRequest decoding otherwise omits those points (the log/trace public
decoders already migrate; the wire pass is idempotent for them). Actual original bytes
remain the quota basis. The fixed schema graph follows pdata v1.23; dependency upgrades require a field
coverage review. Bounded fuzz seeds and runs cover these parsing gates.

The server uses supported standard unary `MethodDesc` registration and invokes
supplied unary interceptors. A receiver-owned codec stores classified parser
failures and reports them through the method, avoiding grpc's automatic Internal
response for codec errors. `Server.Serve` is required: grpc's independent
`ServeHTTP` path does not run tap and fails the receiver's permit/authentication
check. Receiver-owned tap, codec and message limits cannot be replaced by caller
options; transport credentials and ordinary unary interceptors are supported.

Pinned grpc v1.69 drops status details in its early tap-abort path. Consequently,
receiver capacity overload returns fixed `Unavailable`, allowing standard OTLP
SDK retry/backoff without decoding. Pipeline queue/rate overload returns
`ResourceExhausted` with `ErrorInfo` and `RetryInfo` through the normal unary path.
Permanent receiver/schema oversize returns nonretryable `ResourceExhausted` with
`too_large` details where the normal method is reached. Native framing, message
size, header, unsupported-compressor and transport failures remain grpc-native;
they do not always have receiver error details. Unsupported-compressor errors
can reflect the client's compression name within the finite header limit;
grpc strips that field before tap. Authentication values and backend error text
are never deliberately reflected by the receiver. Tests retain this distinction.

Successful exports acknowledge asynchronous admission rather than durability.
`Result.OTLPRejected` counts original data points/log records/spans. A partially
lost histogram or summary counts its original point exactly once, even if other
expanded children remain accepted. Delta baselines and unsupported metadata have
zero rejected originals and explicit diagnostics. Original provenance is
positional, so identical points stay distinct and limiter label mutation cannot
break attribution. Normalization/limits diagnostics and postcommit invariant
failures use a fixed, bounded vocabulary. They never produce a retryable whole
request after pipeline admission; partial responses must not be retried.
