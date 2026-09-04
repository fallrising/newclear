//! Database adapter boundary for Flowshot.
//!
//! Product persistence and migrations are introduced by later SDD nodes.

/// Marker for the database adapter boundary.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DbAdapter;
