//! At-rest encryption for connection API keys and imported OAuth tokens.
//!
//! Secrets are always stored encrypted as `enc:v2:<base64(nonce || ciphertext)>` (AES-256-GCM).
//! The 32-byte key comes from one of two sources:
//!
//! - `--secrets-key` / `THINROUTER_SECRETS_KEY`: a passphrase stretched with Argon2id and a
//!   per-database random salt (stored in the `meta` table).
//! - otherwise a random key file `secrets.key` next to the database, created with mode 0600.
//!
//! `enc:v1:` values (single SHA-256 of the passphrase) and plaintext values from older
//! databases are re-encrypted as v2 when the store opens; see `Store::open`.

use std::fs;
use std::io::Write;
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, bail, Context, Result};
use argon2::Argon2;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};

const PREFIX_V1: &str = "enc:v1:";
const PREFIX_V2: &str = "enc:v2:";
pub const SALT_LEN: usize = 16;

/// Encrypts and decrypts stored secrets with one derived key.
pub struct SecretBox {
    cipher: Aes256Gcm,
    /// Passphrase kept only to read `enc:v1:` values during migration.
    legacy_passphrase: Option<String>,
}

impl SecretBox {
    /// Argon2id(passphrase, salt) → AES-256 key.
    pub fn from_passphrase(passphrase: &str, salt: &[u8]) -> Result<Self> {
        let mut key = [0u8; 32];
        Argon2::default()
            .hash_password_into(passphrase.as_bytes(), salt, &mut key)
            .map_err(|e| anyhow!("argon2id key derivation failed: {e}"))?;
        Ok(Self {
            cipher: Aes256Gcm::new_from_slice(&key).expect("32-byte key"),
            legacy_passphrase: Some(passphrase.to_string()),
        })
    }

    /// Load the random key file, creating it (mode 0600) if missing.
    pub fn from_key_file(path: &Path) -> Result<Self> {
        let key = load_or_create_key_file(path)?;
        Ok(Self {
            cipher: Aes256Gcm::new_from_slice(&key).expect("32-byte key"),
            legacy_passphrase: None,
        })
    }

    pub fn encrypt(&self, plaintext: &str) -> String {
        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill_bytes(&mut nonce_bytes);
        let ciphertext = self
            .cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
            .expect("aes-gcm encrypt");
        let mut packed = Vec::with_capacity(12 + ciphertext.len());
        packed.extend_from_slice(&nonce_bytes);
        packed.extend_from_slice(&ciphertext);
        format!("{PREFIX_V2}{}", B64.encode(packed))
    }

    /// Decrypt a v2 value. Errors never include the stored value.
    pub fn decrypt(&self, stored: &str) -> Result<String> {
        let Some(body) = stored.strip_prefix(PREFIX_V2) else {
            bail!("stored secret is not enc:v2 (database not migrated?)");
        };
        open_packed(&self.cipher, body)
    }

    /// Decrypt a legacy `enc:v1:` value; requires the original passphrase.
    pub fn decrypt_legacy_v1(&self, stored: &str) -> Result<String> {
        let body = stored
            .strip_prefix(PREFIX_V1)
            .context("not an enc:v1 value")?;
        let pass = self.legacy_passphrase.as_deref().context(
            "database holds enc:v1 secrets; start once with the original --secrets-key to migrate them",
        )?;
        let mut hasher = Sha256::new();
        hasher.update(b"thinrouter-secrets-v1:");
        hasher.update(pass.as_bytes());
        let cipher = Aes256Gcm::new_from_slice(&hasher.finalize()).expect("32-byte key");
        open_packed(&cipher, body)
            .context("enc:v1 secret did not decrypt with the given --secrets-key")
    }
}

/// How a stored column value must be handled by the migration.
#[derive(Debug, PartialEq, Eq)]
pub enum StoredKind {
    Empty,
    V2,
    V1,
    Plaintext,
}

