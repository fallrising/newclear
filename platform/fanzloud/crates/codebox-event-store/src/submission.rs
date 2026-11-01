//! Durable isolated-mode admission and observed AP snapshots (CU-M3-01–04).
use std::{fmt, io::Write, path::PathBuf, sync::Arc};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{SQLITE_BUSY_TIMEOUT, path::validate_and_prepare};

const APPLICATION_ID: i64 = 0x43425331;
const REQUEST_LIMIT: usize = 65_536;
const SNAPSHOT_LIMIT: usize = 2 * 1024 * 1024;
const HISTORY_LIMIT: i64 = 128;
const HISTORY_EVENT_LIMIT: usize = 2048;
const SCHEMAS: [&str; 3] = [
    "CREATE TABLE submissions (sequence INTEGER PRIMARY KEY, owner TEXT NOT NULL, key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('unknown','confirmed','rejected')), request TEXT NOT NULL CHECK(length(CAST(request AS BLOB)) <= 65536), receipt TEXT CHECK(receipt IS NULL OR length(CAST(receipt AS BLOB)) <= 2097152), run_id TEXT UNIQUE, UNIQUE(owner,key), CHECK((state = 'confirmed' AND receipt IS NOT NULL AND run_id IS NOT NULL) OR (state != 'confirmed' AND receipt IS NULL AND run_id IS NULL))) STRICT",
    "CREATE TABLE projections (owner TEXT NOT NULL, run_id TEXT NOT NULL, snapshot TEXT NOT NULL CHECK(length(CAST(snapshot AS BLOB)) <= 2097152), cursor INTEGER NOT NULL CHECK(cursor > 0), PRIMARY KEY(owner,run_id)) STRICT",
    "CREATE TABLE observations (owner TEXT NOT NULL, run_id TEXT NOT NULL, cursor INTEGER NOT NULL CHECK(cursor > 0), event TEXT NOT NULL CHECK(length(CAST(event AS BLOB)) <= 2048), PRIMARY KEY(owner,run_id,cursor), FOREIGN KEY(owner,run_id) REFERENCES projections(owner,run_id)) STRICT",
];

/// Redacted failures: never carry SQL, paths, credentials or AP response bodies.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum SubmissionStoreError {
    #[error("invalid private submission database path")]
    InvalidPath,
    #[error("invalid submission store input")]
    InvalidInput,
    #[error("submission or projection conflicts with durable state")]
    Conflict,
    #[error("submission database is busy")]
    Busy,
    #[error("incompatible submission database")]
    Incompatible,
    #[error("corrupt submission database")]
    Corrupt,
    #[error("submission database unavailable")]
    Storage,
}

type Result<T> = std::result::Result<T, SubmissionStoreError>;
type RawSubmission = (String, Option<String>, Option<String>, Option<String>);

/// Only `Started` authorizes the caller's single external dispatch.
#[derive(Clone, Debug, PartialEq)]
pub enum BeginSubmission {
    Started,
    Existing(Value),
    BlockedUnknown,
}

/// Independent private SQLite database; clones open separate bounded-wait connections.
#[derive(Clone)]
pub struct SubmissionStore {
    path: Arc<PathBuf>,
}
impl fmt::Debug for SubmissionStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SubmissionStore").finish_non_exhaustive()
    }
}
impl SubmissionStore {
    /// Open or initialize the distinct version-1 submission schema, failing closed.
    pub fn open(path: PathBuf) -> Result<Self> {
        let path = validate_and_prepare(path)
            .map_err(|_| SubmissionStoreError::InvalidPath)?
            .path;
        let store = Self {
            path: Arc::new(path),
        };
        let mut connection = store.connection_unchecked()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        let app: i64 = tx
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .map_err(sql_error)?;
        let version: i64 = tx
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(sql_error)?;
        let count: i64 = tx
            .query_row("SELECT count(*) FROM sqlite_schema", [], |r| r.get(0))
            .map_err(sql_error)?;
        if app == 0 && version == 0 && count == 0 {
            for schema in SCHEMAS {
                tx.execute_batch(schema).map_err(sql_error)?;
            }
            tx.pragma_update(None, "application_id", APPLICATION_ID)
                .map_err(sql_error)?;
            tx.pragma_update(None, "user_version", 1)
                .map_err(sql_error)?;
        }
        validate_schema(&tx)?;
        let integrity: String = tx
            .query_row("PRAGMA integrity_check(1)", [], |r| r.get(0))
            .map_err(sql_error)?;
        if integrity != "ok" {
            return Err(SubmissionStoreError::Corrupt);
        }
        tx.commit().map_err(sql_error)?;
        Ok(store)
    }

