//! D1 bind lists for list queries. Parameter order matches `sql.rs`.

use crate::sqljson::{json_i64, json_str};
use crate::validate::{like_contains_pattern, ParsedQuery};
use serde_json::Value;

pub fn script_list_args(query: &ParsedQuery) -> Vec<Value> {
    let (has_before, before_id) = flag_id(query.before_id);
    let (has_q, pattern) = like_flag(query.q.as_deref());
    let (has_tag, tag) = text_flag(query.tag.as_deref());
    vec![
        json_str(query.archived.as_str()),
        has_before,
        before_id,
        has_q,
        pattern,
        has_tag,
        tag,
        limit_plus(query.limit),
    ]
}

pub fn runbook_list_args(query: &ParsedQuery) -> Vec<Value> {
    let (has_before, before_id) = flag_id(query.before_id);
    let (has_q, pattern) = like_flag(query.q.as_deref());
    vec![
        json_str(query.archived.as_str()),
        has_before,
        before_id,
        has_q,
        pattern,
        limit_plus(query.limit),
    ]
}

pub fn revision_list_args(id: i64, query: &ParsedQuery) -> Vec<Value> {
    let (has_before, before_revision) = flag_id(query.before_revision);
    vec![
        json_i64(id),
        has_before,
        before_revision,
        limit_plus(query.limit),
    ]
}

pub fn audit_list_args(query: &ParsedQuery) -> Vec<Value> {
    let (has_before, before_id) = flag_id(query.before_id);
    vec![has_before, before_id, limit_plus(query.limit)]
}

fn flag_id(value: Option<i64>) -> (Value, Value) {
    match value {
        Some(id) => (json_i64(1), json_i64(id)),
        None => (json_i64(0), json_i64(0)),
    }
}

fn text_flag(value: Option<&str>) -> (Value, Value) {
    match value {
        Some(text) => (json_i64(1), json_str(text)),
        None => (json_i64(0), json_str("")),
    }
}

fn like_flag(value: Option<&str>) -> (Value, Value) {
    match value {
        Some(text) => (json_i64(1), json_str(&like_contains_pattern(text))),
        None => (json_i64(0), json_str("")),
    }
}

fn limit_plus(limit: u32) -> Value {
    json_i64(i64::from(limit) + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::{Archived, ParsedQuery};

    fn query() -> ParsedQuery {
        ParsedQuery {
            q: None,
            tag: None,
            archived: Archived::Exclude,
            limit: 50,
            before_id: None,
            before_revision: None,
        }
    }

    #[test]
    fn script_list_defaults_and_escapes_the_pattern() {
        let args = script_list_args(&query());
        assert_eq!(args.len(), 8);
        assert_eq!(args[0], json_str("exclude"));
        assert_eq!(args[1], json_i64(0));
        assert_eq!(args[2], json_i64(0));
        assert_eq!(args[3], json_i64(0));
        assert_eq!(args[4], json_str(""));
        assert_eq!(args[5], json_i64(0));
        assert_eq!(args[6], json_str(""));
        assert_eq!(args[7], json_i64(51));

        let mut filtered = query();
        filtered.q = Some("100%_\\".into());
        filtered.tag = Some("ops".into());
        filtered.archived = Archived::Only;
        filtered.limit = 100;
        filtered.before_id = Some(i64::MAX);
        let args = script_list_args(&filtered);
        assert_eq!(args[0], json_str("only"));
        assert_eq!(args[1], json_i64(1));
        assert_eq!(args[2], json_str(&i64::MAX.to_string()));
        assert_eq!(args[3], json_i64(1));
        assert_eq!(args[4], json_str("%100\\%\\_\\\\%"));
        assert_eq!(args[5], json_i64(1));
        assert_eq!(args[6], json_str("ops"));
        assert_eq!(args[7], json_i64(101));
    }

    #[test]
    fn runbook_revision_and_audit_args_skip_unused_filters() {
        let mut runbooks = query();
        runbooks.q = Some("a_b".into());
        runbooks.tag = Some("ignored".into());
        runbooks.before_id = Some(9);
        runbooks.limit = 1;
        let args = runbook_list_args(&runbooks);
        assert_eq!(
            args,
            vec![
                json_str("exclude"),
                json_i64(1),
                json_i64(9),
                json_i64(1),
                json_str("%a\\_b%"),
                json_i64(2),
            ]
        );

        let mut revisions = query();
        revisions.before_id = Some(9);
        revisions.before_revision = Some(3);
        revisions.limit = 1;
        assert_eq!(
            revision_list_args(7, &revisions),
            vec![json_i64(7), json_i64(1), json_i64(3), json_i64(2)]
        );

        let mut audit = query();
        audit.before_revision = Some(3);
        audit.limit = 50;
        assert_eq!(
            audit_list_args(&audit),
            vec![json_i64(0), json_i64(0), json_i64(51)]
        );
        audit.before_id = Some(8);
        assert_eq!(audit_list_args(&audit)[0], json_i64(1));
        assert_eq!(audit_list_args(&audit)[1], json_i64(8));
    }
}
