use super::*;
fn blank() -> Connection {
    crate::connection::open(std::path::Path::new(":memory:")).unwrap()
}
fn db() -> Connection {
    let mut c = blank();
    run(&mut c, 1234).unwrap();
    c
}
#[test]
fn blank_database_upgrades_to_latest() {
    let c = db();
    let record: (i64, String, i64) = c
        .query_row(
            "SELECT version,checksum,applied_at FROM schema_migrations",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(record, (1, REGISTRY[0].checksum.into(), 1234));
}
#[test]
fn latest_database_is_idempotent() {
    let mut c = db();
    let before: i64 = c
        .query_row("PRAGMA schema_version", [], |r| r.get(0))
        .unwrap();
    run(&mut c, 9999).unwrap();
    assert_eq!(
        c.query_row::<i64, _, _>("PRAGMA schema_version", [], |r| r.get(0))
            .unwrap(),
        before
    );
    assert_eq!(
        c.query_row::<i64, _, _>("SELECT applied_at FROM schema_migrations", [], |r| r.get(0))
            .unwrap(),
        1234
    );
}
#[test]
fn migration_registry_rejects_drift() {
    let good = REGISTRY[0];
    for registry in [
        vec![Migration { version: 0, ..good }],
        vec![Migration { version: 2, ..good }],
        vec![good, good],
        vec![Migration {
            checksum: "tamper",
            ..good
        }],
    ] {
        let mut c = blank();
        assert_eq!(
            run_registry(&mut c, &registry, 1).unwrap_err().code,
            ErrorCode::Migration
        );
        assert_eq!(
            c.query_row::<i64, _, _>("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
                .unwrap(),
            0
        );
    }
    let mut c = db();
    c.execute("UPDATE schema_migrations SET checksum='bad'", [])
        .unwrap();
    assert_eq!(run(&mut c, 1).unwrap_err().code, ErrorCode::Migration);
    c.execute("UPDATE schema_migrations SET version=2", [])
        .unwrap();
    assert_eq!(run(&mut c, 1).unwrap_err().code, ErrorCode::Migration);
}
#[test]
fn failed_ddl_rolls_back_schema_and_metadata() {
    let sql = "CREATE TABLE before_failure(id); THIS IS INVALID;";
    let hash = digest(sql);
    let registry = [Migration {
        version: 1,
        sql,
        checksum: &hash,
    }];
    let mut c = blank();
    assert!(run_registry(&mut c, &registry, 1).is_err());
    assert_eq!(
        c.query_row::<i64, _, _>("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
            .unwrap(),
        0
    );
}
#[test]
fn unknown_schema_is_untouched() {
    let mut c = blank();
    c.execute("CREATE TABLE foreign_data(body)", []).unwrap();
    assert_eq!(run(&mut c, 1).unwrap_err().code, ErrorCode::Migration);
    assert_eq!(
        c.query_row::<i64, _, _>("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
            .unwrap(),
        1
    );
}
fn seed(c: &Connection) {
    c.execute_batch("INSERT INTO workspaces VALUES('w','workspace',NULL,1,1);INSERT INTO workspace_roots VALUES('r','w','/root','/root','active','[]','[]',1,1);INSERT INTO documents(id,root_id,rel_path,status,created_at,updated_at) VALUES('d','r','doc.md','present',1,1);INSERT INTO annotations(id,document_id,kind,body,anchor_status,created_at,updated_at) VALUES('a','d','document','note','document',1,1),('a2','d','document','note2','document',1,1);INSERT INTO comments(id,annotation_id,body,created_at,updated_at) VALUES('c','a','comment',1,1);INSERT INTO comments(id,annotation_id,parent_id,body,created_at,updated_at) VALUES('reply','a','c','reply',1,1);INSERT INTO tags VALUES('t','tag','tag','user',1,1);INSERT INTO annotation_tags VALUES('a','t',1);").unwrap();
}
fn reject(c: &Connection, sql: &str) {
    let before = c.total_changes();
    assert!(
        c.execute_batch(sql).is_err(),
        "unexpectedly accepted: {sql}"
    );
    assert_eq!(c.total_changes(), before, "changed rows: {sql}");
}
#[test]
fn hard_delete_is_rejected() {
    let c = db();
    seed(&c);
    for sql in [
        "DELETE FROM documents",
        "DELETE FROM annotations",
        "DELETE FROM comments",
    ] {
        reject(&c, sql);
    }
}
#[test]
fn comment_parent_is_one_level() {
    let c = db();
    seed(&c);
    for sql in [
        "INSERT INTO comments VALUES('x','a','missing','body',0,NULL,1,1)",
        "INSERT INTO comments VALUES('x','a','reply','body',0,NULL,1,1)",
        "INSERT INTO comments VALUES('x','a2','c','body',0,NULL,1,1)",
        "INSERT INTO comments VALUES('x','a','x','body',0,NULL,1,1)",
        "UPDATE comments SET parent_id='reply' WHERE id='c'",
        "UPDATE comments SET parent_id='c' WHERE id='c'",
        "UPDATE comments SET annotation_id='a2' WHERE id='c'",
        "UPDATE comments SET annotation_id='a2' WHERE id='reply'",
        "UPDATE comments SET parent_id='reply' WHERE id='reply'",
        "UPDATE comments SET id='changed' WHERE id='c'",
    ] {
        reject(&c, sql);
    }
}
#[test]
fn system_pin_is_protected() {
    let c = db();
    seed(&c);
    for sql in [
        "UPDATE tags SET display_name='renamed' WHERE kind='system'",
        "UPDATE tags SET normalized_name='renamed' WHERE kind='system'",
        "UPDATE tags SET kind='user' WHERE kind='system'",
        "UPDATE tags SET id='new' WHERE kind='system'",
        "DELETE FROM tags WHERE kind='system'",
        "INSERT INTO annotation_tags SELECT 'a',id,1 FROM tags WHERE kind='system'",
        "UPDATE annotation_tags SET tag_id=(SELECT id FROM tags WHERE kind='system')",
    ] {
        reject(&c, sql);
    }
    c.execute(
        "INSERT INTO document_tags SELECT 'd',id,1 FROM tags WHERE kind='system'",
        [],
    )
    .unwrap();
}
#[test]
fn canonical_checks_reject_invalid_rows() {
    let c = db();
    seed(&c);
    for sql in [
        "INSERT INTO workspaces VALUES('x',' ',NULL,1,1)",
        "UPDATE workspace_roots SET status='bad'",
        "UPDATE workspace_roots SET ext_filter_json='bad'",
        "UPDATE workspace_roots SET ignore_rules_json='bad'",
        "UPDATE workspace_roots SET workspace_id='unknown'",
        "INSERT INTO workspace_roots VALUES('x','w','/root','/root','active','[]','[]',1,1)",
        "UPDATE documents SET status='bad'",
        "UPDATE documents SET revision=-1",
        "UPDATE documents SET root_id='unknown'",
        "INSERT INTO documents(id,root_id,rel_path,status,created_at,updated_at) VALUES('x','r','doc.md','present',1,1)",
        "UPDATE annotations SET kind='bad'",
        "UPDATE annotations SET color='red'",
        "UPDATE annotations SET anchor_status='shifted'",
        "UPDATE annotations SET last_resolution='bad'",
        "UPDATE annotations SET anchor_json='invalid'",
        "UPDATE annotations SET anchor_json='{}'",
        "UPDATE annotations SET kind='range'",
        "UPDATE annotations SET body=' '",
        "UPDATE annotations SET document_id='unknown'",
        "UPDATE comments SET body=' '",
        "UPDATE comments SET annotation_id='unknown'",
        "UPDATE tags SET kind='bad' WHERE id='t'",
        "UPDATE tags SET display_name='' WHERE id='t'",
        "UPDATE tags SET display_name=printf('%065d',1) WHERE id='t'",
        "UPDATE tags SET normalized_name='pin' WHERE id='t'",
        "INSERT INTO document_tags VALUES('unknown','t',1)",
        "INSERT INTO annotation_tags VALUES('a','unknown',1)",
        "INSERT INTO app_state VALUES('scope','key','bad',1)",
        "INSERT INTO annotation_anchor_events(annotation_id,document_revision,trigger_source,outcome,method,created_at) VALUES('a',0,'bad','unchanged','none',1)",
        "INSERT INTO annotation_anchor_events(annotation_id,document_revision,trigger_source,outcome,method,created_at) VALUES('a',0,'open','bad','none',1)",
        "INSERT INTO annotation_anchor_events(annotation_id,document_revision,trigger_source,outcome,method,old_anchor_json,created_at) VALUES('a',0,'open','unchanged','none','bad',1)",
    ] {
        reject(&c, sql);
    }
}
#[test]
fn canonical_v1_catalog_is_complete() {
    let c = db();
    let tables:Vec<String>=c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap().query_map([],|r|r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(
        tables,
        vec![
            "annotation_anchor_events",
            "annotation_tags",
            "annotations",
            "app_state",
            "comments",
            "document_tags",
            "documents",
            "schema_migrations",
            "tags",
            "workspace_roots",
            "workspaces"
        ]
    );
    let indexes:Vec<String>=c.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap().query_map([],|r|r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(
        indexes,
        vec![
            "idx_anchor_events_annotation",
            "idx_annotation_tags_tag",
            "idx_annotations_document_active",
            "idx_comments_annotation",
            "idx_document_tags_tag",
            "idx_documents_last_opened",
            "idx_documents_root_status"
        ]
    );
    let columns: Vec<String> = c
        .prepare("PRAGMA table_info(documents)")
        .unwrap()
        .query_map([], |r| r.get(1))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        columns,
        vec![
            "id",
            "root_id",
            "rel_path",
            "status",
            "source_hash",
            "canonical_text_hash",
            "model_version",
            "size_bytes",
            "mtime_ms",
            "revision",
            "last_seen_at",
            "last_opened_at",
            "created_at",
            "updated_at"
        ]
    );
    let fks: i64 = c
        .query_row(
            "SELECT count(*) FROM pragma_foreign_key_list('annotation_tags')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(fks, 2);
    let triggers: i64 = c
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='trigger'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(triggers, 9);
}
#[test]
fn required_queries_use_declared_indexes() {
    let c = db();
    let cases = [
        (
            "SELECT * FROM documents WHERE root_id='r' AND status='present'",
            "idx_documents_root_status",
        ),
        (
            "SELECT * FROM documents ORDER BY last_opened_at DESC LIMIT 20",
            "idx_documents_last_opened",
        ),
        (
            "SELECT * FROM annotations WHERE document_id='d' AND deleted_at IS NULL AND anchor_status='attached'",
            "idx_annotations_document_active",
        ),
        (
            "SELECT * FROM comments WHERE annotation_id='a' ORDER BY created_at",
            "idx_comments_annotation",
        ),
        (
            "SELECT document_id FROM document_tags WHERE tag_id='t'",
            "idx_document_tags_tag",
        ),
        (
            "SELECT annotation_id FROM annotation_tags WHERE tag_id='t'",
            "idx_annotation_tags_tag",
        ),
        (
            "SELECT * FROM annotation_anchor_events WHERE annotation_id='a' ORDER BY id DESC",
            "idx_anchor_events_annotation",
        ),
    ];
    for (sql, index) in cases {
        let details: Vec<String> = c
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap()
            .query_map([], |r| r.get(3))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(
            details.iter().any(|d| d.contains(index)),
            "{index}: {details:?}"
        );
        eprintln!("{index}: {details:?}");
    }
}
#[test]
fn replacement_cannot_bypass_delete_or_pin_protection() {
    let c = db();
    seed(&c);
    for sql in [
        "INSERT OR REPLACE INTO documents SELECT * FROM documents WHERE id='d'",
        "INSERT OR REPLACE INTO annotations SELECT * FROM annotations WHERE id='a'",
        "INSERT OR REPLACE INTO comments SELECT * FROM comments WHERE id='c'",
        "INSERT OR REPLACE INTO tags SELECT * FROM tags WHERE kind='system'",
        "UPDATE tags SET id=NULL WHERE kind='system'",
    ] {
        reject(&c, sql);
    }
}
#[test]
fn empty_metadata_does_not_adopt_unknown_schema() {
    let mut c = blank();
    c.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL); CREATE TABLE alien(body)").unwrap();
    assert_eq!(run(&mut c, 1).unwrap_err().code, ErrorCode::Migration);
    assert_eq!(
        c.query_row::<i64, _, _>(
            "SELECT count(*) FROM sqlite_master WHERE type='table'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        2
    );
}
#[test]
fn all_canonical_catalog_definitions_match_authority() {
    let spec = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../SPEC.md"));
    let ddl = spec
        .split("### 9.2 Canonical schema")
        .nth(1)
        .unwrap()
        .split("```sql\n")
        .nth(1)
        .unwrap()
        .split("```")
        .next()
        .unwrap();
    let expected = Connection::open_in_memory().unwrap();
    expected.execute_batch(ddl).unwrap();
    let actual = db();
    let catalog = |conn: &Connection| -> Vec<(String, String, String)> {
        conn.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").unwrap().query_map([],|r|{let sql:String=r.get(2)?;Ok((r.get(0)?,r.get(1)?,sql.chars().filter(|c|!c.is_whitespace()).collect()))}).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    assert_eq!(catalog(&actual), catalog(&expected));
}