    /// Commit an unknown intent before any dispatch; duplicates never authorize a POST.
    pub fn begin(&self, owner: &str, key: &str, request: &Value) -> Result<BeginSubmission> {
        validate_owner(owner)?;
        validate_uuid(key)?;
        validate_request(request)?;
        let encoded = encode(request, REQUEST_LIMIT)?;
        let mut connection = self.connection()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        if let Some(existing) = read_submission(&tx, owner, key)? {
            if existing["request"] != *request {
                return Err(SubmissionStoreError::Conflict);
            }
            return Ok(BeginSubmission::Existing(existing));
        }
        if has_unknown(&tx, owner)? {
            return Ok(BeginSubmission::BlockedUnknown);
        }
        tx.execute(
            "INSERT INTO submissions(owner,key,state,request) VALUES(?1,?2,'unknown',?3)",
            params![owner, key, encoded],
        )
        .map_err(sql_error)?;
        tx.commit().map_err(sql_error)?;
        Ok(BeginSubmission::Started)
    }

    /// Bind an unknown intent to its validated unique AP receipt; immutable once saved.
    pub fn confirm(&self, owner: &str, key: &str, receipt: &Value) -> Result<()> {
        validate_owner(owner)?;
        validate_uuid(key)?;
        let encoded = encode(receipt, SNAPSHOT_LIMIT)?;
        let mut connection = self.connection()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        let existing = read_submission(&tx, owner, key)?.ok_or(SubmissionStoreError::Conflict)?;
        validate_receipt(receipt, &existing["request"])?;
        if existing["state"] == "confirmed" {
            return if existing["receipt"] == *receipt {
                Ok(())
            } else {
                Err(SubmissionStoreError::Conflict)
            };
        }
        if existing["state"] != "unknown" {
            return Err(SubmissionStoreError::Conflict);
        }
        let observed: Option<Option<String>> = tx.query_row("SELECT CASE WHEN length(CAST(snapshot AS BLOB)) <= 2097152 THEN snapshot END FROM projections WHERE owner=?1 AND run_id=?2",params![owner,text_field(&receipt["run"],"id")?],|r|r.get(0)).optional().map_err(sql_error)?;
        if let Some(raw) = observed {
            let prior = decode(raw)?;
            validate_run(&prior).map_err(|_| SubmissionStoreError::Corrupt)?;
            for field in [
                "id",
                "task_id",
                "base_sha",
                "profile_revision",
                "goal",
                "review_context",
                "rework_context",
            ] {
                if prior[field] != receipt["run"][field] {
                    return Err(SubmissionStoreError::Conflict);
                }
            }
            if !prior["result"].is_null()
                && !receipt["run"]["result"].is_null()
                && prior["result"] != receipt["run"]["result"]
            {
                return Err(SubmissionStoreError::Conflict);
            }
        }
        tx.execute("UPDATE submissions SET state='confirmed',receipt=?3,run_id=?4 WHERE owner=?1 AND key=?2",params![owner,key,encoded,text_field(&receipt["run"],"id")?]).map_err(sql_error)?;
        tx.commit().map_err(sql_error)
    }

    /// Terminalize an explicit, complete AP rejection; this key cannot dispatch again.
    pub fn reject(&self, owner: &str, key: &str) -> Result<()> {
        validate_owner(owner)?;
        validate_uuid(key)?;
        let mut connection = self.connection()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        let existing = read_submission(&tx, owner, key)?.ok_or(SubmissionStoreError::Conflict)?;
        if existing["state"] == "confirmed" {
            return Err(SubmissionStoreError::Conflict);
        }
        tx.execute(
            "UPDATE submissions SET state='rejected' WHERE owner=?1 AND key=?2",
            params![owner, key],
        )
        .map_err(sql_error)?;
        tx.commit().map_err(sql_error)
    }

