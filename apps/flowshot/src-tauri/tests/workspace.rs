#![allow(clippy::wildcard_imports)]
use flowshot_core::contracts::*;
use flowshot_db::DbRuntime;
use flowshot_tauri::workspace::WorkspaceService;
use std::{fs, path::PathBuf};
fn directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!("n02-{}", uuid::Uuid::now_v7()));
    fs::create_dir(&path).unwrap();
    path
}
fn root(service: &WorkspaceService<'_>, path: &std::path::Path, rules: Vec<String>) -> RootDto {
    let workspace = service
        .create_workspace(CreateWorkspaceRequest {
            name: "synthetic".into(),
        })
        .unwrap();
    service
        .add_root(AddWorkspaceRootRequest {
            workspace_id: workspace.id,
            selected_path: path.to_str().unwrap().into(),
            ext_filter: None,
            ignore_rules: Some(rules),
        })
        .unwrap()
}
#[test]
fn large_workspace_is_lazy_and_fast() {
    let path = directory();
    for n in 0..5000 {
        fs::write(path.join(format!("doc{n:04}.md")), b"synthetic").unwrap();
    }
    fs::create_dir(path.join("not-opened")).unwrap();
    let db = DbRuntime::open(&path.join("state.sqlite3")).unwrap();
    let service = WorkspaceService::new(&db);
    let root = root(&service, &path, vec![]);
    let _ = flowshot_tauri::workspace::take_io_trace();
    let started = std::time::Instant::now();
    let page = service
        .list_directory(ListDirectoryRequest {
            root_id: root.id,
            rel_dir: String::new(),
            cursor: None,
            limit: None,
        })
        .unwrap();
    assert!(started.elapsed().as_millis() < 500);
    assert_eq!(page.entries.len(), 500);
    assert!(page.truncated);
    assert!(page.large_directory);
    assert_eq!(page.entries[0].kind, DirectoryEntryKind::Directory);
    let elapsed = started.elapsed();
    let trace = flowshot_tauri::workspace::take_io_trace();
    assert_eq!(trace.body_reads, 0);
    assert_eq!(trace.child_directory_opens, 0);
    assert!(trace.max_retained_entries <= 501);
    let record = serde_json::json!({"files":5000,"page_size":500,"duration_us":elapsed.as_micros(),"budget_us":500_000,"trace":trace,"profile":"debug","arch":std::env::consts::ARCH,"os":std::env::consts::OS});
    eprintln!("{record}");
    if let Ok(directory) = std::env::var("AGENT_EVIDENCE_DIR") {
        fs::write(
            std::path::Path::new(&directory).join("directory-benchmark.json"),
            format!("{record}\n"),
        )
        .unwrap();
    }
}
#[test]
fn roots_overlap_and_detach_preserve_identity() {
    let path = directory();
    fs::create_dir(path.join("child")).unwrap();
    fs::write(path.join("a.md"), b"note").unwrap();
    let db = DbRuntime::open(&path.join("state.sqlite3")).unwrap();
    let service = WorkspaceService::new(&db);
    let root = root(&service, &path, vec![]);
    assert!(
        service
            .add_root(AddWorkspaceRootRequest {
                workspace_id: root.workspace_id.clone(),
                selected_path: path.join("child").display().to_string(),
                ext_filter: None,
                ignore_rules: None
            })
            .is_err()
    );
    let page = service
        .list_directory(ListDirectoryRequest {
            root_id: root.id.clone(),
            rel_dir: String::new(),
            cursor: None,
            limit: Some(20),
        })
        .unwrap();
    assert!(!page.entries.iter().any(|e| e.name == "drafts"));
    let id = page
        .entries
        .iter()
        .find(|e| e.name == "a.md")
        .unwrap()
        .document_id
        .clone()
        .unwrap();
    service
        .detach_root(DetachWorkspaceRootRequest {
            root_id: root.id.clone(),
        })
        .unwrap();
    assert!(
        service
            .open_document(OpenDocumentRequest {
                document_id: id.clone()
            })
            .is_err()
    );
    let again = service
        .add_root(AddWorkspaceRootRequest {
            workspace_id: root.workspace_id,
            selected_path: path.display().to_string(),
            ext_filter: None,
            ignore_rules: None,
        })
        .unwrap();
    assert_eq!(again.id, root.id);
    assert_eq!(
        service
            .open_document(OpenDocumentRequest {
                document_id: id.clone()
            })
            .unwrap()
            .document
            .id,
        id
    );
}
#[test]
fn source_link_asset_and_ignore_admission() {
    let path = directory();
    fs::create_dir(path.join("drafts")).unwrap();
    fs::write(path.join("drafts/private.md"), b"ignored").unwrap();
    fs::write(path.join("a.md"), b"\xef\xbb\xbfline\r\n").unwrap();
    fs::write(path.join("b.md"), b"target").unwrap();
    fs::write(path.join("image.png"), b"\x89PNG\r\n\x1a\nsynthetic").unwrap();
    fs::write(path.join("bad.svg"), b"<svg/>").unwrap();
    let db = DbRuntime::open(&path.join("state.sqlite3")).unwrap();
    let service = WorkspaceService::new(&db);
    let root = root(&service, &path, vec!["drafts/**".into()]);
    let page = service
        .list_directory(ListDirectoryRequest {
            root_id: root.id.clone(),
            rel_dir: String::new(),
            cursor: None,
            limit: Some(100),
        })
        .unwrap();
    assert!(!page.entries.iter().any(|e| e.name == "drafts"));
    let id = page
        .entries
        .iter()
        .find(|e| e.name == "a.md")
        .unwrap()
        .document_id
        .clone()
        .unwrap();
    let open = service
        .open_document(OpenDocumentRequest {
            document_id: id.clone(),
        })
        .unwrap();
    assert_eq!(open.source, "\u{feff}line\r\n");
    assert_eq!(open.revision, "0");
    assert!(open.committed_source_hash.is_none());
    assert!(
        service
            .resolve_link(ResolveLocalDocumentLinkRequest {
                source_document_id: id.clone(),
                href: "drafts/private.md".into()
            })
            .is_err()
    );
    assert_eq!(
        service
            .resolve_link(ResolveLocalDocumentLinkRequest {
                source_document_id: id.clone(),
                href: "b.md#heading".into()
            })
            .unwrap()
            .fragment
            .as_deref(),
        Some("heading")
    );
    let bytes = service
        .read_asset(ReadWorkspaceAssetRequest {
            source_document_id: id.clone(),
            href: "image.png".into(),
        })
        .unwrap();
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    for href in [
        "bad.svg",
        "data:image/png,x",
        "https://host/image.png",
        "../outside.png",
    ] {
        assert!(
            service
                .read_asset(ReadWorkspaceAssetRequest {
                    source_document_id: id.clone(),
                    href: href.into()
                })
                .is_err()
        );
    }
}
#[test]
fn native_binary_response_is_raw_bytes() {
    use tauri::ipc::{InvokeResponseBody, IpcResponse};
    let bytes = b"\x89PNG\r\n\x1a\nraw".to_vec();
    let response = flowshot_tauri::workspace::binary_asset_response(bytes.clone());
    match response.body().unwrap() {
        InvokeResponseBody::Raw(actual) => assert_eq!(actual, bytes),
        InvokeResponseBody::Json(_) => panic!("asset bytes must not use JSON"),
    }
}
#[test]
fn pages_are_stable_bounded_and_reject_stale_cursors() {
    let path = directory();
    for name in ["z.md", "a.MD", "α.md", "b.md"] {
        fs::write(path.join(name), b"text").unwrap();
    }
    let state = directory();
    let db = DbRuntime::open(&state.join("db.sqlite3")).unwrap();
    let service = WorkspaceService::new(&db);
    let root = root(&service, &path, vec![]);
    let request = ListDirectoryRequest {
        root_id: root.id,
        rel_dir: String::new(),
        cursor: None,
        limit: Some(2),
    };
    let first = service.list_directory(request.clone()).unwrap();
    assert_eq!(
        first
            .entries
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        vec!["a.MD", "b.md"]
    );
    let again = service.list_directory(request.clone()).unwrap();
    assert_eq!(first, again);
    let mut next = request.clone();
    next.cursor = first.next_cursor.clone();
    let page = service.list_directory(next.clone()).unwrap();
    assert_eq!(
        page.entries
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        vec!["z.md", "α.md"]
    );
    assert!(page.next_cursor.is_none());
    fs::write(path.join("new.md"), b"new").unwrap();
    assert_eq!(
        service.list_directory(next).unwrap_err().code,
        AppErrorCode::Conflict
    );
    let mut invalid = request;
    invalid.cursor = Some("not-a-cursor".into());
    assert!(service.list_directory(invalid).is_err());
}
#[test]
fn encoding_limits_magic_and_missing_are_enforced() {
    let path = directory();
    for (name, bytes) in [
        ("a.md", vec![b'a']),
        ("bad.md", vec![0xff]),
        ("svg.png", b"<svg/>".to_vec()),
    ] {
        fs::write(path.join(name), bytes).unwrap();
    }
    let state = directory();
    let db = DbRuntime::open(&state.join("db.sqlite3")).unwrap();
    let service = WorkspaceService::new(&db);
    let root = root(&service, &path, vec![]);
    let page = service
        .list_directory(ListDirectoryRequest {
            root_id: root.id,
            rel_dir: String::new(),
            cursor: None,
            limit: Some(100),
        })
        .unwrap();
    let id = |name: &str| {
        page.entries
            .iter()
            .find(|e| e.name == name)
            .unwrap()
            .document_id
            .clone()
            .unwrap()
    };
    assert_eq!(
        service
            .open_document(OpenDocumentRequest {
                document_id: id("bad.md")
            })
            .unwrap_err()
            .code,
        AppErrorCode::UnsupportedEncoding
    );
    let source = id("a.md");
    assert_eq!(
        service
            .read_asset(ReadWorkspaceAssetRequest {
                source_document_id: source.clone(),
                href: "svg.png".into()
            })
            .unwrap_err()
            .code,
        AppErrorCode::UnsupportedMediaType
    );
    let file = fs::File::create(path.join("large.md")).unwrap();
    file.set_len(20 * 1024 * 1024 + 1).unwrap();
    let resolved = service
        .resolve_link(ResolveLocalDocumentLinkRequest {
            source_document_id: source.clone(),
            href: "large.md".into(),
        })
        .unwrap();
    assert_eq!(
        service
            .open_document(OpenDocumentRequest {
                document_id: resolved.document.id
            })
            .unwrap_err()
            .code,
        AppErrorCode::DocumentTooLarge
    );
    let image = fs::File::create(path.join("large.png")).unwrap();
    image.set_len(10 * 1024 * 1024 + 1).unwrap();
    assert_eq!(
        service
            .read_asset(ReadWorkspaceAssetRequest {
                source_document_id: source.clone(),
                href: "large.png".into()
            })
            .unwrap_err()
            .code,
        AppErrorCode::AssetTooLarge
    );
    fs::remove_file(path.join("a.md")).unwrap();
    assert_eq!(
        service
            .open_document(OpenDocumentRequest {
                document_id: source
            })
            .unwrap_err()
            .code,
        AppErrorCode::NotFound
    );
}

