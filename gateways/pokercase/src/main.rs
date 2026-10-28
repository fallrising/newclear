mod admin;
mod agy;
mod borrowed;
mod cancel;
mod claude;
mod claude_code;
mod claude_mcp;
mod cli_lines;
mod cli_stderr;
mod collection;
mod config;
mod cooldown;
mod cursor_cli;
mod error;
mod guard;
mod http_client;
mod local_import;
mod native_responses;
mod oauth_refresh;
mod prompt_cache;
mod providers;
mod proxy;
mod resolve;
mod responses;
mod secrets;
mod server;
mod siwc;
mod store;
mod stream_budget;
mod templates;
mod token_saver;
mod tui_app;
mod web;

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use crate::config::AppConfig;

#[derive(Parser, Debug)]
#[command(
    name = "thinrouter",
    about = "Thin OpenAI-compatible LLM proxy (GitHub: fallrising/pokercase)"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(clap::Args, Debug)]
struct ServeArgs {
    #[arg(long, env = "THINROUTER_HOST", default_value = "127.0.0.1")]
    host: String,
    #[arg(long, env = "THINROUTER_PORT", default_value_t = 20128)]
    port: u16,
    #[arg(long, env = "THINROUTER_DATA_DIR")]
    data_dir: Option<std::path::PathBuf>,
    #[arg(long, env = "THINROUTER_ADMIN_TOKEN")]
    admin_token: Option<String>,
    /// Allow keyless inference only on loopback, before any gateway key exists.
    #[arg(
        long,
        env = "THINROUTER_ALLOW_KEYLESS_BOOTSTRAP",
        default_value_t = false
    )]
    allow_keyless_bootstrap: bool,
    #[arg(long, env = "THINROUTER_SECRETS_KEY")]
    secrets_key: Option<String>,
    #[arg(long, env = "THINROUTER_SSE_STALL_SECS", default_value_t = 90)]
    sse_stall_secs: u64,
    /// Enable token-saver (truncate tool / huge message content)
    #[arg(long, env = "THINROUTER_TOKEN_SAVER", default_value_t = false)]
    token_saver: bool,
    #[arg(long, env = "THINROUTER_TOKEN_SAVER_MAX_CHARS", default_value_t = 2000)]
    token_saver_max_chars: usize,
    /// Extra Host names to accept (e.g. your Tailscale Serve name); IP literals
    /// and localhost are always accepted. Comma-separated in the env var.
    #[arg(
        long = "allowed-host",
        env = "THINROUTER_ALLOWED_HOSTS",
        value_delimiter = ','
    )]
    allowed_hosts: Vec<String>,
    /// Operator-only upstream base override, `provider=url` (repeatable). Admin UI/API
    /// can then also point that provider's connections at this base.
    #[arg(
        long = "provider-base-override",
        env = "THINROUTER_PROVIDER_BASE_OVERRIDES",
        value_delimiter = ','
    )]
    provider_base_overrides: Vec<String>,
    /// Claude Code CLI used by the `claude` provider (default: `claude` on PATH)
    #[arg(long, env = "THINROUTER_CLAUDE_BIN")]
    claude_bin: Option<String>,
    /// Concurrent Claude Code processes
    #[arg(long, env = "THINROUTER_CLAUDE_MAX_RUNS", default_value_t = 2)]
    claude_max_runs: usize,
    /// Seconds a Claude Code run waits for the client's tool results
    #[arg(long, env = "THINROUTER_CLAUDE_IDLE_SECS", default_value_t = 600)]
    claude_idle_secs: u64,
    /// Cursor Agent CLI command inside the container image (default: cursor-agent)
    #[arg(long, env = "THINROUTER_CURSOR_BIN")]
    cursor_bin: Option<String>,
    /// Pinned local Docker image (sha256 ID or repository@sha256 digest)
    #[arg(long, env = "THINROUTER_CURSOR_IMAGE")]
    cursor_image: Option<String>,
    /// Dedicated Docker profile volume, prefixed thinrouter-cursor-
    #[arg(long, env = "THINROUTER_CURSOR_PROFILE_VOLUME")]
    cursor_profile_volume: Option<String>,
    /// Operator-controlled Docker executable (default: docker)
    #[arg(long, env = "THINROUTER_CURSOR_RUNTIME_BIN")]
    cursor_runtime_bin: Option<String>,
    /// Concurrent Cursor Agent processes
    #[arg(long, env = "THINROUTER_CURSOR_MAX_RUNS", default_value_t = 2)]
    cursor_max_runs: usize,
    /// Enable the cursor provider, accepting that cursor-agent can use the account's
    /// Cursor plugins (e.g. Gmail) for any client prompt.
    #[arg(
        long,
        env = "THINROUTER_CURSOR_ACCEPT_ACCOUNT_PLUGINS",
        default_value_t = false
    )]
    cursor_accept_account_plugins: bool,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Start HTTP proxy + web admin
    Serve(Box<ServeArgs>),
    Doctor {
        #[arg(long, env = "THINROUTER_DATA_DIR")]
        data_dir: Option<std::path::PathBuf>,
        #[arg(long, env = "THINROUTER_SECRETS_KEY")]
        secrets_key: Option<String>,
    },
    Tui {
        #[arg(long, env = "THINROUTER_DATA_DIR")]
        data_dir: Option<std::path::PathBuf>,
        #[arg(long, env = "THINROUTER_SECRETS_KEY")]
        secrets_key: Option<String>,
    },
    /// Import tokens from local agent CLIs (claude/grok/cursor/opencode/agy)
    ImportLocal {
        #[arg(long, env = "THINROUTER_DATA_DIR")]
        data_dir: Option<std::path::PathBuf>,
        #[arg(long, env = "THINROUTER_SECRETS_KEY")]
        secrets_key: Option<String>,
        /// Do not create routes rt-<provider> for each import
        #[arg(long)]
        no_routes: bool,
        /// Routes are created by default; kept so `--routes` still parses
        #[arg(long, hide = true)]
        routes: bool,
        /// After import, refresh OAuth tokens (never the Codex CLI's borrowed login)
        #[arg(long)]
        refresh: bool,
    },
    /// Sign in with ChatGPT (official plan sharing) and store an `siwc` connection
    LoginSiwc {
        #[arg(long, env = "THINROUTER_DATA_DIR")]
        data_dir: Option<std::path::PathBuf>,
        #[arg(long, env = "THINROUTER_SECRETS_KEY")]
        secrets_key: Option<String>,
        /// Connection name (re-running with the same name re-authorizes it)
        #[arg(long, default_value = "siwc")]
        name: String,
        /// Loopback callback port (redirect http://127.0.0.1:<port>/auth/callback)
        #[arg(long, default_value_t = 1455)]
        port: u16,
        /// Default model; otherwise the first model listed for the account
        #[arg(long)]
        model: Option<String>,
    },
    /// Internal: MCP server offering a client's tools to a Claude Code run
    #[command(hide = true)]
    ClaudeMcpHelper {
        #[arg(long)]
        tools_file: std::path::PathBuf,
        #[arg(long)]
        callback_file: Option<std::path::PathBuf>,
    },
    /// Refresh OAuth tokens for imported connections
    Refresh {
        #[arg(long, env = "THINROUTER_DATA_DIR")]
        data_dir: Option<std::path::PathBuf>,
        #[arg(long, env = "THINROUTER_SECRETS_KEY")]
        secrets_key: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // Required when multiple rustls crypto backends are linked (reqwest + tokio-rustls).
    let _ = rustls::crypto::ring::default_provider().install_default();

    // stderr: stdout is a protocol channel for claude-mcp-helper.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    match cli.command {
        Commands::Serve(args) => {
            let ServeArgs {
                host,
                port,
                data_dir,
                admin_token,
                allow_keyless_bootstrap,
                secrets_key,
                sse_stall_secs,
                token_saver,
                token_saver_max_chars,
                allowed_hosts,
                provider_base_overrides,
                claude_bin,
                claude_max_runs,
                claude_idle_secs,
                cursor_bin,
                cursor_image,
                cursor_profile_volume,
                cursor_runtime_bin,
                cursor_max_runs,
                cursor_accept_account_plugins,
            } = *args;
            let mut cfg = AppConfig::new(
                host,
                port,
                data_dir,
                admin_token,
                secrets_key,
                Some(sse_stall_secs),
                Some(token_saver),
                Some(token_saver_max_chars),
            )?;
            cfg.allow_keyless_bootstrap = allow_keyless_bootstrap;
            cfg.allowed_hosts = allowed_hosts;
            cfg.set_provider_base_overrides(&provider_base_overrides)?;
            cfg.claude_bin = claude_bin;
            cfg.claude_max_runs = claude_max_runs;
            cfg.claude_idle_secs = claude_idle_secs;
            cfg.cursor_bin = cursor_bin;
            cfg.cursor_image = cursor_image;
            cfg.cursor_profile_volume = cursor_profile_volume;
            cfg.cursor_runtime_bin = cursor_runtime_bin;
            cfg.cursor_max_runs = cursor_max_runs;
            cfg.cursor_accept_account_plugins = cursor_accept_account_plugins;
            server::run(cfg).await
        }
        Commands::Doctor {
            data_dir,
            secrets_key,
        } => {
            let cfg = AppConfig::new(
                "127.0.0.1".into(),
                20128,
                data_dir,
                None,
                secrets_key,
                None,
                None,
                None,
            )?;
            doctor(&cfg)
        }
        Commands::Tui {
            data_dir,
            secrets_key,
        } => {
            let cfg = AppConfig::new(
                "127.0.0.1".into(),
                20128,
                data_dir,
                None,
                secrets_key,
                None,
                None,
                None,
            )?;
            tui_app::run_tui(&cfg)
        }
        Commands::ImportLocal {
            data_dir,
            secrets_key,
            no_routes,
            routes: _,
            refresh,
        } => {
            let cfg = AppConfig::new(
                "127.0.0.1".into(),
                20128,
                data_dir,
                None,
                secrets_key,
                None,
                None,
                None,
            )?;
            import_local_cmd(&cfg, !no_routes, refresh).await
        }
        Commands::LoginSiwc {
            data_dir,
            secrets_key,
            name,
            port,
            model,
        } => {
            let cfg = AppConfig::new(
                "127.0.0.1".into(),
                20128,
                data_dir,
                None,
                secrets_key,
                None,
                None,
                None,
            )?;
            login_siwc_cmd(&cfg, &name, port, model).await
        }
        Commands::ClaudeMcpHelper {
            tools_file,
            callback_file,
        } => claude_mcp::run(&tools_file, callback_file.as_deref()).await,
        Commands::Refresh {
            data_dir,
            secrets_key,
        } => {
            let cfg = AppConfig::new(
                "127.0.0.1".into(),
                20128,
                data_dir,
                None,
                secrets_key,
                None,
                None,
                None,
            )?;
            refresh_cmd(&cfg).await
        }
    }
}

