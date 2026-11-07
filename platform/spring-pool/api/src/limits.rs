//! Request and build-revision bounds shared by native tests and the worker.

pub const SCRIPT_BODY_MAX_BYTES: usize = 65_536;
pub const REQUEST_MAX_BYTES: usize = 524_288;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentLength {
    Absent,
    Invalid,
    TooLarge,
    WithinLimit(u64),
}

pub fn classify_content_length(raw: Option<&str>) -> ContentLength {
    let Some(raw) = raw else {
        return ContentLength::Absent;
    };
    if raw.is_empty() || raw.len() > 18 || !raw.bytes().all(|byte| byte.is_ascii_digit()) {
        return ContentLength::Invalid;
    }
    match raw.parse::<u64>() {
        Ok(n) if n > REQUEST_MAX_BYTES as u64 => ContentLength::TooLarge,
        Ok(n) => ContentLength::WithinLimit(n),
        Err(_) => ContentLength::Invalid,
    }
}

/// `BUILD_REVISION` is a short token (git SHA or `dev`). Control characters are
/// dropped so a bad var cannot inject into the JSON health body via a raw copy
/// that skips serde — serde would escape them, but we still refuse to echo them.
pub fn sanitize_build_revision(value: &str) -> String {
    let controls = value
        .chars()
        .any(|c| matches!(c, '\u{0000}'..='\u{001F}' | '\u{007F}'));
    if value.is_empty() || controls || value.chars().count() > 128 {
        "dev".to_string()
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_length_bounds() {
        assert_eq!(classify_content_length(None), ContentLength::Absent);
        assert_eq!(
            classify_content_length(Some("0")),
            ContentLength::WithinLimit(0)
        );
        assert_eq!(
            classify_content_length(Some("524288")),
            ContentLength::WithinLimit(524_288)
        );
        assert_eq!(
            classify_content_length(Some("524289")),
            ContentLength::TooLarge
        );
        assert_eq!(classify_content_length(Some("")), ContentLength::Invalid);
        assert_eq!(classify_content_length(Some("-1")), ContentLength::Invalid);
        assert_eq!(classify_content_length(Some(" 1")), ContentLength::Invalid);
        assert_eq!(classify_content_length(Some("1.2")), ContentLength::Invalid);
        assert_eq!(classify_content_length(Some("+8")), ContentLength::Invalid);
    }

    #[test]
    fn build_revision_falls_back_to_dev() {
        assert_eq!(sanitize_build_revision(""), "dev");
        assert_eq!(sanitize_build_revision("dev"), "dev");
        assert_eq!(sanitize_build_revision("abc1234"), "abc1234");
        assert_eq!(sanitize_build_revision("bad\nid"), "dev");
        assert_eq!(sanitize_build_revision(&"x".repeat(129)), "dev");
        assert_eq!(sanitize_build_revision(&"é".repeat(128)), "é".repeat(128));
    }
}
