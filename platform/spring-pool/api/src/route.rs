//! Path matching for `/v1`. Bad id shape is still a known route so method and
//! auth run before the 404. `{revision}` shape failures are `revision_not_found`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathId {
    Ok(i64),
    Bad,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppRoute {
    Health,
    Scripts,
    Script(PathId),
    ScriptArchive(PathId),
    ScriptRevisions(PathId),
    ScriptRevision { id: PathId, revision: PathId },
    Runbooks,
    Runbook(PathId),
    RunbookArchive(PathId),
    RunbookRevisions(PathId),
    RunbookRevision { id: PathId, revision: PathId },
    RunbookExport { id: PathId, revision: PathId },
    Audit,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapeError {
    NotFound,
    RevisionNotFound,
}

pub fn parse_path_id(segment: &str) -> Option<i64> {
    let bytes = segment.as_bytes();
    if bytes.is_empty() || bytes.len() > 16 {
        return None;
    }
    if !bytes[0].is_ascii_digit() || bytes[0] == b'0' {
        return None;
    }
    if !bytes[1..].iter().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    segment.parse().ok()
}

pub fn parse_route(path: &str) -> AppRoute {
    if !path.starts_with('/') {
        return AppRoute::Unknown;
    }
    let segments: Vec<&str> = path[1..].split('/').collect();
    if segments.iter().any(|segment| segment.is_empty()) {
        return AppRoute::Unknown;
    }
    match segments.as_slice() {
        ["v1", "health"] => AppRoute::Health,
        ["v1", "scripts"] => AppRoute::Scripts,
        ["v1", "scripts", id] => AppRoute::Script(path_id(id)),
        ["v1", "scripts", id, "archive"] => AppRoute::ScriptArchive(path_id(id)),
        ["v1", "scripts", id, "revisions"] => AppRoute::ScriptRevisions(path_id(id)),
        ["v1", "scripts", id, "revisions", rev] => AppRoute::ScriptRevision {
            id: path_id(id),
            revision: path_id(rev),
        },
        ["v1", "runbooks"] => AppRoute::Runbooks,
        ["v1", "runbooks", id] => AppRoute::Runbook(path_id(id)),
        ["v1", "runbooks", id, "archive"] => AppRoute::RunbookArchive(path_id(id)),
        ["v1", "runbooks", id, "revisions"] => AppRoute::RunbookRevisions(path_id(id)),
        ["v1", "runbooks", id, "revisions", rev] => AppRoute::RunbookRevision {
            id: path_id(id),
            revision: path_id(rev),
        },
        ["v1", "runbooks", id, "revisions", rev, "export"] => AppRoute::RunbookExport {
            id: path_id(id),
            revision: path_id(rev),
        },
        ["v1", "audit"] => AppRoute::Audit,
        _ => AppRoute::Unknown,
    }
}

pub fn allow_header(route: &AppRoute) -> Option<&'static str> {
    match route {
        AppRoute::Health => Some("GET"),
        AppRoute::Scripts | AppRoute::Runbooks => Some("GET, POST"),
        AppRoute::Script(_) | AppRoute::Runbook(_) => Some("GET, PUT"),
        AppRoute::ScriptArchive(_) | AppRoute::RunbookArchive(_) => Some("POST"),
        AppRoute::ScriptRevisions(_)
        | AppRoute::ScriptRevision { .. }
        | AppRoute::RunbookRevisions(_)
        | AppRoute::RunbookRevision { .. }
        | AppRoute::RunbookExport { .. }
        | AppRoute::Audit => Some("GET"),
        AppRoute::Unknown => None,
    }
}

pub fn method_allowed(route: &AppRoute, method: HttpMethod) -> bool {
    match method {
        HttpMethod::Get => matches!(
            route,
            AppRoute::Health
                | AppRoute::Scripts
                | AppRoute::Script(_)
                | AppRoute::ScriptRevisions(_)
                | AppRoute::ScriptRevision { .. }
                | AppRoute::Runbooks
                | AppRoute::Runbook(_)
                | AppRoute::RunbookRevisions(_)
                | AppRoute::RunbookRevision { .. }
                | AppRoute::RunbookExport { .. }
                | AppRoute::Audit
        ),
        HttpMethod::Post => matches!(
            route,
            AppRoute::Scripts
                | AppRoute::Runbooks
                | AppRoute::ScriptArchive(_)
                | AppRoute::RunbookArchive(_)
        ),
        HttpMethod::Put => matches!(route, AppRoute::Script(_) | AppRoute::Runbook(_)),
        HttpMethod::Other => false,
    }
}

