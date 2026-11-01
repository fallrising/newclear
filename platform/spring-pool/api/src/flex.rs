//! D1 JSON numbers are not always serde `i64` (floats, numeric strings, bools).

use serde::de::{self, Deserializer, Visitor};
use std::fmt;

pub fn i64<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    struct V;
    impl Visitor<'_> for V {
        type Value = i64;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("an integer")
        }

        fn visit_i64<E: de::Error>(self, value: i64) -> Result<i64, E> {
            Ok(value)
        }

        fn visit_u64<E: de::Error>(self, value: u64) -> Result<i64, E> {
            i64::try_from(value).map_err(E::custom)
        }

        fn visit_f64<E: de::Error>(self, value: f64) -> Result<i64, E> {
            f64_as_i64(value).ok_or_else(|| E::custom("not an integer"))
        }

        fn visit_bool<E: de::Error>(self, value: bool) -> Result<i64, E> {
            Ok(i64::from(value))
        }

        fn visit_str<E: de::Error>(self, value: &str) -> Result<i64, E> {
            value.parse::<i64>().map_err(E::custom)
        }
    }
    deserializer.deserialize_any(V)
}

fn f64_as_i64(value: f64) -> Option<i64> {
    if value.is_finite()
        && value.fract() == 0.0
        && value >= i64::MIN as f64
        && value <= i64::MAX as f64
    {
        Some(value as i64)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Row {
        #[serde(deserialize_with = "super::i64")]
        n: i64,
    }

    fn parse(json: &str) -> Result<i64, serde_json::Error> {
        Ok(serde_json::from_str::<Row>(json)?.n)
    }

    #[test]
    fn accepts_d1_numeric_shapes() {
        assert_eq!(parse(r#"{"n":1}"#).unwrap(), 1);
        assert_eq!(parse(r#"{"n":1.0}"#).unwrap(), 1);
        assert_eq!(parse(r#"{"n":true}"#).unwrap(), 1);
        assert_eq!(parse(r#"{"n":false}"#).unwrap(), 0);
        assert_eq!(parse(r#"{"n":"4"}"#).unwrap(), 4);
        assert_eq!(
            parse(r#"{"n":"9007199254740993"}"#).unwrap(),
            9_007_199_254_740_993
        );
        assert!(parse(r#"{"n":1.5}"#).is_err());
        assert!(parse(r#"{"n":null}"#).is_err());
    }
}
