use super::*;
use crate::path_guard::{Guard, Stamp};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use flowshot_db::{
    DbRuntime, Document, DocumentId, Millis, NewRoot, Root, RootId, RootStatus, WorkspaceId,
};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use rustix::fs::FileType;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BinaryHeap,
    path::{Path, PathBuf},
    sync::Mutex,
};
static ROOT_ADMISSION: Mutex<()> = Mutex::new(());
pub struct WorkspaceService<'a> {
    db: &'a DbRuntime,
}
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    Sha256::digest(bytes)
        .iter()
        .fold(String::new(), |mut out, b| {
            let _ = write!(out, "{b:02x}");
            out
        })
}
fn limit(value: Option<u32>) -> Result<u32> {
    let value = value.unwrap_or(500);
    if value == 0 || value > 1000 {
        Err(error(AppErrorCode::ValidationError, false))
    } else {
        Ok(value)
    }
}
fn encode<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_vec(value)
        .map(|b| URL_SAFE_NO_PAD.encode(b))
        .map_err(|_| error(AppErrorCode::Internal, false))
}
fn decode<T: serde::de::DeserializeOwned>(value: &str) -> Result<T> {
    if value.len() > 8192 {
        return Err(error(AppErrorCode::ValidationError, false));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| error(AppErrorCode::ValidationError, false))?;
    serde_json::from_slice(&bytes).map_err(|_| error(AppErrorCode::ValidationError, false))
}
fn strings(value: &serde_json::Value) -> Result<Vec<String>> {
    serde_json::from_value(value.clone()).map_err(|_| error(AppErrorCode::ValidationError, false))
}
fn root_dto(root: Root) -> Result<RootDto> {
    Ok(RootDto {
        id: root.id.to_string(),
        workspace_id: root.workspace_id.to_string(),
        display_path: root.abs_path,
        status: match root.status {
            RootStatus::Active => "active",
            RootStatus::Detached => "detached",
        }
        .into(),
        ext_filter: strings(&root.ext_filter)?,
        ignore_rules: strings(&root.ignore_rules)?,
    })
}
fn document_dto(document: &Document) -> DocumentDto {
    DocumentDto {
        id: document.id.to_string(),
        root_id: document.root_id.to_string(),
        rel_path: document.rel_path.clone(),
        status: match document.status {
            flowshot_db::DocumentStatus::Present => "present",
            flowshot_db::DocumentStatus::Missing => "missing",
        }
        .into(),
        revision: document.revision.0.to_string(),
        size_bytes: document.size_bytes.map(|v| v.to_string()),
        mtime_ms: document.mtime.map(|v| v.0.to_string()),
    }
}
fn prune_companion(line: &str) -> Option<String> {
    if line.starts_with(['!', '#']) {
        return None;
    }
    let prefix = line.strip_suffix("/**")?;
    if prefix.bytes().rev().take_while(|b| *b == b'\\').count() % 2 != 0 {
        return None;
    }
    Some(if prefix.contains('/') {
        format!("{prefix}/")
    } else {
        format!("/{prefix}/")
    })
}
struct Policy {
    matcher: Gitignore,
    root: PathBuf,
    extensions: Vec<String>,
    hash: String,
}
impl Policy {
    fn new(root: &Root) -> Result<Self> {
        let rules = strings(&root.ignore_rules)?;
        let mut builder = GitignoreBuilder::new(&root.canonical_path);
        for line in &rules {
            builder
                .add_line(None, line)
                .map_err(|_| error(AppErrorCode::ValidationError, false))?;
            if let Some(companion) = prune_companion(line) {
                builder
                    .add_line(None, &companion)
                    .map_err(|_| error(AppErrorCode::ValidationError, false))?;
            }
        }
        let matcher = builder
            .build()
            .map_err(|_| error(AppErrorCode::ValidationError, false))?;
        Ok(Self {
            matcher,
            root: PathBuf::from(&root.canonical_path),
            extensions: strings(&root.ext_filter)?,
            hash: hex(format!("{}\0{}", root.ext_filter, root.ignore_rules).as_bytes()),
        })
    }
    fn admit(&self, path: &str, directory: bool) -> bool {
        if path.is_empty() {
            return directory;
        }
        let mut prefix = PathBuf::new();
        let components: Vec<_> = path.split('/').collect();
        for (i, component) in components.iter().enumerate() {
            if matches!(
                *component,
                ".git" | "node_modules" | "target" | "dist" | ".DS_Store"
            ) {
                return false;
            }
            prefix.push(component);
            let dir = i + 1 < components.len() || directory;
            if self
                .matcher
                .matched(self.root.join(&prefix), dir)
                .is_ignore()
            {
                return false;
            }
        }
        true
    }
    fn markdown(&self, path: &str) -> bool {
        Path::new(path)
            .extension()
            .and_then(|x| x.to_str())
            .is_some_and(|ext| {
                self.extensions
                    .iter()
                    .any(|allowed| allowed.trim_start_matches('.').eq_ignore_ascii_case(ext))
            })
    }
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
struct OrderKey {
    rank: u8,
    name: String,
    path: String,
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Selected {
    key: OrderKey,
    kind: u8,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectoryCursor {
    version: u8,
    root: String,
    path: String,
    policy: String,
    stamp: Stamp,
    last: OrderKey,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceCursor {
    version: u8,
    workspace: String,
    root: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecentCursor {
    version: u8,
    workspace: String,
    time: String,
    id: String,
}
// Owned requests are intentional at the blocking IPC boundary.
#[allow(clippy::needless_pass_by_value)]
impl<'a> WorkspaceService<'a> {
    pub fn new(db: &'a DbRuntime) -> Self {
        Self { db }
    }
    fn active_root(&self, id: RootId) -> Result<Root> {
        let root = self.db.read(|r| r.root(id)).map_err(db_error)?;
        if root.status != RootStatus::Active {
            return Err(error(AppErrorCode::NotFound, false));
        }
        Ok(root)
    }
    fn context(&self, id: &str) -> Result<(Document, Root, Policy, Guard)> {
        let id = DocumentId::parse(id).map_err(db_error)?;
        let document = self.db.read(|r| r.document(id)).map_err(db_error)?;
        let root = self.active_root(document.root_id)?;
        let policy = Policy::new(&root)?;
        if !policy.admit(&document.rel_path, false) || !policy.markdown(&document.rel_path) {
            return Err(error(AppErrorCode::NotFound, false));
        }
        let guard = Guard::open(Path::new(&root.canonical_path))?;
        Ok((document, root, policy, guard))
    }
    pub fn create_workspace(&self, request: CreateWorkspaceRequest) -> Result<WorkspaceDto> {
        if request.name.len() > 256 {
            return Err(error(AppErrorCode::ValidationError, false));
        }
        let record = self
            .db
            .transaction(move |tx| tx.create_workspace(request.name))
            .map_err(db_error)?;
        Ok(WorkspaceDto {
            id: record.id.to_string(),
            name: record.name,
        })
    }
    pub fn list_workspaces(&self, request: ListWorkspacesRequest) -> Result<WorkspacePage> {
        let limit = limit(request.limit)?;
        let after = request
            .cursor
            .map(|s| decode::<WorkspaceCursor>(&s))
            .transpose()?
            .map(|c| {
                if c.version != 1 {
                    return Err(error(AppErrorCode::ValidationError, false));
                }
                Ok((
                    WorkspaceId::parse(&c.workspace).map_err(db_error)?,
                    c.root
                        .map(|r| RootId::parse(&r).map_err(db_error))
                        .transpose()?,
                ))
            })
            .transpose()?;
        let mut rows = self
            .db
            .read(|r| r.workspace_page(after, limit + 1))
            .map_err(db_error)?;
        let more = rows.len() > limit as usize;
        if more {
            rows.pop();
        }
        let cursor = if more {
            rows.last()
                .map(|r| {
                    encode(&WorkspaceCursor {
                        version: 1,
                        workspace: r.workspace.id.to_string(),
                        root: r.root.as_ref().map(|r| r.id.to_string()),
                    })
                })
                .transpose()?
        } else {
            None
        };
        let entries = rows
            .into_iter()
            .map(|row| {
                Ok(WorkspaceRow {
                    workspace: WorkspaceDto {
                        id: row.workspace.id.to_string(),
                        name: row.workspace.name,
                    },
                    root: row.root.map(root_dto).transpose()?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(WorkspacePage {
            entries,
            next_cursor: cursor,
        })
    }
    pub fn add_root(&self, request: AddWorkspaceRootRequest) -> Result<RootDto> {
        self.add_root_inner(request, || {})
    }
    #[allow(clippy::too_many_lines)] // Keep the full atomic admission boundary together.
    fn add_root_inner(
        &self,
        request: AddWorkspaceRootRequest,
        before_commit: impl FnOnce() + Send + 'static,
    ) -> Result<RootDto> {
        let _admission = ROOT_ADMISSION
            .lock()
            .map_err(|_| error(AppErrorCode::Internal, false))?;
        let workspace = WorkspaceId::parse(&request.workspace_id).map_err(db_error)?;
        if request.selected_path.len() > 4096 {
            return Err(error(AppErrorCode::ValidationError, false));
        }
        let canonical = std::fs::canonicalize(&request.selected_path)
            .map_err(|_| error(AppErrorCode::NotFound, false))?;
        let canonical = canonical
            .to_str()
            .ok_or_else(|| error(AppErrorCode::ValidationError, false))?
            .to_owned();
        let guard = Guard::open(Path::new(&canonical))?;
        let identity = guard.identity();
        let ancestors = guard.ancestor_identities()?;
        let explicit_extensions = request.ext_filter.is_some();
        let explicit_rules = request.ignore_rules.is_some();
        let extensions = request
            .ext_filter
            .unwrap_or_else(|| vec!["md".into(), "markdown".into(), "mdx".into()]);
        let rules = request.ignore_rules.unwrap_or_default();
        if extensions.is_empty()
            || extensions.len() > 64
            || extensions.iter().any(|x| {
                x.len() > 32
                    || x.trim_start_matches('.').is_empty()
                    || x.contains(['/', '\\', '\0'])
            })
            || rules.len() > 1000
            || rules.iter().any(|x| x.len() > 1024)
        {
            return Err(error(AppErrorCode::ValidationError, false));
        }
        let input = NewRoot {
            workspace_id: workspace,
            abs_path: request.selected_path,
            canonical_path: canonical.clone(),
            ext_filter: serde_json::json!(extensions),
            ignore_rules: serde_json::json!(rules),
        };
        let sample = Root {
            id: RootId(uuid::Uuid::now_v7()),
            workspace_id: workspace,
            abs_path: input.abs_path.clone(),
            canonical_path: canonical.clone(),
            status: RootStatus::Active,
            ext_filter: input.ext_filter.clone(),
            ignore_rules: input.ignore_rules.clone(),
            created_at: Millis(0),
            updated_at: Millis(0),
        };
        Policy::new(&sample)?;
        let result = self
            .db
            .transaction(move |tx| {
                tx.repository().workspace(workspace)?;
                let mut after = None;
                let mut reattach = None;
                loop {
                    let rows = tx.repository().roots_page(workspace, after, 1000)?;
                    let count = rows.len();
                    for root in rows {
                        after = Some(root.id);
                        if root.status == RootStatus::Detached {
                            let same_root = root.canonical_path == canonical
                                || Guard::open(Path::new(&root.canonical_path))
                                    .is_ok_and(|stored| stored.identity() == identity);
                            if same_root {
                                if (explicit_extensions && root.ext_filter != input.ext_filter)
                                    || (explicit_rules && root.ignore_rules != input.ignore_rules)
                                {
                                    return Err(DbError::new(ErrorCode::Validation));
                                }
                                reattach = Some(root.id);
                            }
                            continue;
                        }
                        let path = Path::new(&root.canonical_path);
                        if path.starts_with(&canonical) || Path::new(&canonical).starts_with(path) {
                            return Err(DbError::new(ErrorCode::Validation));
                        }
                        if let Ok(existing) = Guard::open(path)
                            && (ancestors.contains(&existing.identity())
                                || existing
                                    .ancestor_identities()
                                    .map_err(|_| DbError::new(ErrorCode::Validation))?
                                    .contains(&identity))
                        {
                            return Err(DbError::new(ErrorCode::Validation));
                        }
                    }
                    if count < 1000 {
                        break;
                    }
                }
                let record = if let Some(id) = reattach {
                    tx.set_root_status(id, RootStatus::Active)
                } else {
                    tx.create_root(input)
                }?;
                before_commit();
                guard
                    .revalidate()
                    .map_err(|_| DbError::new(ErrorCode::Conflict))?;
                Ok(record)
            })
            .map_err(db_error)?;
        root_dto(result)
    }
    pub fn detach_root(&self, request: DetachWorkspaceRootRequest) -> Result<RootDto> {
        let id = RootId::parse(&request.root_id).map_err(db_error)?;
        let record = self
            .db
            .transaction(move |tx| tx.set_root_status(id, RootStatus::Detached))
            .map_err(db_error)?;
        root_dto(record)
    }
    pub fn list_directory(&self, request: ListDirectoryRequest) -> Result<DirectoryPage> {
        self.list_directory_inner(request, || {})
    }
    #[allow(clippy::too_many_lines)] // Validation, bounded scan and identity commit form one operation.
    fn list_directory_inner(
        &self,
        request: ListDirectoryRequest,
        before_scan: impl FnOnce(),
    ) -> Result<DirectoryPage> {
        direct_components(&request.rel_dir, true).map_err(|c| error(c, false))?;
        let id = RootId::parse(&request.root_id).map_err(db_error)?;
        let root = self.active_root(id)?;
        let policy = Policy::new(&root)?;
        if !policy.admit(&request.rel_dir, true) {
            return Err(error(AppErrorCode::NotFound, false));
        }
        let guard = Guard::open(Path::new(&root.canonical_path))?;
        let stamp = guard.stamp_directory(&request.rel_dir)?;
        let limit = limit(request.limit)?;
        let cursor = request
            .cursor
            .map(|s| decode::<DirectoryCursor>(&s))
            .transpose()?;
        if let Some(c) = &cursor
            && (c.version != 1
                || c.root != request.root_id
                || c.path != request.rel_dir
                || c.policy != policy.hash
                || c.stamp != stamp
                || c.last.rank > 1
                || direct_components(&c.last.name, false).is_err()
                || c.last.name.contains('/')
                || c.last.path
                    != if request.rel_dir.is_empty() {
                        c.last.name.clone()
                    } else {
                        format!("{}/{}", request.rel_dir, c.last.name)
                    })
        {
            return Err(error(AppErrorCode::Conflict, true));
        }

        let mut selected = BinaryHeap::<Selected>::new();
        let mut visible = 0_u32;
        let keep = limit as usize + 1;
        before_scan();
        let (scanned_stamp, unsupported) = guard.entries(&request.rel_dir, |name, kind| {
            let path = if request.rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", request.rel_dir, name)
            };
            let directory = kind == FileType::Directory;
            if !policy.admit(&path, directory) {
                return Ok(());
            }
            visible = visible.saturating_add(1);
            let kind = match kind {
                FileType::Directory => 0,
                FileType::RegularFile if policy.markdown(&path) => 1,
                FileType::Symlink => 3,
                _ => 2,
            };
            let key = OrderKey {
                rank: u8::from(!directory),
                name,
                path,
            };
            if cursor.as_ref().is_some_and(|c| key <= c.last) {
                return Ok(());
            }
            let candidate = Selected { key, kind };
            if selected.len() < keep {
                selected.push(candidate);
            } else if let Some(mut largest) = selected.peek_mut()
                && candidate < *largest
            {
                *largest = candidate;
            }
            crate::path_guard::retained_entries(selected.len());
            Ok(())
        })?;
        if scanned_stamp != stamp {
            return Err(error(AppErrorCode::Conflict, true));
        }
        let mut selected = selected.into_sorted_vec();
        let more = selected.len() > limit as usize;
        if more {
            selected.pop();
        }
        let next_cursor = if more {
            selected
                .last()
                .map(|entry| {
                    encode(&DirectoryCursor {
                        version: 1,
                        root: request.root_id,
                        path: request.rel_dir,
                        policy: policy.hash.clone(),
                        stamp,
                        last: entry.key.clone(),
                    })
                })
                .transpose()?
        } else {
            None
        };
        let entries = self
            .db
            .transaction(move |tx| {
                let current = tx.repository().root(id)?;
                if current.status != RootStatus::Active
                    || current.ext_filter != root.ext_filter
                    || current.ignore_rules != root.ignore_rules
                {
                    return Err(DbError::new(ErrorCode::Conflict));
                }
                selected
                    .into_iter()
                    .map(|entry| {
                        let doc = if entry.kind == 1 {
                            Some(
                                tx.ensure_document(id, entry.key.path.clone())?
                                    .id
                                    .to_string(),
                            )
                        } else {
                            None
                        };
                        Ok(DirectoryEntry {
                            name: entry.key.name,
                            rel_path: entry.key.path,
                            kind: match entry.kind {
                                0 => DirectoryEntryKind::Directory,
                                1 => DirectoryEntryKind::MarkdownFile,
                                3 => DirectoryEntryKind::Symlink,
                                _ => DirectoryEntryKind::OtherFile,
                            },
                            document_id: doc,
                            unavailable: entry.kind >= 2,
                        })
                    })
                    .collect::<flowshot_db::Result<Vec<_>>>()
            })
            .map_err(db_error)?;
        Ok(DirectoryPage {
            entries,
            next_cursor,
            truncated: more,
            visible_count: visible,
            unsupported_name_count: unsupported,
            large_directory: visible > 2000,
        })
    }
    pub fn open_document(&self, request: OpenDocumentRequest) -> Result<OpenDocumentResponse> {
        let (document, root, _, guard) = self.context(&request.document_id)?;
        let read = match guard.read(
            &document.rel_path,
            20 * 1024 * 1024,
            AppErrorCode::DocumentTooLarge,
        ) {
            Ok(read) => read,
            Err(e) => {
                if e.code == AppErrorCode::NotFound {
                    let id = document.id;
                    self.db
                        .transaction(move |tx| {
                            tx.set_document_status(id, flowshot_db::DocumentStatus::Missing)
                        })
                        .map_err(db_error)?;
                }
                return Err(e);
            }
        };
        let observed = hex(&read.bytes);
        let source = String::from_utf8(read.bytes)
            .map_err(|_| error(AppErrorCode::UnsupportedEncoding, false))?;
        let id = document.id;
        let record = self
            .db
            .transaction(move |tx| {
                if tx.repository().root(root.id)?.status != RootStatus::Active {
                    return Err(DbError::new(ErrorCode::Conflict));
                }
                tx.set_document_status(id, flowshot_db::DocumentStatus::Present)?;
                tx.observe_document_optional(id, read.stamp.size, read.stamp.millis(), true)
            })
            .map_err(db_error)?;
        Ok(OpenDocumentResponse {
            document: document_dto(&record),
            source,
            observed_source_hash: observed,
            committed_source_hash: record.source_hash,
            committed_canonical_hash: record.canonical_hash,
            committed_model_version: record.model_version,
            revision: record.revision.0.to_string(),
        })
    }
    pub fn resolve_link(
        &self,
        request: ResolveLocalDocumentLinkRequest,
    ) -> Result<ResolvedDocumentLink> {
        let (source, root, policy, guard) = self.context(&request.source_document_id)?;
        let (path, fragment) =
            resolve_href(&source.rel_path, &request.href).map_err(|c| error(c, false))?;
        if !policy.admit(&path, false) || !policy.markdown(&path) {
            return Err(error(AppErrorCode::NotFound, false));
        }
        guard.regular_file(&path)?;
        let id = root.id;
        let document = self
            .db
            .transaction(move |tx| {
                if tx.repository().root(id)?.status != RootStatus::Active {
                    return Err(DbError::new(ErrorCode::Conflict));
                }
                tx.ensure_document(id, path)
            })
            .map_err(db_error)?;
        Ok(ResolvedDocumentLink {
            document: document_dto(&document),
            fragment,
        })
    }
    pub fn read_asset(&self, request: ReadWorkspaceAssetRequest) -> Result<Vec<u8>> {
        let (source, root, policy, guard) = self.context(&request.source_document_id)?;
        let (path, _) =
            resolve_href(&source.rel_path, &request.href).map_err(|c| error(c, false))?;
        if !policy.admit(&path, false) {
            return Err(error(AppErrorCode::NotFound, false));
        }
        let read = guard.read(&path, 10 * 1024 * 1024, AppErrorCode::AssetTooLarge)?;
        if image_mime(&read.bytes).is_none() {
            return Err(error(AppErrorCode::UnsupportedMediaType, false));
        }
        self.active_root(root.id)?;
        Ok(read.bytes)
    }
    pub fn recent_documents(
        &self,
        request: ListRecentDocumentsRequest,
    ) -> Result<RecentDocumentsPage> {
        let workspace = WorkspaceId::parse(&request.workspace_id).map_err(db_error)?;
        let limit = limit(request.limit)?;
        let after = request
            .cursor
            .map(|s| decode::<RecentCursor>(&s))
            .transpose()?
            .map(|c| {
                if c.version != 1 || c.workspace != request.workspace_id {
                    return Err(error(AppErrorCode::Conflict, true));
                }
                let time = c
                    .time
                    .parse::<i64>()
                    .ok()
                    .filter(|v| *v >= 0)
                    .ok_or_else(|| error(AppErrorCode::ValidationError, false))?;
                Ok((Millis(time), DocumentId::parse(&c.id).map_err(db_error)?))
            })
            .transpose()?;
        let mut records = self
            .db
            .read(|r| r.recent_documents(workspace, after, limit + 1))
            .map_err(db_error)?;
        let more = records.len() > limit as usize;
        if more {
            records.pop();
        }
        let next_cursor = if more {
            records
                .last()
                .map(|d| {
                    encode(&RecentCursor {
                        version: 1,
                        workspace: request.workspace_id,
                        time: d.last_opened_at.map_or(0, |t| t.0).to_string(),
                        id: d.id.to_string(),
                    })
                })
                .transpose()?
        } else {
            None
        };
        Ok(RecentDocumentsPage {
            documents: records.iter().map(document_dto).collect(),
            next_cursor,
        })
    }
}
pub fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pinned_ignore_terminal_subtree_semantics() {
        let mut builder = GitignoreBuilder::new("/synthetic");
        builder.add_line(None, "drafts/**").unwrap();
        let matcher = builder.build().unwrap();
        let directory = matcher.matched("/synthetic/drafts", true).is_ignore();
        let child = matcher
            .matched("/synthetic/drafts/private.md", false)
            .is_ignore();
        eprintln!("ignore0.4.33 drafts/**: directory={directory}, child={child}");
        assert!(child);
        assert!(!directory);
    }
}

#[cfg(test)]
mod policy_tests {
    use super::*;
    fn policy(rules: &[&str]) -> Policy {
        Policy::new(&Root {
            id: RootId(uuid::Uuid::now_v7()),
            workspace_id: WorkspaceId(uuid::Uuid::now_v7()),
            abs_path: "/synthetic".into(),
            canonical_path: "/synthetic".into(),
            status: RootStatus::Active,
            ext_filter: serde_json::json!(["md"]),
            ignore_rules: serde_json::json!(rules),
            created_at: Millis(0),
            updated_at: Millis(0),
        })
        .unwrap()
    }
    #[test]
    fn terminal_subtrees_prune_and_ordered_parent_negation_is_explicit() {
        let p = policy(&["drafts/**", "!drafts/keep.md", "nested/drafts/**"]);
        assert!(!p.admit("drafts", true));
        assert!(!p.admit("drafts/keep.md", false));
        assert!(!p.admit("nested/drafts", true));
        assert!(p.admit("other/drafts", true));
        assert!(p.admit("drafts-other", true));
        let p = policy(&["drafts/**", "!drafts/", "!drafts/keep.md"]);
        assert!(p.admit("drafts", true));
        assert!(p.admit("drafts/keep.md", false));
        assert!(!p.admit("drafts/private.md", false));
        assert!(prune_companion(r"literal/\*\*").is_none());
        assert!(prune_companion(r"literal\/**").is_none());
    }
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("admit-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir(&path).unwrap();
        path
    }
    fn request(workspace: &WorkspaceDto, path: &Path) -> AddWorkspaceRootRequest {
        AddWorkspaceRootRequest {
            workspace_id: workspace.id.clone(),
            selected_path: path.display().to_string(),
            ext_filter: None,
            ignore_rules: None,
        }
    }
    #[test]
    fn reattachment_preserves_omitted_or_equal_policy_and_rejects_changes() {
        let root = directory();
        let state = directory();
        let db = DbRuntime::open(&state.join("db.sqlite3")).unwrap();
        let service = WorkspaceService::new(&db);
        let workspace = service
            .create_workspace(CreateWorkspaceRequest {
                name: "policy".into(),
            })
            .unwrap();
        let mut initial = request(&workspace, &root);
        initial.ext_filter = Some(vec!["md".into()]);
        initial.ignore_rules = Some(vec!["private/**".into()]);
        let record = service.add_root(initial.clone()).unwrap();
        service
            .detach_root(DetachWorkspaceRootRequest {
                root_id: record.id.clone(),
            })
            .unwrap();
        for (extensions, rules) in [
            (Some(vec!["markdown".into()]), None),
            (None, Some(vec!["private/**".into(), "secret/**".into()])),
        ] {
            let mut changed = request(&workspace, &root);
            changed.ext_filter = extensions;
            changed.ignore_rules = rules;
            assert!(
                service.add_root(changed).is_err(),
                "explicit differing policy must reject"
            );
            assert_eq!(
                db.read(|r| r.root(RootId::parse(&record.id).unwrap()))
                    .unwrap()
                    .status,
                RootStatus::Detached
            );
        }
        let equal = service.add_root(initial).unwrap();
        assert_eq!(equal.id, record.id);
        service
            .detach_root(DetachWorkspaceRootRequest {
                root_id: record.id.clone(),
            })
            .unwrap();
        let omitted = service.add_root(request(&workspace, &root)).unwrap();
        assert_eq!(omitted.id, record.id);
        assert_eq!(omitted.ext_filter, vec!["md"]);
        assert_eq!(omitted.ignore_rules, vec!["private/**"]);
    }
    #[test]
    fn root_admission_race_never_commits_new_active_root() {
        let root = directory();
        let state = directory();
        let db = DbRuntime::open(&state.join("db.sqlite3")).unwrap();
        let service = WorkspaceService::new(&db);
        let workspace = service
            .create_workspace(CreateWorkspaceRequest {
                name: "race".into(),
            })
            .unwrap();
        let swap = root.clone();
        assert!(
            service
                .add_root_inner(request(&workspace, &root), move || {
                    std::fs::rename(&swap, swap.with_extension("held")).unwrap();
                    std::fs::create_dir(&swap).unwrap();
                })
                .is_err()
        );
        assert!(
            db.read(|r| r.roots_page(WorkspaceId::parse(&workspace.id).unwrap(), None, 10))
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn root_admission_race_never_reactivates_detached_root() {
        let root = directory();
        let state = directory();
        let db = DbRuntime::open(&state.join("db.sqlite3")).unwrap();
        let service = WorkspaceService::new(&db);
        let workspace = service
            .create_workspace(CreateWorkspaceRequest {
                name: "race".into(),
            })
            .unwrap();
        let record = service.add_root(request(&workspace, &root)).unwrap();
        service
            .detach_root(DetachWorkspaceRootRequest {
                root_id: record.id.clone(),
            })
            .unwrap();
        let swap = root.clone();
        assert!(
            service
                .add_root_inner(request(&workspace, &root), move || {
                    std::fs::rename(&swap, swap.with_extension("held")).unwrap();
                    std::fs::create_dir(&swap).unwrap();
                })
                .is_err()
        );
        assert_eq!(
            db.read(|r| r.root(RootId::parse(&record.id).unwrap()))
                .unwrap()
                .status,
            RootStatus::Detached
        );
    }
}

#[cfg(test)]
mod cursor_race_tests {
    use super::*;
    #[test]
    fn directory_mutation_between_validation_and_scan_rejects_page() {
        let root = std::env::temp_dir().join(format!("cursor-race-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("before.md"), "before").unwrap();
        let db = DbRuntime::open(Path::new(":memory:")).unwrap();
        let service = WorkspaceService::new(&db);
        let workspace = service
            .create_workspace(CreateWorkspaceRequest {
                name: "race".into(),
            })
            .unwrap();
        let record = service
            .add_root(AddWorkspaceRootRequest {
                workspace_id: workspace.id,
                selected_path: root.display().to_string(),
                ext_filter: None,
                ignore_rules: None,
            })
            .unwrap();
        let swap = root.clone();
        let result = service.list_directory_inner(
            ListDirectoryRequest {
                root_id: record.id.clone(),
                rel_dir: String::new(),
                cursor: None,
                limit: Some(1),
            },
            move || {
                std::fs::write(swap.join("after.md"), "after").unwrap();
            },
        );
        assert_eq!(result.unwrap_err().code, AppErrorCode::Conflict);
        assert!(
            db.read(|r| r.document_by_path(RootId::parse(&record.id).unwrap(), "before.md"))
                .unwrap()
                .is_none()
        );
    }
}
