use flowshot_core::contracts::{
    AppErrorCode, AppErrorDto, BuildInfoDto, CommandContract, EmptyRequest, GetBuildInfo,
    command_descriptors,
};
use ts_rs::Config;

#[test]
fn empty_request_serializes_as_one_object() {
    assert_eq!(
        serde_json::to_string(&EmptyRequest::default()).expect("request should serialize"),
        "{}"
    );
}

#[test]
fn build_info_matches_the_frozen_json_shape() {
    let build_info = BuildInfoDto {
        version: "0.1.0".into(),
        git_sha: "abc123".into(),
        build_profile: "test".into(),
    };

    assert_eq!(
        serde_json::to_string(&build_info).expect("build info should serialize"),
        r#"{"version":"0.1.0","gitSha":"abc123","buildProfile":"test"}"#
    );
}

#[test]
fn application_error_omits_absent_details() {
    let error = AppErrorDto {
        code: AppErrorCode::ValidationError,
        message: "invalid value".into(),
        retryable: false,
        correlation_id: "corr-1".into(),
        details: None,
    };

    assert_eq!(
        serde_json::to_string(&error).expect("error should serialize"),
        r#"{"code":"VALIDATION_ERROR","message":"invalid value","retryable":false,"correlationId":"corr-1"}"#
    );
}

#[test]
fn command_manifest_uses_the_frozen_name_and_types() {
    let config = Config::default();
    let commands = command_descriptors(&config);

    assert_eq!(GetBuildInfo::NAME, "get_build_info");
    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].name, "get_build_info");
    assert_eq!(commands[0].request_type, "EmptyRequest");
    assert_eq!(commands[0].response_type, "BuildInfoDto");
}