async fn import_local_cmd(cfg: &AppConfig, routes: bool, refresh: bool) -> Result<()> {
    let store = store::Store::open(&cfg.db_path(), cfg.secrets_key.clone())?;
    println!("thinrouter import-local");
    println!("  data_dir: {}", cfg.data_dir.display());
    let results = local_import::import_all_local(&store, routes)?;
    for r in &results {
        println!(
            "  {:8} {:14} {} — {}",
            r.provider,
            r.name,
            if r.ok { "OK  " } else { "FAIL" },
            r.detail
        );
    }
    if refresh {
        println!("  refreshing oauth…");
        for (name, ok, detail) in local_import::refresh_all_oauth(&store).await? {
            println!(
                "  refresh {:14} {} — {}",
                name,
                if ok { "OK  " } else { "FAIL" },
                detail.chars().take(120).collect::<String>()
            );
        }
    }
    println!("ok");
    Ok(())
}

async fn login_siwc_cmd(
    cfg: &AppConfig,
    name: &str,
    port: u16,
    model: Option<String>,
) -> Result<()> {
    let store = store::Store::open(&cfg.db_path(), cfg.secrets_key.clone())?;
    let http = http_client::build_http_client()?;
    let existing = store.get_connection_by_name(name)?;
    anyhow::ensure!(
        existing
            .as_ref()
            .is_none_or(|c| c.oauth.as_ref().is_some_and(|o| o.provider == "siwc")),
        "connection '{name}' exists for another provider; pass a different --name"
    );
    let meta: serde_json::Value = existing
        .as_ref()
        .and_then(|c| c.oauth.as_ref()?.meta.as_deref())
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_default();
    let client_id = meta.get("client_id").and_then(|v| v.as_str());
    let host_id = siwc::host_id(&cfg.data_dir)?;

    let signed = siwc::sign_in(
        &http,
        siwc::AUTH_BASE,
        &host_id,
        client_id,
        port,
        std::time::Duration::from_secs(300),
        |url| {
            println!(
                "Open this URL in a browser on this machine to sign in with ChatGPT:\n\n  {url}\n"
            );
            println!("Waiting for the redirect to 127.0.0.1:{port} (5 minutes)...");
        },
    )
    .await?;
    if let Some(prev) = meta.get("subject").and_then(|v| v.as_str()) {
        anyhow::ensure!(
            prev == signed.subject,
            "signed in as a different ChatGPT account than connection '{name}'; use another --name"
        );
    }
    let models = siwc::list_models(&http, siwc::API_BASE, &signed.tokens.access_token)
        .await
        .unwrap_or_else(|e| {
            println!("  (model list unavailable: {e})");
            Vec::new()
        });
    let default_model = model
        .or_else(|| existing.as_ref().and_then(|c| c.default_model.clone()))
        .or_else(|| models.first().cloned());
    let new_meta = serde_json::json!({
        "client_id": signed.client_id,
        "ext_agent_host_id": signed.host_id,
        "subject": signed.subject,
    });
    let row = store.upsert_oauth_connection(
        existing.as_ref().map(|c| c.id.clone()),
        name,
        siwc::API_BASE,
        "siwc",
        &signed.tokens.access_token,
        signed.tokens.refresh_token.as_deref(),
        signed.tokens.expires_at().as_deref(),
        Some(&new_meta.to_string()),
        default_model.as_deref(),
        existing.as_ref().map(|c| c.priority).unwrap_or(100),
        true,
    )?;
    store.upsert_route(None, "rt-siwc", "fallback", &[(row.id.clone(), None)])?;
    println!(
        "Signed in as {} — connection '{name}', route rt-siwc, default model {}",
        signed.email.as_deref().unwrap_or(&signed.subject),
        default_model.as_deref().unwrap_or("(none; pass --model)")
    );
    if !models.is_empty() {
        println!("  models: {}", models.join(", "));
    }
    Ok(())
}

