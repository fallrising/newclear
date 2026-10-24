//! Frame-preserving terminal guard for a single native Responses HTTP stream.
use serde_json::{json, Value};

const MAX_EVENT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct NativeResponses {
    frame: Vec<u8>,
    line_start: usize,
    pending_cr: bool,
    next_sequence: u64,
    saw_frame: bool,
    pub(crate) done: bool,
}

impl NativeResponses {
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        for &byte in chunk {
            if self.done {
                break;
            }
            // Delay CR to preserve a possible CRLF byte-for-byte.
            if self.pending_cr {
                self.pending_cr = false;
                if byte == b'\n' {
                    if !self.append(byte, &mut out) {
                        break;
                    }
                    self.line_end(2, &mut out);
                    continue;
                }
                self.line_end(1, &mut out);
                if self.done {
                    break;
                }
            }
            if !self.append(byte, &mut out) {
                break;
            }
            match byte {
                b'\r' => self.pending_cr = true,
                b'\n' => self.line_end(1, &mut out),
                _ => {}
            }
        }
        out
    }

    fn append(&mut self, byte: u8, out: &mut Vec<u8>) -> bool {
        if self.frame.len() == MAX_EVENT_BYTES {
            self.fail(out);
            return false;
        }
        self.frame.push(byte);
        true
    }

    fn line_end(&mut self, ending_len: usize, out: &mut Vec<u8>) {
        let empty = self.frame.len() - ending_len == self.line_start;
        self.line_start = self.frame.len();
        if !empty {
            return;
        }
        match self.classify() {
            Ok(terminal) => {
                out.append(&mut self.frame);
                self.line_start = 0;
                self.done = terminal;
            }
            Err(()) => self.fail(out),
        }
    }

    fn classify(&mut self) -> Result<bool, ()> {
        let raw = std::str::from_utf8(&self.frame).map_err(|_| ())?;
        let raw = if self.saw_frame {
            raw
        } else {
            raw.strip_prefix('\u{feff}').unwrap_or(raw)
        };
        self.saw_frame = true;
        let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
        let mut data = Vec::new();
        let mut event = "";
        for line in normalized.lines() {
            let (field, value) = line.split_once(':').unwrap_or((line, ""));
            let value = value.strip_prefix(' ').unwrap_or(value);
            match field {
                "data" => data.push(value),
                "event" => event = value,
                _ => {}
            }
        }
        if data.is_empty() {
            return Ok(false);
        }
        let data = data.join("\n");
        let terminal_name = |s: &str| {
            matches!(
                s,
                "response.completed" | "response.incomplete" | "response.failed" | "error"
            )
        };
        if data.trim() == "[DONE]" {
            return Err(());
        }
        let value: Value = match serde_json::from_str(&data) {
            Ok(v) => v,
            Err(_) if terminal_name(event) => return Err(()),
            Err(_) => return Ok(false),
        };
        let kind = value["type"].as_str().unwrap_or("");
        if (terminal_name(kind) || terminal_name(event)) && !event.is_empty() && event != kind {
            return Err(());
        }
        if let Some(sequence) = value.get("sequence_number") {
            let n = sequence
                .as_u64()
                .filter(|n| *n < i64::MAX as u64)
                .ok_or(())?;
            self.next_sequence = self.next_sequence.max(n + 1);
        }
        match kind {
            "response.completed" | "response.incomplete" | "response.failed" => {
                let response = value.get("response").filter(|v| v.is_object()).ok_or(())?;
                if response["status"].as_str() != kind.strip_prefix("response.") {
                    return Err(());
                }
                if kind != "response.failed" && response.get("error").is_some_and(|e| !e.is_null())
                {
                    return Err(());
                }
                Ok(true)
            }
            "error" if value["message"].is_string() => Ok(true),
            "error" => Err(()),
            _ => Ok(false),
        }
    }

    fn fail(&mut self, out: &mut Vec<u8>) {
        self.fail_with(
            out,
            "upstream_stream_incomplete",
            crate::error::INCOMPLETE_STREAM_MESSAGE,
        );
    }

    pub(crate) fn stall(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        if !self.done {
            self.fail_with(
                &mut out,
                "upstream_stream_timeout",
                crate::error::STALLED_STREAM_MESSAGE,
            );
        }
        out
    }

    fn fail_with(&mut self, out: &mut Vec<u8>, code: &str, message: &str) {
        self.frame.clear();
        self.line_start = 0;
        self.pending_cr = false;
        self.done = true;
        let error = json!({"type":"error", "code":code,
            "message":message, "param":null,
            "sequence_number": self.next_sequence});
        out.extend_from_slice(format!("event: error\ndata: {error}\n\n").as_bytes());
    }

    /// Resolve a final CR-only terminal at the existing idle deadline. Until then
    /// retain one-byte lookahead so a fragmented CRLF stays byte-identical.
    pub(crate) fn finish_cr_terminal(&mut self) -> Option<Vec<u8>> {
        if !self.done
            && self.pending_cr
            && self.frame.len().checked_sub(1) == Some(self.line_start)
            && self.classify() == Ok(true)
        {
            self.pending_cr = false;
            self.done = true;
            self.line_start = 0;
            Some(std::mem::take(&mut self.frame))
        } else {
            None
        }
    }

    pub(crate) fn end(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        if !self.done && self.pending_cr {
            self.pending_cr = false;
            self.line_end(1, &mut out);
        }
        if !self.done {
            self.fail(&mut out);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guarded(raw: &[u8], stride: usize) -> String {
        let mut guard = NativeResponses::default();
        let mut out = Vec::new();
        for chunk in raw.chunks(stride) {
            out.extend(guard.push(chunk));
        }
        out.extend(guard.end());
        assert!(guard.end().is_empty());
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn nr2_nr3_frames_preserve_bytes_across_fragmentation() {
        for ending in ["\n", "\r\n", "\r"] {
            for status in ["completed", "incomplete", "failed"] {
                let raw = format!("\u{feff}: heartbeat\nid: a\n\ndata: {{\"type\":\"response.output_text.delta\",\"delta\":\"片段 response.completed\",\"sequence_number\":3}}\n\nevent: response.{status}\ndata: {{\"type\":\"response.{status}\",\ndata: \"sequence_number\":4,\"response\":{{\"status\":\"{status}\",\"output\":[{{\"unknown\":\"保留\"}}],\"usage\":{{\"input_tokens\":9}}}}}}\n\n").replace('\n', ending);
                for stride in [1, 2, 3, 7, raw.len()] {
                    assert_eq!(guarded(raw.as_bytes(), stride), raw);
                }
            }
        }
    }

    #[test]
    fn nr1_false_or_unfinished_terminals_fail_once() {
        for raw in [
            "", "data: [DONE]\n\n", "data: {\"type\":\"response.completed\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"failed\"}}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"error\":{\"message\":\"SECRET\"}}}\n\n",
            "event: response.completed\ndata: {broken SECRET\n\n",
            "event: response.completed\ndata: {\"type\":\"response.output_text.delta\"}\n\n",
            "event: wrong\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",
            "data: {\"type\":\"error\"}\n\n",
        ] {
            let out = guarded(raw.as_bytes(), 1);
            assert_eq!(out.matches("event: error").count(), 1, "{raw}: {out}");
            assert!(!out.contains("SECRET") && !out.contains("response.completed") && !out.contains("[DONE]"), "{out}");
        }
    }

    #[test]
    fn nr1_partial_text_tool_and_terminal_substrings_do_not_complete() {
        let raw = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"response.completed\",\"sequence_number\":8}\n\ndata: {\"type\":\"response.function_call_arguments.delta\",\"delta\":\"{\"}\n\n";
        let out = guarded(raw.as_bytes(), 1);
        assert!(out.starts_with(raw));
        assert!(out.contains("\"sequence_number\":9"));
        assert_eq!(out.matches("event: error").count(), 1);
    }

    #[test]
    fn nr2_first_terminal_is_final() {
        for terminal in [
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",
            "event: error\ndata: {\"type\":\"error\",\"message\":\"upstream error\",\"extra\":1}\n\n",
            "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\"}}\n\n",
        ] {
            let raw = format!("{terminal}data: {{\"type\":\"response.completed\"}}\n\n");
            for stride in [1, raw.len()] { assert_eq!(guarded(raw.as_bytes(), stride), terminal); }
        }
    }

    #[test]
    fn nr3_event_memory_and_sequence_are_bounded() {
        let mut guard = NativeResponses::default();
        let prefix = vec![b'x'; MAX_EVENT_BYTES];
        assert!(guard.push(&prefix).is_empty());
        assert_eq!(guard.frame.len(), MAX_EVENT_BYTES);
        let out = guard.push(b"x");
        assert!(guard.done && guard.frame.is_empty());
        assert!(String::from_utf8(out).unwrap().contains("event: error"));
        for n in ["-1", "1.5", "9223372036854775807", "18446744073709551615"] {
            let raw = format!(
                "data: {{\"type\":\"response.output_text.delta\",\"sequence_number\":{n}}}\n\n"
            );
            let out = guarded(raw.as_bytes(), 3);
            assert!(out.starts_with("event: error"));
            assert!(out.contains("\"sequence_number\":0"));
        }
    }
}
