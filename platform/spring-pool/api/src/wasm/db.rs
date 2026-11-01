use serde::de::DeserializeOwned;
use serde_json::Value;
use worker::{wasm_bindgen::JsValue, D1Database, D1PreparedStatement, D1Result, Result};

pub fn statement(db: &D1Database, sql: &str, args: Vec<Value>) -> Result<D1PreparedStatement> {
    let values = args
        .into_iter()
        .map(|value| match value {
            Value::String(s) => Ok(JsValue::from_str(&s)),
            Value::Number(n) => n
                .as_f64()
                .map(JsValue::from_f64)
                .ok_or_else(|| super::worker_msg("invalid SQL number")),
            Value::Null => Ok(JsValue::NULL),
            _ => Err(super::worker_msg("invalid SQL value")),
        })
        .collect::<Result<Vec<_>>>()?;
    db.prepare(sql).bind(&values)
}
pub fn checked(result: D1Result) -> Result<D1Result> {
    if result.success() {
        Ok(result)
    } else {
        Err(super::worker_msg(
            &result.error().unwrap_or_else(|| "D1 query failed".into()),
        ))
    }
}
pub async fn all<T: DeserializeOwned>(
    db: &D1Database,
    sql: &str,
    args: Vec<Value>,
) -> Result<Vec<T>> {
    checked(statement(db, sql, args)?.all().await?)?.results()
}
pub async fn first<T: DeserializeOwned>(
    db: &D1Database,
    sql: &str,
    args: Vec<Value>,
) -> Result<Option<T>> {
    Ok(all(db, sql, args).await?.into_iter().next())
}
pub async fn batch(db: &D1Database, statements: Vec<D1PreparedStatement>) -> Result<Vec<D1Result>> {
    db.batch(statements)
        .await?
        .into_iter()
        .map(checked)
        .collect()
}
pub fn mapped<T, E>(value: std::result::Result<T, E>) -> Result<T> {
    value.map_err(|_| super::worker_msg("invalid database row"))
}
pub fn required<T>(value: Option<T>) -> Result<T> {
    value.ok_or_else(|| super::worker_msg("missing database result"))
}
