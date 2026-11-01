//! N02 frozen workspace command DTOs; source paths never grant frontend filesystem access.
use super::{CommandContract, CommandDescriptor};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ListWorkspacesRequest {
    #[serde(default)]
    #[ts(optional)]
    pub cursor: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub limit: Option<u32>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CreateWorkspaceRequest {
    pub name: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct AddWorkspaceRootRequest {
    pub workspace_id: String,
    pub selected_path: String,
    #[serde(default)]
    #[ts(optional)]
    pub ext_filter: Option<Vec<String>>,
    #[serde(default)]
    #[ts(optional)]
    pub ignore_rules: Option<Vec<String>>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DetachWorkspaceRootRequest {
    pub root_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ListDirectoryRequest {
    pub root_id: String,
    pub rel_dir: String,
    #[serde(default)]
    #[ts(optional)]
    pub cursor: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub limit: Option<u32>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct OpenDocumentRequest {
    pub document_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ResolveLocalDocumentLinkRequest {
    pub source_document_id: String,
    pub href: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ReadWorkspaceAssetRequest {
    pub source_document_id: String,
    pub href: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ListRecentDocumentsRequest {
    pub workspace_id: String,
    #[serde(default)]
    #[ts(optional)]
    pub cursor: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub limit: Option<u32>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RootDto {
    pub id: String,
    pub workspace_id: String,
    pub display_path: String,
    pub status: String,
    pub ext_filter: Vec<String>,
    pub ignore_rules: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRow {
    pub workspace: WorkspaceDto,
    pub root: Option<RootDto>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePage {
    pub entries: Vec<WorkspaceRow>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub rel_path: String,
    pub kind: DirectoryEntryKind,
    pub document_id: Option<String>,
    pub unavailable: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage {
    pub entries: Vec<DirectoryEntry>,
    pub next_cursor: Option<String>,
    pub truncated: bool,
    pub visible_count: u32,
    pub unsupported_name_count: u32,
    pub large_directory: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDto {
    pub id: String,
    pub root_id: String,
    pub rel_path: String,
    pub status: String,
    pub revision: String,
    pub size_bytes: Option<String>,
    pub mtime_ms: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocumentResponse {
    pub document: DocumentDto,
    pub source: String,
    pub observed_source_hash: String,
    pub committed_source_hash: Option<String>,
    pub committed_canonical_hash: Option<String>,
    pub committed_model_version: Option<u32>,
    pub revision: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDocumentLink {
    pub document: DocumentDto,
    pub fragment: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecentDocumentsPage {
    pub documents: Vec<DocumentDto>,
    pub next_cursor: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryEntryKind {
    Directory,
    MarkdownFile,
    OtherFile,
    Symlink,
}
/// Type-level binary transport marker; native success is raw bytes, never this JSON value.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[ts(rename = "ArrayBuffer")]
pub struct BinaryAsset;
pub struct ListWorkspaces;
impl CommandContract for ListWorkspaces {
    const NAME: &'static str = "list_workspaces";
    type Request = ListWorkspacesRequest;
    type Response = WorkspacePage;
}
pub struct CreateWorkspace;
impl CommandContract for CreateWorkspace {
    const NAME: &'static str = "create_workspace";
    type Request = CreateWorkspaceRequest;
    type Response = WorkspaceDto;
}
pub struct AddWorkspaceRoot;
impl CommandContract for AddWorkspaceRoot {
    const NAME: &'static str = "add_workspace_root";
    type Request = AddWorkspaceRootRequest;
    type Response = RootDto;
}
pub struct DetachWorkspaceRoot;
impl CommandContract for DetachWorkspaceRoot {
    const NAME: &'static str = "detach_workspace_root";
    type Request = DetachWorkspaceRootRequest;
    type Response = RootDto;
}
pub struct ListDirectory;
impl CommandContract for ListDirectory {
    const NAME: &'static str = "list_directory";
    type Request = ListDirectoryRequest;
    type Response = DirectoryPage;
}
pub struct OpenDocument;
impl CommandContract for OpenDocument {
    const NAME: &'static str = "open_document";
    type Request = OpenDocumentRequest;
    type Response = OpenDocumentResponse;
}
pub struct ResolveLocalDocumentLink;
impl CommandContract for ResolveLocalDocumentLink {
    const NAME: &'static str = "resolve_local_document_link";
    type Request = ResolveLocalDocumentLinkRequest;
    type Response = ResolvedDocumentLink;
}
pub struct ReadWorkspaceAsset;
impl CommandContract for ReadWorkspaceAsset {
    const NAME: &'static str = "read_workspace_asset";
    type Request = ReadWorkspaceAssetRequest;
    type Response = BinaryAsset;
    const TRANSPORT: &'static str = "binary";
}
pub struct ListRecentDocuments;
impl CommandContract for ListRecentDocuments {
    const NAME: &'static str = "list_recent_documents";
    type Request = ListRecentDocumentsRequest;
    type Response = RecentDocumentsPage;
}
#[must_use]
pub fn workspace_command_descriptors(config: &ts_rs::Config) -> Vec<CommandDescriptor> {
    vec![
        ListWorkspaces::descriptor(config),
        CreateWorkspace::descriptor(config),
        AddWorkspaceRoot::descriptor(config),
        DetachWorkspaceRoot::descriptor(config),
        ListDirectory::descriptor(config),
        OpenDocument::descriptor(config),
        ResolveLocalDocumentLink::descriptor(config),
        ReadWorkspaceAsset::descriptor(config),
        ListRecentDocuments::descriptor(config),
    ]
}
#[must_use]
pub fn workspace_declarations(config: &ts_rs::Config) -> Vec<String> {
    vec![
        ListWorkspacesRequest::decl(config),
        CreateWorkspaceRequest::decl(config),
        AddWorkspaceRootRequest::decl(config),
        DetachWorkspaceRootRequest::decl(config),
        ListDirectoryRequest::decl(config),
        OpenDocumentRequest::decl(config),
        ResolveLocalDocumentLinkRequest::decl(config),
        ReadWorkspaceAssetRequest::decl(config),
        ListRecentDocumentsRequest::decl(config),
        WorkspaceDto::decl(config),
        RootDto::decl(config),
        WorkspaceRow::decl(config),
        WorkspacePage::decl(config),
        DirectoryEntry::decl(config),
        DirectoryPage::decl(config),
        DocumentDto::decl(config),
        OpenDocumentResponse::decl(config),
        ResolvedDocumentLink::decl(config),
        RecentDocumentsPage::decl(config),
        DirectoryEntryKind::decl(config),
    ]
}
