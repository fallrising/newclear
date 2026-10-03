use worker::js_sys::Date;
use worker::wasm_bindgen::JsValue;

pub fn now_iso() -> String {
    let stamp = Date::new_0().to_iso_string();
    let value: JsValue = stamp.into();
    value
        .as_string()
        .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string())
}