pub fn shape_error(route: &AppRoute) -> Option<ShapeError> {
    match route {
        AppRoute::Script(PathId::Bad)
        | AppRoute::ScriptArchive(PathId::Bad)
        | AppRoute::ScriptRevisions(PathId::Bad)
        | AppRoute::Runbook(PathId::Bad)
        | AppRoute::RunbookArchive(PathId::Bad)
        | AppRoute::RunbookRevisions(PathId::Bad)
        | AppRoute::ScriptRevision {
            id: PathId::Bad, ..
        }
        | AppRoute::RunbookRevision {
            id: PathId::Bad, ..
        }
        | AppRoute::RunbookExport {
            id: PathId::Bad, ..
        } => Some(ShapeError::NotFound),
        AppRoute::ScriptRevision {
            revision: PathId::Bad,
            ..
        }
        | AppRoute::RunbookRevision {
            revision: PathId::Bad,
            ..
        }
        | AppRoute::RunbookExport {
            revision: PathId::Bad,
            ..
        } => Some(ShapeError::RevisionNotFound),
        _ => None,
    }
}

fn path_id(segment: &str) -> PathId {
    match parse_path_id(segment) {
        Some(id) => PathId::Ok(id),
        None => PathId::Bad,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_ids_match_the_contract_pattern() {
        assert_eq!(parse_path_id("1"), Some(1));
        assert_eq!(parse_path_id("10"), Some(10));
        assert_eq!(parse_path_id(&"9".repeat(16)), Some(9_999_999_999_999_999));
        assert_eq!(parse_path_id("0"), None);
        assert_eq!(parse_path_id("01"), None);
        assert_eq!(parse_path_id("abc"), None);
        assert_eq!(parse_path_id(""), None);
        assert_eq!(parse_path_id(&"9".repeat(17)), None);
        assert_eq!(parse_path_id("-1"), None);
        assert_eq!(parse_path_id("1.2"), None);
    }

    #[test]
    fn every_openapi_route_is_known_and_cleanup_is_not() {
        let cases = [
            ("/v1/health", AppRoute::Health),
            ("/v1/scripts", AppRoute::Scripts),
            ("/v1/scripts/7", AppRoute::Script(PathId::Ok(7))),
            ("/v1/scripts/abc", AppRoute::Script(PathId::Bad)),
            (
                "/v1/scripts/7/archive",
                AppRoute::ScriptArchive(PathId::Ok(7)),
            ),
            (
                "/v1/scripts/7/revisions",
                AppRoute::ScriptRevisions(PathId::Ok(7)),
            ),
            (
                "/v1/scripts/7/revisions/2",
                AppRoute::ScriptRevision {
                    id: PathId::Ok(7),
                    revision: PathId::Ok(2),
                },
            ),
            ("/v1/runbooks", AppRoute::Runbooks),
            ("/v1/runbooks/0", AppRoute::Runbook(PathId::Bad)),
            (
                "/v1/runbooks/4/archive",
                AppRoute::RunbookArchive(PathId::Ok(4)),
            ),
            (
                "/v1/runbooks/4/revisions/3/export",
                AppRoute::RunbookExport {
                    id: PathId::Ok(4),
                    revision: PathId::Ok(3),
                },
            ),
            ("/v1/audit", AppRoute::Audit),
        ];
        for (path, route) in cases {
            assert_eq!(parse_route(path), route, "{path}");
        }
        for path in [
            "/v1/scripts/1/delete",
            "/v1/scripts/1/execute",
            "/v1/cleanup",
            "/v1/scripts/",
            "/v1//scripts",
            "/v1/Scripts",
            "/",
            "/healthz",
        ] {
            assert_eq!(parse_route(path), AppRoute::Unknown, "{path}");
        }
    }

    #[test]
    fn bad_revision_shape_is_distinct_and_id_wins_when_both_are_bad() {
        let both = parse_route("/v1/scripts/abc/revisions/nope");
        assert_eq!(shape_error(&both), Some(ShapeError::NotFound));
        let rev = parse_route("/v1/runbooks/4/revisions/0/export");
        assert_eq!(shape_error(&rev), Some(ShapeError::RevisionNotFound));
        assert_eq!(shape_error(&parse_route("/v1/scripts/4")), None);
    }

    #[test]
    fn methods_match_the_route_table() {
        let get_put = parse_route("/v1/scripts/1");
        assert!(method_allowed(&get_put, HttpMethod::Get));
        assert!(method_allowed(&get_put, HttpMethod::Put));
        assert!(!method_allowed(&get_put, HttpMethod::Post));
        assert_eq!(allow_header(&get_put), Some("GET, PUT"));

        let archive = parse_route("/v1/runbooks/1/archive");
        assert!(method_allowed(&archive, HttpMethod::Post));
        assert!(!method_allowed(&archive, HttpMethod::Get));
        assert!(!method_allowed(&archive, HttpMethod::Other));
        assert_eq!(allow_header(&archive), Some("POST"));

        assert!(method_allowed(&AppRoute::Health, HttpMethod::Get));
        assert!(!method_allowed(&AppRoute::Health, HttpMethod::Post));
        assert_eq!(allow_header(&AppRoute::Health), Some("GET"));
        assert!(!method_allowed(&AppRoute::Audit, HttpMethod::Other));
        assert_eq!(allow_header(&parse_route("/v1/scripts")), Some("GET, POST"));
    }
}
