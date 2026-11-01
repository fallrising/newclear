#![allow(clippy::wildcard_imports)]
use flowshot_db::*;
use std::time::Instant;
struct FixedClock;
impl Clock for FixedClock {
    fn now(&self) -> Millis {
        Millis(1234)
    }
}
struct FixedIds(std::sync::atomic::AtomicU64);
impl IdSource for FixedIds {
    fn next(&self) -> uuid::Uuid {
        uuid::Uuid::from_u128(
            0x0190_0000_0000_7000_8000_0000_0000_0000
                + u128::from(self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst)),
        )
    }
}
fn main() {
    #[allow(clippy::assertions_on_constants)]
    // A runtime guard permits checking the bench in debug without executing it.
    {
        assert!(!cfg!(debug_assertions), "release benchmark required");
    }
    let path =
        std::env::temp_dir().join(format!("flowshot-bench-{}.sqlite3", uuid::Uuid::now_v7()));
    let combined = Instant::now();
    let db = DbRuntime::with_config(
        &path,
        Config::default(),
        std::sync::Arc::new(FixedClock),
        std::sync::Arc::new(FixedIds(std::sync::atomic::AtomicU64::new(1))),
    )
    .unwrap();
    let migration = combined.elapsed();
    let seed = Instant::now();
    let doc = db
        .transaction(|tx| {
            let w = tx.create_workspace("benchmark".into())?;
            let root = tx.create_root(NewRoot {
                workspace_id: w.id,
                abs_path: "/synthetic".into(),
                canonical_path: "/synthetic".into(),
                ext_filter: serde_json::json!(["md"]),
                ignore_rules: serde_json::json!([]),
            })?;
            let doc = tx.create_document(root.id, "benchmark.md".into())?;
            let tag = tx.create_tag("benchmark".into())?;
            for _ in 0..10_000 {
                let a = tx.create_annotation(NewAnnotation {
                    document_id: doc.id,
                    body: "synthetic note".into(),
                    color: Color::Yellow,
                    kind: AnnotationKind::Document,
                })?;
                assert!(tx.set_tag_binding(TagTarget::Annotation(a.id), tag.id, true)?);
            }
            Ok(doc)
        })
        .unwrap();
    let seed_duration = seed.elapsed();
    let total = combined.elapsed();
    let annotations = db
        .read(|r| r.annotations(doc.id, Tombstones::Include))
        .unwrap();
    assert_eq!(annotations.len(), 10_000);
    assert!(
        annotations
            .iter()
            .all(|a| a.version == RowVersion(0) && a.deleted_at.is_none())
    );
    let c = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        c.query_row::<i64, _, _>("SELECT count(*) FROM annotation_tags", [], |r| r.get(0))
            .unwrap(),
        10_000
    );
    assert_eq!(
        c.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
    let cpu = std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|s| {
            s.lines().find_map(|line| {
                line.strip_prefix("model name")
                    .and_then(|s| s.split_once(':').map(|(_, v)| v.trim().to_owned()))
            })
        })
        .unwrap_or_else(|| "unknown".into());
    let os =
        std::fs::read_to_string("/etc/os-release").unwrap_or_else(|_| std::env::consts::OS.into());
    let report = serde_json::json!({"profile":"release","arch":std::env::consts::ARCH,"cpu":cpu,"os":os,"logical_cpus":std::thread::available_parallelism().map_or(0,std::num::NonZeroUsize::get),"sqlite":rusqlite::version(),"rusqlite":"0.40.2","annotations":10000,"bindings":10000,"migration_us":migration.as_micros(),"seed_us":seed_duration.as_micros(),"combined_us":total.as_micros(),"budget_us":1_000_000,"passed":total.as_secs_f64()<1.0});
    println!("{report}");
    if let Ok(dir) = std::env::var("AGENT_EVIDENCE_DIR") {
        std::fs::write(
            std::path::Path::new(&dir).join("benchmark.json"),
            format!("{report}\n"),
        )
        .unwrap();
    }
    assert!(total.as_secs_f64() < 1.0, "combined migration+seed >=1s");
}
