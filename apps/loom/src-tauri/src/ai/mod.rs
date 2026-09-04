//! AI bridge — streaming text completion across multiple vendors.
//!
//! Layered to keep vendor differences contained:
//!
//! - `provider.rs` defines the trait every vendor implements.
//! - `providers/` hosts the per-vendor impls (Anthropic, OpenAI,
//!   DeepSeek — the last two share a body shape).
//! - `client.rs` is the provider-agnostic HTTP + SSE driver.
//! - `service.rs` glues request lifecycle (in-flight map, cancellation,
//!   per-vendor env-var defaults).
//!
//! Selection: `LOOM_AI_PROVIDER` env var (default: `anthropic`).
//! Per-provider keys: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
//! `DEEPSEEK_API_KEY`. Model defaults per provider; `LOOM_AI_MODEL`
//! overrides. v1 stays at text completion (no tool use, no agentic
//! loop — those layer onto B3's approve gate later).

pub mod client;
pub mod error;
pub mod provider;
pub mod providers;
pub mod service;

pub use error::{AiError, AiResult};
pub use service::{AiChunk, AiRequestId, AiService, AiStatus};
