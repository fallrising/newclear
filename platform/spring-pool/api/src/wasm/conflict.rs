use super::{db, respond};
use crate::{
    dbmsg::{classify_write_error, ArchiveClass, WriteClass},
    error, rows, sql,
    sqljson::json_i64,
};
use worker::{D1Database, Response, Result};

pub async fn write_failure(
    db: &D1Database,
    kind: &str,
    id: i64,
    expected: i64,
    failure: worker::Error,
) -> Result<Response> {
    let class = classify_write_error(&failure.to_string());
    drop(failure);
    let query = if kind == "script" {
        sql::SELECT_SCRIPT_SNAP
    } else {
        sql::SELECT_RUNBOOK_SNAP
    };
    let snap = db::first::<rows::SnapRow>(db, query, vec![json_i64(id)]).await?;
    let body = match (class, snap) {
        (WriteClass::NotFound, _) => error::not_found("Entity not found."),
        (WriteClass::Archived, Some(head)) => error::archived(kind, id, head.current_revision),
        (WriteClass::RevisionConflict, Some(head)) => {
            error::revision_conflict(kind, id, head.current_revision, expected)
        }
        (WriteClass::Archived, None) => error::conflict_without_head("archived"),
        (WriteClass::RevisionConflict, None) => error::conflict_without_head("revision_conflict"),
        _ => {
            worker::console_error!("database mutation failed");
            error::internal_error()
        }
    };
    respond::json_err(body)
}
pub fn archive_failure(
    class: ArchiveClass,
    kind: &str,
    id: i64,
    expected: i64,
) -> Result<Response> {
    respond::json_err(match class {
        ArchiveClass::NotFound => error::not_found("Entity not found."),
        ArchiveClass::Archived { current_revision } => error::archived(kind, id, current_revision),
        ArchiveClass::RevisionConflict { current_revision } => {
            error::revision_conflict(kind, id, current_revision, expected)
        }
        _ => error::internal_error(),
    })
}
