//! Map D1 JSON rows into API responses. Failures carry no row text.

use crate::dbmsg::{is_audit_action, is_entity_type, HeadSnap};
use crate::dto::{
    AuditEventResponse, RunbookResponse, RunbookRevisionResponse, RunbookRevisionSummary,
    RunbookStepResponse, RunbookSummary, ScriptResponse, ScriptRevisionResponse,
    ScriptRevisionSummary, ScriptSummary,
};
use crate::export::{ExportRunbook, ExportStep};
use crate::validate::{canonical_language, NormalizedScript};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(crate) struct IdRow {
    #[serde(alias = "max(id)", deserialize_with = "crate::flex::i64")]
    pub(crate) id: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OkRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) ok: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SnapRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) current_revision: i64,
    #[serde(default)]
    pub(crate) archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ScriptRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) tags_json: String,
    pub(crate) language: String,
    pub(crate) body: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ScriptSummaryRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    pub(crate) tags_json: String,
    pub(crate) language: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) byte_size: i64,
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ScriptRevisionRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) script_id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) tags_json: String,
    pub(crate) language: String,
    pub(crate) body: String,
    pub(crate) created_at: String,
    pub(crate) created_by: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) is_current: i64,
    #[serde(default)]
    pub(crate) script_archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ScriptRevisionSummaryRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    pub(crate) language: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) byte_size: i64,
    pub(crate) created_at: String,
    pub(crate) created_by: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunbookRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    pub(crate) description: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) step_count: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunbookSummaryRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) step_count: i64,
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunbookRevisionRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) runbook_id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    pub(crate) description: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) step_count: i64,
    pub(crate) created_at: String,
    pub(crate) created_by: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) is_current: i64,
    #[serde(default)]
    pub(crate) runbook_archived_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RunbookRevisionSummaryRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
    pub(crate) title: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) step_count: i64,
    pub(crate) created_at: String,
    pub(crate) created_by: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct StepRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) position: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) script_id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) script_revision: i64,
    pub(crate) instruction: String,
    pub(crate) script_title: String,
    pub(crate) script_language: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) script_archived: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExportStepRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) position: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) script_id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) script_revision: i64,
    pub(crate) instruction: String,
    pub(crate) script_title: String,
    pub(crate) script_language: String,
    pub(crate) script_body: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) script_archived: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuditRow {
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) id: i64,
    pub(crate) occurred_at: String,
    pub(crate) actor: String,
    pub(crate) action: String,
    pub(crate) entity_type: String,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) entity_id: i64,
    #[serde(deserialize_with = "crate::flex::i64")]
    pub(crate) revision: i64,
}

pub(crate) fn require_new_id(row: &IdRow) -> Result<i64, ()> {
    pos_id(row.id)
}

pub(crate) fn head_snap(row: SnapRow) -> HeadSnap {
    HeadSnap {
        current_revision: row.current_revision,
        archived: row.archived_at.is_some(),
    }
}

pub(crate) fn map_script(row: ScriptRow) -> Result<ScriptResponse, ()> {
    Ok(ScriptResponse {
        id: pos_id(row.id)?,
        revision: pos_id(row.revision)?,
        title: row.title,
        description: row.description,
        tags: tags_of(&row.tags_json)?,
        language: language_of(&row.language)?,
        byte_size: byte_len(&row.body)?,
        body: row.body,
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
    })
}

pub(crate) fn map_script_summary(row: ScriptSummaryRow) -> Result<ScriptSummary, ()> {
    Ok(ScriptSummary {
        id: pos_id(row.id)?,
        revision: pos_id(row.revision)?,
        title: row.title,
        tags: tags_of(&row.tags_json)?,
        language: language_of(&row.language)?,
        byte_size: byte_col(row.byte_size)?,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
    })
}

pub(crate) fn map_script_revision(row: ScriptRevisionRow) -> Result<ScriptRevisionResponse, ()> {
    Ok(ScriptRevisionResponse {
        script_id: pos_id(row.script_id)?,
        revision: pos_id(row.revision)?,
        title: row.title,
        description: row.description,
        tags: tags_of(&row.tags_json)?,
        language: language_of(&row.language)?,
        byte_size: byte_len(&row.body)?,
        body: row.body,
        created_at: row.created_at,
        created_by: row.created_by,
        is_current: row.is_current != 0,
        script_archived_at: row.script_archived_at,
    })
}

