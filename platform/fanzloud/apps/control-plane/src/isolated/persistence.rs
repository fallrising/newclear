//! CU-M3-01–05: product intent/readback only; no queue, recovery POST or agent lifecycle.
use super::*;
use codebox_event_store::{BeginSubmission, SubmissionStore, SubmissionStoreError};
use serde_json::{Value, json};

async fn send(
    config: Arc<Config>,
    method: Method,
    path: String,
    headers: HeaderMap,
    body: Vec<u8>,
) -> Result<Response<Body>, IsolatedError> {
    tokio::task::spawn_blocking(move || forward(&config, &method, &path, &headers, &body))
        .await
        .map_err(|_| IsolatedError::Transport)?
}

fn json(status: StatusCode, value: &Value) -> Response<Body> {
    let encoded = value.to_string();
    if encoded.len() > RESPONSE_LIMIT * 2 {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "durable_response_too_large",
        );
    }
    reply(status, encoded, "application/json")
}

fn store_error(value: SubmissionStoreError) -> Response<Body> {
    match value {
        SubmissionStoreError::Conflict => error(StatusCode::CONFLICT, "submission_conflict"),
        SubmissionStoreError::InvalidInput => error(StatusCode::BAD_REQUEST, "invalid_submission"),
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "durable_store_unavailable"),
    }
}

fn canonical_id(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|text| Uuid::parse_str(text).is_ok_and(|id| id.to_string() == text))
}

