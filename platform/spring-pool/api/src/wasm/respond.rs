use crate::error::{status_code, ErrorResponse};
use crate::export::content_disposition;
use serde::Serialize;
use worker::{Headers, Response, Result};

pub fn json_response(status: u16, body: &impl Serialize) -> Result<Response> {
    let headers = Headers::new();
    headers.set("content-type", "application/json; charset=utf-8")?;
    Ok(Response::from_json(body)?
        .with_status(status)
        .with_headers(headers))
}

pub fn json_err(body: ErrorResponse) -> Result<Response> {
    let status = status_code(&body);
    json_response(status, &body)
}

pub fn created(location: &str, body: &impl Serialize) -> Result<Response> {
    let headers = Headers::new();
    headers.set("content-type", "application/json; charset=utf-8")?;
    headers.set("location", location)?;
    Ok(Response::from_json(body)?
        .with_status(201)
        .with_headers(headers))
}

pub fn method_not_allowed(allow: &str) -> Result<Response> {
    let body = crate::error::method_not_allowed();
    let headers = Headers::new();
    headers.set("content-type", "application/json; charset=utf-8")?;
    headers.set("allow", allow)?;
    Ok(Response::from_json(&body)?
        .with_status(405)
        .with_headers(headers))
}

pub fn markdown(id: i64, revision: i64, body: String) -> Result<Response> {
    let headers = Headers::new();
    headers.set("content-type", "text/markdown; charset=utf-8")?;
    headers.set("content-disposition", &content_disposition(id, revision))?;
    Ok(Response::ok(body)?.with_headers(headers))
}
