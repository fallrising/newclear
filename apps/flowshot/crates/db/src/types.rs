//! Owned domain types. SQL representations never leave this crate.
use std::{fmt, sync::Arc};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    Validation,
    NotFound,
    Conflict,
    Migration,
    Busy,
    Overload,
    Closed,
    Internal,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DbError {
    pub code: ErrorCode,
}
impl DbError {
    pub const fn new(code: ErrorCode) -> Self {
        Self { code }
    }
}
impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "database {:?}", self.code)
    }
}
impl std::error::Error for DbError {}
pub type Result<T> = std::result::Result<T, DbError>;
pub(crate) fn invalid() -> DbError {
    DbError::new(ErrorCode::Validation)
}
pub(crate) fn internal() -> DbError {
    DbError::new(ErrorCode::Internal)
}
pub(crate) fn conflict() -> DbError {
    DbError::new(ErrorCode::Conflict)
}
impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        use rusqlite::{Error, ErrorCode as SqlCode};
        Self::new(match e {
            Error::SqliteFailure(ref x, _)
                if matches!(x.code, SqlCode::DatabaseBusy | SqlCode::DatabaseLocked) =>
            {
                ErrorCode::Busy
            }
            Error::SqliteFailure(ref x, _) if x.code == SqlCode::ConstraintViolation => {
                ErrorCode::Validation
            }
            Error::QueryReturnedNoRows => ErrorCode::NotFound,
            _ => ErrorCode::Internal,
        })
    }
}
macro_rules! id { ($($name:ident),+) => { $(
 #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)] pub struct $name(pub Uuid);
 impl $name { pub fn parse(value: &str) -> Result<Self> { let id=Uuid::parse_str(value).map_err(|_| invalid())?; if id.get_version_num()!=7 {return Err(invalid());} Ok(Self(id)) } }
 impl fmt::Display for $name { fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { self.0.fmt(f) } }
 )+ }; }
id!(
    WorkspaceId,
    RootId,
    DocumentId,
    AnnotationId,
    CommentId,
    TagId
);
macro_rules! token { ($($name:ident),+) => { $(
 #[derive(Clone, Copy, Debug, PartialEq, Eq, Default)] pub struct $name(pub u64);
 impl $name { pub fn checked(self) -> Result<i64> { i64::try_from(self.0).map_err(|_| invalid()) } pub fn next(self) -> Result<Self> { let n=self.0.checked_add(1).ok_or_else(invalid)?; let x=Self(n); x.checked()?; Ok(x) } }
 )+ }; }
