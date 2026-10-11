use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};

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
        })
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
