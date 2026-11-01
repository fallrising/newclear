#![allow(clippy::wildcard_imports)]
use flowshot_db::*;
#[test]
fn production_runtime_contract() {
    fn send_sync<T: Send + Sync>() {}
    send_sync::<DbRuntime>();
    let db = DbRuntime::open(std::path::Path::new(":memory:")).unwrap();
    let w = db
        .transaction(|tx| tx.create_workspace("contract".into()))
        .unwrap();
    assert_eq!(w.name, "contract");
    assert_eq!(db.read(|r| r.workspace(w.id)).unwrap(), w);
}
#[test]
fn normalization_and_versions() {
    assert_eq!(normalize_tag("  Ｓtraße  ").unwrap(), "strasse");
    assert!(RowVersion(i64::MAX as u64).next().is_err());
}
