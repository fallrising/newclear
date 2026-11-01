#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
#[test]
fn persisted_token_bounds_reject_overflow_and_negative_rows() {
    let path = common::path("tokens");
    let db = DbRuntime::open(&path).unwrap();
    let (doc, a, c, _) = common::fixture(&db);
    let raw = rusqlite::Connection::open(path).unwrap();
    for version in [0, 1, i64::MAX] {
        raw.execute(
            "UPDATE annotations SET row_version=?1 WHERE id=?2",
            rusqlite::params![version, a.id.to_string()],
        )
        .unwrap();
        assert_eq!(
            db.read(|r| r.annotation(a.id)).unwrap().version,
            RowVersion(version.cast_unsigned())
        );
    }
    assert_eq!(
        db.transaction(move |tx| tx.update_annotation(
            a.id,
            RowVersion(i64::MAX.cast_unsigned()),
            "overflow".into(),
            Color::Blue
        ))
        .unwrap_err()
        .code,
        ErrorCode::Validation
    );
    raw.execute(
        "UPDATE annotations SET row_version=-1 WHERE id=?1",
        [a.id.to_string()],
    )
    .unwrap();
    assert_eq!(
        db.read(|r| r.annotation(a.id)).unwrap_err().code,
        ErrorCode::Internal
    );
    raw.execute(
        "UPDATE annotations SET row_version=0 WHERE id=?1",
        [a.id.to_string()],
    )
    .unwrap();
    raw.execute(
        "UPDATE comments SET row_version=?1 WHERE id=?2",
        rusqlite::params![i64::MAX, c.id.to_string()],
    )
    .unwrap();
    assert_eq!(
        db.transaction(move |tx| tx.delete_annotation(a.id, RowVersion(0)))
            .unwrap_err()
            .code,
        ErrorCode::Validation
    );
    assert_eq!(db.read(|r| r.annotation(a.id)).unwrap(), a);
    assert!(db.read(|r| r.comment(c.id)).unwrap().deleted_at.is_none());
    raw.execute(
        "UPDATE documents SET revision=?1 WHERE id=?2",
        rusqlite::params![i64::MAX, doc.id.to_string()],
    )
    .unwrap();
    assert_eq!(
        db.transaction(move |tx| tx.commit_document(DocumentCommit {
            document_id: doc.id,
            expected: DocumentRevision(i64::MAX.cast_unsigned()),
            source_hash: "a".repeat(64),
            canonical_hash: "b".repeat(64),
            model_version: 1,
            changes: vec![]
        }))
        .unwrap_err()
        .code,
        ErrorCode::Validation
    );
    assert_eq!(db.read(|r| r.document(doc.id)).unwrap().source_hash, None);
}
#[test]
fn app_state_timestamp_overflow_does_not_mutate() {
    let path = common::path("state-overflow");
    let db = DbRuntime::open(&path).unwrap();
    let raw = rusqlite::Connection::open(path).unwrap();
    raw.execute(
        "INSERT INTO app_state VALUES('scope','key','1',?1)",
        [i64::MAX],
    )
    .unwrap();
    assert_eq!(
        db.transaction(|tx| tx.compare_set_app_state(
            "scope".into(),
            "key".into(),
            Some(Millis(i64::MAX)),
            serde_json::json!(2)
        ))
        .unwrap_err()
        .code,
        ErrorCode::Validation
    );
    assert_eq!(
        db.read(|r| r.app_state("scope", "key"))
            .unwrap()
            .unwrap()
            .value,
        serde_json::json!(1)
    );
}
