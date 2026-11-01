use super::{audit, db, respond, runbooks, scripts};
use crate::{
    dto::HealthResponse,
    error,
    limits::sanitize_build_revision,
    route::{self, AppRoute as R, HttpMethod as M, PathId::Ok as Id, ShapeError},
    rows, sql,
    validate::{self, QueryKind},
};
use worker::{Env, Method, Request, Response, Result};
pub async fn handle(mut req: Request, env: Env) -> Result<Response> {
    let url = req.url()?;
    let route = route::parse_route(url.path());
    let method = match req.method() {
        Method::Get => M::Get,
        Method::Post => M::Post,
        Method::Put => M::Put,
        _ => M::Other,
    };
    let Some(allow) = route::allow_header(&route) else {
        return respond::json_err(error::not_found("Route not found."));
    };
    if !route::method_allowed(&route, method) {
        return respond::method_not_allowed(allow);
    }
    if route == R::Health {
        let build = sanitize_build_revision(
            &env.var("BUILD_REVISION")
                .map(|v| v.to_string())
                .unwrap_or_default(),
        );
        let ok = match env.d1("DB") {
            Ok(database) => db::first::<rows::OkRow>(&database, sql::HEALTH, vec![])
                .await
                .map(|row| row.is_some_and(|row| row.ok == 1))
                .unwrap_or(false),
            Err(_) => false,
        };
        return respond::json_response(if ok { 200 } else { 503 }, &HealthResponse::new(ok, build));
    }
    let actor = req
        .headers()
        .get("X-Spring-Pool-Actor")?
        .unwrap_or_default();
    if !validate::validate_actor(&actor) {
        return respond::json_err(error::unauthenticated());
    }
    if let Some(shape) = route::shape_error(&route) {
        return respond::json_err(match shape {
            ShapeError::NotFound => error::not_found("Entity not found."),
            ShapeError::RevisionNotFound => error::revision_not_found(),
        });
    }
    let kind = match route {
        R::Scripts if method == M::Get => Some(QueryKind::ScriptList),
        R::Runbooks if method == M::Get => Some(QueryKind::RunbookList),
        R::ScriptRevisions(_) | R::RunbookRevisions(_) => Some(QueryKind::RevisionList),
        R::Audit => Some(QueryKind::AuditList),
        _ => None,
    };
    let query = if let Some(kind) = kind {
        match validate::parse_query(
            kind,
            &url.query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect::<Vec<_>>(),
        ) {
            Ok(query) => Some(query),
            Err(_) => return respond::json_err(error::invalid_request()),
        }
    } else {
        None
    };
    let db = env.d1("DB")?;
    match (route, method) {
        (R::Scripts, M::Get) => scripts::list(&db, query.unwrap()).await,
        (R::Scripts, M::Post) => scripts::create(&db, &mut req, &actor).await,
        (R::Script(Id(id)), M::Get) => scripts::get(&db, id).await,
        (R::Script(Id(id)), M::Put) => scripts::update(&db, &mut req, &actor, id).await,
        (R::ScriptArchive(Id(id)), M::Post) => scripts::archive(&db, &mut req, &actor, id).await,
        (R::ScriptRevisions(Id(id)), M::Get) => scripts::revisions(&db, id, query.unwrap()).await,
        (
            R::ScriptRevision {
                id: Id(id),
                revision: Id(rev),
            },
            M::Get,
        ) => scripts::revision(&db, id, rev).await,
        (R::Runbooks, M::Get) => runbooks::list(&db, query.unwrap()).await,
        (R::Runbooks, M::Post) => runbooks::create(&db, &mut req, &actor).await,
        (R::Runbook(Id(id)), M::Get) => runbooks::get(&db, id).await,
        (R::Runbook(Id(id)), M::Put) => runbooks::update(&db, &mut req, &actor, id).await,
        (R::RunbookArchive(Id(id)), M::Post) => runbooks::archive(&db, &mut req, &actor, id).await,
        (R::RunbookRevisions(Id(id)), M::Get) => runbooks::revisions(&db, id, query.unwrap()).await,
        (
            R::RunbookRevision {
                id: Id(id),
                revision: Id(rev),
            },
            M::Get,
        ) => runbooks::revision(&db, id, rev, false).await,
        (
            R::RunbookExport {
                id: Id(id),
                revision: Id(rev),
            },
            M::Get,
        ) => runbooks::revision(&db, id, rev, true).await,
        (R::Audit, M::Get) => audit::list(&db, query.unwrap()).await,
        _ => respond::json_err(error::not_found("Route not found.")),
    }
}
