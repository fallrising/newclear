-- Additive rejection metadata only. Existing business rows are untouched.
-- Application writes are bounded to 10000 rows; no automatic removal/overwrite.
CREATE TABLE rejection_audit (
 request_id TEXT PRIMARY KEY CHECK(length(request_id) BETWEEN 1 AND 64),
 observed_at INTEGER NOT NULL CHECK(observed_at >= 0),
 method TEXT NOT NULL CHECK(method IN ('GET','POST','OTHER')),
 route TEXT NOT NULL CHECK(route IN ('authorization-self','bootstrap','health-schedule','usage','commands','command','cancel','artifact','runner-claim','runner-report','assets','other')),
 status INTEGER NOT NULL CHECK(status BETWEEN 400 AND 499),
 code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 64),
 authenticated INTEGER NOT NULL CHECK(authenticated IN (0,1))
);
CREATE INDEX rejection_observed ON rejection_audit(observed_at DESC, request_id DESC);