fn valid_task(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == 5
        && ["project_id", "profile_revision"]
            .iter()
            .all(|field| canonical_id(&value[field]))
        && value["base_sha"].as_str().is_some_and(|text| {
            text.len() == 40
                && text
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        && [("title", 200), ("goal", 20_000)]
            .iter()
            .all(|(key, limit)| {
                value[*key].as_str().is_some_and(|text| {
                    !text.trim().is_empty()
                        && text.chars().count() <= *limit
                        && !text.contains('\0')
                })
            })
}

fn valid_handoff(path: &str, body: &Value) -> bool {
    let Some(object) = body.as_object() else {
        return false;
    };
    if path.ends_with("/rework") {
        return object.is_empty();
    }
    object.len() == 3
        && canonical_id(&body["artifact_id"])
        && canonical_id(&body["profile_revision"])
        && body["candidate_sha256"].as_str().is_some_and(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}

fn valid_receipt(receipt: &Value, request: &Value) -> bool {
    if request.get("route").is_some() {
        // Full lineage/body binding is checked atomically by SubmissionStore::confirm.
        return canonical_id(&receipt["run"]["id"])
            && canonical_id(&receipt["task"]["id"])
            && receipt["run"]["task_id"] == receipt["task"]["id"];
    }
    let run = &receipt["run"];
    let task = &receipt["task"];
    canonical_id(&run["id"])
        && canonical_id(&task["id"])
        && run["task_id"] == task["id"]
        && task["project_id"] == request["project_id"]
        && task["title"] == request["title"]
        && ["base_sha", "profile_revision", "goal"]
            .iter()
            .all(|key| run[*key] == request[*key])
}

/// AP authenticates every local read and authorizes intent recording before any task POST.
pub(super) async fn handle(
    config: Arc<Config>,
    store: SubmissionStore,
    method: Method,
    path: String,
    headers: HeaderMap,
    body: Vec<u8>,
) -> Response<Body> {
    let session = match send(
        config.clone(),
        Method::GET,
        "/api/v1/session".into(),
        headers.clone(),
        vec![],
    )
    .await
    {
        Ok(value) if value.status() == StatusCode::OK => value,
        _ => {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "authentication_unavailable",
            );
        }
    };
    let session = match to_bytes(session.into_body(), RESPONSE_LIMIT)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
    {
        Some(value) if value["authenticated"] == true => value,
        _ => return error(StatusCode::UNAUTHORIZED, "authentication_required"),
    };
    let Some(owner) = session["username"]
        .as_str()
        .filter(|text| !text.is_empty() && text.len() <= 256)
        .map(str::to_owned)
    else {
        return error(StatusCode::UNAUTHORIZED, "authentication_required");
    };
    if method == Method::POST
        && (session["csrf_token"].as_str().is_none_or(str::is_empty)
            || headers.get("x-csrf-token").and_then(|v| v.to_str().ok())
                != session["csrf_token"].as_str())
    {
        return error(StatusCode::FORBIDDEN, "csrf_failed");
    }
    if path == "/api/v1/submissions" {
        return match tokio::task::spawn_blocking(move || store.list(&owner)).await {
            Ok(Ok(value)) => json(StatusCode::OK, &value),
            Ok(Err(value)) => store_error(value),
            Err(_) => error(StatusCode::SERVICE_UNAVAILABLE, "durable_store_unavailable"),
        };
    }
    if method == Method::POST {
        let request = match serde_json::from_slice::<Value>(&body) {
            Ok(value) if path == "/api/v1/tasks" && valid_task(&value) => value,
            Ok(value) if handoff_target(&path) && valid_handoff(&path, &value) => {
                json!({"route":path,"body":value})
            }
            _ => return error(StatusCode::BAD_REQUEST, "invalid_submission"),
        };
        let Some(key) = headers
            .get("idempotency-key")
            .and_then(|v| v.to_str().ok())
            .filter(|text| canonical_id(&Value::String(text.to_string())))
            .map(str::to_owned)
        else {
            return error(StatusCode::BAD_REQUEST, "invalid_submission_key");
        };
        let (db, who, id, value) = (store.clone(), owner.clone(), key.clone(), request.clone());
        match tokio::task::spawn_blocking(move || db.begin(&who, &id, &value)).await {
            Ok(Ok(BeginSubmission::Started)) => {}
            Ok(Ok(BeginSubmission::Existing(value))) if value["state"] == "confirmed" => {
                return json(StatusCode::ACCEPTED, &value["receipt"]);
            }
            Ok(Ok(BeginSubmission::Existing(value))) if value["state"] == "rejected" => {
                return error(StatusCode::CONFLICT, "submission_rejected");
            }
            Ok(Ok(_)) => return error(StatusCode::CONFLICT, "submission_outcome_unknown"),
            Ok(Err(value)) => return store_error(value),
            Err(_) => return error(StatusCode::SERVICE_UNAVAILABLE, "durable_store_unavailable"),
        }
        // No cancellation or error below this committed claim grants another POST.
        let response = match send(config, method, path, headers, body).await {
            Ok(value) => value,
            Err(_) => return error(StatusCode::BAD_GATEWAY, "upstream_outcome_unknown"),
        };
        let status = response.status();
        if status.is_client_error() {
            return match tokio::task::spawn_blocking(move || store.reject(&owner, &key)).await {
                Ok(Ok(())) => error(status, "submission_rejected"),
                _ => error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "submission_outcome_unknown",
                ),
            };
        }
        if status != StatusCode::ACCEPTED {
            return error(StatusCode::BAD_GATEWAY, "upstream_outcome_unknown");
        }
        let receipt = match to_bytes(response.into_body(), RESPONSE_LIMIT)
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        {
            Some(value) if valid_receipt(&value, &request) => value,
            _ => return error(StatusCode::BAD_GATEWAY, "upstream_outcome_unknown"),
        };
        let saved = receipt.clone();
        return match tokio::task::spawn_blocking(move || store.confirm(&owner, &key, &saved)).await
        {
            Ok(Ok(())) => json(StatusCode::ACCEPTED, &receipt),
            _ => error(
                StatusCode::SERVICE_UNAVAILABLE,
                "submission_outcome_unknown",
            ),
        };
    }
    let response = match send(config, method, path.clone(), headers, body).await {
        Ok(value) if value.status() == StatusCode::OK => value,
        Ok(mut value) => {
            security(&mut value);
            return value;
        }
        Err(_) => return error(StatusCode::BAD_GATEWAY, "upstream_unavailable"),
    };
    let run = match to_bytes(response.into_body(), RESPONSE_LIMIT)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
    {
        Some(value) if value["id"].as_str() == path.strip_prefix("/api/v1/runs/") => value,
        _ => return error(StatusCode::BAD_GATEWAY, "invalid_run_projection"),
    };
    match tokio::task::spawn_blocking(move || store.observe(&owner, &run)).await {
        Ok(Ok(mut projection)) => {
            let mut run = projection["run"].take();
            if let Some(object) = projection.as_object_mut() {
                object.remove("run");
            }
            run["fanz_history"] = projection;
            json(StatusCode::OK, &run)
        }
        Ok(Err(value)) => store_error(value),
        Err(_) => error(StatusCode::SERVICE_UNAVAILABLE, "durable_store_unavailable"),
    }
}