    /// At most 100 intents within 2 MiB, plus an unresolved flag over all history.
    pub fn list(&self, owner: &str) -> Result<Value> {
        validate_owner(owner)?;
        let mut connection = self.connection()?;
        let tx = connection.transaction().map_err(sql_error)?;
        let mut statement = tx
            .prepare("SELECT key FROM submissions WHERE owner=?1 ORDER BY sequence DESC LIMIT 101")
            .map_err(sql_error)?;
        let keys = statement
            .query_map([owner], |r| r.get::<_, String>(0))
            .map_err(sql_error)?;
        let mut items = Vec::new();
        // Reserve the envelope and separators before retaining any decoded record.
        let mut remaining = SNAPSHOT_LIMIT - 128;
        let mut history_truncated = false;
        for key in keys {
            if items.len() == 100 {
                history_truncated = true;
                break;
            }
            let record = read_submission(&tx, owner, &key.map_err(sql_error)?)?
                .ok_or(SubmissionStoreError::Corrupt)?;
            match encode(&record, remaining.saturating_sub(1)) {
                Ok(encoded) => {
                    remaining -= encoded.len() + 1;
                    items.push(record);
                }
                Err(SubmissionStoreError::InvalidInput) => {
                    history_truncated = true;
                    break;
                }
                Err(error) => return Err(error),
            }
        }
        Ok(
            json!({"items":items,"blocked":has_unknown(&tx,owner)?,"history_truncated":history_truncated}),
        )
    }

