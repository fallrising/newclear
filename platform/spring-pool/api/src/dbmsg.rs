//! Classify D1/SQLite failures without logging the raw message.
//! Trigger text is `RAISE(ABORT, 'sp:…')`. D1 often prefixes that text.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteClass {
    RevisionConflict,
    Archived,
    NotFound,
    ForeignKey,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeadSnap {
    pub current_revision: i64,
    pub archived: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveClass {
    Updated,
    NotFound,
    Archived { current_revision: i64 },
    RevisionConflict { current_revision: i64 },
    Inconsistent,
}

pub fn classify_write_error(message: &str) -> WriteClass {
    if has_code(message, "sp:not_found") {
        return WriteClass::NotFound;
    }
    if has_code(message, "sp:archived") {
        return WriteClass::Archived;
    }
    if has_code(message, "sp:revision_conflict") {
        return WriteClass::RevisionConflict;
    }
    let lower = message.to_ascii_lowercase();
    if lower.contains("unique constraint") || lower.contains("primary key") {
        return WriteClass::RevisionConflict;
    }
    if lower.contains("foreign key constraint") {
        return WriteClass::ForeignKey;
    }
    WriteClass::Other
}

pub fn classify_archive(changes: u64, head: Option<&HeadSnap>, expected: i64) -> ArchiveClass {
    if changes > 0 {
        return ArchiveClass::Updated;
    }
    match head {
        None => ArchiveClass::NotFound,
        Some(head) if head.archived => ArchiveClass::Archived {
            current_revision: head.current_revision,
        },
        Some(head) if head.current_revision != expected => ArchiveClass::RevisionConflict {
            current_revision: head.current_revision,
        },
        Some(_) => ArchiveClass::Inconsistent,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveDecision {
    Saved,
    Rejected(ArchiveClass),
}

/// `changes_positive` is `Some` when D1 sent `meta.changes`. `None` means the
/// metadata was missing: only then does an `archived_at` equal to this
/// request's timestamp count as the write. A reported zero still classifies.
pub fn decide_archive(
    changes_positive: Option<bool>,
    revision: i64,
    archived_at: Option<&str>,
    expected: i64,
    now: &str,
) -> ArchiveDecision {
    let saved = match changes_positive {
        Some(changed) => changed,
        None => revision == expected && archived_at == Some(now),
    };
    if saved && archived_at.is_some() && revision == expected {
        return ArchiveDecision::Saved;
    }
    if saved {
        return ArchiveDecision::Rejected(ArchiveClass::Inconsistent);
    }
    let head = HeadSnap {
        current_revision: revision,
        archived: archived_at.is_some(),
    };
    ArchiveDecision::Rejected(classify_archive(0, Some(&head), expected))
}

pub fn is_audit_action(action: &str) -> bool {
    matches!(
        action,
        "script.create"
            | "script.update"
            | "script.archive"
            | "runbook.create"
            | "runbook.update"
            | "runbook.archive"
    )
}

pub fn is_entity_type(entity_type: &str) -> bool {
    matches!(entity_type, "script" | "runbook")
}

fn has_code(message: &str, code: &str) -> bool {
    message.match_indices(code).any(|(index, _)| {
        match message[index + code.len()..].chars().next() {
            None => true,
            Some(c) => !c.is_ascii_alphanumeric() && c != '_',
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixed_d1_errors_keep_conflict_and_archive() {
        let prefixed = "D1_ERROR: SQLITE_CONSTRAINT: script_revisions_guard_insert: sp:revision_conflict";
        assert_eq!(
            classify_write_error(prefixed),
            WriteClass::RevisionConflict
        );
        assert_eq!(
            classify_write_error("Error: sp:archived"),
            WriteClass::Archived
        );
        assert_eq!(
            classify_write_error("wrapped sp:not_found trailing"),
            WriteClass::NotFound
        );
        assert_eq!(
            classify_write_error(
                "D1_ERROR: UNIQUE constraint failed: script_revisions.script_id, script_revisions.revision"
            ),
            WriteClass::RevisionConflict
        );
        assert_eq!(
            classify_write_error("PRIMARY KEY constraint failed"),
            WriteClass::RevisionConflict
        );
        assert_eq!(
            classify_write_error("FOREIGN KEY constraint failed"),
            WriteClass::ForeignKey
        );
        assert_eq!(
            classify_write_error("sp:immutable_revision"),
            WriteClass::Other
        );
        assert_eq!(
            classify_write_error("sp:revision_conflicted"),
            WriteClass::Other
        );
    }

    #[test]
    fn archive_prefers_archived_over_stale_revision() {
        let head = HeadSnap {
            current_revision: 4,
            archived: true,
        };
        assert_eq!(
            classify_archive(0, Some(&head), 3),
            ArchiveClass::Archived {
                current_revision: 4
            }
        );
        let live = HeadSnap {
            current_revision: 4,
            archived: false,
        };
        assert_eq!(
            classify_archive(0, Some(&live), 3),
            ArchiveClass::RevisionConflict {
                current_revision: 4
            }
        );
        assert_eq!(
            classify_archive(1, Some(&live), 4),
            ArchiveClass::Updated
        );
        assert_eq!(classify_archive(0, None, 1), ArchiveClass::NotFound);
        assert_eq!(
            classify_archive(0, Some(&live), 4),
            ArchiveClass::Inconsistent
        );
    }

    #[test]
    fn audit_vocabulary() {
        assert!(is_audit_action("script.create"));
        assert!(is_audit_action("runbook.archive"));
        assert!(!is_audit_action("script.delete"));
        assert!(is_entity_type("script"));
        assert!(!is_entity_type("cleanup"));
    }

    #[test]
    fn archive_decision_matches_changes_and_the_reloaded_row() {
        let now = "2026-09-30T00:00:00.000Z";
        assert_eq!(
            decide_archive(Some(true), 4, Some("earlier"), 4, now),
            ArchiveDecision::Saved
        );
        assert_eq!(
            decide_archive(Some(true), 4, Some(now), 4, now),
            ArchiveDecision::Saved
        );
        assert_eq!(
            decide_archive(Some(true), 5, Some(now), 4, now),
            ArchiveDecision::Rejected(ArchiveClass::Inconsistent)
        );
        assert_eq!(
            decide_archive(Some(true), 4, None, 4, now),
            ArchiveDecision::Rejected(ArchiveClass::Inconsistent)
        );
        assert_eq!(
            decide_archive(Some(false), 4, Some(now), 3, now),
            ArchiveDecision::Rejected(ArchiveClass::Archived {
                current_revision: 4
            })
        );
        assert_eq!(
            decide_archive(Some(false), 4, None, 3, now),
            ArchiveDecision::Rejected(ArchiveClass::RevisionConflict {
                current_revision: 4
            })
        );
        assert_eq!(
            decide_archive(Some(false), 4, None, 4, now),
            ArchiveDecision::Rejected(ArchiveClass::Inconsistent)
        );
        assert_eq!(
            decide_archive(None, 4, Some(now), 4, now),
            ArchiveDecision::Saved
        );
        assert_eq!(
            decide_archive(None, 4, Some("earlier"), 3, now),
            ArchiveDecision::Rejected(ArchiveClass::Archived {
                current_revision: 4
            })
        );
        assert_eq!(
            decide_archive(None, 4, None, 3, now),
            ArchiveDecision::Rejected(ArchiveClass::RevisionConflict {
                current_revision: 4
            })
        );
    }
}