pub fn classify(stored: &str) -> StoredKind {
    if stored.is_empty() {
        StoredKind::Empty
    } else if stored.starts_with(PREFIX_V2) {
        StoredKind::V2
    } else if stored.starts_with(PREFIX_V1) {
        StoredKind::V1
    } else {
        StoredKind::Plaintext
    }
}

pub fn random_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::rng().fill_bytes(&mut salt);
    salt
}

fn open_packed(cipher: &Aes256Gcm, body: &str) -> Result<String> {
    let raw = B64
        .decode(body)
        .map_err(|_| anyhow!("stored secret is not valid base64"))?;
    if raw.len() < 13 {
        bail!("stored secret is truncated");
    }
    let (nonce, ct) = raw.split_at(12);
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| anyhow!("stored secret did not decrypt (wrong secrets key?)"))?;
    String::from_utf8(pt).map_err(|_| anyhow!("decrypted secret is not UTF-8"))
}

fn load_or_create_key_file(path: &Path) -> Result<[u8; 32]> {
    match fs::read_to_string(path) {
        Ok(s) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = fs::metadata(path)?.permissions().mode() & 0o777;
                if mode & 0o077 != 0 {
                    bail!(
                        "{} is readable by group/others (mode {mode:o}); run chmod 600 on it",
                        path.display()
                    );
                }
            }
            let bytes = hex::decode(s.trim())
                .map_err(|_| anyhow!("{} is not a hex key", path.display()))?;
            bytes
                .try_into()
                .map_err(|_| anyhow!("{} must hold 32 bytes", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut key = [0u8; 32];
            rand::rng().fill_bytes(&mut key);
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut f = opts
                .open(path)
                .with_context(|| format!("create {}", path.display()))?;
            f.write_all(hex::encode(key).as_bytes())?;
            f.write_all(b"\n")?;
            f.sync_all()?;
            Ok(key)
        }
        Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passphrase_roundtrip_and_wrong_key_fails() {
        let salt = random_salt();
        let sb = SecretBox::from_passphrase("pass", &salt).unwrap();
        let enc = sb.encrypt("sk-secret-123");
        assert!(enc.starts_with(PREFIX_V2));
        assert!(!enc.contains("sk-secret"));
        assert_eq!(sb.decrypt(&enc).unwrap(), "sk-secret-123");
        let wrong = SecretBox::from_passphrase("wrong", &salt).unwrap();
        let err = wrong.decrypt(&enc).unwrap_err().to_string();
        assert!(!err.contains("sk-secret"));
        let other_salt = SecretBox::from_passphrase("pass", &random_salt()).unwrap();
        assert!(other_salt.decrypt(&enc).is_err());
    }

    #[test]
    fn key_file_is_created_private_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.key");
        let a = SecretBox::from_key_file(&path).unwrap();
        let enc = a.encrypt("tok");
        let b = SecretBox::from_key_file(&path).unwrap();
        assert_eq!(b.decrypt(&enc).unwrap(), "tok");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(SecretBox::from_key_file(&path).is_err());
        }
    }

    #[test]
    fn legacy_v1_decrypts_with_original_passphrase() {
        // enc:v1 layout: SHA-256("thinrouter-secrets-v1:" + pass) key, nonce || ct.
        let mut hasher = Sha256::new();
        hasher.update(b"thinrouter-secrets-v1:pass");
        let cipher = Aes256Gcm::new_from_slice(&hasher.finalize()).unwrap();
        let nonce = [7u8; 12];
        let ct = cipher
            .encrypt(Nonce::from_slice(&nonce), b"old-token".as_ref())
            .unwrap();
        let v1 = format!("{PREFIX_V1}{}", B64.encode([&nonce[..], &ct].concat()));
        assert_eq!(classify(&v1), StoredKind::V1);
        let sb = SecretBox::from_passphrase("pass", &random_salt()).unwrap();
        assert_eq!(sb.decrypt_legacy_v1(&v1).unwrap(), "old-token");
        let dir = tempfile::tempdir().unwrap();
        let keyfile = SecretBox::from_key_file(&dir.path().join("k")).unwrap();
        assert!(keyfile.decrypt_legacy_v1(&v1).is_err());
    }
}