async fn refresh_cmd(cfg: &AppConfig) -> Result<()> {
    let store = store::Store::open(&cfg.db_path(), cfg.secrets_key.clone())?;
    println!("thinrouter refresh");
    for (name, ok, detail) in local_import::refresh_all_oauth(&store).await? {
        println!(
            "  {:14} {} — {}",
            name,
            if ok { "OK  " } else { "FAIL" },
            detail.chars().take(160).collect::<String>()
        );
    }
    println!("ok");
    Ok(())
}

fn doctor(cfg: &AppConfig) -> Result<()> {
    println!("thinrouter doctor");
    println!("  crate    : thinrouter");
    println!("  repo     : fallrising/pokercase");
    println!("  data_dir : {}", cfg.data_dir.display());
    println!("  db_path  : {}", cfg.db_path().display());
    println!(
        "  secrets  : {}",
        if cfg.secrets_key.is_some() {
            "encrypted (argon2id passphrase)".to_string()
        } else {
            format!(
                "encrypted (key file {})",
                cfg.data_dir.join("secrets.key").display()
            )
        }
    );
    let store = store::Store::open(&cfg.db_path(), cfg.secrets_key.clone())?;
    let conns = store.list_connections()?;
    let oauth_n = conns
        .iter()
        .filter(|c| c.auth_type == "oauth_import")
        .count();
    let routes = store.list_routes()?;
    let keys = store.list_api_keys()?;
    let cost = store.usage_cost_total()?;
    println!("  connections: {} (oauth_import: {oauth_n})", conns.len());
    println!("  routes     : {}", routes.len());
    println!("  api_keys   : {}", keys.len());
    println!("  all-time  : {cost}");
    println!("ok");
    Ok(())
}
