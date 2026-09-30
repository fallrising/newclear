//! JSON values bound to D1. Integers above the IEEE safe range are decimal
//! strings so SQLite affinity keeps the exact id.

use serde_json::{Number, Value};

const MAX_SAFE: i64 = 9_007_199_254_740_991;

pub fn json_i64(n: i64) -> Value {
    if (-MAX_SAFE..=MAX_SAFE).contains(&n) {
        Value::Number(Number::from(n))
    } else {
        Value::String(n.to_string())
    }
}

pub fn json_str(s: &str) -> Value {
    Value::String(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_integers_stay_numbers_and_large_ones_are_strings() {
        assert_eq!(json_i64(1), Value::Number(Number::from(1)));
        assert_eq!(
            json_i64(MAX_SAFE),
            Value::Number(Number::from(MAX_SAFE))
        );
        assert_eq!(json_i64(-MAX_SAFE), Value::Number(Number::from(-MAX_SAFE)));
        assert_eq!(
            json_i64(MAX_SAFE + 1),
            Value::String((MAX_SAFE + 1).to_string())
        );
        assert_eq!(json_i64(i64::MAX), Value::String(i64::MAX.to_string()));
        assert_eq!(json_str("ops"), Value::String("ops".into()));
    }
}
