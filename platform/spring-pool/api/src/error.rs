//! Error envelope. `current_revision` is only present on 409. `details` is
//! present on 413 and 422. Messages never include bodies, titles, or emails.

use crate::validate::{Issue, IssueCode};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorObject,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ErrorObject {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<IssueBody>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IssueBody {
    pub field: String,
    pub issue: IssueCode,
}

pub fn status_code(response: &ErrorResponse) -> u16 {
    match response.error.code {
        "invalid_request" => 400,
        "unauthenticated" => 401,
        "not_found" | "revision_not_found" => 404,
        "method_not_allowed" => 405,
        "revision_conflict" | "archived" => 409,
        "request_too_large" | "script_too_large" => 413,
        "validation_failed" => 422,
        _ => 500,
    }
}

pub fn invalid_request() -> ErrorResponse {
    plain("invalid_request", "The request is invalid.")
}

pub fn unauthenticated() -> ErrorResponse {
    plain("unauthenticated", "Authentication is required.")
}

pub fn not_found(message: &str) -> ErrorResponse {
    plain("not_found", message)
}

pub fn revision_not_found() -> ErrorResponse {
    plain("revision_not_found", "Revision not found.")
}

pub fn method_not_allowed() -> ErrorResponse {
    plain("method_not_allowed", "Method not allowed.")
}

pub fn request_too_large() -> ErrorResponse {
    ErrorResponse {
        error: ErrorObject {
            code: "request_too_large",
            message: "Request body exceeds 524288 bytes.".into(),
            current_revision: None,
            details: Some(Vec::new()),
        },
    }
}

pub fn script_too_large() -> ErrorResponse {
    ErrorResponse {
        error: ErrorObject {
            code: "script_too_large",
            message: "Script body exceeds 65536 bytes.".into(),
            current_revision: None,
            details: Some(vec![IssueBody {
                field: "body".into(),
                issue: IssueCode::TooLong,
            }]),
        },
    }
}

pub fn validation_failed(issues: &[Issue]) -> ErrorResponse {
    ErrorResponse {
        error: ErrorObject {
            code: "validation_failed",
            message: "Validation failed.".into(),
            current_revision: None,
            details: Some(
                issues
                    .iter()
                    .map(|issue| IssueBody {
                        field: issue.field.clone(),
                        issue: issue.code,
                    })
                    .collect(),
            ),
        },
    }
}

pub fn revision_conflict(kind: &str, id: i64, current: i64, expected: i64) -> ErrorResponse {
    ErrorResponse {
        error: ErrorObject {
            code: "revision_conflict",
            message: format!(
                "{kind} {id} is at revision {current}; you sent expected_revision {expected}."
            ),
            current_revision: Some(current),
            details: None,
        },
    }
}

pub fn archived(kind: &str, id: i64, current: i64) -> ErrorResponse {
    ErrorResponse {
        error: ErrorObject {
            code: "archived",
            message: format!("{kind} {id} is archived at revision {current}."),
            current_revision: Some(current),
            details: None,
        },
    }
}

pub fn conflict_without_head(code: &'static str) -> ErrorResponse {
    let message = if code == "archived" {
        "The item is archived."
    } else {
        "The resource revision does not match."
    };
    ErrorResponse {
        error: ErrorObject {
            code: if code == "archived" {
                "archived"
            } else {
                "revision_conflict"
            },
            message: message.into(),
            current_revision: None,
            details: None,
        },
    }
}

pub fn internal_error() -> ErrorResponse {
    plain("internal_error", "Internal error.")
}

fn plain(code: &'static str, message: &str) -> ErrorResponse {
    ErrorResponse {
        error: ErrorObject {
            code,
            message: message.to_string(),
            current_revision: None,
            details: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::Issue;

    #[test]
    fn envelope_shape_matches_the_contract() {
        let conflict = revision_conflict("Script", 7, 4, 3);
        assert_eq!(status_code(&conflict), 409);
        let json = serde_json::to_value(&conflict).unwrap();
        assert_eq!(json["error"]["code"], "revision_conflict");
        assert_eq!(
            json["error"]["message"],
            "Script 7 is at revision 4; you sent expected_revision 3."
        );
        assert_eq!(json["error"]["current_revision"], 4);
        assert!(json["error"].get("details").is_none());

        let archived = archived("Runbook", 2, 5);
        assert_eq!(
            serde_json::to_value(&archived).unwrap()["error"]["message"],
            "Runbook 2 is archived at revision 5."
        );

        let invalid = validation_failed(&[Issue {
            field: "steps[0].script_revision".into(),
            code: IssueCode::NotFound,
        }]);
        assert_eq!(status_code(&invalid), 422);
        let json = serde_json::to_value(&invalid).unwrap();
        assert!(json["error"].get("current_revision").is_none());
        assert_eq!(
            json["error"]["details"][0]["field"],
            "steps[0].script_revision"
        );
        assert_eq!(json["error"]["details"][0]["issue"], "not_found");

        let too_big = script_too_large();
        assert_eq!(status_code(&too_big), 413);
        assert_eq!(
            serde_json::to_value(&too_big).unwrap()["error"]["details"][0]["field"],
            "body"
        );
        let raw = request_too_large();
        assert_eq!(
            serde_json::to_value(&raw).unwrap()["error"]["details"],
            serde_json::json!([])
        );

        for (response, status) in [
            (invalid_request(), 400),
            (unauthenticated(), 401),
            (not_found("Script not found."), 404),
            (revision_not_found(), 404),
            (method_not_allowed(), 405),
            (internal_error(), 500),
        ] {
            assert_eq!(status_code(&response), status);
            let json = serde_json::to_value(&response).unwrap();
            assert!(json["error"].get("current_revision").is_none());
            assert!(json["error"].get("details").is_none());
            let message = json["error"]["message"].as_str().unwrap();
            assert!(!message.contains('@'));
        }
    }
}
