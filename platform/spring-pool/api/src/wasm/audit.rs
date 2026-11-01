use super::{db, respond};
use crate::{bind, dto::AuditList, page::page_limit, rows, sql, validate::ParsedQuery};
use worker::{D1Database, Response, Result};
pub async fn list(db: &D1Database, query: ParsedQuery) -> Result<Response> {
    let items = db::all::<rows::AuditRow>(db, sql::LIST_AUDIT, bind::audit_list_args(&query))
        .await?
        .into_iter()
        .map(|row| db::mapped(rows::map_audit(row)))
        .collect::<Result<Vec<_>>>()?;
    let (items, next_before_id) = page_limit(items, query.limit as usize, |item| item.id);
    respond::json_response(
        200,
        &AuditList {
            items,
            next_before_id,
        },
    )
}
