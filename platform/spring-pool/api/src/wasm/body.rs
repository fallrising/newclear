use crate::error::{invalid_request, request_too_large, ErrorResponse};
use crate::limits::{classify_content_length, ContentLength, REQUEST_MAX_BYTES};
use serde::de::DeserializeOwned;
use worker::js_sys::{Function, Promise, Reflect, Uint8Array};
use worker::wasm_bindgen::JsCast;
use worker::wasm_bindgen::JsValue;
use worker::wasm_bindgen_futures::JsFuture;
use worker::{Request, Result};

pub enum ReadJson<T> {
    Value(T),
    Failure(ErrorResponse),
}

enum BodyRead {
    Bytes(Vec<u8>),
    TooLarge,
    InvalidLength,
}

pub async fn read_json<T: DeserializeOwned>(req: &mut Request) -> Result<ReadJson<T>> {
    match read_limited(req).await? {
        BodyRead::TooLarge => Ok(ReadJson::Failure(request_too_large())),
        BodyRead::InvalidLength => Ok(ReadJson::Failure(invalid_request())),
        BodyRead::Bytes(bytes) => match serde_json::from_slice(&bytes) {
            Ok(value) => Ok(ReadJson::Value(value)),
            Err(_) => Ok(ReadJson::Failure(invalid_request())),
        },
    }
}

async fn read_limited(req: &mut Request) -> Result<BodyRead> {
    let declared = match req.headers().get("Content-Length") {
        Ok(value) => value,
        Err(err) => {
            drop(err);
            worker::console_error!("content-length read failed");
            return Err(super::worker_msg("content-length"));
        }
    };
    match classify_content_length(declared.as_deref()) {
        ContentLength::Invalid => return Ok(BodyRead::InvalidLength),
        ContentLength::TooLarge => return Ok(BodyRead::TooLarge),
        ContentLength::Absent | ContentLength::WithinLimit(_) => {}
    }
    read_stream(req).await
}

async fn read_stream(req: &mut Request) -> Result<BodyRead> {
    let Some(stream) = req.inner().body() else {
        return Ok(BodyRead::Bytes(Vec::new()));
    };
    let stream_js = JsValue::from(stream);
    let get_reader = Reflect::get(&stream_js, &JsValue::from_str("getReader")).map_err(js_fail)?;
    let get_reader = get_reader.dyn_into::<Function>().map_err(js_fail)?;
    let reader = get_reader.call0(&stream_js).map_err(js_fail)?;
    let read = Reflect::get(&reader, &JsValue::from_str("read")).map_err(js_fail)?;
    let read = read.dyn_into::<Function>().map_err(js_fail)?;

    let mut buf = Vec::new();
    loop {
        let promise = read.call0(&reader).map_err(js_fail)?;
        let promise = promise.dyn_into::<Promise>().map_err(js_fail)?;
        let chunk = JsFuture::from(promise).await.map_err(js_fail)?;
        let done = Reflect::get(&chunk, &JsValue::from_str("done"))
            .map_err(js_fail)?
            .as_bool()
            .unwrap_or(true);
        if done {
            break;
        }
        let value = Reflect::get(&chunk, &JsValue::from_str("value")).map_err(js_fail)?;
        let array = Uint8Array::new(&value);
        let len = array.length() as usize;
        if buf.len().saturating_add(len) > REQUEST_MAX_BYTES {
            cancel_reader(&reader).await;
            return Ok(BodyRead::TooLarge);
        }
        let start = buf.len();
        buf.resize(start + len, 0);
        array.copy_to(&mut buf[start..]);
    }
    Ok(BodyRead::Bytes(buf))
}

async fn cancel_reader(reader: &JsValue) {
    let Ok(cancel) = Reflect::get(reader, &JsValue::from_str("cancel")) else {
        return;
    };
    let Ok(cancel) = cancel.dyn_into::<Function>() else {
        return;
    };
    let Ok(promise) = cancel.call0(reader) else {
        return;
    };
    let Ok(promise) = promise.dyn_into::<Promise>() else {
        return;
    };
    drop(JsFuture::from(promise).await);
}

fn js_fail(err: JsValue) -> worker::Error {
    drop(err);
    super::worker_msg("request body read failed")
}
