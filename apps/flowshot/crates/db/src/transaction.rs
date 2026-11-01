use crate::types::{conflict, invalid, validate_hash};
use crate::*;
use rusqlite::params;
/// Opaque writer transaction. The borrow cannot escape an owned actor request.
pub struct Transaction<'a> {
    pub(crate) conn: &'a rusqlite::Connection,
    pub(crate) sources: &'a types::Sources,
}
// Owned inputs are intentional at the queued transaction boundary.
#[allow(clippy::needless_pass_by_value)]
impl Transaction<'_> {
    pub fn repository(&self) -> Repository<'_> {
        Repository { conn: self.conn }
    }
    fn atomic<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        self.conn.execute_batch("SAVEPOINT primitive")?;
        match f(self) {
            Ok(v) => {
                self.conn.execute_batch("RELEASE primitive")?;
                Ok(v)
            }
            Err(e) => {
                self.conn
                    .execute_batch("ROLLBACK TO primitive; RELEASE primitive")?;
                Err(e)
            }
        }
    }
    pub fn create_workspace(&mut self, name: String) -> Result<Workspace> {
        if name.trim().is_empty() {
            return Err(invalid());
        }
        let id = WorkspaceId(self.sources.id()?);
        let now = self.sources.now()?;
        self.conn
            .prepare_cached(
                "INSERT INTO workspaces(id,name,created_at,updated_at) VALUES(?1,?2,?3,?3)",
            )?
            .execute(params![id.to_string(), name, now])?;
        self.repository().workspace(id)
    }
    pub fn create_root(&mut self, input: NewRoot) -> Result<Root> {
        if input.abs_path.is_empty()
            || input.canonical_path.is_empty()
            || !input.ext_filter.is_array()
            || !input.ignore_rules.is_array()
        {
            return Err(invalid());
        }
        let id = RootId(self.sources.id()?);
        let now = self.sources.now()?;
        self.conn.prepare_cached("INSERT INTO workspace_roots(id,workspace_id,abs_path,canonical_path,status,ext_filter_json,ignore_rules_json,created_at,updated_at) VALUES(?1,?2,?3,?4,'active',?5,?6,?7,?7)")?.execute(params![id.to_string(),input.workspace_id.to_string(),input.abs_path,input.canonical_path,input.ext_filter.to_string(),input.ignore_rules.to_string(),now])?;
        self.repository().root(id)
    }
    pub fn create_document(&mut self, root: RootId, rel_path: String) -> Result<Document> {
        if rel_path.is_empty()
            || rel_path.starts_with('/')
            || rel_path.contains('\0')
            || rel_path
                .split('/')
                .any(|x| x.is_empty() || x == ".." || x == ".")
        {
            return Err(invalid());
        }
        let id = DocumentId(self.sources.id()?);
        let now = self.sources.now()?;
        self.conn.prepare_cached("INSERT INTO documents(id,root_id,rel_path,status,created_at,updated_at) VALUES(?1,?2,?3,'present',?4,?4)")?.execute(params![id.to_string(),root.to_string(),rel_path,now])?;
        self.repository().document(id)
    }
    pub fn set_root_status(&mut self, id: RootId, status: RootStatus) -> Result<Root> {
        let old = self.repository().root(id)?;
        if old.status == status {
            return Ok(old);
        }
        self.conn.execute(
            "UPDATE workspace_roots SET status=?1,updated_at=?2 WHERE id=?3",
            params![status.sql(), self.sources.now()?, id.to_string()],
        )?;
        self.repository().root(id)
    }
    pub fn set_document_status(
        &mut self,
        id: DocumentId,
        status: DocumentStatus,
    ) -> Result<Document> {
        let old = self.repository().document(id)?;
        if old.status == status {
            return Ok(old);
        }
        self.conn.execute(
            "UPDATE documents SET status=?1,updated_at=?2 WHERE id=?3",
            params![status.sql(), self.sources.now()?, id.to_string()],
        )?;
        self.repository().document(id)
    }
    pub fn observe_document(
        &mut self,
        id: DocumentId,
        size: u64,
        mtime: Millis,
        opened: bool,
    ) -> Result<Document> {
        self.repository().document(id)?;
        let size = i64::try_from(size).map_err(|_| invalid())?;
        let now = self.sources.now()?;
        self.conn.execute("UPDATE documents SET size_bytes=?1,mtime_ms=?2,last_seen_at=?3,last_opened_at=CASE WHEN ?4 THEN ?3 ELSE last_opened_at END,updated_at=?3 WHERE id=?5",params![size,mtime.checked()?,now,opened,id.to_string()])?;
        self.repository().document(id)
    }
    fn verify_snapshot(&self, s: &Snapshot) -> Result<()> {
        let d = self.repository().document(s.document_id)?;
        s.revision.checked()?;
        if s.model_version != 1 {
            return Err(invalid());
        }
        validate_hash(&s.source_hash)?;
        validate_hash(&s.canonical_hash)?;
        if d.revision != s.revision
            || d.source_hash.as_deref() != Some(&s.source_hash)
            || d.canonical_hash.as_deref() != Some(&s.canonical_hash)
            || d.model_version != Some(s.model_version)
        {
            return Err(conflict());
        }
        Ok(())
    }
    pub fn create_annotation(&mut self, input: NewAnnotation) -> Result<Annotation> {
        let (kind, status, anchor) = match &input.kind {
            AnnotationKind::Document => {
                if input.body.trim().is_empty() {
                    return Err(invalid());
                }
                ("document", AnchorStatus::Document, None)
            }
            AnnotationKind::Range {
                anchor,
                status,
                snapshot,
            } => {
                anchor.validate()?;
                if *status == AnchorStatus::Document || snapshot.document_id != input.document_id {
                    return Err(invalid());
                }
                self.verify_snapshot(snapshot)?;
                if anchor.0["source_hash"].as_str() != Some(&snapshot.source_hash)
                    || anchor.0["canonical_hash"].as_str() != Some(&snapshot.canonical_hash)
                {
                    return Err(conflict());
                }
                ("range", *status, Some(anchor.0.to_string()))
            }
        };
        let id = AnnotationId(self.sources.id()?);
        let now = self.sources.now()?;
        self.conn.prepare_cached("INSERT INTO annotations(id,document_id,kind,body,color,anchor_status,anchor_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)")?.execute(params![id.to_string(),input.document_id.to_string(),kind,input.body,input.color.sql(),status.sql(),anchor,now])?;
        self.repository().annotation(id)
    }
    pub fn update_annotation(
        &mut self,
        id: AnnotationId,
        expected: RowVersion,
        body: String,
        color: Color,
    ) -> Result<Annotation> {
        let old = self.repository().annotation(id)?;
        if old.version != expected {
            return Err(conflict());
        }
        expected.checked()?;
        if old.deleted_at.is_some()
            || (old.status == AnchorStatus::Document && body.trim().is_empty())
        {
            return Err(invalid());
        }
        if old.body == body && old.color == color {
            return Ok(old);
        }
        let next = expected.next()?;
        let changed=self.conn.execute("UPDATE annotations SET body=?1,color=?2,row_version=?3,updated_at=?4 WHERE id=?5 AND row_version=?6",params![body,color.sql(),next.checked()?,self.sources.now()?,id.to_string(),expected.checked()?])?;
        if changed != 1 {
            return Err(conflict());
        }
        self.repository().annotation(id)
    }
    pub fn delete_annotation(
        &mut self,
        id: AnnotationId,
        expected: RowVersion,
    ) -> Result<Annotation> {
        self.atomic(|tx|{let old=tx.repository().annotation(id)?;if old.version!=expected{return Err(conflict());}expected.checked()?;if old.deleted_at.is_some(){return Ok(old);}let next=expected.next()?;let now=tx.sources.now()?;for c in tx.repository().comments(id,Tombstones::Include)?{if c.deleted_at!=Some(Millis(now)){c.version.next()?;}}
 tx.conn.execute("UPDATE annotations SET deleted_at=?1,updated_at=?1,row_version=?2 WHERE id=?3 AND row_version=?4",params![now,next.checked()?,id.to_string(),expected.checked()?])?;
 tx.conn.execute("UPDATE comments SET deleted_at=?1,updated_at=?1,row_version=row_version+1 WHERE annotation_id=?2 AND deleted_at IS NOT ?1",params![now,id.to_string()])?;tx.repository().annotation(id)})
    }
    pub fn create_comment(
        &mut self,
        id: AnnotationId,
        parent: Option<CommentId>,
        body: String,
    ) -> Result<Comment> {
        if body.trim().is_empty() || self.repository().annotation(id)?.deleted_at.is_some() {
            return Err(invalid());
        }
        let cid = CommentId(self.sources.id()?);
        let now = self.sources.now()?;
        self.conn.prepare_cached("INSERT INTO comments(id,annotation_id,parent_id,body,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)")?.execute(params![cid.to_string(),id.to_string(),parent.map(|p|p.to_string()),body,now])?;
        self.repository().comment(cid)
    }
    pub fn update_comment(
        &mut self,
        id: CommentId,
        expected: RowVersion,
        body: String,
    ) -> Result<Comment> {
        let old = self.repository().comment(id)?;
        if old.version != expected {
            return Err(conflict());
        }
        expected.checked()?;
        if old.deleted_at.is_some() || body.trim().is_empty() {
            return Err(invalid());
        }
        if old.body == body {
            return Ok(old);
        }
        let next = expected.next()?;
        self.conn.execute("UPDATE comments SET body=?1,row_version=?2,updated_at=?3 WHERE id=?4 AND row_version=?5",params![body,next.checked()?,self.sources.now()?,id.to_string(),expected.checked()?])?;
        self.repository().comment(id)
    }
    pub fn delete_comment(&mut self, id: CommentId, expected: RowVersion) -> Result<Comment> {
        let old = self.repository().comment(id)?;
        if old.version != expected {
            return Err(conflict());
        }
        expected.checked()?;
        if old.deleted_at.is_some() {
            return Ok(old);
        }
        let next = expected.next()?;
        let now = self.sources.now()?;
        self.conn.execute("UPDATE comments SET deleted_at=?1,updated_at=?1,row_version=?2 WHERE id=?3 AND row_version=?4",params![now,next.checked()?,id.to_string(),expected.checked()?])?;
        self.repository().comment(id)
    }
    pub fn create_tag(&mut self, display: String) -> Result<Tag> {
        let display = display.trim();
        if !(1..=64).contains(&display.chars().count()) {
            return Err(invalid());
        }
        let normalized = normalize_tag(display)?;
        let id = TagId(self.sources.id()?);
        let now = self.sources.now()?;
        self.conn.prepare_cached("INSERT INTO tags(id,display_name,normalized_name,kind,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)")?.execute(params![id.to_string(),display,normalized,TagKind::User.sql(),now])?;
        self.repository().tag(id)
    }
    pub fn set_tag_binding(&mut self, target: TagTarget, tag: TagId, bound: bool) -> Result<bool> {
        self.repository().tag(tag)?;
        let (insert, delete, id) = match target {
            TagTarget::Document(id) => {
                self.repository().document(id)?;
                (
                    "INSERT INTO document_tags(document_id,tag_id,created_at) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",
                    "DELETE FROM document_tags WHERE document_id=?1 AND tag_id=?2",
                    id.to_string(),
                )
            }
            TagTarget::Annotation(id) => {
                if self.repository().annotation(id)?.deleted_at.is_some() {
                    return Err(invalid());
                }
                (
                    "INSERT INTO annotation_tags(annotation_id,tag_id,created_at) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING",
                    "DELETE FROM annotation_tags WHERE annotation_id=?1 AND tag_id=?2",
                    id.to_string(),
                )
            }
        };
        let count = if bound {
            self.conn.prepare_cached(insert)?.execute(params![
                id,
                tag.to_string(),
                self.sources.now()?
            ])?
        } else {
            self.conn
                .prepare_cached(delete)?
                .execute(params![id, tag.to_string()])?
        };
        Ok(count != 0)
    }
    pub fn compare_set_app_state(
        &mut self,
        scope: String,
        key: String,
        expected: Option<Millis>,
        value: serde_json::Value,
    ) -> Result<AppState> {
        if scope.trim().is_empty() || key.trim().is_empty() {
            return Err(invalid());
        }
        let old = self.repository().app_state(&scope, &key)?;
        if old.as_ref().map(|s| s.updated_at) != expected {
            return Err(conflict());
        }
        if let Some(old) = &old
            && old.value == value
        {
            return Ok(old.clone());
        }
        let clock = self.sources.now()?;
        let now = if let Some(old) = old {
            clock.max(old.updated_at.0.checked_add(1).ok_or_else(invalid)?)
        } else {
            clock
        };
        self.conn.execute("INSERT INTO app_state(scope,key,value_json,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![scope,key,value.to_string(),now])?;
        Ok(AppState {
            scope,
            key,
            value,
            updated_at: Millis(now),
        })
    }
    pub fn commit_document(&mut self, input: DocumentCommit) -> Result<Document> {
        self.atomic(|tx| tx.commit_document_inner(input))
    }
    fn commit_document_inner(&mut self, input: DocumentCommit) -> Result<Document> {
        if input.model_version != 1 {
            return Err(invalid());
        }
        validate_hash(&input.source_hash)?;
        validate_hash(&input.canonical_hash)?;
        let old = self.repository().document(input.document_id)?;
        if old.revision != input.expected {
            return Err(conflict());
        }
        let next = input.expected.next()?;
        let now = self.sources.now()?;
        let mut seen = std::collections::HashSet::new();
        for change in &input.changes {
            if !seen.insert(change.annotation_id) {
                return Err(invalid());
            }
            let a = self.repository().annotation(change.annotation_id)?;
            if a.document_id != input.document_id
                || a.version != change.expected
                || a.deleted_at.is_some()
            {
                return Err(conflict());
            }
            change.expected.next()?;
            if a.status == AnchorStatus::Document || change.status == AnchorStatus::Document {
                return Err(invalid());
            }
            let anchor = change.anchor.as_ref().ok_or_else(invalid)?;
            anchor.validate()?;
            if change.status == AnchorStatus::Orphaned {
                if change.anchor != a.anchor
                    || change.event.outcome != EventOutcome::Orphaned
                    || change.resolution != Resolution::None
                {
                    return Err(invalid());
                }
            } else if anchor.0["source_hash"].as_str() != Some(&input.source_hash)
                || anchor.0["canonical_hash"].as_str() != Some(&input.canonical_hash)
            {
                return Err(conflict());
            }
            if change.status == AnchorStatus::Attached
                && !matches!(
                    change.event.outcome,
                    EventOutcome::Unchanged | EventOutcome::Shifted | EventOutcome::Recovered
                )
            {
                return Err(invalid());
            }
            // The canonical event method records a matching algorithm. An unchanged
            // fast path uses no matching algorithm; the annotation retains Unchanged.
            let event_method = match change.resolution {
                Resolution::Unchanged => Resolution::None,
                method => method,
            };
            if change.event.old_anchor != a.anchor
                || change.event.new_anchor != change.anchor
                || change.event.method != event_method
            {
                return Err(invalid());
            }
            if (change.status == AnchorStatus::Document) != change.anchor.is_none()
                || change
                    .event
                    .score
                    .is_some_and(|s| !s.is_finite() || !(0.0..=1.0).contains(&s))
            {
                return Err(invalid());
            }
            for a in [&change.event.old_anchor, &change.event.new_anchor]
                .into_iter()
                .flatten()
            {
                a.validate()?;
            }
        }
        let live: std::collections::HashSet<_> = self
            .repository()
            .annotations(input.document_id, Tombstones::Exclude)?
            .into_iter()
            .filter(|a| a.status != AnchorStatus::Document)
            .map(|a| a.id)
            .collect();
        if seen != live {
            return Err(conflict());
        }
        self.conn.execute("UPDATE documents SET source_hash=?1,canonical_text_hash=?2,model_version=?3,revision=?4,updated_at=?5 WHERE id=?6 AND revision=?7",params![input.source_hash,input.canonical_hash,input.model_version,next.checked()?,now,input.document_id.to_string(),input.expected.checked()?])?;
        for change in input.changes {
            let json = change.anchor.map(|a| a.0.to_string());
            self.conn.execute("UPDATE annotations SET anchor_status=?1,anchor_json=?2,last_resolution=?3,last_reanchored_revision=?4,row_version=?5,updated_at=?6 WHERE id=?7 AND row_version=?8",params![change.status.sql(),json,change.resolution.sql(),next.checked()?,change.expected.next()?.checked()?,now,change.annotation_id.to_string(),change.expected.checked()?])?;
            let e = change.event;
            self.conn.execute("INSERT INTO annotation_anchor_events(annotation_id,document_revision,trigger_source,outcome,method,score,old_anchor_json,new_anchor_json,reason_code,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![change.annotation_id.to_string(),next.checked()?,e.source.sql(),e.outcome.sql(),e.method.sql(),e.score,e.old_anchor.map(|a|a.0.to_string()),e.new_anchor.map(|a|a.0.to_string()),e.reason,now])?;
        }
        self.repository().document(input.document_id)
    }
}
impl Transaction<'_> {
    /// Ensure a discovered identity without touching committed hashes/model/revision.
    pub fn ensure_document(&mut self, root: RootId, path: String) -> Result<Document> {
        if let Some(document) = self.repository().document_by_path(root, &path)? {
            return self.set_document_status(document.id, DocumentStatus::Present);
        }
        self.create_document(root, path)
    }
    /// Additive observation for unknown/pre-epoch filesystem modification times.
    pub fn observe_document_optional(
        &mut self,
        id: DocumentId,
        size: u64,
        mtime: Option<Millis>,
        opened: bool,
    ) -> Result<Document> {
        self.repository().document(id)?;
        let size = i64::try_from(size).map_err(|_| invalid())?;
        let mtime = mtime.map(Millis::checked).transpose()?;
        let now = self.sources.now()?;
        self.conn.execute("UPDATE documents SET size_bytes=?1,mtime_ms=?2,last_seen_at=?3,last_opened_at=CASE WHEN ?4 THEN ?3 ELSE last_opened_at END,updated_at=?3 WHERE id=?5",params![size,mtime,now,opened,id.to_string()])?;
        self.repository().document(id)
    }
}
