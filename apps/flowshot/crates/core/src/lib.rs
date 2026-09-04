//! Platform-neutral domain code for Flowshot.

pub mod contracts;

/// Returns the stable application display name.
#[must_use]
pub const fn application_name() -> &'static str {
    "Flowshot"
}

#[cfg(test)]
mod tests {
    use super::application_name;

    #[test]
    fn exposes_the_application_name() {
        assert_eq!(application_name(), "Flowshot");
    }
}
