//! Prompt-cache routing for Responses upstreams on the ChatGPT plan (siwc): a stable
//! per-conversation `prompt_cache_key` plus matching session headers, so turns of one
//! conversation reach the machine holding its cached prefix (yetone/magpie#933).

use bytes::Bytes;
use serde_json::Value;
use uuid::Uuid;

/// Namespace for deriving conversation keys (UUIDv5).
const KEY_NAMESPACE: Uuid = Uuid::from_u128(0x6f1d_93a4_2c55_4b0e_9a1e_7d3c_5b8f_0e21);

/// Ensure the Responses body has a `prompt_cache_key` and return it. A client-supplied
/// key wins; otherwise the key is derived from what stays fixed across a conversation's
/// turns: model, instructions and the first input item.
pub fn ensure_prompt_cache_key(body: &Bytes) -> (Bytes, Option<String>) {
    let Ok(Value::Object(mut obj)) = serde_json::from_slice::<Value>(body) else {
        return (body.clone(), None);
    };
    if let Some(k) = obj
        .get("prompt_cache_key")
        .and_then(|k| k.as_str())
        .filter(|k| !k.is_empty())
    {
        return (body.clone(), Some(k.to_string()));
    }
    let first = obj
        .get("input")
        .and_then(|i| i.as_array())
        .and_then(|a| a.first())
        .cloned();
    let Some(first) = first else {
        return (body.clone(), None);
    };
    let seed = serde_json::json!([
        obj.get("model").cloned().unwrap_or(Value::Null),
        obj.get("instructions").cloned().unwrap_or(Value::Null),
        first,
    ]);
    let key = Uuid::new_v5(&KEY_NAMESPACE, seed.to_string().as_bytes()).to_string();
    obj.insert("prompt_cache_key".into(), Value::String(key.clone()));
    match serde_json::to_vec(&obj) {
        Ok(v) => (Bytes::from(v), Some(key)),
        Err(_) => (body.clone(), None),
    }
}

/// Session headers the ChatGPT backend uses for cache routing (same value as the key).
pub fn session_headers(key: &str) -> [(&'static str, String); 2] {
    [
        ("session-id", key.to_string()),
        ("thread-id", key.to_string()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn key_of(v: Value) -> String {
        let (b, k) = ensure_prompt_cache_key(&Bytes::from(v.to_string()));
        let body: Value = serde_json::from_slice(&b).unwrap();
        assert_eq!(body["prompt_cache_key"], k.clone().unwrap());
        k.unwrap()
    }

    #[test]
    fn key_is_stable_across_turns_and_differs_between_conversations() {
        let first = json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "plan a trip"}]});
        let turn1 = json!({"model": "m", "instructions": "sys", "input": [first]});
        let turn2 = json!({"model": "m", "instructions": "sys", "input": [first,
            {"type": "function_call", "call_id": "c", "name": "f", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "c", "output": "x"}]});
        assert_eq!(key_of(turn1.clone()), key_of(turn2));
        let other = json!({"model": "m", "instructions": "sys", "input": [{"type": "message", "role": "user", "content": "other"}]});
        assert_ne!(key_of(turn1), key_of(other));
    }

    #[test]
    fn client_key_wins() {
        let v = json!({"prompt_cache_key": "mine", "input": [{"role": "user", "content": "x"}]});
        let (b, k) = ensure_prompt_cache_key(&Bytes::from(v.to_string()));
        assert_eq!(k.as_deref(), Some("mine"));
        assert_eq!(b, Bytes::from(v.to_string()));
    }
}
