//! Logical limits for converter-owned payload and collection entries, not total RSS.
use serde_json::Value;
use std::io::{self, Write};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;

pub(crate) struct RetainedBudget {
    bytes: usize,
    entries: usize,
    byte_limit: usize,
    entry_limit: usize,
}
impl Default for RetainedBudget {
    fn default() -> Self {
        Self {
            bytes: 0,
            entries: 0,
            byte_limit: MAX_BYTES,
            entry_limit: MAX_ENTRIES,
        }
    }
}
impl RetainedBudget {
    /// Charge before mutation. Failed charges are atomic; moving stored data is free.
    pub(crate) fn charge(&mut self, bytes: usize, entries: usize) -> bool {
        if bytes > self.byte_limit - self.bytes || entries > self.entry_limit - self.entries {
            return false;
        }
        self.bytes += bytes;
        self.entries += entries;
        true
    }

    #[cfg(test)]
    pub(crate) fn limited(byte_limit: usize, entry_limit: usize) -> Self {
        Self {
            byte_limit,
            entry_limit,
            ..Self::default()
        }
    }
}

/// Count retained JSON metadata without allocating a second serialized copy.
/// Missing call_id/name are represented by the existing empty-string default.
pub(crate) fn metadata_bytes(value: Option<&Value>) -> usize {
    struct Count(usize);
    impl Write for Count {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if bytes.len() > MAX_BYTES - self.0 {
                return Err(io::Error::other("retained metadata limit"));
            }
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let Some(value) = value else {
        return 2;
    };
    let mut count = Count(0);
    if serde_json::to_writer(&mut count, value).is_err() {
        MAX_BYTES + 1
    } else {
        count.0
    }
}
