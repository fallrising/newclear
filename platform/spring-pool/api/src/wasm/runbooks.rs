use super::{
    body::{read_json, ReadJson},
    conflict, db, respond, time,
};
use crate::{
    bind,
    dbmsg::{self, decide_archive, ArchiveDecision},
    dto::*,
    error,
    page::page_limit,
    rows, sql,
    sqljson::{json_i64, json_str},
    validate::{self, NormalizedRunbook, NormalizedStep, ParsedQuery},
};
use serde::Deserialize;
use worker::{D1Database, Request, Response, Result};

// Validate all pins in one query, keeping 30-step writes inside Free D1 query limits.
const MISSING_PINS: &str = "SELECT CAST(pin.key AS INTEGER) AS position FROM json_each(?1) pin LEFT JOIN script_revisions sr ON sr.script_id = json_extract(pin.value, '$[0]') AND sr.revision = json_extract(pin.value, '$[1]') WHERE sr.script_id IS NULL ORDER BY CAST(pin.key AS INTEGER)";
#[derive(Deserialize)]
struct MissingPin {
    position: usize,
}
async fn pin_issues(db: &D1Database, steps: &[NormalizedStep]) -> Result<Vec<validate::Issue>> {
    let pins = steps
        .iter()
        .map(|step| vec![json_i64(step.script_id), json_i64(step.script_revision)])
        .collect::<Vec<_>>();
    let missing = db::all::<MissingPin>(
        db,
        MISSING_PINS,
        vec![json_str(&serde_json::to_string(&pins)?)],
    )
    .await?;
    let mut issues = vec![];
    validate::push_missing_pins(
        &mut issues,
        &missing
            .into_iter()
            .map(|row| row.position)
            .collect::<Vec<_>>(),
    );
    Ok(issues)
}
pub async fn list(db: &D1Database, query: ParsedQuery) -> Result<Response> {
    let items =
        db::all::<rows::RunbookSummaryRow>(db, sql::LIST_RUNBOOKS, bind::runbook_list_args(&query))
            .await?
            .into_iter()
            .map(|row| db::mapped(rows::map_runbook_summary(row)))
            .collect::<Result<Vec<_>>>()?;
    let (items, next_before_id) = page_limit(items, query.limit as usize, |item| item.id);
    respond::json_response(
        200,
        &RunbookList {
            items,
            next_before_id,
        },
    )
}
pub async fn get(db: &D1Database, id: i64) -> Result<Response> {
    let Some(row) =
        db::first::<rows::RunbookRow>(db, sql::SELECT_RUNBOOK, vec![json_i64(id)]).await?
    else {
        return respond::json_err(error::not_found("Runbook not found."));
    };
    let steps = db::all::<rows::StepRow>(
        db,
        sql::SELECT_RUNBOOK_STEPS,
        vec![json_i64(id), json_i64(row.revision)],
    )
    .await?;
    respond::json_response(200, &db::mapped(rows::map_runbook(row, steps))?)
}
pub async fn create(db: &D1Database, req: &mut Request, actor: &str) -> Result<Response> {
    let input = match read_json::<RunbookCreate>(req).await? {
        ReadJson::Value(value) => value,
        ReadJson::Failure(error) => return respond::json_err(error),
    };
    let value = match validate::validate_runbook(&input) {
        Ok(value) => value,
        Err(issues) => return respond::json_err(error::validation_failed(&issues)),
    };
    write(db, value, actor, None).await
}
pub async fn update(db: &D1Database, req: &mut Request, actor: &str, id: i64) -> Result<Response> {
    let input = match read_json::<RunbookUpdate>(req).await? {
        ReadJson::Value(value) => value,
        ReadJson::Failure(error) => return respond::json_err(error),
    };
    let (expected, value) = match validate::validate_runbook_update(&input) {
        Ok(value) => value,
        Err(issues) => return respond::json_err(error::validation_failed(&issues)),
    };
    write(db, value, actor, Some((id, expected))).await
}
async fn write(
    db: &D1Database,
    value: NormalizedRunbook,
    actor: &str,
    update: Option<(i64, i64)>,
) -> Result<Response> {
    let issues = pin_issues(db, &value.steps).await?;
    if !issues.is_empty() {
        return respond::json_err(error::validation_failed(&issues));
    }
    let now = time::now_iso();
    let mut statements = vec![];
    let fields = vec![
        json_str(&value.title),
        json_str(&value.description),
        json_i64(value.steps.len() as i64),
        json_str(&now),
        json_str(actor),
    ];
    if let Some((id, expected)) = update {
        let mut args = vec![json_i64(id), json_i64(expected + 1)];
        args.extend(fields);
        statements.push(db::statement(db, sql::INSERT_RUNBOOK_REVISION, args)?);
    } else {
        statements.push(db::statement(
            db,
            sql::INSERT_RUNBOOK,
            vec![json_str(&now)],
        )?);
        statements.push(db::statement(db, sql::INSERT_RUNBOOK_REVISION_NEW, fields)?);
    }
    for (index, step) in value.steps.iter().enumerate() {
        let mut args = vec![];
        if let Some((id, expected)) = update {
            args.extend([json_i64(id), json_i64(expected + 1)]);
        }
        args.extend([
            json_i64(index as i64 + 1),
            json_i64(step.script_id),
            json_i64(step.script_revision),
            json_str(&step.instruction),
        ]);
        statements.push(db::statement(
            db,
            if update.is_some() {
                sql::INSERT_RUNBOOK_STEP
            } else {
                sql::INSERT_RUNBOOK_STEP_NEW
            },
            args,
        )?);
    }
    if let Some((id, expected)) = update {
        statements.push(db::statement(db, sql::SELECT_RUNBOOK, vec![json_i64(id)])?);
        statements.push(db::statement(
            db,
            sql::SELECT_RUNBOOK_STEPS,
            vec![json_i64(id), json_i64(expected + 1)],
        )?);
    } else {
        statements.push(db::statement(db, sql::SELECT_NEW_RUNBOOK, vec![])?);
        statements.push(db::statement(db, sql::SELECT_NEW_RUNBOOK_STEPS, vec![])?);
    }
    let result = match db::batch(db, statements).await {
        Ok(result) => result,
        Err(failure) => {
            if dbmsg::classify_write_error(&failure.to_string()) == dbmsg::WriteClass::ForeignKey {
                let issues = pin_issues(db, &value.steps).await?;
                if !issues.is_empty() {
                    return respond::json_err(error::validation_failed(&issues));
                }
            }
            let (id, expected) = update.unwrap_or((0, 0));
            return conflict::write_failure(db, "runbook", id, expected, failure).await;
        }
    };
    let row = db::required(
        result[result.len() - 2]
            .results::<rows::RunbookRow>()?
            .into_iter()
            .next(),
    )?;
    let steps = result[result.len() - 1].results::<rows::StepRow>()?;
    let body = db::mapped(rows::map_runbook(row, steps))?;
    if update.is_some() {
        respond::json_response(200, &body)
    } else {
        respond::created(&format!("/v1/runbooks/{}", body.id), &body)
    }
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
                sql::ARCHIVE_RUNBOOK,
                vec![
                    json_str(&now),
                    json_str(actor),
                    json_i64(id),
                    json_i64(expected),
                ],
            )?,
            db::statement(db, sql::SELECT_RUNBOOK, vec![json_i64(id)])?,
            db::statement(
                db,
                sql::SELECT_RUNBOOK_STEPS,
                vec![json_i64(id), json_i64(expected)],
            )?,
        ],
    )
    .await
    {
        Ok(result) => result,
        Err(error) => return conflict::write_failure(db, "runbook", id, expected, error).await,
    };
    let Some(row) = result[1].results::<rows::RunbookRow>()?.into_iter().next() else {
        return respond::json_err(error::not_found("Runbook not found."));
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
        ArchiveDecision::Saved => respond::json_response(
            200,
            &db::mapped(rows::map_runbook(row, result[2].results()?))?,
        ),
        ArchiveDecision::Rejected(class) => {
            conflict::archive_failure(class, "runbook", id, expected)
        }
    }
}
pub async fn revisions(db: &D1Database, id: i64, query: ParsedQuery) -> Result<Response> {
    if db::first::<rows::OkRow>(db, sql::RUNBOOK_EXISTS, vec![json_i64(id)])
        .await?
        .is_none()
    {
        return respond::json_err(error::not_found("Runbook not found."));
    }
    let items = db::all::<rows::RunbookRevisionSummaryRow>(
        db,
        sql::LIST_RUNBOOK_REVISIONS,
        bind::revision_list_args(id, &query),
    )
    .await?
    .into_iter()
    .map(|row| db::mapped(rows::map_runbook_revision_summary(row)))
    .collect::<Result<Vec<_>>>()?;
    let (items, next_before_revision) =
        page_limit(items, query.limit as usize, |item| item.revision);
    respond::json_response(
        200,
        &RunbookRevisionList {
            items,
            next_before_revision,
        },
    )
}
pub async fn revision(db: &D1Database, id: i64, rev: i64, export: bool) -> Result<Response> {
    if db::first::<rows::OkRow>(db, sql::RUNBOOK_EXISTS, vec![json_i64(id)])
        .await?
        .is_none()
    {
        return respond::json_err(error::not_found("Runbook not found."));
    }
    let Some(row) = db::first::<rows::RunbookRevisionRow>(
        db,
        sql::SELECT_RUNBOOK_REVISION,
        vec![json_i64(id), json_i64(rev)],
    )
    .await?
    else {
        return respond::json_err(error::revision_not_found());
    };
    if export {
        let steps = db::all::<rows::ExportStepRow>(
            db,
            sql::SELECT_EXPORT_STEPS,
            vec![json_i64(id), json_i64(rev)],
        )
        .await?;
        respond::markdown(
            id,
            rev,
            crate::export::render(&db::mapped(rows::map_export(row, steps))?),
        )
    } else {
        let steps = db::all::<rows::StepRow>(
            db,
            sql::SELECT_RUNBOOK_STEPS,
            vec![json_i64(id), json_i64(rev)],
        )
        .await?;
        respond::json_response(200, &db::mapped(rows::map_runbook_revision(row, steps))?)
    }
}
