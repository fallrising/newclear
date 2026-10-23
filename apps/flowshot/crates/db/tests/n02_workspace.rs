#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
#[test]
fn joined_pages_split_roots_and_keep_empty_workspaces() {
    let db = common::open();
    let workspace = db
        .transaction(|tx| tx.create_workspace("roots".into()))
        .unwrap();
    for path in ["/a", "/b"] {
        db.transaction(move |tx| {
            tx.create_root(NewRoot {
                workspace_id: workspace.id,
                abs_path: path.into(),
                canonical_path: path.into(),
                ext_filter: serde_json::json!(["md"]),
                ignore_rules: serde_json::json!([]),
            })
        })
        .unwrap();
    }
    let empty = db
        .transaction(|tx| tx.create_workspace("empty".into()))
        .unwrap();
    let mut after = None;
    let mut rows = Vec::new();
    loop {
        let page = db.read(|r| r.workspace_page(after, 1)).unwrap();
        if page.is_empty() {
            break;
        }
        after = page
            .last()
            .map(|r| (r.workspace.id, r.root.as_ref().map(|r| r.id)));
        rows.extend(page);
    }
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows.iter()
            .filter(|row| row.workspace.id == workspace.id)
            .count(),
        2
    );
    assert!(
        rows.iter()
            .any(|row| row.workspace.id == empty.id && row.root.is_none())
    );
    assert_eq!(
        db.read(|r| r.roots_page(workspace.id, None, 1))
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn identity_ensure_and_optional_observation_preserve_snapshot() {
    let db = common::open();
    let (document, _, _, _) = common::fixture(&db);
    let again = db
        .transaction(move |tx| tx.ensure_document(document.root_id, document.rel_path.clone()))
        .unwrap();
    assert_eq!(again.id, document.id);
    let observed = db
        .transaction(move |tx| tx.observe_document_optional(document.id, 123, None, true))
        .unwrap();
    assert_eq!(observed.mtime, None);
    assert_eq!(observed.source_hash, None);
    assert_eq!(observed.canonical_hash, None);
    assert_eq!(observed.revision, DocumentRevision(0));
    let root = db.read(|r| r.root(document.root_id)).unwrap();
    assert_eq!(
        db.read(|r| r.recent_documents(root.workspace_id, None, 10))
            .unwrap(),
        vec![observed]
    );
}
