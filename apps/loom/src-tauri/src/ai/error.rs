use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("ANTHROPIC_API_KEY env var is not set")]
    MissingApiKey,

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Anthropic API returned {status}: {body}")]
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
