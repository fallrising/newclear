//! spring-pool internal API.
//!
//! Validation, Markdown export, and SQL text are native-testable. The Workers
//! entry point is compiled only for `wasm32-unknown-unknown`.

pub mod bind;
pub mod dbmsg;
pub mod dto;
pub mod error;
pub mod export;
pub mod flex;
pub mod limits;
pub mod page;
pub mod route;
pub mod rows;
pub mod sql;
pub mod sqljson;
pub mod validate;

#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(target_arch = "wasm32")]
#[worker::event(fetch)]
pub async fn main(
    req: worker::Request,
    env: worker::Env,
    _ctx: worker::Context,
) -> worker::Result<worker::Response> {
    wasm::fetch(req, env).await
}

#[cfg(test)]
mod contract_files {
    #[test]
    fn migration_has_the_sdd_guards_and_no_cleanup() {
        let sql = include_str!("../migrations/0001_init.sql");
        let needles = [
            "CREATE TABLE scripts",
            "CREATE TABLE script_revisions",
            "CREATE TABLE runbooks",
            "CREATE TABLE runbook_revisions",
            "CREATE TABLE runbook_steps",
            "CREATE TABLE audit_events",
            "CREATE INDEX runbook_steps_pin",
            "scripts_no_delete",
            "scripts_guard_update",
            "scripts_audit_archive",
            "script_revisions_guard_insert",
            "script_revisions_advance",
            "script_revisions_immutable",
            "script_revisions_no_delete",
            "runbooks_no_delete",
            "runbooks_guard_update",
            "runbooks_audit_archive",
            "runbook_revisions_guard_insert",
            "runbook_revisions_advance",
            "runbook_revisions_immutable",
            "runbook_revisions_no_delete",
            "runbook_steps_guard_insert",
            "runbook_steps_immutable",
            "runbook_steps_no_delete",
            "audit_no_update",
            "audit_no_delete",
            "sp:no_hard_delete",
            "sp:no_unarchive",
            "sp:revision_regress",
            "sp:not_found",
            "sp:archived",
            "sp:revision_conflict",
            "sp:immutable_revision",
            "sp:step_out_of_range",
            "sp:audit_immutable",
            "'script.create'",
            "'script.update'",
            "'script.archive'",
            "'runbook.create'",
            "'runbook.update'",
            "'runbook.archive'",
            "length(CAST(body AS BLOB)) BETWEEN 1 AND 65536",
        ];
        for needle in needles {
            assert!(sql.contains(needle), "missing {needle}");
        }
        let upper = sql.to_ascii_uppercase();
        assert!(!upper.contains("BEGIN TRANSACTION"));
        assert!(!upper.contains("COMMIT"));
        assert!(!upper.contains("DELETE FROM"));
        assert!(!sql.contains("cleanup"));
    }

    #[test]
    fn wrangler_and_cargo_follow_the_task() {
        let wrangler = include_str!("../wrangler.toml");
        assert!(wrangler.contains("name = \"spring-pool-api\""));
        assert!(wrangler.contains("name = \"spring-pool-api-staging\""));
        assert!(wrangler.contains("database_name = \"spring-pool-local\""));
        assert!(wrangler.contains("database_name = \"spring-pool-api-staging\""));
        assert!(wrangler.contains("00000000-0000-0000-0000-000000000001"));
        assert!(wrangler.contains("00000000-0000-0000-0000-000000000000"));
        assert!(wrangler.contains("main = \"build/worker/shim.mjs\""));
        assert!(wrangler.contains("compatibility_date = \"2026-09-30\""));
        assert!(wrangler.contains("command = \"worker-build --release\""));
        assert!(wrangler.contains("BUILD_REVISION = \"dev\""));
        assert_eq!(wrangler.matches("workers_dev = false").count(), 2);
        assert_eq!(wrangler.matches("preview_urls = false").count(), 2);
        assert!(!wrangler.contains("routes"));
        assert!(!wrangler.contains("route ="));

        let cargo = include_str!("../Cargo.toml");
        assert!(cargo.contains("=0.8.7"));
        assert!(cargo.contains("d1"));
        assert!(cargo.contains("cdylib"));
        assert!(cargo.contains("rlib"));
        assert!(cargo.contains("opt-level = \"z\""));
        assert!(cargo.contains("lto = true"));
        assert!(cargo.contains("serde_json"));
    }
}
