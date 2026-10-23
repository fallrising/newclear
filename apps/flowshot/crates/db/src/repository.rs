use crate::types::{internal, invalid};
use crate::*;
use caseless::Caseless;
use rusqlite::{Row, params};
use unicode_normalization::UnicodeNormalization;
/// Read-only view with typed methods, borrowed for one blocking operation.
pub struct Repository<'a> {
    pub(crate) conn: &'a rusqlite::Connection,
}
pub fn normalize_tag(value: &str) -> Result<String> {
    let value: String = value.trim().nfkc().default_case_fold().collect();
    let value = value.trim();
    if value.is_empty() {
        Err(invalid())
    } else {
        Ok(value.into())
    }
}
#[allow(clippy::needless_pass_by_value)] // Own the SQLite text value before JSON decoding.
fn json(value: String) -> Result<serde_json::Value> {
    serde_json::from_str(&value).map_err(|_| internal())
}
fn opt_json(value: Option<String>) -> Result<Option<Anchor>> {
    value.map(|v| json(v).map(Anchor)).transpose()
}
fn token(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| internal())
}
fn time(value: i64) -> Result<Millis> {
    if value < 0 {
        Err(internal())
    } else {
        Ok(Millis(value))
    }
}
fn opt_time(value: Option<i64>) -> Result<Option<Millis>> {
    value.map(time).transpose()
}
fn workspace(r: &Row<'_>) -> Result<Workspace> {
    Ok(Workspace {
        id: WorkspaceId::parse(&r.get::<_, String>(0)?)?,
        name: r.get(1)?,
        archived_at: opt_time(r.get(2)?)?,
        created_at: time(r.get(3)?)?,
        updated_at: time(r.get(4)?)?,
    })
}
fn root(r: &Row<'_>) -> Result<Root> {
    Ok(Root {
        id: RootId::parse(&r.get::<_, String>(0)?)?,
        workspace_id: WorkspaceId::parse(&r.get::<_, String>(1)?)?,
        abs_path: r.get(2)?,
        canonical_path: r.get(3)?,
        status: RootStatus::parse(&r.get::<_, String>(4)?)?,
        ext_filter: json(r.get(5)?)?,
        ignore_rules: json(r.get(6)?)?,
        created_at: time(r.get(7)?)?,
        updated_at: time(r.get(8)?)?,
    })
}
fn document(r: &Row<'_>) -> Result<Document> {
    Ok(Document {
        id: DocumentId::parse(&r.get::<_, String>(0)?)?,
        root_id: RootId::parse(&r.get::<_, String>(1)?)?,
        rel_path: r.get(2)?,
        status: DocumentStatus::parse(&r.get::<_, String>(3)?)?,
        source_hash: r.get(4)?,
        canonical_hash: r.get(5)?,
        model_version: r
            .get::<_, Option<i64>>(6)?
            .map(|v| u32::try_from(v).map_err(|_| internal()))
            .transpose()?,
        size_bytes: r.get::<_, Option<i64>>(7)?.map(token).transpose()?,
        mtime: opt_time(r.get(8)?)?,
        revision: DocumentRevision(token(r.get(9)?)?),
        last_seen_at: opt_time(r.get(10)?)?,
        last_opened_at: opt_time(r.get(11)?)?,
        created_at: time(r.get(12)?)?,
        updated_at: time(r.get(13)?)?,
    })
}
fn annotation(r: &Row<'_>) -> Result<Annotation> {
    Ok(Annotation {
        id: AnnotationId::parse(&r.get::<_, String>(0)?)?,
        document_id: DocumentId::parse(&r.get::<_, String>(1)?)?,
        body: r.get(3)?,
        color: Color::parse(&r.get::<_, String>(4)?)?,
        status: AnchorStatus::parse(&r.get::<_, String>(5)?)?,
        anchor: opt_json(r.get(6)?)?,
        resolution: Resolution::parse(&r.get::<_, String>(7)?)?,
        last_reanchored_revision: r
            .get::<_, Option<i64>>(8)?
            .map(|v| token(v).map(DocumentRevision))
            .transpose()?,
        version: RowVersion(token(r.get(9)?)?),
        deleted_at: opt_time(r.get(10)?)?,
        created_at: time(r.get(11)?)?,
        updated_at: time(r.get(12)?)?,
    })
}
fn comment(r: &Row<'_>) -> Result<Comment> {
    Ok(Comment {
        id: CommentId::parse(&r.get::<_, String>(0)?)?,
        annotation_id: AnnotationId::parse(&r.get::<_, String>(1)?)?,
        parent_id: r
            .get::<_, Option<String>>(2)?
            .map(|s| CommentId::parse(&s))
            .transpose()?,
        body: r.get(3)?,
        version: RowVersion(token(r.get(4)?)?),
        deleted_at: opt_time(r.get(5)?)?,
        created_at: time(r.get(6)?)?,
        updated_at: time(r.get(7)?)?,
    })
}
fn tag(r: &Row<'_>) -> Result<Tag> {
    Ok(Tag {
        id: TagId::parse(&r.get::<_, String>(0)?)?,
        display_name: r.get(1)?,
        normalized_name: r.get(2)?,
        kind: TagKind::parse(&r.get::<_, String>(3)?)?,
        created_at: time(r.get(4)?)?,
        updated_at: time(r.get(5)?)?,
    })
}
impl Repository<'_> {
    fn one<T>(
        &self,
        sql: &str,
        values: impl rusqlite::Params,
        map: fn(&Row<'_>) -> Result<T>,
    ) -> Result<T> {
        let mut statement = self.conn.prepare_cached(sql)?;
        let mut rows = statement.query(values)?;
        map(rows
            .next()?
            .ok_or_else(|| DbError::new(ErrorCode::NotFound))?)
    }
    fn many<T>(
        &self,
        sql: &str,
        values: impl rusqlite::Params,
        map: fn(&Row<'_>) -> Result<T>,
    ) -> Result<Vec<T>> {
        let mut statement = self.conn.prepare_cached(sql)?;
        let mut rows = statement.query(values)?;
        let mut result = Vec::new();
        while let Some(row) = rows.next()? {
            result.push(map(row)?);
        }
        Ok(result)
    }
    pub fn workspace(&self, id: WorkspaceId) -> Result<Workspace> {
        self.one(
            "SELECT * FROM workspaces WHERE id=?1",
            [id.to_string()],
            workspace,
        )
    }
    pub fn root(&self, id: RootId) -> Result<Root> {
        self.one(
            "SELECT * FROM workspace_roots WHERE id=?1",
            [id.to_string()],
            root,
        )
    }
    pub fn document(&self, id: DocumentId) -> Result<Document> {
        self.one(
            "SELECT * FROM documents WHERE id=?1",
            [id.to_string()],
            document,
        )
    }
    pub fn annotation(&self, id: AnnotationId) -> Result<Annotation> {
        self.one(
            "SELECT * FROM annotations WHERE id=?1",
            [id.to_string()],
            annotation,
        )
    }
    pub fn comment(&self, id: CommentId) -> Result<Comment> {
        self.one(
            "SELECT * FROM comments WHERE id=?1",
            [id.to_string()],
            comment,
        )
    }
    pub fn tag(&self, id: TagId) -> Result<Tag> {
        self.one("SELECT * FROM tags WHERE id=?1", [id.to_string()], tag)
    }
    pub fn annotations(&self, id: DocumentId, t: Tombstones) -> Result<Vec<Annotation>> {
        self.many(if t==Tombstones::Include {"SELECT * FROM annotations WHERE document_id=?1 ORDER BY created_at,id"}else{"SELECT * FROM annotations WHERE document_id=?1 AND deleted_at IS NULL ORDER BY created_at,id"},[id.to_string()],annotation)
    }
    pub fn comments(&self, id: AnnotationId, t: Tombstones) -> Result<Vec<Comment>> {
        self.many(if t==Tombstones::Include {"SELECT * FROM comments WHERE annotation_id=?1 ORDER BY created_at,id"}else{"SELECT * FROM comments WHERE annotation_id=?1 AND deleted_at IS NULL ORDER BY created_at,id"},[id.to_string()],comment)
    }
    pub fn app_state(&self, scope: &str, key: &str) -> Result<Option<AppState>> {
        match self.one(
            "SELECT scope,key,value_json,updated_at FROM app_state WHERE scope=?1 AND key=?2",
            params![scope, key],
            |r| {
                Ok(AppState {
                    scope: r.get(0)?,
                    key: r.get(1)?,
                    value: json(r.get(2)?)?,
                    updated_at: time(r.get(3)?)?,
                })
            },
        ) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.code == ErrorCode::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    pub fn tags(&self, target: TagTarget) -> Result<Vec<Tag>> {
        match target{TagTarget::Document(id)=>self.many("SELECT t.* FROM tags t JOIN document_tags b ON t.id=b.tag_id WHERE b.document_id=?1 ORDER BY t.normalized_name",[id.to_string()],tag),TagTarget::Annotation(id)=>self.many("SELECT t.* FROM tags t JOIN annotation_tags b ON t.id=b.tag_id WHERE b.annotation_id=?1 ORDER BY t.normalized_name",[id.to_string()],tag)}
    }
    pub fn anchor_events(&self, id: AnnotationId) -> Result<Vec<AnchorEvent>> {
        self.many("SELECT trigger_source,outcome,method,score,old_anchor_json,new_anchor_json,reason_code FROM annotation_anchor_events WHERE annotation_id=?1 ORDER BY id DESC",[id.to_string()],|r|Ok(AnchorEvent{source:TriggerSource::parse(&r.get::<_,String>(0)?)?,outcome:EventOutcome::parse(&r.get::<_,String>(1)?)?,method:Resolution::parse(&r.get::<_,String>(2)?)?,score:r.get(3)?,old_anchor:opt_json(r.get(4)?)?,new_anchor:opt_json(r.get(5)?)?,reason:r.get(6)?}))
    }
}