#[cfg(unix)]
#[test]
fn symlinks_unsupported_names_and_identity_bypasses_fail_closed() {
    use std::os::unix::{ffi::OsStringExt, fs::symlink};
    let path = directory();
    let outside = directory();
    fs::write(outside.join("secret.md"), b"outside").unwrap();
    fs::write(path.join("a.md"), b"source").unwrap();
    fs::create_dir(path.join("drafts")).unwrap();
    fs::write(path.join("drafts/private.md"), b"ignored").unwrap();
    fs::write(path.join("drafts/image.png"), b"\x89PNG\r\n\x1a\nignored").unwrap();
    fs::create_dir(path.join(".git")).unwrap();
    fs::write(path.join(".git/secret.md"), b"builtin").unwrap();
    symlink(&outside, path.join("escape")).unwrap();
    symlink(outside.join("secret.md"), path.join("link.md")).unwrap();
    fs::write(
        path.join(std::ffi::OsString::from_vec(vec![0xff, b'.', b'm', b'd'])),
        b"invalid name",
    )
    .unwrap();
    let state = directory();
    let db = DbRuntime::open(&state.join("db.sqlite3")).unwrap();
    let service = WorkspaceService::new(&db);
    let root = root(&service, &path, vec!["drafts/**".into(), "!.git/".into()]);
    let page = service
        .list_directory(ListDirectoryRequest {
            root_id: root.id.clone(),
            rel_dir: String::new(),
            cursor: None,
            limit: None,
        })
        .unwrap();
    assert_eq!(page.unsupported_name_count, 1);
    assert!(
        !page
            .entries
            .iter()
            .any(|entry| ["drafts", ".git"].contains(&entry.name.as_str()))
    );
    for name in ["escape", "link.md"] {
        let entry = page
            .entries
            .iter()
            .find(|entry| entry.name == name)
            .unwrap();
        assert_eq!(entry.kind, DirectoryEntryKind::Symlink);
        assert!(entry.unavailable);
        assert!(entry.document_id.is_none());
    }
    assert_eq!(
        service
            .list_directory(ListDirectoryRequest {
                root_id: root.id.clone(),
                rel_dir: "escape".into(),
                cursor: None,
                limit: None
            })
            .unwrap_err()
            .code,
        AppErrorCode::SymlinkForbidden
    );
    for rel_path in ["drafts/private.md", ".git/secret.md", "link.md"] {
        let root_id = flowshot_db::RootId::parse(&root.id).unwrap();
        let document = db
            .transaction(move |tx| tx.ensure_document(root_id, rel_path.into()))
            .unwrap();
        assert!(
            service
                .open_document(OpenDocumentRequest {
                    document_id: document.id.to_string()
                })
                .is_err()
        );
    }
    let source = page
        .entries
        .iter()
        .find(|entry| entry.name == "a.md")
        .unwrap()
        .document_id
        .clone()
        .unwrap();
    assert!(
        service
            .read_asset(ReadWorkspaceAssetRequest {
                source_document_id: source,
                href: "drafts/image.png".into()
            })
            .is_err()
    );
}

