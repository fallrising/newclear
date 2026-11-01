#![allow(clippy::wildcard_imports, clippy::many_single_char_names)]
mod common;
use flowshot_db::*;
#[test]
fn annotation_delete_tombstones_thread() {
    let db = common::open();
    let (d, a, c, r) = common::fixture(&db);
    let deleted = db
        .transaction(move |tx| tx.delete_annotation(a.id, a.version))
        .unwrap();
    assert_eq!(deleted.deleted_at, Some(Millis(1234)));
    assert_eq!(deleted.version, RowVersion(1));
    db.read(|q| {
        for id in [c.id, r.id] {
            let x = q.comment(id)?;
            assert_eq!(x.deleted_at, deleted.deleted_at);
            assert_eq!(x.version, RowVersion(1));
        }
        assert!(q.annotations(d.id, Tombstones::Exclude)?.is_empty());
        assert_eq!(q.annotations(d.id, Tombstones::Include)?.len(), 1);
        Ok(())
    })
    .unwrap();
    assert_eq!(
        db.transaction(move |tx| tx.delete_annotation(a.id, RowVersion(1)))
            .unwrap(),
        deleted
    );
}
#[test]
fn comment_delete_preserves_replies() {
    let db = common::open();
    let (_, a, c, r) = common::fixture(&db);
    db.transaction(move |tx| tx.delete_comment(c.id, c.version))
        .unwrap();
    db.read(|q| {
        assert!(q.comment(c.id)?.deleted_at.is_some());
        assert_eq!(q.comment(r.id)?, r);
        assert_eq!(q.comments(a.id, Tombstones::Include)?.len(), 2);
        Ok(())
    })
    .unwrap();
}
