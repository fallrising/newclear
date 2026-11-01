use super::{
    body::{read_json, ReadJson},
    conflict, db, respond, time,
};
use crate::{
    bind,
    dbmsg::{decide_archive, ArchiveDecision},
    dto::*,
    error,
    page::page_limit,
    rows, sql,
    sqljson::{json_i64, json_str},
    validate::{self, NormalizedScript, ParsedQuery, ScriptFailure},
};
use worker::{D1Database, Request, Response, Result};

fn script_error(failure: ScriptFailure) -> Result<Response> {
    respond::json_err(match failure {
        ScriptFailure::TooLarge => error::script_too_large(),
        ScriptFailure::Invalid(issues) => error::validation_failed(&issues),
    })
}
fn revision_args(
    value: &NormalizedScript,
    now: &str,
    actor: &str,
) -> Result<Vec<serde_json::Value>> {
    Ok(vec![
        json_str(&value.title),
        json_str(&value.description),
        json_str(&serde_json::to_string(&value.tags)?),
        json_str(&validate::tag_index(&value.tags)),
        json_str(&value.language),
        json_str(&value.body),
        json_str(now),
        json_str(actor),
    ])
}
pub async fn list(db: &D1Database, query: ParsedQuery) -> Result<Response> {
    let items =
        db::all::<rows::ScriptSummaryRow>(db, sql::LIST_SCRIPTS, bind::script_list_args(&query))
            .await?
            .into_iter()
            .map(|row| db::mapped(rows::map_script_summary(row)))
            .collect::<Result<Vec<_>>>()?;
    let (items, next_before_id) = page_limit(items, query.limit as usize, |item| item.id);
    respond::json_response(
        200,
        &ScriptList {
            items,
            next_before_id,
        },
    )
}
pub async fn get(db: &D1Database, id: i64) -> Result<Response> {
    match db::first::<rows::ScriptRow>(db, sql::SELECT_SCRIPT, vec![json_i64(id)]).await? {
        Some(row) => respond::json_response(200, &db::mapped(rows::map_script(row))?),
        None => respond::json_err(error::not_found("Script not found.")),
    }
}
pub async fn create(db: &D1Database, req: &mut Request, actor: &str) -> Result<Response> {
    let input = match read_json::<ScriptCreate>(req).await? {
        ReadJson::Value(value) => value,
        ReadJson::Failure(error) => return respond::json_err(error),
    };
    let value = match validate::validate_script(&input) {
        Ok(value) => value,
        Err(error) => return script_error(error),
    };
    let now = time::now_iso();
    let result = db::batch(
        db,
        vec![
            db::statement(db, sql::INSERT_SCRIPT, vec![json_str(&now)])?,
            db::statement(
                db,
                sql::INSERT_SCRIPT_REVISION_NEW,
                revision_args(&value, &now, actor)?,
            )?,
            db::statement(db, sql::SELECT_NEW_SCRIPT_ID, vec![])?,
        ],
    )
    .await?;
    let row = db::required(result[2].results::<rows::IdRow>()?.into_iter().next())?;
    let id = db::mapped(rows::require_new_id(&row))?;
    respond::created(
        &format!("/v1/scripts/{id}"),
        &db::mapped(rows::synthesized_script(id, value, &now))?,
    )
}
pub async fn update(db: &D1Database, req: &mut Request, actor: &str, id: i64) -> Result<Response> {
    let input = match read_json::<ScriptUpdate>(req).await? {
        ReadJson::Value(value) => value,
        ReadJson::Failure(error) => return respond::json_err(error),
    };
    let (expected, value) = match validate::validate_script_update(&input) {
        Ok(value) => value,
        Err(error) => return script_error(error),
    };
    let mut args = vec![json_i64(id), json_i64(expected + 1)];
    args.extend(revision_args(&value, &time::now_iso(), actor)?);
    let result = match db::batch(
        db,
        vec![
            db::statement(db, sql::INSERT_SCRIPT_REVISION, args)?,
            db::statement(db, sql::SELECT_SCRIPT, vec![json_i64(id)])?,
        ],
    )
    .await
    {
        Ok(result) => result,
        Err(error) => return conflict::write_failure(db, "script", id, expected, error).await,
    };
    let row = db::required(result[1].results::<rows::ScriptRow>()?.into_iter().next())?;
    respond::json_response(200, &db::mapped(rows::map_script(row))?)
}
pub async fn archive(db: &D1Database, req: &mut Request, actor: &str, id: i64) -> Result<Response> {
    let input = match read_json::<ArchiveRequest>(req).await? {
        ReadJson::Value(value) => value,
        ReadJson::Failure(error) => return respond::json_err(error),
    };
    if let Some(issue) = validate::check_expected_revision(input.expected_revision) {
        return respond::json_err(error::validation_failed(&[issue]));
    }
    let now = time::now_iso();
    let expected = input.expected_revision;
    let result = match db::batch(
        db,
        vec![
            db::statement(
                db,
                sql::ARCHIVE_SCRIPT,
                vec![
                    json_str(&now),
                    json_str(actor),
                    json_i64(id),
                    json_i64(expected),
                ],
            )?,
            db::statement(db, sql::SELECT_SCRIPT, vec![json_i64(id)])?,
        ],
    )
    .await
    {
        Ok(result) => result,
        Err(error) => return conflict::write_failure(db, "script", id, expected, error).await,
    };
    let Some(row) = result[1].results::<rows::ScriptRow>()?.into_iter().next() else {
        return respond::json_err(error::not_found("Script not found."));
    };
    let changes = result[0]
        .meta()?
        .and_then(|meta| meta.changes)
        .map(|count| count > 0);
    match decide_archive(
        changes,
        row.revision,
        row.archived_at.as_deref(),
        expected,
        &now,
    ) {
        ArchiveDecision::Saved => respond::json_response(200, &db::mapped(rows::map_script(row))?),
        ArchiveDecision::Rejected(class) => {
            conflict::archive_failure(class, "script", id, expected)
        }
    }
}
pub async fn revisions(db: &D1Database, id: i64, query: ParsedQuery) -> Result<Response> {
    if db::first::<rows::OkRow>(db, sql::SCRIPT_EXISTS, vec![json_i64(id)])
        .await?
        .is_none()
    {
        return respond::json_err(error::not_found("Script not found."));
    }
    let items = db::all::<rows::ScriptRevisionSummaryRow>(
        db,
        sql::LIST_SCRIPT_REVISIONS,
        bind::revision_list_args(id, &query),
    )
    .await?
    .into_iter()
    .map(|row| db::mapped(rows::map_script_revision_summary(row)))
    .collect::<Result<Vec<_>>>()?;
    let (items, next_before_revision) =
        page_limit(items, query.limit as usize, |item| item.revision);
    respond::json_response(
        200,
        &ScriptRevisionList {
            items,
            next_before_revision,
        },
    )
}
pub async fn revision(db: &D1Database, id: i64, rev: i64) -> Result<Response> {
    if db::first::<rows::OkRow>(db, sql::SCRIPT_EXISTS, vec![json_i64(id)])
        .await?
        .is_none()
    {
        return respond::json_err(error::not_found("Script not found."));
    }
    match db::first::<rows::ScriptRevisionRow>(
        db,
        sql::SELECT_SCRIPT_REVISION,
        vec![json_i64(id), json_i64(rev)],
    )
    .await?
    {
        Some(row) => respond::json_response(200, &db::mapped(rows::map_script_revision(row))?),
        None => respond::json_err(error::revision_not_found()),
    }
}
