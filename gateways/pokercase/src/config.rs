use std::fs;
use std::io::Write;
use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub data_dir: PathBuf,
    pub admin_token: Option<String>,
    /// Explicit keyless bootstrap, restricted to exact loopback listeners.
    pub allow_keyless_bootstrap: bool,
    /// Optional passphrase for encrypting connection API keys at rest.
    pub secrets_key: Option<String>,
    /// Max idle time between SSE chunks before aborting (seconds).
    pub sse_stall_secs: u64,
    /// Enable token-saver rewrite (tool_result truncation).
    pub token_saver: bool,
    /// Max chars kept per tool-like content block.
    pub token_saver_max_chars: usize,
    /// Extra Host names accepted besides IP literals, `localhost` and `host`
    /// (e.g. the Tailscale Serve name). Guards against DNS rebinding.
    pub allowed_hosts: Vec<String>,
    /// Operator-only upstream base overrides `provider=url`, accepted in addition to
    /// the provider's official hosts (local mocks, egress proxies). CLI/env only.
    pub provider_base_overrides: Vec<(String, String)>,
    /// Claude Code binary for the `claude` provider (`--claude-bin`).
    pub claude_bin: Option<String>,
    /// Concurrent Claude Code processes.
    pub claude_max_runs: usize,
    /// Seconds a Claude Code run waits for tool results.
    pub claude_idle_secs: u64,
    /// Cursor Agent CLI binary for the `cursor` provider (`--cursor-bin`).
    pub cursor_bin: Option<String>,
    /// Concurrent Cursor Agent processes.
    pub cursor_max_runs: usize,
}

impl AppConfig {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        host: String,
        port: u16,
        data_dir: Option<PathBuf>,
        admin_token: Option<String>,
        secrets_key: Option<String>,
        sse_stall_secs: Option<u64>,
        token_saver: Option<bool>,
        token_saver_max_chars: Option<usize>,
    ) -> Result<Self> {
        let data_dir = match data_dir {
            Some(p) => p,
            None => dirs::home_dir()
                .context("cannot resolve home dir")?
                .join(".thinrouter"),
        };
        fs::create_dir_all(&data_dir)
            .with_context(|| format!("create data dir {}", data_dir.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o700));
        }
        Ok(Self {
            host,
            port,
            data_dir,
            admin_token: admin_token.filter(|s| !s.trim().is_empty()),
            allow_keyless_bootstrap: false,
            secrets_key: secrets_key.filter(|s| !s.is_empty()),
            sse_stall_secs: sse_stall_secs.unwrap_or(90),
            token_saver: token_saver.unwrap_or(false),
            token_saver_max_chars: token_saver_max_chars.unwrap_or(2_000),
            allowed_hosts: Vec::new(),
            provider_base_overrides: Vec::new(),
            claude_bin: None,
            claude_max_runs: 2,
            claude_idle_secs: 600,
            cursor_bin: None,
            cursor_max_runs: 2,
        })
    }

    pub fn admin_token_path(&self) -> PathBuf {
        self.data_dir.join("admin-token")
    }

    /// The admin UI/API always needs a token. Without `--admin-token`, load or create
    /// `<data_dir>/admin-token` (mode 0600). Returns the file path when it was used,
    /// so the caller can log the path; the token itself is never logged.
    pub fn ensure_admin_token(&mut self) -> Result<Option<PathBuf>> {
        if self.admin_token.is_some() {
            return Ok(None);
        }
        let path = self.admin_token_path();
        let token = match fs::read_to_string(&path) {
            Ok(s) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mode = fs::metadata(&path)?.permissions().mode() & 0o777;
                    if mode & 0o077 != 0 {
                        bail!(
                            "{} is readable by group/others (mode {mode:o}); run chmod 600 on it",
                            path.display()
                        );
                    }
                }
                s.trim().to_string()
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let token = crate::guard::random_hex(32);
                let mut opts = fs::OpenOptions::new();
                opts.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    opts.mode(0o600);
                }
                let mut f = opts
                    .open(&path)
                    .with_context(|| format!("create {}", path.display()))?;
                writeln!(f, "{token}")?;
                token
            }
            Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
        };
        if token.is_empty() {
            bail!("{} is empty", path.display());
        }
        self.admin_token = Some(token);
        Ok(Some(path))
    }

    /// Parse `provider=url` entries from the CLI / env.
    pub fn set_provider_base_overrides(&mut self, entries: &[String]) -> Result<()> {
        for e in entries.iter().flat_map(|e| e.split(',')) {
            let e = e.trim();
            if e.is_empty() {
                continue;
            }
            let (p, url) = e
                .split_once('=')
                .with_context(|| format!("expected provider=url, got {e}"))?;
            let id = crate::providers::resolve(p.trim())
                .map(|p| p.id)
                .with_context(|| format!("unknown provider {p}"))?;
            self.provider_base_overrides
                .push((id.to_string(), url.trim().trim_end_matches('/').to_string()));
        }
        Ok(())
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("thinrouter.db")
    }

    pub fn listen_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn loopback_listener(&self) -> bool {
        self.listen_addr()
            .parse::<SocketAddr>()
            .is_ok_and(|addr| addr.ip().is_loopback())
    }

    pub fn validate_listener(&self) -> Result<SocketAddr> {
        let addr: SocketAddr = self
            .listen_addr()
            .parse()
            .with_context(|| format!("invalid listen addr {}", self.listen_addr()))?;
        anyhow::ensure!(
            !self.allow_keyless_bootstrap || addr.ip().is_loopback(),
            "keyless bootstrap requires an exact loopback listener IP"
        );
        anyhow::ensure!(
            addr.ip().is_loopback()
                || self
                    .admin_token
                    .as_ref()
                    .is_some_and(|s| !s.trim().is_empty()),
            "non-loopback listeners require a nonempty admin token"
        );
        Ok(addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(host: &str) -> (tempfile::TempDir, AppConfig) {
        let dir = tempfile::tempdir().unwrap();
        let cfg = AppConfig::new(
            host.into(),
            20128,
            Some(dir.path().into()),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        (dir, cfg)
    }

    #[test]
    fn bootstrap_is_off_by_default_and_exact_loopback_only() {
        for host in ["127.0.0.1", "127.1.2.3", "[::1]"] {
            let (_dir, mut cfg) = cfg(host);
            assert!(!cfg.allow_keyless_bootstrap);
            assert!(cfg.loopback_listener());
            cfg.allow_keyless_bootstrap = true;
            assert!(cfg.validate_listener().is_ok());
        }
        for host in [
            "0.0.0.0",
            "[::]",
            "192.0.2.1",
            "localhost",
            "[::ffff:127.0.0.1]",
        ] {
            let (_dir, mut cfg) = cfg(host);
            assert!(!cfg.loopback_listener());
            cfg.admin_token = Some("admin-test".into());
            cfg.allow_keyless_bootstrap = true;
            assert!(cfg.validate_listener().is_err());
        }
    }

    #[test]
    fn public_listener_requires_nonempty_admin_token() {
        let (_dir, mut cfg) = cfg("0.0.0.0");
        assert!(cfg.validate_listener().is_err());
        cfg.admin_token = Some(" ".into());
        assert!(cfg.validate_listener().is_err());
        cfg.admin_token = Some("admin-test".into());
        assert!(cfg.validate_listener().is_ok());
    }
}
