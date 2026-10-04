use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("the selected API key environment variable is not set")]
    MissingApiKey,

    #[error("invalid AI configuration: {0}")]
    Configuration(String),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("AI provider returned {status}: {body}")]
    Api { status: u16, body: String },

    #[error("malformed SSE stream: {0}")]
    Stream(String),

    #[error("request {0} was cancelled")]
    Cancelled(String),

    #[error("request {0} not found")]
    UnknownRequest(String),
}

impl Clone for AiError {
    fn clone(&self) -> Self {
        match self {
            Self::MissingApiKey => Self::MissingApiKey,
            Self::Configuration(s) => Self::Configuration(s.clone()),
            Self::Http(e) => Self::Stream(format!("http: {e}")),
            Self::Api { status, body } => Self::Api {
                status: *status,
                body: body.clone(),
            },
            Self::Stream(s) => Self::Stream(s.clone()),
            Self::Cancelled(s) => Self::Cancelled(s.clone()),
            Self::UnknownRequest(s) => Self::UnknownRequest(s.clone()),
        }
    }
}

pub type AiResult<T> = Result<T, AiError>;

// We hand `AiError` around inside `Arc` in places where multiple consumers
// might inspect it; this helper keeps the bound terse.
pub type SharedAiResult<T> = Result<T, Arc<AiError>>;

impl AiError {
    /// Provider responses may echo authentication material. Sanitize every
    /// returned error, including parser payloads and transport URL metadata.
    pub(super) fn redact(self, key: &str) -> Self {
        let safe = |text: String| {
            if key.is_empty() {
                text
            } else {
                text.replace(key, "[redacted]")
            }
        };
        match self {
            Self::Api { status, body } => Self::Api {
                status,
                body: safe(body),
            },
            Self::Stream(text) => Self::Stream(safe(text)),
            Self::Configuration(text) => Self::Configuration(safe(text)),
            Self::Http(error) => {
                let error = error.without_url();
                if !key.is_empty()
                    && (error.to_string().contains(key) || format!("{error:?}").contains(key))
                {
                    Self::Stream("HTTP transport error".into())
                } else {
                    Self::Http(error)
                }
            }
            other => other,
        }
    }
}