pub(crate) fn map_script_revision_summary(
    row: ScriptRevisionSummaryRow,
) -> Result<ScriptRevisionSummary, ()> {
    Ok(ScriptRevisionSummary {
        revision: pos_id(row.revision)?,
        title: row.title,
        language: language_of(&row.language)?,
        byte_size: byte_col(row.byte_size)?,
        created_at: row.created_at,
        created_by: row.created_by,
    })
}

pub(crate) fn map_runbook(row: RunbookRow, steps: Vec<StepRow>) -> Result<RunbookResponse, ()> {
    Ok(RunbookResponse {
        id: pos_id(row.id)?,
        revision: pos_id(row.revision)?,
        title: row.title,
        description: row.description,
        steps: map_steps(steps, row.step_count)?,
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
    })
}

pub(crate) fn map_runbook_summary(row: RunbookSummaryRow) -> Result<RunbookSummary, ()> {
    Ok(RunbookSummary {
        id: pos_id(row.id)?,
        revision: pos_id(row.revision)?,
        title: row.title,
        step_count: step_count_ok(row.step_count)?,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
    })
}

pub(crate) fn map_runbook_revision(
    row: RunbookRevisionRow,
    steps: Vec<StepRow>,
) -> Result<RunbookRevisionResponse, ()> {
    Ok(RunbookRevisionResponse {
        runbook_id: pos_id(row.runbook_id)?,
        revision: pos_id(row.revision)?,
        title: row.title,
        description: row.description,
        steps: map_steps(steps, row.step_count)?,
        created_at: row.created_at,
        created_by: row.created_by,
        is_current: row.is_current != 0,
        runbook_archived_at: row.runbook_archived_at,
    })
}

pub(crate) fn map_runbook_revision_summary(
    row: RunbookRevisionSummaryRow,
) -> Result<RunbookRevisionSummary, ()> {
    Ok(RunbookRevisionSummary {
        revision: pos_id(row.revision)?,
        title: row.title,
        step_count: step_count_ok(row.step_count)?,
        created_at: row.created_at,
        created_by: row.created_by,
    })
}

pub(crate) fn map_export(
    row: RunbookRevisionRow,
    steps: Vec<ExportStepRow>,
) -> Result<ExportRunbook, ()> {
    let id = pos_id(row.runbook_id)?;
    let revision = pos_id(row.revision)?;
    Ok(ExportRunbook {
        id,
        revision,
        title: row.title,
        description: row.description,
        revision_created_at: row.created_at,
        steps: map_export_steps(steps, row.step_count)?,
    })
}

pub(crate) fn map_audit(row: AuditRow) -> Result<AuditEventResponse, ()> {
    if !is_audit_action(&row.action) || !is_entity_type(&row.entity_type) {
        return Err(());
    }
    Ok(AuditEventResponse {
        id: pos_id(row.id)?,
        occurred_at: row.occurred_at,
        actor: row.actor,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: pos_id(row.entity_id)?,
        revision: pos_id(row.revision)?,
    })
}

pub(crate) fn synthesized_script(
    id: i64,
    script: NormalizedScript,
    now: &str,
) -> Result<ScriptResponse, ()> {
    Ok(ScriptResponse {
        id: pos_id(id)?,
        revision: 1,
        title: script.title,
        description: script.description,
        tags: script.tags,
        language: language_of(&script.language)?,
        byte_size: byte_len(&script.body)?,
        body: script.body,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        archived_at: None,
    })
}

fn map_steps(rows: Vec<StepRow>, step_count: i64) -> Result<Vec<RunbookStepResponse>, ()> {
    let count = step_count_ok(step_count)?;
    if i64::try_from(rows.len()).ok() != Some(count) {
        return Err(());
    }
    let mut steps = Vec::with_capacity(rows.len());
    for (index, row) in rows.into_iter().enumerate() {
        let position = i64::try_from(index).map_err(|_| ())? + 1;
        if row.position != position {
            return Err(());
        }
        steps.push(RunbookStepResponse {
            position,
            script_id: pos_id(row.script_id)?,
            script_revision: pos_id(row.script_revision)?,
            instruction: row.instruction,
            script_title: row.script_title,
            script_language: language_of(&row.script_language)?,
            script_archived: row.script_archived != 0,
        });
    }
    Ok(steps)
}