#[test]
fn exact_size_limits_and_all_magic_signatures_are_accepted() {
    let path = directory();
    fs::write(path.join("a.md"), vec![b'a'; 20 * 1024 * 1024]).unwrap();
    let state = directory();
    let db = DbRuntime::open(&state.join("db.sqlite3")).unwrap();
    let service = WorkspaceService::new(&db);
    let root = root(&service, &path, vec![]);
    let page = service
        .list_directory(ListDirectoryRequest {
            root_id: root.id,
            rel_dir: String::new(),
            cursor: None,
            limit: None,
        })
        .unwrap();
    let id = page.entries[0].document_id.clone().unwrap();
    let open = service
        .open_document(OpenDocumentRequest {
            document_id: id.clone(),
        })
        .unwrap();
    assert_eq!(open.source.len(), 20 * 1024 * 1024);
    for (name, signature) in [
        ("limit.png", b"\x89PNG\r\n\x1a\n".as_slice()),
        ("small.jpg", b"\xff\xd8\xff".as_slice()),
        ("small.gif", b"GIF89a".as_slice()),
        ("small.webp", b"RIFF0000WEBP".as_slice()),
    ] {
        let mut bytes = signature.to_vec();
        if name == "limit.png" {
            bytes.resize(10 * 1024 * 1024, 0);
        }
        fs::write(path.join(name), &bytes).unwrap();
        let actual = service
            .read_asset(ReadWorkspaceAssetRequest {
                source_document_id: id.clone(),
                href: name.into(),
            })
            .unwrap();
        assert_eq!(actual, bytes);
    }
}
