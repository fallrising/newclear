#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
#[test]
fn stale_row_version_conflicts() {
    let db = common::open();
    let (_, a, c, _) = common::fixture(&db);
    let updated = db
        .transaction(move |tx| {
            tx.update_annotation(a.id, a.version, "changed".into(), Color::Green)
        })
        .unwrap();
    assert_eq!(updated.version, RowVersion(1));
    let err = db
        .transaction(move |tx| {
            tx.update_annotation(a.id, a.version, "secret stale".into(), Color::Pink)
        })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Conflict);
    assert!(!err.to_string().contains("secret"));
    assert_eq!(db.read(|q| q.annotation(a.id)).unwrap(), updated);
    db.transaction(move |tx| tx.update_comment(c.id, c.version, "changed".into()))
        .unwrap();
    assert_eq!(
        db.transaction(move |tx| tx.delete_comment(c.id, c.version))
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
}
#[test]
fn stale_document_revision_rolls_back() {
    let db = common::open();
    let (d, a, _, _) = common::fixture(&db);
    let input = DocumentCommit {
        document_id: d.id,
        expected: d.revision,
        source_hash: "a".repeat(64),
        canonical_hash: "b".repeat(64),
        model_version: 1,
        changes: vec![],
    };
    db.transaction({
        let input = input.clone();
        move |tx| tx.commit_document(input)
    })
    .unwrap();
    assert_eq!(
        db.transaction(move |tx| tx.commit_document(input))
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(db.read(|q| q.annotation(a.id)).unwrap(), a);
}
#[test]
fn fixed_clock_cas_and_noop() {
    let db = common::open();
    let first = db
        .transaction(|tx| {
            tx.compare_set_app_state("window".into(), "tabs".into(), None, serde_json::json!([1]))
        })
        .unwrap();
    let second = db
        .transaction(move |tx| {
            tx.compare_set_app_state(
                "window".into(),
                "tabs".into(),
                Some(first.updated_at),
                serde_json::json!([2]),
            )
        })
        .unwrap();
    assert_eq!(second.updated_at, Millis(1235));
    assert_eq!(
        db.transaction(move |tx| tx.compare_set_app_state(
            "window".into(),
            "tabs".into(),
            Some(Millis(1234)),
            serde_json::json!([3])
        ))
        .unwrap_err()
        .code,
        ErrorCode::Conflict
    );
    assert_eq!(
        db.transaction(move |tx| tx.compare_set_app_state(
            "window".into(),
            "tabs".into(),
            Some(second.updated_at),
            serde_json::json!([2])
        ))
        .unwrap()
        .updated_at,
        Millis(1235)
    );
}
