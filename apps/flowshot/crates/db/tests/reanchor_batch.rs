#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
fn anchor(source: &str, canonical: &str) -> Anchor {
    Anchor(
        serde_json::json!({"version":1,"document_model_version":1,"exact":"text","prefix":"","suffix":"","start_hint":0,"end_hint":4,"offset_unit":"utf8-byte","source_hash":source,"canonical_hash":canonical,"source_span_hint":null}),
    )
}
fn fixture(db: &DbRuntime) -> (Document, Annotation, Annotation) {
    let (d, _, _, _) = common::fixture(db);
    db.transaction(move |tx| {
        let d = tx.commit_document(DocumentCommit {
            document_id: d.id,
            expected: d.revision,
            source_hash: "a".repeat(64),
            canonical_hash: "b".repeat(64),
            model_version: 1,
            changes: vec![],
        })?;
        let input = NewAnnotation {
            document_id: d.id,
            body: String::new(),
            color: Color::Yellow,
            kind: AnnotationKind::Range {
                anchor: anchor(&"a".repeat(64), &"b".repeat(64)),
                status: AnchorStatus::Attached,
                snapshot: Snapshot {
                    document_id: d.id,
                    revision: d.revision,
                    source_hash: "a".repeat(64),
                    canonical_hash: "b".repeat(64),
                    model_version: 1,
                },
            },
        };
        let a = tx.create_annotation(input.clone())?;
        let b = tx.create_annotation(input)?;
        Ok((d, a, b))
    })
    .unwrap()
}
fn change(a: &Annotation, orphan: bool) -> AnchorChange {
    let new = if orphan {
        a.anchor.clone()
    } else {
        Some(anchor(&"c".repeat(64), &"d".repeat(64)))
    };
    AnchorChange {
        annotation_id: a.id,
        expected: a.version,
        anchor: new.clone(),
        status: if orphan {
            AnchorStatus::Orphaned
        } else {
            AnchorStatus::Attached
        },
        resolution: if orphan {
            Resolution::None
        } else {
            Resolution::Exact
        },
        event: AnchorEvent {
            source: TriggerSource::Watcher,
            outcome: if orphan {
                EventOutcome::Orphaned
            } else {
                EventOutcome::Shifted
            },
            method: if orphan {
                Resolution::None
            } else {
                Resolution::Exact
            },
            score: None,
            old_anchor: a.anchor.clone(),
            new_anchor: new,
            reason: None,
        },
    }
}
fn commit(d: &Document, changes: Vec<AnchorChange>) -> DocumentCommit {
    DocumentCommit {
        document_id: d.id,
        expected: d.revision,
        source_hash: "c".repeat(64),
        canonical_hash: "d".repeat(64),
        model_version: 1,
        changes,
    }
}
#[test]
fn orphan_retains_original_anchor_and_audit() {
    let db = common::open();
    let (d, a, b) = fixture(&db);
    let input = commit(&d, vec![change(&a, true), change(&b, false)]);
    let updated = db.transaction(move |tx| tx.commit_document(input)).unwrap();
    assert_eq!(updated.revision, DocumentRevision(2));
    let orphan = db.read(|q| q.annotation(a.id)).unwrap();
    assert_eq!(orphan.anchor, a.anchor);
    assert_eq!(orphan.status, AnchorStatus::Orphaned);
    assert_eq!(orphan.version, RowVersion(1));
    assert_eq!(
        db.read(|q| q.anchor_events(a.id)).unwrap()[0].old_anchor,
        a.anchor
    );
}
#[test]
fn missing_range_and_forged_audit_are_rejected() {
    let db = common::open();
    let (d, a, b) = fixture(&db);
    let missing = commit(&d, vec![change(&a, false)]);
    assert!(
        db.transaction(move |tx| tx.commit_document(missing))
            .is_err()
    );
    let mut forged = change(&a, false);
    forged.event.old_anchor = None;
    let input = commit(&d, vec![forged, change(&b, false)]);
    assert!(db.transaction(move |tx| tx.commit_document(input)).is_err());
    let mut lost = change(&a, false);
    lost.status = AnchorStatus::Document;
    lost.anchor = None;
    lost.event.new_anchor = None;
    let input = commit(&d, vec![lost, change(&b, false)]);
    assert!(db.transaction(move |tx| tx.commit_document(input)).is_err());
    assert_eq!(db.read(|q| q.document(d.id)).unwrap(), d);
    assert_eq!(db.read(|q| q.annotation(a.id)).unwrap(), a);
    assert!(db.read(|q| q.anchor_events(a.id)).unwrap().is_empty());
}
#[test]
fn stale_second_range_rolls_back_entire_batch() {
    let db = common::open();
    let (d, a, b) = fixture(&db);
    db.transaction(move |tx| tx.update_annotation(b.id, b.version, "changed".into(), Color::Blue))
        .unwrap();
    let input = commit(&d, vec![change(&a, false), change(&b, false)]);
    assert_eq!(
        db.transaction(move |tx| tx.commit_document(input))
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    assert_eq!(db.read(|q| q.document(d.id)).unwrap(), d);
    assert_eq!(db.read(|q| q.annotation(a.id)).unwrap(), a);
    assert!(db.read(|q| q.anchor_events(a.id)).unwrap().is_empty());
}
#[test]
fn failed_event_rolls_back_batch_even_when_caller_handles_error() {
    let path = common::path("event-failure");
    let db = DbRuntime::open(&path).unwrap();
    let (d, a, b) = fixture(&db);
    let raw = rusqlite::Connection::open(path).unwrap();
    raw.execute_batch(&format!("CREATE TRIGGER test_event_failure BEFORE INSERT ON annotation_anchor_events WHEN NEW.annotation_id='{}' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END;",b.id)).unwrap();
    let input = commit(&d, vec![change(&a, false), change(&b, false)]);
    db.transaction(move |tx| {
        assert_eq!(
            tx.commit_document(input).unwrap_err().code,
            ErrorCode::Validation
        );
        tx.create_workspace("outer transaction survived".into())
    })
    .unwrap();
    assert_eq!(db.read(|q| q.document(d.id)).unwrap(), d);
    assert_eq!(db.read(|q| q.annotation(a.id)).unwrap(), a);
    assert_eq!(db.read(|q| q.annotation(b.id)).unwrap(), b);
    assert!(db.read(|q| q.anchor_events(a.id)).unwrap().is_empty());
}
#[test]
fn unchanged_resolution_uses_none_event_method() {
    let db = common::open();
    let (document, first, second) = fixture(&db);
    let changes = [&first, &second]
        .into_iter()
        .map(|annotation| {
            let mut update = change(annotation, false);
            let updated_anchor = Some(anchor(&"c".repeat(64), &"b".repeat(64)));
            update.anchor = updated_anchor.clone();
            update.resolution = Resolution::Unchanged;
            update.event.outcome = EventOutcome::Unchanged;
            update.event.method = Resolution::None;
            update.event.new_anchor = updated_anchor;
            update
        })
        .collect();
    let mut input = commit(&document, changes);
    input.canonical_hash = "b".repeat(64);
    let updated = db.transaction(move |tx| tx.commit_document(input)).unwrap();
    assert_eq!(updated.revision, DocumentRevision(2));
    assert_eq!(updated.canonical_hash, document.canonical_hash);
    assert_eq!(updated.source_hash, Some("c".repeat(64)));
    for annotation in [first, second] {
        let stored = db
            .read(|repository| repository.annotation(annotation.id))
            .unwrap();
        assert_eq!(stored.status, AnchorStatus::Attached);
        assert_eq!(stored.resolution, Resolution::Unchanged);
        assert_eq!(stored.version, RowVersion(1));
        let events = db
            .read(|repository| repository.anchor_events(annotation.id))
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].outcome, EventOutcome::Unchanged);
        assert_eq!(events[0].method, Resolution::None);
        assert_eq!(events[0].old_anchor, annotation.anchor);
        assert_eq!(events[0].new_anchor, stored.anchor);
    }
}
#[test]
fn attached_status_rejects_orphaned_event_outcome() {
    let db = common::open();
    let (document, first, second) = fixture(&db);
    let mut inconsistent = change(&first, false);
    inconsistent.event.outcome = EventOutcome::Orphaned;
    let input = commit(&document, vec![inconsistent, change(&second, false)]);
    assert_eq!(
        db.transaction(move |tx| tx.commit_document(input))
            .unwrap_err()
            .code,
        ErrorCode::Validation
    );
    assert_eq!(
        db.read(|repository| repository.document(document.id))
            .unwrap(),
        document
    );
    for annotation in [first, second] {
        assert_eq!(
            db.read(|repository| repository.annotation(annotation.id))
                .unwrap(),
            annotation
        );
        assert!(
            db.read(|repository| repository.anchor_events(annotation.id))
                .unwrap()
                .is_empty()
        );
    }
}
