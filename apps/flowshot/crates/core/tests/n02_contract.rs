use flowshot_core::contracts::*;
#[test]
fn path_and_href_boundaries() {
    assert_eq!(
        direct_components("目录/file.md", false).unwrap(),
        vec!["目录", "file.md"]
    );
    assert_eq!(direct_components("", true).unwrap(), Vec::<String>::new());
    for x in ["../x", "/x", "x//y", "x/./y", "x\\y", "x\0y"] {
        assert!(direct_components(x, false).is_err(), "{x:?}");
    }
    assert_eq!(
        resolve_href("folder/doc.md", "../other.md#part").unwrap(),
        ("other.md".into(), Some("part".into()))
    );
    for h in [
        "../../escape.md",
        "https://host/x.md",
        "//host/x",
        "x%2fy",
        "x%252e.md",
        "javascript:x",
    ] {
        assert!(resolve_href("folder/doc.md", h).is_err(), "{h}");
    }
}
#[test]
fn dto_goldens_and_binary_transport() {
    let request: ListWorkspacesRequest = serde_json::from_str("{}").unwrap();
    assert_eq!(
        serde_json::to_string(&request).unwrap(),
        r#"{"cursor":null,"limit":null}"#
    );
    let value = serde_json::json!({"rootId":"root","relDir":"","cursor":null,"limit":500});
    let request: ListDirectoryRequest = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), value);
    let cmd = ReadWorkspaceAsset::descriptor(&ts_rs::Config::default());
    assert_eq!(cmd.transport, "binary");
    assert_eq!(cmd.response_type, "ArrayBuffer");
}

#[test]
fn all_n02_request_shapes_are_frozen() {
    fn golden<T: serde::Serialize + serde::de::DeserializeOwned>(input: &str, expected: &str) {
        let request: T = serde_json::from_str(input).unwrap();
        assert_eq!(serde_json::to_string(&request).unwrap(), expected);
    }
    golden::<CreateWorkspaceRequest>(r#"{"name":"知识"}"#, r#"{"name":"知识"}"#);
    golden::<AddWorkspaceRootRequest>(
        r#"{"workspaceId":"w","selectedPath":"/synthetic","extFilter":["md"],"ignoreRules":["drafts/**"]}"#,
        r#"{"workspaceId":"w","selectedPath":"/synthetic","extFilter":["md"],"ignoreRules":["drafts/**"]}"#,
    );
    golden::<DetachWorkspaceRootRequest>(r#"{"rootId":"r"}"#, r#"{"rootId":"r"}"#);
    golden::<OpenDocumentRequest>(r#"{"documentId":"d"}"#, r#"{"documentId":"d"}"#);
    golden::<ResolveLocalDocumentLinkRequest>(
        r#"{"sourceDocumentId":"d","href":"../b.md#part"}"#,
        r#"{"sourceDocumentId":"d","href":"../b.md#part"}"#,
    );
    golden::<ReadWorkspaceAssetRequest>(
        r#"{"sourceDocumentId":"d","href":"image.png"}"#,
        r#"{"sourceDocumentId":"d","href":"image.png"}"#,
    );
    golden::<ListRecentDocumentsRequest>(
        r#"{"workspaceId":"w"}"#,
        r#"{"workspaceId":"w","cursor":null,"limit":null}"#,
    );
    assert!(
        serde_json::from_str::<OpenDocumentRequest>(r#"{"documentId":"d","path":"/escape"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<ListDirectoryRequest>(r#"{"rootId":"r","relDir":"","limit":-1}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<ListDirectoryRequest>(
            r#"{"rootId":"r","relDir":"","limit":4294967296}"#
        )
        .is_err()
    );
}
