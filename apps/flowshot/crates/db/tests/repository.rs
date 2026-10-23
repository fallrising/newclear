#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
#[test]
fn typed_sources_noops_bindings_and_missing_preserve_data() {
    let db = common::open();
    let (d, a, c, _) = common::fixture(&db);
    assert_eq!(d.created_at, Millis(1234));
    assert_eq!(d.id.0.get_version_num(), 7);
    let same = db
        .transaction({
            let a = a.clone();
            move |tx| tx.update_annotation(a.id, a.version, a.body, a.color)
        })
        .unwrap();
    assert_eq!(same, a);
    let same = db
        .transaction({
            let c = c.clone();
            move |tx| tx.update_comment(c.id, c.version, c.body)
        })
        .unwrap();
    assert_eq!(same, c);
    let missing = db
        .transaction(move |tx| tx.set_document_status(d.id, DocumentStatus::Missing))
        .unwrap();
    assert_eq!(missing.revision, d.revision);
    assert_eq!(db.read(|q| q.annotation(a.id)).unwrap(), a);
    let observed = db
        .transaction(move |tx| tx.observe_document(d.id, 12, Millis(1000), true))
        .unwrap();
    assert_eq!(observed.source_hash, d.source_hash);
    assert_eq!(observed.canonical_hash, d.canonical_hash);
    assert_eq!(observed.revision, d.revision);
    let tag = db
        .transaction(|tx| tx.create_tag("  Ｓtraße ".into()))
        .unwrap();
    assert_eq!(tag.normalized_name, "strasse");
    assert_eq!(
        db.transaction(|tx| tx.create_tag("STRASSE".into()))
            .unwrap_err()
            .code,
        ErrorCode::Validation
    );
    assert!(
        db.transaction(move |tx| tx.set_tag_binding(TagTarget::Annotation(a.id), tag.id, true))
            .unwrap()
    );
    assert!(
        !db.transaction(move |tx| tx.set_tag_binding(TagTarget::Annotation(a.id), tag.id, true))
            .unwrap()
    );
    assert_eq!(
        db.read(|q| q.tags(TagTarget::Annotation(a.id))).unwrap(),
        vec![tag]
    );
    let pin = TagId::parse("00000000-0000-7000-8000-000000000001").unwrap();
    assert_eq!(
        db.transaction(move |tx| tx.set_tag_binding(TagTarget::Annotation(a.id), pin, true))
            .unwrap_err()
            .code,
        ErrorCode::Validation
    );
    assert!(
        db.transaction(move |tx| tx.set_tag_binding(TagTarget::Document(d.id), pin, true))
            .unwrap()
    );
}
#[test]
fn normalization_is_idempotent_table() {
    for name in [" Straße ", "İ", "ＡＢＣ", "Σςσ", "cloud/aws", "Å", "  "] {
        match normalize_tag(name) {
            Ok(n) => {
                assert_eq!(normalize_tag(&n).unwrap(), n);
                assert_eq!(n.trim(), n);
            }
            Err(e) => {
                assert_eq!(e.code, ErrorCode::Validation);
                assert!(name.trim().is_empty());
            }
        }
    }
}
#[test]
fn numeric_bounds_and_domain_validation() {
    for value in [0, 1, i64::MAX as u64] {
        assert_eq!(RowVersion(value).checked().unwrap().cast_unsigned(), value);
        assert_eq!(
            DocumentRevision(value).checked().unwrap().cast_unsigned(),
            value
        );
    }
    assert!(RowVersion(u64::MAX).checked().is_err());
    assert!(Millis(-1).checked().is_err());
    let db = common::open();
    let (d, _, _, _) = common::fixture(&db);
    assert_eq!(
        db.transaction(move |tx| tx.commit_document(DocumentCommit {
            document_id: d.id,
            expected: d.revision,
            source_hash: "a".repeat(64),
            canonical_hash: "b".repeat(64),
            model_version: 2,
            changes: vec![]
        }))
        .unwrap_err()
        .code,
        ErrorCode::Validation
    );
    let anchor = Anchor(serde_json::json!({"version":1}));
    assert!(anchor.validate().is_err());
}
