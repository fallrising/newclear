//! Validated AI configuration shared by status and request construction.
//! The reader seam avoids process-global environment mutation in tests.

use super::error::{AiError, AiResult};
use super::provider::ProviderKind;
use super::service::AiStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireProtocol {
    ChatCompletions,
    Responses,
    Messages,
}

impl WireProtocol {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ChatCompletions => "chat-completions",
            Self::Responses => "responses",
            Self::Messages => "messages",
        }
    }

    pub(super) fn operation(self) -> &'static str {
        match self {
            Self::ChatCompletions => "chat/completions",
            Self::Responses => "responses",
            Self::Messages => "messages",
        }
    }
}

/// Credentials deliberately stay private and are omitted from Debug/status.
#[derive(Clone)]
pub struct AiSettings {
    pub(super) provider: ProviderKind,
    pub(super) protocol: WireProtocol,
    pub(super) base_url: String,
    pub(super) model: String,
    pub(super) key_env: String,
    pub(super) api_key: Option<String>,
    pub(super) max_tokens: u32,
}

impl std::fmt::Debug for AiSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AiSettings")
            .field("provider", &self.provider)
            .field("protocol", &self.protocol)
            .field("key_present", &self.api_key.is_some())
            .finish_non_exhaustive()
    }
}

impl AiSettings {
    pub fn from_env() -> AiResult<Self> {
        // Preserve explicitly present non-Unicode values as invalid rather
        // than treating them as absent and silently selecting defaults.
        Self::resolve(|name| match std::env::var(name) {
            Ok(value) => Some(value),
            Err(std::env::VarError::NotPresent) => None,
            Err(std::env::VarError::NotUnicode(_)) => Some("\0".into()),
        })
    }

    pub fn resolve(read: impl Fn(&str) -> Option<String>) -> AiResult<Self> {
        let provider = match read("LOOM_AI_PROVIDER") {
            None => ProviderKind::Anthropic,
            Some(raw) => ProviderKind::parse(&raw).ok_or_else(|| {
                invalid(
                    "LOOM_AI_PROVIDER",
                    "expected anthropic, openai, deepseek, or opencode",
                )
            })?,
        };
        let protocol = match read("LOOM_AI_PROTOCOL") {
            Some(raw) => match raw.trim() {
                "chat-completions" => WireProtocol::ChatCompletions,
                "responses" => WireProtocol::Responses,
                "messages" => WireProtocol::Messages,
                _ => {
                    return Err(invalid(
                        "LOOM_AI_PROTOCOL",
                        "expected chat-completions, responses, or messages",
                    ))
                }
            },
            None if provider == ProviderKind::OpenCode => {
                return Err(invalid(
                    "LOOM_AI_PROTOCOL",
                    "required for opencode; select the model's documented protocol",
                ))
            }
            None if provider == ProviderKind::Anthropic => WireProtocol::Messages,
            None => WireProtocol::ChatCompletions,
        };
        let model = read("LOOM_AI_MODEL")
            .unwrap_or_else(|| provider.default_model().into())
            .trim()
            .to_owned();
        if model.is_empty() || model.chars().any(char::is_control) {
            return Err(invalid("LOOM_AI_MODEL", "a nonempty model is required"));
        }
        let default_base = match provider {
            ProviderKind::Anthropic => "https://api.anthropic.com/v1",
            ProviderKind::OpenAi => "https://api.openai.com/v1",
            ProviderKind::DeepSeek => "https://api.deepseek.com/v1",
            ProviderKind::OpenCode => "https://opencode.ai/zen/go/v1",
        };
        let base_url =
            validate_base_url(&read("LOOM_AI_BASE_URL").unwrap_or_else(|| default_base.into()))?;
        let key_env = read("LOOM_AI_API_KEY_ENV").unwrap_or_else(|| provider.api_key_env().into());
        if !valid_env_name(&key_env) {
            return Err(invalid(
                "LOOM_AI_API_KEY_ENV",
                "expected an environment-variable name, such as OPENCODE_API_KEY",
            ));
        }
        let api_key = read(&key_env)
            .map(|key| key.trim().to_owned())
            .filter(|key| !key.is_empty());
        if api_key
            .as_ref()
            .is_some_and(|key| !key.bytes().all(|byte| (0x20..=0x7e).contains(&byte)))
        {
            return Err(invalid(
                "LOOM_AI_API_KEY_ENV",
                "selected API key is not a valid HTTP header value",
            ));
        }
        let max_tokens = match read("LOOM_AI_MAX_TOKENS") {
            None => 2048,
            Some(raw) => raw
                .parse::<u32>()
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(|| invalid("LOOM_AI_MAX_TOKENS", "expected a positive integer"))?,
        };
        Ok(Self {
            provider,
            protocol,
            base_url,
            model,
            key_env,
            api_key,
            max_tokens,
        })
    }

    #[must_use]
    pub fn provider(&self) -> ProviderKind {
        self.provider
    }

    #[must_use]
    pub fn protocol(&self) -> WireProtocol {
        self.protocol
    }

    #[must_use]
    pub fn status(&self) -> AiStatus {
        let safe = |value: &str| match &self.api_key {
            Some(key) => value.replace(key, "[redacted]"),
            None => value.to_owned(),
        };
        AiStatus {
            provider: self.provider.as_str().into(),
            model: safe(&self.model),
            key_present: self.api_key.is_some(),
            key_env: safe(&self.key_env),
            protocol: Some(self.protocol.as_str().into()),
            base_url: Some(safe(&self.base_url)),
            configuration_error: None,
        }
    }
}

fn invalid(name: &str, reason: &str) -> AiError {
    AiError::Configuration(format!("{name}: {reason}"))
}

fn valid_env_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes
        .next()
        .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn validate_base_url(raw: &str) -> AiResult<String> {
    let error = || {
        invalid("LOOM_AI_BASE_URL", "expected HTTPS (or loopback HTTP), without credentials, query, fragment, or operation path")
    };
    if raw.is_empty()
        || raw.contains('\\')
        || raw.chars().any(char::is_whitespace)
        || raw.chars().any(char::is_control)
    {
        return Err(error());
    }
    let (_, authority_and_path) = raw.split_once("://").ok_or_else(error)?;
    if authority_and_path
        .split('/')
        .next()
        .is_none_or(|authority| authority.is_empty() || authority.contains('@'))
    {
        return Err(error());
    }
    let url = reqwest::Url::parse(raw).map_err(|_| error())?;
    let host = url.host_str().ok_or_else(error)?;
    let loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !(url.scheme() == "https" || url.scheme() == "http" && loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error());
    }
    let path = url.path().trim_end_matches('/');
    if ["/messages", "/responses", "/chat/completions"]
        .iter()
        .any(|operation| path.ends_with(operation))
    {
        return Err(error());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