fn map_export_steps(rows: Vec<ExportStepRow>, step_count: i64) -> Result<Vec<ExportStep>, ()> {
    let count = step_count_ok(step_count)?;
    if i64::try_from(rows.len()).ok() != Some(count) {
        return Err(());
    }
    let mut steps = Vec::with_capacity(rows.len());
    for (index, row) in rows.into_iter().enumerate() {
        let position = i64::try_from(index).map_err(|_| ())? + 1;
        if row.position != position {
            return Err(());
        }
        let position_u32 = u32::try_from(position).map_err(|_| ())?;
        byte_len(&row.script_body)?;
        steps.push(ExportStep {
            position: position_u32,
            script_id: pos_id(row.script_id)?,
            script_revision: pos_id(row.script_revision)?,
            instruction: row.instruction,
            script_title: row.script_title,
            language: language_of(&row.script_language)?,
            body: row.script_body,
            script_archived: row.script_archived != 0,
        });
    }
    Ok(steps)
}

fn language_of(value: &str) -> Result<String, ()> {
    canonical_language(value).map(str::to_string).ok_or(())
}

fn tags_of(value: &str) -> Result<Vec<String>, ()> {
    serde_json::from_str(value).map_err(|_| ())
}

fn byte_len(body: &str) -> Result<i64, ()> {
    let size = i64::try_from(body.len()).map_err(|_| ())?;
    byte_col(size)
}

fn byte_col(size: i64) -> Result<i64, ()> {
    if (1..=65_536).contains(&size) {
        Ok(size)
    } else {
        Err(())
    }
}

fn pos_id(value: i64) -> Result<i64, ()> {
    if value >= 1 {
        Ok(value)
    } else {
        Err(())
    }
}

