//! Pure component and href rules. Only native capability handles grant access.
use super::AppErrorCode;
/// Validate a direct root-relative path; only the empty directory sentinel is allowed.
///
/// # Errors
/// Rejects absolute, parent, empty-interior and invalid or oversized components.
pub fn direct_components(value: &str, allow_root: bool) -> Result<Vec<String>, AppErrorCode> {
    if value.len() > 4096 {
        return Err(AppErrorCode::ValidationError);
    }
    if value.is_empty() && allow_root {
        return Ok(Vec::new());
    }
    if value.is_empty()
        || value.starts_with('/')
        || value.contains(['\\', '\0'])
        || value.as_bytes().get(1) == Some(&b':')
    {
        return Err(AppErrorCode::PathOutsideWorkspace);
    }
    value
        .split('/')
        .map(|s| {
            if s.is_empty() || s == "." || s == ".." {
                Err(AppErrorCode::PathOutsideWorkspace)
            } else {
                Ok(s.to_owned())
            }
        })
        .collect()
}
fn decode(value: &str) -> Result<String, AppErrorCode> {
    let input = value.as_bytes();
    let mut result = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'%' {
            let hex = input
                .get(i + 1..i + 3)
                .ok_or(AppErrorCode::ValidationError)?;
            let hi = (hex[0] as char)
                .to_digit(16)
                .ok_or(AppErrorCode::ValidationError)?;
            let lo = (hex[1] as char)
                .to_digit(16)
                .ok_or(AppErrorCode::ValidationError)?;
            let byte = u8::try_from(hi * 16 + lo).map_err(|_| AppErrorCode::ValidationError)?;
            if matches!(byte, b'/' | b'\\' | 0) {
                return Err(AppErrorCode::PathOutsideWorkspace);
            }
            result.push(byte);
            i += 3;
        } else {
            result.push(input[i]);
            i += 1;
        }
    }
    let output = String::from_utf8(result).map_err(|_| AppErrorCode::ValidationError)?;
    if output
        .as_bytes()
        .windows(3)
        .any(|w| w[0] == b'%' && w[1].is_ascii_hexdigit() && w[2].is_ascii_hexdigit())
    {
        return Err(AppErrorCode::ValidationError);
    }
    Ok(output)
}
/// Normalize a one-decode Markdown href against its source document, never another root.
///
/// # Errors
/// Rejects malformed encodings, schemes, separators and root escapes.
pub fn resolve_href(source: &str, href: &str) -> Result<(String, Option<String>), AppErrorCode> {
    if href.len() > 8192 {
        return Err(AppErrorCode::ValidationError);
    }
    let source = direct_components(source, false)?;
    if href.starts_with("//") || href.contains(['\\', '\0', '?']) {
        return Err(AppErrorCode::PathOutsideWorkspace);
    }
    let (path, fragment) = href
        .split_once('#')
        .map_or((href, None), |(p, f)| (p, Some(f)));
    let path = decode(path)?;
    if path.split('/').next().is_some_and(|s| s.contains(':')) {
        return Err(AppErrorCode::PathOutsideWorkspace);
    }
    let mut parts = if path.starts_with('/') {
        Vec::new()
    } else {
        source[..source.len() - 1].to_vec()
    };
    if path.is_empty() {
        parts = source;
    } else {
        for component in path.trim_start_matches('/').split('/') {
            match component {
                "" => return Err(AppErrorCode::PathOutsideWorkspace),
                "." => {}
                ".." => {
                    parts.pop().ok_or(AppErrorCode::PathOutsideWorkspace)?;
                }
                other => parts.push(other.into()),
            }
        }
    }
    let path = parts.join("/");
    direct_components(&path, false)?;
    Ok((path, fragment.map(decode).transpose()?))
}