token!(RowVersion, DocumentRevision);
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Millis(pub i64);
impl Millis {
    pub fn checked(self) -> Result<i64> {
        if self.0 < 0 {
            Err(invalid())
        } else {
            Ok(self.0)
        }
    }
}
pub trait Clock: Send + Sync {
    fn now(&self) -> Millis;
}
pub trait IdSource: Send + Sync {
    fn next(&self) -> Uuid;
}
#[derive(Clone)]
pub(crate) struct Sources {
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdSource>,
}
impl Sources {
    pub fn now(&self) -> Result<i64> {
        self.clock.now().checked()
    }
    pub fn id(&self) -> Result<Uuid> {
        let id = self.ids.next();
        if id.get_version_num() == 7 {
            Ok(id)
        } else {
            Err(invalid())
        }
    }
}
macro_rules! enumeration { ($name:ident { $($variant:ident => $value:literal),+ }) => {
 #[derive(Clone, Copy, Debug, PartialEq, Eq)] pub enum $name { $($variant),+ }
 impl $name { pub(crate) const fn sql(self)-> &'static str {match self {$ (Self::$variant=>$value),+}} pub(crate) fn parse(s:&str)->Result<Self> {match s {$($value=>Ok(Self::$variant)),+, _=>Err(internal())}} }
}; }
enumeration!(RootStatus { Active=>"active", Detached=>"detached" });
enumeration!(DocumentStatus { Present=>"present", Missing=>"missing" });
enumeration!(Color { Yellow=>"yellow", Green=>"green", Blue=>"blue", Pink=>"pink", Purple=>"purple" });
enumeration!(AnchorStatus { Attached=>"attached", Orphaned=>"orphaned", Document=>"document" });
enumeration!(Resolution { None=>"none", Unchanged=>"unchanged", Exact=>"exact", Context=>"context", Fuzzy=>"fuzzy", Manual=>"manual" });
enumeration!(TriggerSource { Open=>"open", Watcher=>"watcher", Manual=>"manual", Replay=>"replay" });
enumeration!(EventOutcome { Unchanged=>"unchanged", Shifted=>"shifted", Orphaned=>"orphaned", Recovered=>"recovered" });
enumeration!(TagKind { User=>"user", System=>"system" });
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tombstones {
    Exclude,
    Include,
}
/// Anchor is structured JSON validated at the repository boundary; it contains no canonical text model.
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor(pub serde_json::Value);
impl Anchor {
    pub fn validate(&self) -> Result<()> {
        let x = &self.0;
        let text = |k| x[k].as_str().ok_or_else(invalid);
        let start = x["start_hint"].as_u64().ok_or_else(invalid)?;
        let end = x["end_hint"].as_u64().ok_or_else(invalid)?;
        if x["version"] != 1
            || x["document_model_version"] != 1
            || text("exact")?.trim().is_empty()
            || text("prefix")?.chars().count() > 32
            || text("suffix")?.chars().count() > 32
            || text("offset_unit")? != "utf8-byte"
            || start >= end
            || end - start != u64::try_from(text("exact")?.len()).map_err(|_| invalid())?
        {
            return Err(invalid());
        }
        for k in ["source_hash", "canonical_hash"] {
            validate_hash(text(k)?)?;
        }
        Ok(())
    }
}
pub(crate) fn validate_hash(s: &str) -> Result<()> {
    if s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(invalid())
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub document_id: DocumentId,
    pub revision: DocumentRevision,
    pub source_hash: String,
    pub canonical_hash: String,
    pub model_version: u32,
}
#[derive(Clone, Debug, PartialEq)]
pub enum AnnotationKind {
    Document,
    Range {
        anchor: Anchor,
        status: AnchorStatus,
        snapshot: Snapshot,
    },
}
#[derive(Clone, Debug)]
pub struct NewRoot {
    pub workspace_id: WorkspaceId,
    pub abs_path: String,
    pub canonical_path: String,
    pub ext_filter: serde_json::Value,
    pub ignore_rules: serde_json::Value,
}
#[derive(Clone, Debug)]
pub struct NewAnnotation {
    pub document_id: DocumentId,
    pub body: String,
    pub color: Color,
    pub kind: AnnotationKind,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub archived_at: Option<Millis>,
    pub created_at: Millis,
    pub updated_at: Millis,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Root {
    pub id: RootId,
    pub workspace_id: WorkspaceId,
    pub abs_path: String,
    pub canonical_path: String,
    pub status: RootStatus,
    pub ext_filter: serde_json::Value,
    pub ignore_rules: serde_json::Value,
    pub created_at: Millis,
    pub updated_at: Millis,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Document {
    pub id: DocumentId,
    pub root_id: RootId,
    pub rel_path: String,
    pub status: DocumentStatus,
    pub source_hash: Option<String>,
    pub canonical_hash: Option<String>,
    pub model_version: Option<u32>,
    pub size_bytes: Option<u64>,
    pub mtime: Option<Millis>,
    pub revision: DocumentRevision,
    pub last_seen_at: Option<Millis>,
    pub last_opened_at: Option<Millis>,
    pub created_at: Millis,
    pub updated_at: Millis,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Annotation {
    pub id: AnnotationId,
    pub document_id: DocumentId,
    pub body: String,
    pub color: Color,
    pub anchor: Option<Anchor>,
    pub status: AnchorStatus,
    pub resolution: Resolution,
    pub last_reanchored_revision: Option<DocumentRevision>,
    pub version: RowVersion,
    pub deleted_at: Option<Millis>,
    pub created_at: Millis,
    pub updated_at: Millis,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Comment {
    pub id: CommentId,
    pub annotation_id: AnnotationId,
    pub parent_id: Option<CommentId>,
    pub body: String,
    pub version: RowVersion,
    pub deleted_at: Option<Millis>,
    pub created_at: Millis,
    pub updated_at: Millis,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Tag {
    pub id: TagId,
    pub display_name: String,
    pub normalized_name: String,
    pub kind: TagKind,
    pub created_at: Millis,
    pub updated_at: Millis,
}
#[derive(Clone, Debug, PartialEq)]
pub struct AppState {
    pub scope: String,
    pub key: String,
    pub value: serde_json::Value,
    pub updated_at: Millis,
}
#[derive(Clone, Debug)]
pub struct AnchorChange {
    pub annotation_id: AnnotationId,
    pub expected: RowVersion,
    pub anchor: Option<Anchor>,
    pub status: AnchorStatus,
    pub resolution: Resolution,
    pub event: AnchorEvent,
}
#[derive(Clone, Debug, PartialEq)]
pub struct AnchorEvent {
    pub source: TriggerSource,
    pub outcome: EventOutcome,
    pub method: Resolution,
    pub score: Option<f64>,
    pub old_anchor: Option<Anchor>,
    pub new_anchor: Option<Anchor>,
    pub reason: Option<String>,
}
#[derive(Clone, Debug)]
pub struct DocumentCommit {
    pub document_id: DocumentId,
    pub expected: DocumentRevision,
    pub source_hash: String,
    pub canonical_hash: String,
    pub model_version: u32,
    pub changes: Vec<AnchorChange>,
}
#[derive(Clone, Copy, Debug)]
pub enum TagTarget {
    Document(DocumentId),
    Annotation(AnnotationId),
}