    /// Persist an authenticated AP observation without fabricating a submission intent.
    pub fn observe(&self, owner: &str, run: &Value) -> Result<Value> {
        validate_owner(owner)?;
        validate_run(run)?;
        let encoded = encode(run, SNAPSHOT_LIMIT)?;
        let id = text_field(run, "id")?;
        let mut connection = self.connection()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        let previous: Option<(Option<String>,i64)> = tx.query_row("SELECT CASE WHEN length(CAST(snapshot AS BLOB)) <= 2097152 THEN snapshot END,cursor FROM projections WHERE owner=?1 AND run_id=?2",params![owner,id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(sql_error)?;
        let mut cursor = 0;
        if let Some((raw, old_cursor)) = previous {
            let old = decode(raw)?;
            validate_run(&old).map_err(|_| SubmissionStoreError::Corrupt)?;
            if old_cursor <= 0 {
                return Err(SubmissionStoreError::Corrupt);
            }
            cursor = old_cursor;
            for field in [
                "id",
                "task_id",
                "base_sha",
                "profile_revision",
                "goal",
                "review_context",
                "rework_context",
            ] {
                if old[field] != run[field] {
                    return Err(SubmissionStoreError::Conflict);
                }
            }
            if number(run, "state_version")? < number(&old, "state_version")?
                || number(run, "last_event_seq")? < number(&old, "last_event_seq")?
            {
                return projection(&tx, owner, id, &old, cursor);
            }
            if (!old["result"].is_null() && old["result"] != run["result"])
                || (old["state_version"] == run["state_version"] && old["state"] != run["state"])
            {
                return Err(SubmissionStoreError::Conflict);
            }
            if old == *run {
                return projection(&tx, owner, id, &old, cursor);
            }
        }
        // A confirmed receipt is also an immutable identity anchor for the first GET.
        let bound: Option<String> = tx
            .query_row(
                "SELECT key FROM submissions WHERE owner=?1 AND run_id=?2",
                params![owner, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql_error)?;
        if let Some(key) = bound {
            let record = read_submission(&tx, owner, &key)?.ok_or(SubmissionStoreError::Corrupt)?;
            let original = &record["receipt"]["run"];
            for field in [
                "id",
                "task_id",
                "base_sha",
                "profile_revision",
                "goal",
                "review_context",
                "rework_context",
            ] {
                if original[field] != run[field] {
                    return Err(SubmissionStoreError::Conflict);
                }
            }
            if !original["result"].is_null() && original["result"] != run["result"] {
                return Err(SubmissionStoreError::Conflict);
            }
        }
        cursor = cursor.checked_add(1).ok_or(SubmissionStoreError::Corrupt)?;
        tx.execute("INSERT INTO projections(owner,run_id,snapshot,cursor) VALUES(?1,?2,?3,?4) ON CONFLICT(owner,run_id) DO UPDATE SET snapshot=excluded.snapshot,cursor=excluded.cursor",params![owner,id,encoded,cursor]).map_err(sql_error)?;
        let mut event = json!({"cursor":cursor,"state":run["state"],"state_version":run["state_version"],"cleanup_state":run["cleanup_state"],"last_event_seq":run["last_event_seq"]});
        if let Some(reason) = run.get("reason")
            && reason.is_string()
            && encode(reason, 1024).is_ok()
        {
            event["reason"] = reason.clone();
        }
        tx.execute(
            "INSERT INTO observations(owner,run_id,cursor,event) VALUES(?1,?2,?3,?4)",
            params![owner, id, cursor, encode(&event, HISTORY_EVENT_LIMIT)?],
        )
        .map_err(sql_error)?;
        tx.execute(
            "DELETE FROM observations WHERE owner=?1 AND run_id=?2 AND cursor<=?3",
            params![owner, id, cursor - HISTORY_LIMIT],
        )
        .map_err(sql_error)?;
        let result = projection(&tx, owner, id, run, cursor)?;
        tx.commit().map_err(sql_error)?;
        Ok(result)
    }

    fn connection_unchecked(&self) -> Result<Connection> {
        // Never recreate a removed live database or follow an unsafe replacement path.
        std::fs::symlink_metadata(self.path.as_ref()).map_err(|_| SubmissionStoreError::Storage)?;
        validate_and_prepare(self.path.as_ref().clone())
            .map_err(|_| SubmissionStoreError::InvalidPath)?;
        let connection = Connection::open_with_flags(
            self.path.as_ref(),
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(sql_error)?;
        connection
            .busy_timeout(SQLITE_BUSY_TIMEOUT)
            .map_err(sql_error)?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
            .map_err(sql_error)?;
        Ok(connection)
    }
    fn connection(&self) -> Result<Connection> {
        let connection = self.connection_unchecked()?;
        validate_schema(&connection)?;
        Ok(connection)
    }
}

fn sql_error(error: rusqlite::Error) -> SubmissionStoreError {
    match error.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
            SubmissionStoreError::Busy
        }
        Some(rusqlite::ErrorCode::ConstraintViolation) => SubmissionStoreError::Conflict,
        Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase) => {
            SubmissionStoreError::Corrupt
        }
        _ => SubmissionStoreError::Storage,
    }
}
fn validate_schema(connection: &Connection) -> Result<()> {
    let app: i64 = connection
        .query_row("PRAGMA application_id", [], |r| r.get(0))
        .map_err(sql_error)?;
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(sql_error)?;
    if app != APPLICATION_ID || version != 1 {
        return Err(SubmissionStoreError::Incompatible);
    }
    let mut statement = connection
        .prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name")
        .map_err(sql_error)?;
    let actual: Vec<String> = statement
        .query_map([], |r| r.get(0))
        .map_err(sql_error)?
        .collect::<std::result::Result<_, _>>()
        .map_err(sql_error)?;
    let expected = [SCHEMAS[2], SCHEMAS[1], SCHEMAS[0]];
    if actual.iter().map(String::as_str).collect::<Vec<_>>() != expected {
        return Err(SubmissionStoreError::Corrupt);
    }
    Ok(())
}
fn validate_owner(owner: &str) -> Result<()> {
    if owner.is_empty() || owner.len() > 256 || owner.chars().any(char::is_control) {
        Err(SubmissionStoreError::InvalidInput)
    } else {
        Ok(())
    }
}
fn validate_uuid(value: &str) -> Result<()> {
    if Uuid::parse_str(value).is_ok_and(|uuid| uuid.to_string() == value) {
        Ok(())
    } else {
        Err(SubmissionStoreError::InvalidInput)
    }
}
fn text_field<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or(SubmissionStoreError::InvalidInput)
}
fn number(value: &Value, field: &str) -> Result<u64> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .ok_or(SubmissionStoreError::InvalidInput)
}
fn validate_base(value: &Value) -> Result<()> {
    let base = text_field(value, "base_sha")?;
    if base.len() != 40
        || !base
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(SubmissionStoreError::InvalidInput);
    }
    Ok(())
}
// New handoff intents carry their exact route; legacy coding rows retain their v1 shape.
fn handoff(value: &Value) -> Result<(&str, &str)> {
    let route = text_field(value, "route")?;
    let (id, action) = route
        .strip_prefix("/api/v1/runs/")
        .and_then(|s| s.split_once('/'))
        .ok_or(SubmissionStoreError::InvalidInput)?;
    validate_uuid(id)?;
    if !matches!(action, "reviews" | "rework") {
        return Err(SubmissionStoreError::InvalidInput);
    }
    Ok((id, action))
}
fn validate_digest(value: &Value) -> Result<()> {
    let s = value.as_str().ok_or(SubmissionStoreError::InvalidInput)?;
    if s.len() != 64
        || !s
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(SubmissionStoreError::InvalidInput);
    }
    Ok(())
}
fn validate_request(value: &Value) -> Result<()> {
    if value.get("route").is_some() {
        let (_, action) = handoff(value)?;
        if value.as_object().map(|v| v.len()) != Some(2) {
            return Err(SubmissionStoreError::InvalidInput);
        }
        let body = value["body"]
            .as_object()
            .ok_or(SubmissionStoreError::InvalidInput)?;
        if action == "rework" {
            return if body.is_empty() {
                Ok(())
            } else {
                Err(SubmissionStoreError::InvalidInput)
            };
        }
        if body.len() != 3 {
            return Err(SubmissionStoreError::InvalidInput);
        }
        validate_uuid(text_field(&value["body"], "artifact_id")?)?;
        validate_uuid(text_field(&value["body"], "profile_revision")?)?;
        return validate_digest(&value["body"]["candidate_sha256"]);
    }
    let object = value
        .as_object()
        .ok_or(SubmissionStoreError::InvalidInput)?;
    if object.len() != 5
        || ![
            "project_id",
            "base_sha",
            "profile_revision",
            "title",
            "goal",
        ]
        .iter()
        .all(|field| object.contains_key(*field))
    {
        return Err(SubmissionStoreError::InvalidInput);
    }
    validate_uuid(text_field(value, "project_id")?)?;
    validate_uuid(text_field(value, "profile_revision")?)?;
    validate_base(value)?;
    text_field(value, "title")?;
    text_field(value, "goal")?;
    Ok(())
}
fn validate_run(value: &Value) -> Result<()> {
    for field in ["id", "task_id", "profile_revision"] {
        validate_uuid(text_field(value, field)?)?;
    }
    validate_base(value)?;
    text_field(value, "goal")?;
    for field in ["state", "cleanup_state"] {
        if text_field(value, field)?.len() > 64 {
            return Err(SubmissionStoreError::InvalidInput);
        }
    }
    if number(value, "state_version")? == 0 {
        return Err(SubmissionStoreError::InvalidInput);
    }
    number(value, "last_event_seq")?;
    if !value["result"].is_null() && !value["result"].is_object() {
        return Err(SubmissionStoreError::InvalidInput);
    }
    Ok(())
}
fn validate_receipt(receipt: &Value, request: &Value) -> Result<()> {
    let run = &receipt["run"];
    let task = &receipt["task"];
    validate_run(run)?;
    validate_uuid(text_field(task, "id")?)?;
    validate_uuid(text_field(task, "project_id")?)?;
    if request.get("route").is_some() {
        let (parent, action) = handoff(request)?;
        if task["id"] != run["task_id"] {
            return Err(SubmissionStoreError::Conflict);
        }
        let context = if action == "reviews" {
            &run["review_context"]
        } else {
            &run["rework_context"]
        };
        validate_uuid(text_field(context, "root_writer_run_id")?)?;
        validate_digest(&context["candidate_sha256"])?;
        let matched = if action == "reviews" {
            run["purpose"] == "review"
                && context["writer_run_id"] == parent
                && context["artifact_id"] == request["body"]["artifact_id"]
                && context["candidate_sha256"] == request["body"]["candidate_sha256"]
                && run["profile_revision"] == request["body"]["profile_revision"]
                && context["reviewer_profile_revision"] == run["profile_revision"]
                && matches!(context["review_round"].as_u64(), Some(1 | 2))
        } else {
            run["purpose"] == "coding" && context["review_run_id"] == parent
        };
        return if matched {
            Ok(())
        } else {
            Err(SubmissionStoreError::Conflict)
        };
    }
    if task["id"] != run["task_id"]
        || task["project_id"] != request["project_id"]
        || task["title"] != request["title"]
        || ["base_sha", "profile_revision", "goal"]
            .iter()
            .any(|field| run[*field] != request[*field])
    {
        return Err(SubmissionStoreError::Conflict);
    }
    Ok(())
}
struct LimitedWriter {
    bytes: Vec<u8>,
    limit: usize,
}
impl Write for LimitedWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::other("size limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn encode(value: &Value, limit: usize) -> Result<String> {
    let mut writer = LimitedWriter {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut writer, value).map_err(|_| SubmissionStoreError::InvalidInput)?;
    String::from_utf8(writer.bytes).map_err(|_| SubmissionStoreError::InvalidInput)
}
fn decode(raw: Option<String>) -> Result<Value> {
    serde_json::from_str(&raw.ok_or(SubmissionStoreError::Corrupt)?)
        .map_err(|_| SubmissionStoreError::Corrupt)
}
fn has_unknown(connection: &Connection, owner: &str) -> Result<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM submissions WHERE owner=?1 AND state='unknown')",
            [owner],
            |r| r.get(0),
        )
        .map_err(sql_error)
}
fn read_submission(connection: &Connection, owner: &str, key: &str) -> Result<Option<Value>> {
    let row: Option<RawSubmission>=connection.query_row("SELECT state,CASE WHEN length(CAST(request AS BLOB))<=65536 THEN request END,CASE WHEN length(CAST(receipt AS BLOB))<=2097152 THEN receipt END,run_id FROM submissions WHERE owner=?1 AND key=?2",params![owner,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(sql_error)?;
    let Some((state, request, receipt, run_id)) = row else {
        return Ok(None);
    };
    let request = decode(request)?;
    validate_uuid(key)
        .and_then(|_| validate_request(&request))
        .map_err(|_| SubmissionStoreError::Corrupt)?;
    let mut record = json!({"key":key,"state":state,"request":request});
    if state == "confirmed" {
        let receipt = decode(receipt)?;
        validate_receipt(&receipt, &request).map_err(|_| SubmissionStoreError::Corrupt)?;
        if receipt["run"]["id"].as_str() != run_id.as_deref() {
            return Err(SubmissionStoreError::Corrupt);
        }
        record["receipt"] = receipt;
    } else if !["unknown", "rejected"].contains(&state.as_str())
        || receipt.is_some()
        || run_id.is_some()
    {
        return Err(SubmissionStoreError::Corrupt);
    }
    Ok(Some(record))
}
fn projection(
    connection: &Connection,
    owner: &str,
    id: &str,
    run: &Value,
    cursor: i64,
) -> Result<Value> {
    let mut statement=connection.prepare("SELECT cursor,CASE WHEN length(CAST(event AS BLOB))<=2048 THEN event END FROM observations WHERE owner=?1 AND run_id=?2 ORDER BY cursor LIMIT 129").map_err(sql_error)?;
    let mut rows = statement.query(params![owner, id]).map_err(sql_error)?;
    let mut events = Vec::new();
    let expected_count = cursor.min(HISTORY_LIMIT);
    let mut expected_cursor = cursor - expected_count + 1;
    while let Some(row) = rows.next().map_err(sql_error)? {
        let index: i64 = row.get(0).map_err(sql_error)?;
        let event = decode(row.get(1).map_err(sql_error)?)?;
        if index != expected_cursor || event["cursor"] != index {
            return Err(SubmissionStoreError::Corrupt);
        }
        expected_cursor += 1;
        events.push(event);
    }
    if events.len() != expected_count as usize {
        return Err(SubmissionStoreError::Corrupt);
    }
    Ok(json!({"run":run,"events":events,"cursor":cursor,"history_truncated":cursor>HISTORY_LIMIT}))
}
