//! Semantic validation. JSON type errors stay at the serde boundary (HTTP 400).
//! Lengths for text fields are Unicode scalar values. Script bodies are UTF-8 bytes.

use crate::dto::{RunbookCreate, RunbookUpdate, ScriptCreate, ScriptUpdate, StepInput};
use crate::limits::SCRIPT_BODY_MAX_BYTES;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCode {
    Required,
    TooShort,
    TooLong,
    InvalidFormat,
    InvalidValue,
    Duplicate,
    TooFewItems,
    TooManyItems,
    NotFound,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    pub field: String,
    pub code: IssueCode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedScript {
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub language: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedStep {
    pub script_id: i64,
    pub script_revision: i64,
    pub instruction: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedRunbook {
    pub title: String,
    pub description: String,
    pub steps: Vec<NormalizedStep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptFailure {
    TooLarge,
    Invalid(Vec<Issue>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Archived {
    Exclude,
    Include,
    Only,
}

impl Archived {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Exclude => "exclude",
            Self::Include => "include",
            Self::Only => "only",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryKind {
    ScriptList,
    RunbookList,
    RevisionList,
    AuditList,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedQuery {
    pub q: Option<String>,
    pub tag: Option<String>,
    pub archived: Archived,
    pub limit: u32,
    pub before_id: Option<i64>,
    pub before_revision: Option<i64>,
}

pub fn validate_actor(value: &str) -> bool {
    let count = value.chars().count();
    (3..=254).contains(&count) && value.contains('@') && !value.chars().any(is_c0_or_del)
}

pub fn validate_script(input: &ScriptCreate) -> Result<NormalizedScript, ScriptFailure> {
    if input.body.len() > SCRIPT_BODY_MAX_BYTES {
        return Err(ScriptFailure::TooLarge);
    }
    let (title, description, tags, language, mut issues) = text_fields(
        &input.title,
        &input.description,
        &input.tags,
        &input.language,
    );
    push_body(&input.body, &mut issues);
    if issues.is_empty() {
        Ok(NormalizedScript {
            title,
            description,
            tags,
            language,
            body: input.body.clone(),
        })
    } else {
        Err(ScriptFailure::Invalid(issues))
    }
}

pub fn validate_script_update(
    input: &ScriptUpdate,
) -> Result<(i64, NormalizedScript), ScriptFailure> {
    if input.body.len() > SCRIPT_BODY_MAX_BYTES {
        return Err(ScriptFailure::TooLarge);
    }
    let (title, description, tags, language, mut issues) = text_fields(
        &input.title,
        &input.description,
        &input.tags,
        &input.language,
    );
    if let Some(issue) = check_expected_revision(input.expected_revision) {
        issues.insert(0, issue);
    }
    push_body(&input.body, &mut issues);
    if issues.is_empty() {
        Ok((
            input.expected_revision,
            NormalizedScript {
                title,
                description,
                tags,
                language,
                body: input.body.clone(),
            },
        ))
    } else {
        Err(ScriptFailure::Invalid(issues))
    }
}

pub fn validate_runbook(input: &RunbookCreate) -> Result<NormalizedRunbook, Vec<Issue>> {
    let (title, description, mut issues) = title_and_description(&input.title, &input.description);
    let steps = normalize_steps(&input.steps, &mut issues);
    if issues.is_empty() {
        Ok(NormalizedRunbook {
            title,
            description,
            steps,
        })
    } else {
        Err(issues)
    }
}

pub fn validate_runbook_update(
    input: &RunbookUpdate,
) -> Result<(i64, NormalizedRunbook), Vec<Issue>> {
    let (title, description, mut issues) = title_and_description(&input.title, &input.description);
    if let Some(issue) = check_expected_revision(input.expected_revision) {
        issues.insert(0, issue);
    }
    let steps = normalize_steps(&input.steps, &mut issues);
    if issues.is_empty() {
        Ok((
            input.expected_revision,
            NormalizedRunbook {
                title,
                description,
                steps,
            },
        ))
    } else {
        Err(issues)
    }
}

pub fn check_expected_revision(value: i64) -> Option<Issue> {
    if value < 1 || value == i64::MAX {
        Some(issue("expected_revision", IssueCode::InvalidValue))
    } else {
        None
    }
}

pub fn push_missing_pins(issues: &mut Vec<Issue>, missing_indexes: &[usize]) {
    for &index in missing_indexes {
        let field = format!("steps[{index}].script_revision");
        let id_field = format!("steps[{index}].script_id");
        if issues
            .iter()
            .any(|existing| existing.field == field || existing.field == id_field)
        {
            continue;
        }
        issues.push(Issue {
            field,
            code: IssueCode::NotFound,
        });
    }
}

pub fn canonical_language(language: &str) -> Option<&'static str> {
    match language {
        "bash" => Some("bash"),
        "python" => Some("python"),
        "powershell" => Some("powershell"),
        _ => None,
    }
}

pub fn tag_index(tags: &[String]) -> String {
    if tags.is_empty() {
        return String::from(",");
    }
    let mut out = String::from(",");
    for (index, tag) in tags.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str(tag);
    }
    out.push(',');
    out
}

pub fn like_contains_pattern(query: &str) -> String {
    let mut escaped = String::new();
    for ch in query.chars() {
        if ch == '\\' || ch == '%' || ch == '_' {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    format!("%{escaped}%")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueryError;

pub fn parse_query(kind: QueryKind, pairs: &[(String, String)]) -> Result<ParsedQuery, QueryError> {
    let allowed: &[&str] = match kind {
        QueryKind::ScriptList => &["q", "tag", "archived", "limit", "before_id"],
        QueryKind::RunbookList => &["q", "archived", "limit", "before_id"],
        QueryKind::RevisionList => &["limit", "before_revision"],
        QueryKind::AuditList => &["limit", "before_id"],
    };
    for (key, _) in pairs {
        if !allowed.contains(&key.as_str()) {
            return Err(QueryError);
        }
    }
    let q = match kind {
        QueryKind::ScriptList | QueryKind::RunbookList => optional_q(pairs)?,
        QueryKind::RevisionList | QueryKind::AuditList => None,
    };
    let tag = if kind == QueryKind::ScriptList {
        optional_tag(pairs)?
    } else {
        None
    };
    let archived = if matches!(kind, QueryKind::ScriptList | QueryKind::RunbookList) {
        optional_archived(pairs)?
    } else {
        Archived::Exclude
    };
    let limit = optional_limit(pairs)?;
    let before_id = if matches!(
        kind,
        QueryKind::ScriptList | QueryKind::RunbookList | QueryKind::AuditList
    ) {
        optional_positive(pairs, "before_id")?
    } else {
        None
    };
    let before_revision = if kind == QueryKind::RevisionList {
        optional_positive(pairs, "before_revision")?
    } else {
        None
    };
    Ok(ParsedQuery {
        q,
        tag,
        archived,
        limit,
        before_id,
        before_revision,
    })
}

fn text_fields(
    title: &str,
    description: &str,
    tags: &[String],
    language: &str,
) -> (String, String, Vec<String>, String, Vec<Issue>) {
    let (title, description, mut issues) = title_and_description(title, description);
    let tags = normalize_tags(tags, &mut issues);
    let language = match canonical_language(language) {
        Some(value) => value.to_string(),
        None => {
            issues.push(issue("language", IssueCode::InvalidValue));
            String::new()
        }
    };
    (title, description, tags, language, issues)
}

fn title_and_description(title: &str, description: &str) -> (String, String, Vec<Issue>) {
    let mut issues = Vec::new();
    let title = normalize_title(title, &mut issues);
    let description = normalize_description(description, &mut issues);
    (title, description, issues)
}

fn normalize_title(raw: &str, issues: &mut Vec<Issue>) -> String {
    let title = raw.trim().to_string();
    if title.is_empty() {
        issues.push(issue("title", IssueCode::TooShort));
    } else {
        if title.chars().count() > 200 {
            issues.push(issue("title", IssueCode::TooLong));
        }
        if title.chars().any(is_c0_or_del) {
            issues.push(issue("title", IssueCode::InvalidValue));
        }
    }
    title
}

fn normalize_description(raw: &str, issues: &mut Vec<Issue>) -> String {
    let description = raw.trim().to_string();
    if description.chars().count() > 2000 {
        issues.push(issue("description", IssueCode::TooLong));
    }
    if raw.chars().any(forbidden_prose) {
        issues.push(issue("description", IssueCode::InvalidValue));
    }
    description
}

fn normalize_tags(tags: &[String], issues: &mut Vec<Issue>) -> Vec<String> {
    if tags.len() > 10 {
        issues.push(issue("tags", IssueCode::TooManyItems));
    }
    let mut seen = Vec::new();
    let mut kept = Vec::new();
    for (index, tag) in tags.iter().enumerate() {
        if !valid_tag(tag) {
            issues.push(issue(format!("tags[{index}]"), IssueCode::InvalidFormat));
        } else if seen.iter().any(|existing: &String| existing == tag) {
            issues.push(issue(format!("tags[{index}]"), IssueCode::Duplicate));
        } else {
            seen.push(tag.clone());
            kept.push(tag.clone());
        }
    }
    kept
}

fn push_body(body: &str, issues: &mut Vec<Issue>) {
    if body.is_empty() {
        issues.push(issue("body", IssueCode::TooShort));
    } else if body.contains('\0') {
        issues.push(issue("body", IssueCode::InvalidValue));
    }
}

fn normalize_steps(steps: &[StepInput], issues: &mut Vec<Issue>) -> Vec<NormalizedStep> {
    if steps.is_empty() {
        issues.push(issue("steps", IssueCode::TooFewItems));
    } else if steps.len() > 30 {
        issues.push(issue("steps", IssueCode::TooManyItems));
    }
    let mut normalized = Vec::with_capacity(steps.len());
    for (index, step) in steps.iter().enumerate() {
        if step.script_id < 1 {
            issues.push(issue(
                format!("steps[{index}].script_id"),
                IssueCode::InvalidValue,
            ));
        }
        if step.script_revision < 1 {
            issues.push(issue(
                format!("steps[{index}].script_revision"),
                IssueCode::InvalidValue,
            ));
        }
        let instruction = step.instruction.trim().to_string();
        if instruction.is_empty() {
            issues.push(issue(
                format!("steps[{index}].instruction"),
                IssueCode::Required,
            ));
        } else {
            if instruction.chars().count() > 2000 {
                issues.push(issue(
                    format!("steps[{index}].instruction"),
                    IssueCode::TooLong,
                ));
            }
            if step.instruction.chars().any(forbidden_prose) {
                issues.push(issue(
                    format!("steps[{index}].instruction"),
                    IssueCode::InvalidValue,
                ));
            }
        }
        normalized.push(NormalizedStep {
            script_id: step.script_id,
            script_revision: step.script_revision,
            instruction,
        });
    }
    normalized
}

fn valid_tag(tag: &str) -> bool {
    let bytes = tag.as_bytes();
    if bytes.is_empty() || bytes.len() > 32 {
        return false;
    }
    let first_ok = bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit();
    first_ok
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn is_c0_or_del(c: char) -> bool {
    matches!(c, '\u{0000}'..='\u{001F}' | '\u{007F}')
}

fn forbidden_prose(c: char) -> bool {
    c != '\n' && c != '\t' && is_c0_or_del(c)
}

fn issue(field: impl Into<String>, code: IssueCode) -> Issue {
    Issue {
        field: field.into(),
        code,
    }
}

fn take_one<'a>(pairs: &'a [(String, String)], key: &str) -> Result<Option<&'a str>, QueryError> {
    let mut matches = pairs.iter().filter(|(candidate, _)| candidate == key);
    match (matches.next(), matches.next()) {
        (None, _) => Ok(None),
        (Some((_, value)), None) => Ok(Some(value.as_str())),
        _ => Err(QueryError),
    }
}

fn optional_q(pairs: &[(String, String)]) -> Result<Option<String>, QueryError> {
    match take_one(pairs, "q")? {
        None => Ok(None),
        Some(value) => {
            let count = value.chars().count();
            if (1..=200).contains(&count) {
                Ok(Some(value.to_string()))
            } else {
                Err(QueryError)
            }
        }
    }
}

fn optional_tag(pairs: &[(String, String)]) -> Result<Option<String>, QueryError> {
    match take_one(pairs, "tag")? {
        None => Ok(None),
        Some(value) if valid_tag(value) => Ok(Some(value.to_string())),
        Some(_) => Err(QueryError),
    }
}

fn optional_archived(pairs: &[(String, String)]) -> Result<Archived, QueryError> {
    match take_one(pairs, "archived")? {
        None => Ok(Archived::Exclude),
        Some("exclude") => Ok(Archived::Exclude),
        Some("include") => Ok(Archived::Include),
        Some("only") => Ok(Archived::Only),
        Some(_) => Err(QueryError),
    }
}

fn optional_limit(pairs: &[(String, String)]) -> Result<u32, QueryError> {
    match take_one(pairs, "limit")? {
        None => Ok(50),
        Some(value) => parse_u32_range(value, 1, 100).ok_or(QueryError),
    }
}

fn optional_positive(pairs: &[(String, String)], key: &str) -> Result<Option<i64>, QueryError> {
    match take_one(pairs, key)? {
        None => Ok(None),
        Some(value) => {
            if value.is_empty() || value.len() > 18 || !value.bytes().all(|b| b.is_ascii_digit()) {
                return Err(QueryError);
            }
            let parsed = value.parse::<i64>().map_err(|_| QueryError)?;
            if parsed >= 1 {
                Ok(Some(parsed))
            } else {
                Err(QueryError)
            }
        }
    }
}

fn parse_u32_range(value: &str, min: u32, max: u32) -> Option<u32> {
    if value.is_empty() || value.len() > 10 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let parsed = value.parse::<u32>().ok()?;
    if (min..=max).contains(&parsed) {
        Some(parsed)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::StepInput;

    fn script(
        title: &str,
        description: &str,
        tags: &[&str],
        language: &str,
        body: &str,
    ) -> ScriptCreate {
        ScriptCreate {
            title: title.into(),
            description: description.into(),
            tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
            language: language.into(),
            body: body.into(),
        }
    }

    fn codes(issues: &[Issue]) -> Vec<(&str, IssueCode)> {
        issues
            .iter()
            .map(|issue| (issue.field.as_str(), issue.code))
            .collect()
    }

    #[test]
    fn script_normalizes_trim_and_keeps_body_bytes() {
        let ok = validate_script(&script(
            "  Hello  ",
            "\nnote\n",
            &["ops", "db"],
            "python",
            "  echo  \r\n",
        ))
        .unwrap();
        assert_eq!(ok.title, "Hello");
        assert_eq!(ok.description, "note");
        assert_eq!(ok.tags, vec!["ops".to_string(), "db".to_string()]);
        assert_eq!(ok.body, "  echo  \r\n");
        assert_eq!(tag_index(&ok.tags), ",ops,db,");
        assert_eq!(tag_index(&[]), ",");
    }

    #[test]
    fn script_reports_every_field_issue() {
        let failure = validate_script(&script(
            "   ",
            "bad\u{0001}",
            &["OK", "ok", "ok", "no_pe"],
            "ruby",
            "\0",
        ))
        .unwrap_err();
        let ScriptFailure::Invalid(issues) = failure else {
            panic!("expected validation issues");
        };
        assert_eq!(
            codes(&issues),
            vec![
                ("title", IssueCode::TooShort),
                ("description", IssueCode::InvalidValue),
                ("tags[0]", IssueCode::InvalidFormat),
                ("tags[2]", IssueCode::Duplicate),
                ("tags[3]", IssueCode::InvalidFormat),
                ("language", IssueCode::InvalidValue),
                ("body", IssueCode::InvalidValue),
            ]
        );
    }

    #[test]
    fn title_description_and_tag_bounds_use_scalars() {
        let ok_title = "é".repeat(200);
        assert!(validate_script(&script(&ok_title, "", &[], "bash", "x")).is_ok());
        let long_title = "é".repeat(201);
        let err = validate_script(&script(&long_title, "", &[], "bash", "x")).unwrap_err();
        let ScriptFailure::Invalid(issues) = err else {
            panic!("too long");
        };
        assert_eq!(codes(&issues), vec![("title", IssueCode::TooLong)]);

        let ok_desc = "é".repeat(2000);
        assert!(validate_script(&script("T", &ok_desc, &[], "bash", "x")).is_ok());
        let long_desc = "é".repeat(2001);
        let err = validate_script(&script("T", &long_desc, &[], "bash", "x")).unwrap_err();
        let ScriptFailure::Invalid(issues) = err else {
            panic!("too long");
        };
        assert_eq!(codes(&issues), vec![("description", IssueCode::TooLong)]);

        assert!(validate_script(&script("a\tb", "", &[], "bash", "x")).is_err());
        assert!(validate_script(&script("T", "line\n\tmore", &[], "powershell", "x")).is_ok());
        assert!(validate_script(&script("T", "bad\r", &[], "bash", "x")).is_err());
        assert!(validate_script(&script("T", "bad\u{007F}", &[], "bash", "x")).is_err());

        let tag = format!("a{}", "b".repeat(31));
        assert_eq!(tag.len(), 32);
        assert!(validate_script(&script("T", "", &[&tag], "bash", "x")).is_ok());
        let tag = format!("a{}", "b".repeat(32));
        assert!(validate_script(&script("T", "", &[&tag], "bash", "x")).is_err());
        assert!(validate_script(&script("T", "", &["-a"], "bash", "x")).is_err());
        assert!(validate_script(&script("T", "", &["é"], "bash", "x")).is_err());

        let many: Vec<_> = (0..11).map(|n| format!("t{n}")).collect();
        let refs: Vec<_> = many.iter().map(String::as_str).collect();
        let err = validate_script(&script("T", "", &refs, "bash", "x")).unwrap_err();
        let ScriptFailure::Invalid(issues) = err else {
            panic!("too many");
        };
        assert_eq!(issues[0].code, IssueCode::TooManyItems);
    }

    #[test]
    fn body_byte_limit_nul_and_multibyte_scalars() {
        assert!(matches!(
            validate_script(&script("T", "", &[], "bash", "")),
            Err(ScriptFailure::Invalid(_))
        ));
        let exact = "é".repeat(32_768);
        assert_eq!(exact.len(), 65_536);
        let ok = validate_script(&script("T", "", &[], "bash", &exact)).unwrap();
        assert_eq!(ok.body.len(), 65_536);

        let mut over = exact;
        over.push('a');
        assert_eq!(over.len(), 65_537);
        assert!(matches!(
            validate_script(&script("T", "", &[], "bash", &over)),
            Err(ScriptFailure::TooLarge)
        ));
        let ascii = "a".repeat(65_537);
        assert!(matches!(
            validate_script(&script("T", "", &[], "bash", &ascii)),
            Err(ScriptFailure::TooLarge)
        ));
        assert!(matches!(
            validate_script(&script("  ", "", &[], "nope", &ascii)),
            Err(ScriptFailure::TooLarge)
        ));
        assert!(matches!(
            validate_script(&script("T", "", &[], "bash", "a\0b")),
            Err(ScriptFailure::Invalid(_))
        ));
    }

    #[test]
    fn expected_revision_and_runbook_steps() {
        assert!(check_expected_revision(1).is_none());
        assert_eq!(
            check_expected_revision(0).unwrap().code,
            IssueCode::InvalidValue
        );
        assert!(check_expected_revision(i64::MAX).is_some());

        let update = ScriptUpdate {
            expected_revision: 0,
            title: "T".into(),
            description: String::new(),
            tags: Vec::new(),
            language: "bash".into(),
            body: "x".into(),
        };
        let err = validate_script_update(&update).unwrap_err();
        let ScriptFailure::Invalid(issues) = err else {
            panic!("invalid");
        };
        assert_eq!(issues[0].field, "expected_revision");

        let steps: Vec<StepInput> = (0..30)
            .map(|_| StepInput {
                script_id: 1,
                script_revision: 2,
                instruction: "  do\nit  ".into(),
            })
            .collect();
        let ok = validate_runbook(&RunbookCreate {
            title: "R".into(),
            description: String::new(),
            steps: steps.clone(),
        })
        .unwrap();
        assert_eq!(ok.steps.len(), 30);
        assert_eq!(ok.steps[0].instruction, "do\nit");

        assert!(validate_runbook(&RunbookCreate {
            title: "R".into(),
            description: String::new(),
            steps: Vec::new(),
        })
        .unwrap_err()
        .iter()
        .any(|issue| issue.code == IssueCode::TooFewItems));

        let mut too_many = steps;
        too_many.push(StepInput {
            script_id: 1,
            script_revision: 1,
            instruction: "x".into(),
        });
        assert!(validate_runbook(&RunbookCreate {
            title: "R".into(),
            description: String::new(),
            steps: too_many,
        })
        .unwrap_err()
        .iter()
        .any(|issue| issue.code == IssueCode::TooManyItems));

        let err = validate_runbook(&RunbookCreate {
            title: "R".into(),
            description: String::new(),
            steps: vec![StepInput {
                script_id: 0,
                script_revision: -1,
                instruction: "  ".into(),
            }],
        })
        .unwrap_err();
        assert_eq!(
            codes(&err),
            vec![
                ("steps[0].script_id", IssueCode::InvalidValue),
                ("steps[0].script_revision", IssueCode::InvalidValue),
                ("steps[0].instruction", IssueCode::Required),
            ]
        );
    }

    #[test]
    fn missing_pins_do_not_duplicate_field_errors() {
        let mut issues = vec![issue("steps[0].script_id", IssueCode::InvalidValue)];
        push_missing_pins(&mut issues, &[0, 1]);
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[1].field, "steps[1].script_revision");
        assert_eq!(issues[1].code, IssueCode::NotFound);
    }

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(like_contains_pattern("a"), "%a%");
        assert_eq!(like_contains_pattern("100%"), "%100\\%%");
        assert_eq!(like_contains_pattern("_"), "%\\_%");
        assert_eq!(like_contains_pattern("\\"), "%\\\\%");
        assert_eq!(like_contains_pattern("a_b%c\\d"), "%a\\_b\\%c\\\\d%");
    }

    #[test]
    fn queries_default_and_reject_invalid_values() {
        let parsed = parse_query(QueryKind::ScriptList, &[]).unwrap();
        assert_eq!(parsed.limit, 50);
        assert_eq!(parsed.archived, Archived::Exclude);
        assert!(parsed.q.is_none());

        let pairs = vec![
            ("q".into(), "Foo".into()),
            ("tag".into(), "ops".into()),
            ("archived".into(), "only".into()),
            ("limit".into(), "100".into()),
            ("before_id".into(), "9".into()),
        ];
        let parsed = parse_query(QueryKind::ScriptList, &pairs).unwrap();
        assert_eq!(parsed.q.as_deref(), Some("Foo"));
        assert_eq!(parsed.tag.as_deref(), Some("ops"));
        assert_eq!(parsed.archived, Archived::Only);
        assert_eq!(parsed.limit, 100);
        assert_eq!(parsed.before_id, Some(9));

        assert!(parse_query(QueryKind::ScriptList, &[("limit".into(), "0".into())]).is_err());
        assert!(parse_query(QueryKind::ScriptList, &[("limit".into(), "101".into())]).is_err());
        assert!(parse_query(QueryKind::ScriptList, &[("q".into(), "".into())]).is_err());
        assert!(parse_query(QueryKind::ScriptList, &[("q".into(), "é".repeat(201))]).is_err());
        assert!(parse_query(QueryKind::ScriptList, &[("q".into(), "é".repeat(200))]).is_ok());
        assert!(parse_query(QueryKind::ScriptList, &[("tag".into(), "Bad".into())]).is_err());
        assert!(parse_query(
            QueryKind::ScriptList,
            &[("archived".into(), "Exclude".into())]
        )
        .is_err());
        assert!(parse_query(QueryKind::ScriptList, &[("before_id".into(), "0".into())]).is_err());
        assert!(parse_query(
            QueryKind::ScriptList,
            &[
                ("before_id".into(), "1".into()),
                ("before_id".into(), "2".into())
            ]
        )
        .is_err());
        assert!(parse_query(QueryKind::RunbookList, &[("tag".into(), "ops".into())]).is_err());
        assert!(parse_query(QueryKind::RevisionList, &[("q".into(), "a".into())]).is_err());
        assert!(parse_query(
            QueryKind::AuditList,
            &[("archived".into(), "include".into())]
        )
        .is_err());
        let revisions = parse_query(
            QueryKind::RevisionList,
            &[
                ("before_revision".into(), "3".into()),
                ("limit".into(), "1".into()),
            ],
        )
        .unwrap();
        assert_eq!(revisions.before_revision, Some(3));
        assert_eq!(revisions.limit, 1);
    }

    #[test]
    fn actor_header_rules() {
        assert!(validate_actor("a@b"));
        assert!(validate_actor(&format!("{}@x", "a".repeat(250))));
        assert!(!validate_actor("ab"));
        assert!(!validate_actor("@"));
        assert!(!validate_actor("a@b\n"));
        assert!(!validate_actor(&format!("{}@x", "a".repeat(253))));
        assert!(validate_actor("Owner@Example.com"));
    }

    #[test]
    fn issue_codes_serialize_snake_case() {
        assert_eq!(
            serde_json::to_value(IssueCode::TooManyItems).unwrap(),
            "too_many_items"
        );
        assert_eq!(
            serde_json::to_value(IssueCode::NotFound).unwrap(),
            "not_found"
        );
    }
}
