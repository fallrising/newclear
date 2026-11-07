//! JSON shapes. Input structs use `deny_unknown_fields`. Missing optional
//! fields default; JSON null does not.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScriptCreate {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub language: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScriptUpdate {
    pub expected_revision: i64,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub language: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ArchiveRequest {
    pub expected_revision: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StepInput {
    pub script_id: i64,
    pub script_revision: i64,
    pub instruction: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunbookCreate {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub steps: Vec<StepInput>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunbookUpdate {
    pub expected_revision: i64,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub steps: Vec<StepInput>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScriptResponse {
    pub id: i64,
    pub revision: i64,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub language: String,
    pub body: String,
    pub byte_size: i64,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScriptSummary {
    pub id: i64,
    pub revision: i64,
    pub title: String,
    pub tags: Vec<String>,
    pub language: String,
    pub byte_size: i64,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScriptList {
    pub items: Vec<ScriptSummary>,
    pub next_before_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScriptRevisionResponse {
    pub script_id: i64,
    pub revision: i64,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub language: String,
    pub body: String,
    pub byte_size: i64,
    pub created_at: String,
    pub created_by: String,
    pub is_current: bool,
    pub script_archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScriptRevisionSummary {
    pub revision: i64,
    pub title: String,
    pub language: String,
    pub byte_size: i64,
    pub created_at: String,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ScriptRevisionList {
    pub items: Vec<ScriptRevisionSummary>,
    pub next_before_revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunbookStepResponse {
    pub position: i64,
    pub script_id: i64,
    pub script_revision: i64,
    pub instruction: String,
    pub script_title: String,
    pub script_language: String,
    pub script_archived: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunbookResponse {
    pub id: i64,
    pub revision: i64,
    pub title: String,
    pub description: String,
    pub steps: Vec<RunbookStepResponse>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunbookSummary {
    pub id: i64,
    pub revision: i64,
    pub title: String,
    pub step_count: i64,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunbookList {
    pub items: Vec<RunbookSummary>,
    pub next_before_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunbookRevisionResponse {
    pub runbook_id: i64,
    pub revision: i64,
    pub title: String,
    pub description: String,
    pub steps: Vec<RunbookStepResponse>,
    pub created_at: String,
    pub created_by: String,
    pub is_current: bool,
    pub runbook_archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunbookRevisionSummary {
    pub revision: i64,
    pub title: String,
    pub step_count: i64,
    pub created_at: String,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunbookRevisionList {
    pub items: Vec<RunbookRevisionSummary>,
    pub next_before_revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditEventResponse {
    pub id: i64,
    pub occurred_at: String,
    pub actor: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: i64,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AuditList {
    pub items: Vec<AuditEventResponse>,
    pub next_before_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub build: String,
    pub database: &'static str,
}

impl HealthResponse {
    pub fn new(ok: bool, build: String) -> Self {
        if ok {
            Self {
                status: "ok",
                service: "spring-pool-api",
                build,
                database: "ok",
            }
        } else {
            Self {
                status: "degraded",
                service: "spring-pool-api",
                build,
                database: "error",
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_create_rejects_unknown_fields_wrong_types_and_null_optionals() {
        let ok: ScriptCreate =
            serde_json::from_str(r#"{"title":"T","language":"bash","body":"x"}"#).unwrap();
        assert_eq!(ok.description, "");
        assert!(ok.tags.is_empty());

        assert!(serde_json::from_str::<ScriptCreate>(
            r#"{"title":"T","language":"bash","body":"x","extra":1}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ScriptCreate>(
            r#"{"title":"T","language":"bash","body":"x","description":null}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ScriptCreate>(
            r#"{"title":"T","language":"bash","body":"x","tags":null}"#
        )
        .is_err());
        assert!(
            serde_json::from_str::<ScriptCreate>(r#"{"title":"T","language":1,"body":"x"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<ScriptCreate>(r#"{"language":"bash","body":"x"}"#).is_err());
        assert!(serde_json::from_str::<ScriptCreate>(
            r#"{"title":"T","language":"bash","body":"x","tags":[1]}"#
        )
        .is_err());
    }

    #[test]
    fn updates_require_expected_revision_as_an_integer() {
        assert!(serde_json::from_str::<ScriptUpdate>(
            r#"{"title":"T","language":"bash","body":"x"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ScriptUpdate>(
            r#"{"expected_revision":"1","title":"T","language":"bash","body":"x"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ScriptUpdate>(
            r#"{"expected_revision":1.5,"title":"T","language":"bash","body":"x"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ScriptUpdate>(
            r#"{"expected_revision":1.0,"title":"T","language":"bash","body":"x"}"#
        )
        .is_err());
        let ok: ScriptUpdate = serde_json::from_str(
            r#"{"expected_revision":2,"title":"T","language":"bash","body":"x"}"#,
        )
        .unwrap();
        assert_eq!(ok.expected_revision, 2);

        assert!(serde_json::from_str::<ArchiveRequest>(r#"{}"#).is_err());
        assert!(
            serde_json::from_str::<ArchiveRequest>(r#"{"expected_revision":1,"x":1}"#).is_err()
        );
    }

    #[test]
    fn runbook_steps_reject_unknown_nested_fields() {
        assert!(serde_json::from_str::<RunbookCreate>(
            r#"{"title":"R","steps":[{"script_id":1,"script_revision":1,"instruction":"go","note":"no"}]}"#
        )
        .is_err());
        let ok: RunbookCreate = serde_json::from_str(
            r#"{"title":"R","steps":[{"script_id":1,"script_revision":1,"instruction":"go"}]}"#,
        )
        .unwrap();
        assert_eq!(ok.description, "");
        assert!(serde_json::from_str::<RunbookUpdate>(
            r#"{"title":"R","steps":[{"script_id":1,"script_revision":1,"instruction":"go"}]}"#
        )
        .is_err());
    }

    #[test]
    fn responses_keep_null_archive_and_cursors() {
        let script = ScriptResponse {
            id: 7,
            revision: 1,
            title: "T".into(),
            description: "".into(),
            tags: vec!["ops".into()],
            language: "bash".into(),
            body: "echo".into(),
            byte_size: 4,
            created_at: "2026-09-30T12:34:56.789Z".into(),
            updated_at: "2026-09-30T12:34:56.789Z".into(),
            archived_at: None,
        };
        let json = serde_json::to_value(&script).unwrap();
        assert!(json.get("archived_at").unwrap().is_null());
        assert_eq!(json["byte_size"], 4);
        assert!(json.get("created_by").is_none());

        let list = ScriptList {
            items: Vec::new(),
            next_before_id: None,
        };
        let json = serde_json::to_value(&list).unwrap();
        assert!(json["next_before_id"].is_null());

        let list = ScriptList {
            items: Vec::new(),
            next_before_id: Some(4),
        };
        assert_eq!(serde_json::to_value(&list).unwrap()["next_before_id"], 4);

        let health = HealthResponse::new(false, "abc".into());
        let json = serde_json::to_value(&health).unwrap();
        assert_eq!(json["status"], "degraded");
        assert_eq!(json["service"], "spring-pool-api");
        assert_eq!(json["database"], "error");
        assert_eq!(json["build"], "abc");
    }
}