fn step_count_ok(count: i64) -> Result<i64, ()> {
    if (1..=30).contains(&count) {
        Ok(count)
    } else {
        Err(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use serde_json::{json, Value};

    fn parse<T: DeserializeOwned>(value: Value) -> T {
        serde_json::from_value(value).unwrap()
    }

    fn script_value(body: &str) -> Value {
        json!({
            "id": "4",
            "revision": 2.0,
            "title": "  kept  ",
            "description": "line",
            "tags_json": "[\"ops\",\"db\"]",
            "language": "bash",
            "body": body,
            "created_at": "2026-09-30T00:00:00.000Z",
            "updated_at": "2026-09-30T00:00:01.000Z",
            "archived_at": null,
            "extra": true
        })
    }

    fn step_value(position: i64, archived: Value) -> Value {
        json!({
            "position": position,
            "script_id": 4,
            "script_revision": 2,
            "instruction": "do\nit",
            "script_title": "Title",
            "script_language": "python",
            "script_archived": archived
        })
    }

    #[test]
    fn script_rows_keep_body_bytes_and_reject_bad_columns() {
        let row: ScriptRow = parse(script_value("é\r\n"));
        let mapped = map_script(row).unwrap();
        assert_eq!(mapped.id, 4);
        assert_eq!(mapped.revision, 2);
        assert_eq!(mapped.title, "  kept  ");
        assert_eq!(mapped.tags, vec!["ops".to_string(), "db".to_string()]);
        assert_eq!(mapped.language, "bash");
        assert_eq!(mapped.body, "é\r\n");
        assert_eq!(mapped.byte_size, 4);
        assert!(mapped.archived_at.is_none());

        let mut missing = script_value("x");
        missing.as_object_mut().unwrap().remove("archived_at");
        let row: ScriptRow = parse(missing);
        assert!(map_script(row).unwrap().archived_at.is_none());

        let mut bad_lang = script_value("x");
        bad_lang["language"] = json!("Bash");
        assert!(map_script(parse(bad_lang)).is_err());

        let mut bad_tags = script_value("x");
        bad_tags["tags_json"] = json!("{\"a\":1}");
        assert!(map_script(parse(bad_tags)).is_err());

        let mut empty = script_value("");
        assert!(map_script(parse(empty)).is_err());

        let mut summary = script_value("ignored");
        summary["byte_size"] = json!(65_536);
        summary.as_object_mut().unwrap().remove("body");
        summary.as_object_mut().unwrap().remove("description");
        summary.as_object_mut().unwrap().remove("created_at");
        let row: ScriptSummaryRow = parse(summary);
        assert_eq!(map_script_summary(row).unwrap().byte_size, 65_536);

        let mut too_big = script_value("x");
        too_big["byte_size"] = json!(65_537);
        too_big.as_object_mut().unwrap().remove("body");
        too_big.as_object_mut().unwrap().remove("description");
        too_big.as_object_mut().unwrap().remove("created_at");
        assert!(map_script_summary(parse(too_big)).is_err());
    }

    #[test]
    fn revisions_accept_bool_flags_and_ids() {
        let row: IdRow = parse(json!({"max(id)": "9007199254740993"}));
        assert_eq!(require_new_id(&row).unwrap(), 9_007_199_254_740_993);
        assert!(require_new_id(&parse(json!({"id": 0}))).is_err());

        let ok: OkRow = parse(json!({"ok": true}));
        assert_eq!(ok.ok, 1);
        let snap = head_snap(parse(json!({
            "current_revision": 4,
            "archived_at": "2026-09-30T00:00:00.000Z"
        })));
        assert!(snap.archived);
        assert_eq!(snap.current_revision, 4);
        let live = head_snap(parse(json!({"current_revision": 1, "archived_at": null})));
        assert!(!live.archived);

        let revision: ScriptRevisionRow = parse(json!({
            "script_id": 4,
            "revision": 2,
            "title": "T",
            "description": "",
            "tags_json": "[]",
            "language": "powershell",
            "body": "x",
            "created_at": "2026-09-30T00:00:00.000Z",
            "created_by": "a@b",
            "is_current": true,
            "script_archived_at": null
        }));
        let mapped = map_script_revision(revision).unwrap();
        assert!(mapped.is_current);
        assert!(mapped.script_archived_at.is_none());
        assert_eq!(mapped.created_by, "a@b");
        assert!(mapped.tags.is_empty());

        let summary: ScriptRevisionSummaryRow = parse(json!({
            "revision": 3,
            "title": "T",
            "language": "python",
            "byte_size": 1,
            "created_at": "2026-09-30T00:00:00.000Z",
            "created_by": "a@b"
        }));
        assert_eq!(map_script_revision_summary(summary).unwrap().revision, 3);
    }

    #[test]
    fn runbook_steps_must_be_complete_and_ordered() {
        let header: RunbookRow = parse(json!({
            "id": 8,
            "revision": 1,
            "title": "R",
            "description": "",
            "step_count": 2,
            "created_at": "2026-09-30T00:00:00.000Z",
            "updated_at": "2026-09-30T00:00:00.000Z",
            "archived_at": null
        }));
        let steps = vec![
            parse(step_value(1, json!(0))),
            parse(step_value(2, json!(true))),
        ];
        let mapped = map_runbook(header, steps).unwrap();
        assert_eq!(mapped.steps.len(), 2);
        assert!(!mapped.steps[0].script_archived);
        assert!(mapped.steps[1].script_archived);
        assert_eq!(mapped.steps[1].script_language, "python");
        assert_eq!(mapped.steps[0].instruction, "do\nit");

        let header: RunbookRow = parse(json!({
            "id": 8, "revision": 1, "title": "R", "description": "",
            "step_count": 2, "created_at": "t", "updated_at": "t", "archived_at": null
        }));
        assert!(map_runbook(header, vec![parse(step_value(1, json!(0)))]).is_err());

        let summary: RunbookSummaryRow = parse(json!({
            "id": 8, "revision": 1, "title": "R", "step_count": 31,
            "updated_at": "t", "archived_at": null
        }));
        assert!(map_runbook_summary(summary).is_err());

        let revision: RunbookRevisionRow = parse(json!({
            "runbook_id": 8,
            "revision": 2,
            "title": "R",
            "description": "d",
            "step_count": 1,
            "created_at": "2026-09-30T00:00:00.000Z",
            "created_by": "a@b",
            "is_current": 0,
            "runbook_archived_at": "2026-09-30T00:00:02.000Z"
        }));
        let mapped = map_runbook_revision(revision, vec![parse(step_value(1, json!(1)))]).unwrap();
        assert!(!mapped.is_current);
        assert_eq!(
            mapped.runbook_archived_at.as_deref(),
            Some("2026-09-30T00:00:02.000Z")
        );

        let summary: RunbookRevisionSummaryRow = parse(json!({
            "revision": 2, "title": "R", "step_count": 1,
            "created_at": "t", "created_by": "a@b"
        }));
        assert_eq!(map_runbook_revision_summary(summary).unwrap().step_count, 1);
    }

    #[test]
    fn export_keeps_pinned_body_bytes() {
        let header: RunbookRevisionRow = parse(json!({
            "runbook_id": 8,
            "revision": 3,
            "title": "R",
            "description": "",
            "step_count": 1,
            "created_at": "2026-09-30T00:00:00.000Z",
            "created_by": "a@b",
            "is_current": 1
        }));
        let body = "echo `code`\n";
        let step: ExportStepRow = parse(json!({
            "position": 1,
            "script_id": 4,
            "script_revision": 2,
            "instruction": "go",
            "script_title": "T",
            "script_language": "bash",
            "script_body": body,
            "script_archived": false
        }));
        let mapped = map_export(header, vec![step]).unwrap();
        assert_eq!(mapped.steps[0].body, body);
        assert_eq!(mapped.steps[0].position, 1);
        assert!(!mapped.steps[0].script_archived);
        assert_eq!(mapped.revision_created_at, "2026-09-30T00:00:00.000Z");

        let header: RunbookRevisionRow = parse(json!({
            "runbook_id": 8, "revision": 3, "title": "R", "description": "",
            "step_count": 1, "created_at": "t", "created_by": "a@b", "is_current": 1
        }));
        let step: ExportStepRow = parse(json!({
            "position": 1, "script_id": 4, "script_revision": 2, "instruction": "go",
            "script_title": "T", "script_language": "bash", "script_body": "",
            "script_archived": 0
        }));
        assert!(map_export(header, vec![step]).is_err());
    }

    #[test]
    fn audit_rows_reject_unknown_vocabulary() {
        let row: AuditRow = parse(json!({
            "id": 3,
            "occurred_at": "2026-09-30T00:00:00.000Z",
            "actor": "a@b",
            "action": "runbook.update",
            "entity_type": "runbook",
            "entity_id": 8,
            "revision": 2
        }));
        let mapped = map_audit(row).unwrap();
        assert_eq!(mapped.action, "runbook.update");
        assert_eq!(mapped.entity_id, 8);

        let row: AuditRow = parse(json!({
            "id": 3, "occurred_at": "t", "actor": "a@b", "action": "script.delete",
            "entity_type": "script", "entity_id": 1, "revision": 1
        }));
        assert!(map_audit(row).is_err());
    }

    #[test]
    fn synthesized_create_uses_normalized_body_bytes() {
        let script = NormalizedScript {
            title: "T".into(),
            description: String::new(),
            tags: vec!["ops".into()],
            language: "bash".into(),
            body: "é".into(),
        };
        let mapped = synthesized_script(4, script, "2026-09-30T00:00:00.000Z").unwrap();
        assert_eq!(mapped.id, 4);
        assert_eq!(mapped.revision, 1);
        assert_eq!(mapped.byte_size, 2);
        assert_eq!(mapped.body, "é");
        assert_eq!(mapped.created_at, mapped.updated_at);
        assert!(mapped.archived_at.is_none());

        let script = NormalizedScript {
            title: "T".into(),
            description: String::new(),
            tags: Vec::new(),
            language: "nope".into(),
            body: "x".into(),
        };
        assert!(synthesized_script(1, script, "t").is_err());
        let script = NormalizedScript {
            title: "T".into(),
            description: String::new(),
            tags: Vec::new(),
            language: "bash".into(),
            body: "x".into(),
        };
        assert!(synthesized_script(0, script, "t").is_err());
    }
}
