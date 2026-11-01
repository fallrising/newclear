#![allow(clippy::many_single_char_names)]
#![allow(dead_code)]
use flowshot_db::*;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
pub struct FixedClock(pub i64);
impl Clock for FixedClock {
    fn now(&self) -> Millis {
        Millis(self.0)
    }
}
pub struct FixedIds(AtomicU64);
impl IdSource for FixedIds {
    fn next(&self) -> uuid::Uuid {
        let n = self.0.fetch_add(1, Ordering::SeqCst);
        uuid::Uuid::from_u128((0x0190_0000_0000_7000_8000_0000_0000_0000_u128) + u128::from(n))
    }
}
pub fn open() -> DbRuntime {
    DbRuntime::with_config(
        std::path::Path::new(":memory:"),
        Config {
            write_capacity: 2,
            read_connections: 2,
        },
        Arc::new(FixedClock(1234)),
        Arc::new(FixedIds(AtomicU64::new(1))),
    )
    .unwrap()
}
pub fn fixture(db: &DbRuntime) -> (Document, Annotation, Comment, Comment) {
    db.transaction(|tx| {
        let w = tx.create_workspace("test".into())?;
        let r = tx.create_root(NewRoot {
            workspace_id: w.id,
            abs_path: "/synthetic".into(),
            canonical_path: "/synthetic".into(),
            ext_filter: serde_json::json!(["md"]),
            ignore_rules: serde_json::json!([]),
        })?;
        let d = tx.create_document(r.id, "readme.md".into())?;
        let a = tx.create_annotation(NewAnnotation {
            document_id: d.id,
            body: "secret annotation".into(),
            color: Color::Yellow,
            kind: AnnotationKind::Document,
        })?;
        let c = tx.create_comment(a.id, None, "secret comment".into())?;
        let reply = tx.create_comment(a.id, Some(c.id), "reply".into())?;
        Ok((d, a, c, reply))
    })
    .unwrap()
}
pub fn path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("flowshot-{name}-{}.sqlite3", uuid::Uuid::now_v7()))
}
