//! Static SQL. Values are always `?N` binds. D1 `batch` is the transaction;
//! these statements never issue BEGIN/COMMIT.

/// Args: now.
pub const INSERT_SCRIPT: &str = "INSERT INTO scripts (created_at, updated_at) VALUES (?1, ?1)";

/// Args: title, description, tags_json, tag_index, language, body, now, actor.
pub const INSERT_SCRIPT_REVISION_NEW: &str = "\
INSERT INTO script_revisions (
  script_id, revision, title, description, tags_json, tag_index, language, body, created_at, created_by
) VALUES ((SELECT max(id) FROM scripts), 1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)";

pub const SELECT_NEW_SCRIPT_ID: &str = "SELECT max(id) AS id FROM scripts";

/// Args: script_id, revision, title, description, tags_json, tag_index, language, body, now, actor.
pub const INSERT_SCRIPT_REVISION: &str = "\
INSERT INTO script_revisions (
  script_id, revision, title, description, tags_json, tag_index, language, body, created_at, created_by
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)";

/// Args: id.
pub const SELECT_SCRIPT: &str = "\
SELECT s.id AS id,
       s.current_revision AS revision,
       r.title AS title,
       r.description AS description,
       r.tags_json AS tags_json,
       r.language AS language,
       r.body AS body,
       s.created_at AS created_at,
       s.updated_at AS updated_at,
       s.archived_at AS archived_at
FROM scripts s
JOIN script_revisions r
  ON r.script_id = s.id AND r.revision = s.current_revision
WHERE s.id = ?1";

/// Args: id.
pub const SELECT_SCRIPT_SNAP: &str =
    "SELECT current_revision AS current_revision, archived_at AS archived_at FROM scripts WHERE id = ?1";

/// Args: archived mode, has_before, before_id, has_q, like pattern, has_tag, tag, limit.
pub const LIST_SCRIPTS: &str = "\
SELECT s.id AS id,
       s.current_revision AS revision,
       r.title AS title,
       r.tags_json AS tags_json,
       r.language AS language,
       length(CAST(r.body AS BLOB)) AS byte_size,
       s.updated_at AS updated_at,
       s.archived_at AS archived_at
FROM scripts s
JOIN script_revisions r
  ON r.script_id = s.id AND r.revision = s.current_revision
WHERE (
    (?1 = 'exclude' AND s.archived_at IS NULL)
    OR ?1 = 'include'
    OR (?1 = 'only' AND s.archived_at IS NOT NULL)
  )
  AND (?2 = 0 OR s.id < ?3)
  AND (?4 = 0 OR instr(lower(r.title), lower(?5)) > 0)
  AND (?6 = 0 OR r.tag_index LIKE '%,' || ?7 || ',%')
ORDER BY s.id DESC
LIMIT ?8";

/// Args: id.
pub const SCRIPT_EXISTS: &str = "SELECT 1 AS ok FROM scripts WHERE id = ?1";

/// Args: script_id, has_before, before_revision, limit.
pub const LIST_SCRIPT_REVISIONS: &str = "\
SELECT revision AS revision,
       title AS title,
       language AS language,
       length(CAST(body AS BLOB)) AS byte_size,
       created_at AS created_at,
       created_by AS created_by
FROM script_revisions
WHERE script_id = ?1
  AND (?2 = 0 OR revision < ?3)
ORDER BY revision DESC
LIMIT ?4";

/// Args: script_id, revision.
pub const SELECT_SCRIPT_REVISION: &str = "\
SELECT r.script_id AS script_id,
       r.revision AS revision,
       r.title AS title,
       r.description AS description,
       r.tags_json AS tags_json,
       r.language AS language,
       r.body AS body,
       r.created_at AS created_at,
       r.created_by AS created_by,
       CASE WHEN r.revision = s.current_revision THEN 1 ELSE 0 END AS is_current,
       s.archived_at AS script_archived_at
FROM script_revisions r
JOIN scripts s ON s.id = r.script_id
WHERE r.script_id = ?1 AND r.revision = ?2";

/// Args: now, actor, id, expected_revision.
pub const ARCHIVE_SCRIPT: &str = "\
UPDATE scripts
SET archived_at = ?1, archived_by = ?2
WHERE id = ?3 AND current_revision = ?4 AND archived_at IS NULL";

/// Args: now.
pub const INSERT_RUNBOOK: &str = "INSERT INTO runbooks (created_at, updated_at) VALUES (?1, ?1)";

/// Args: title, description, step_count, now, actor.
pub const INSERT_RUNBOOK_REVISION_NEW: &str = "\
INSERT INTO runbook_revisions (
  runbook_id, revision, title, description, step_count, created_at, created_by
) VALUES ((SELECT max(id) FROM runbooks), 1, ?1, ?2, ?3, ?4, ?5)";

/// Args: position, script_id, script_revision, instruction.
pub const INSERT_RUNBOOK_STEP_NEW: &str = "\
INSERT INTO runbook_steps (
  runbook_id, revision, position, script_id, script_revision, instruction
) VALUES ((SELECT max(id) FROM runbooks), 1, ?1, ?2, ?3, ?4)";

pub const SELECT_NEW_RUNBOOK: &str = "\
SELECT rb.id AS id,
       rb.current_revision AS revision,
       rr.title AS title,
       rr.description AS description,
       rr.step_count AS step_count,
       rb.created_at AS created_at,
       rb.updated_at AS updated_at,
       rb.archived_at AS archived_at
FROM runbooks rb
JOIN runbook_revisions rr
  ON rr.runbook_id = rb.id AND rr.revision = rb.current_revision
WHERE rb.id = (SELECT max(id) FROM runbooks)";

pub const SELECT_NEW_RUNBOOK_STEPS: &str = "\
SELECT st.position AS position,
       st.script_id AS script_id,
       st.script_revision AS script_revision,
       st.instruction AS instruction,
       sr.title AS script_title,
       sr.language AS script_language,
       CASE WHEN s.archived_at IS NULL THEN 0 ELSE 1 END AS script_archived
FROM runbook_steps st
JOIN script_revisions sr
  ON sr.script_id = st.script_id AND sr.revision = st.script_revision
JOIN scripts s ON s.id = st.script_id
WHERE st.runbook_id = (SELECT max(id) FROM runbooks)
  AND st.revision = 1
ORDER BY st.position ASC";

/// Args: runbook_id, revision, title, description, step_count, now, actor.
pub const INSERT_RUNBOOK_REVISION: &str = "\
INSERT INTO runbook_revisions (
  runbook_id, revision, title, description, step_count, created_at, created_by
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)";

/// Args: runbook_id, revision, position, script_id, script_revision, instruction.
pub const INSERT_RUNBOOK_STEP: &str = "\
INSERT INTO runbook_steps (
  runbook_id, revision, position, script_id, script_revision, instruction
) VALUES (?1, ?2, ?3, ?4, ?5, ?6)";

/// Args: id.
pub const SELECT_RUNBOOK: &str = "\
SELECT rb.id AS id,
       rb.current_revision AS revision,
       rr.title AS title,
       rr.description AS description,
       rr.step_count AS step_count,
       rb.created_at AS created_at,
       rb.updated_at AS updated_at,
       rb.archived_at AS archived_at
FROM runbooks rb
JOIN runbook_revisions rr
  ON rr.runbook_id = rb.id AND rr.revision = rb.current_revision
WHERE rb.id = ?1";

/// Args: runbook_id, revision.
pub const SELECT_RUNBOOK_STEPS: &str = "\
SELECT st.position AS position,
       st.script_id AS script_id,
       st.script_revision AS script_revision,
       st.instruction AS instruction,
       sr.title AS script_title,
       sr.language AS script_language,
       CASE WHEN s.archived_at IS NULL THEN 0 ELSE 1 END AS script_archived
FROM runbook_steps st
JOIN script_revisions sr
  ON sr.script_id = st.script_id AND sr.revision = st.script_revision
JOIN scripts s ON s.id = st.script_id
WHERE st.runbook_id = ?1 AND st.revision = ?2
ORDER BY st.position ASC";

/// Args: runbook_id, revision. Same join as steps, plus the pinned body.
pub const SELECT_EXPORT_STEPS: &str = "\
SELECT st.position AS position,
       st.script_id AS script_id,
       st.script_revision AS script_revision,
       st.instruction AS instruction,
       sr.title AS script_title,
       sr.language AS script_language,
       sr.body AS script_body,
       CASE WHEN s.archived_at IS NULL THEN 0 ELSE 1 END AS script_archived
FROM runbook_steps st
JOIN script_revisions sr
  ON sr.script_id = st.script_id AND sr.revision = st.script_revision
JOIN scripts s ON s.id = st.script_id
WHERE st.runbook_id = ?1 AND st.revision = ?2
ORDER BY st.position ASC";

/// Args: archived mode, has_before, before_id, has_q, like pattern, limit.
pub const LIST_RUNBOOKS: &str = "\
SELECT rb.id AS id,
       rb.current_revision AS revision,
       rr.title AS title,
       rr.step_count AS step_count,
       rb.updated_at AS updated_at,
       rb.archived_at AS archived_at
FROM runbooks rb
JOIN runbook_revisions rr
  ON rr.runbook_id = rb.id AND rr.revision = rb.current_revision
WHERE (
    (?1 = 'exclude' AND rb.archived_at IS NULL)
    OR ?1 = 'include'
    OR (?1 = 'only' AND rb.archived_at IS NOT NULL)
  )
  AND (?2 = 0 OR rb.id < ?3)
  AND (?4 = 0 OR instr(lower(rr.title), lower(?5)) > 0)
ORDER BY rb.id DESC
LIMIT ?6";

/// Args: id.
pub const RUNBOOK_EXISTS: &str = "SELECT 1 AS ok FROM runbooks WHERE id = ?1";

/// Args: runbook_id, has_before, before_revision, limit.
pub const LIST_RUNBOOK_REVISIONS: &str = "\
SELECT revision AS revision,
       title AS title,
       step_count AS step_count,
       created_at AS created_at,
       created_by AS created_by
FROM runbook_revisions
WHERE runbook_id = ?1
  AND (?2 = 0 OR revision < ?3)
ORDER BY revision DESC
LIMIT ?4";

/// Args: runbook_id, revision.
pub const SELECT_RUNBOOK_REVISION: &str = "\
SELECT rr.runbook_id AS runbook_id,
       rr.revision AS revision,
       rr.title AS title,
       rr.description AS description,
       rr.step_count AS step_count,
       rr.created_at AS created_at,
       rr.created_by AS created_by,
       CASE WHEN rr.revision = rb.current_revision THEN 1 ELSE 0 END AS is_current,
       rb.archived_at AS runbook_archived_at
FROM runbook_revisions rr
JOIN runbooks rb ON rb.id = rr.runbook_id
WHERE rr.runbook_id = ?1 AND rr.revision = ?2";

/// Args: now, actor, id, expected_revision.
pub const ARCHIVE_RUNBOOK: &str = "\
UPDATE runbooks
SET archived_at = ?1, archived_by = ?2
WHERE id = ?3 AND current_revision = ?4 AND archived_at IS NULL";

/// Args: id.
pub const SELECT_RUNBOOK_SNAP: &str =
    "SELECT current_revision AS current_revision, archived_at AS archived_at FROM runbooks WHERE id = ?1";

/// Args: script_id, script_revision.
pub const PIN_EXISTS: &str =
    "SELECT 1 AS ok FROM script_revisions WHERE script_id = ?1 AND revision = ?2";

/// Args: has_before, before_id, limit.
pub const LIST_AUDIT: &str = "\
SELECT id AS id,
       occurred_at AS occurred_at,
       actor AS actor,
       action AS action,
       entity_type AS entity_type,
       entity_id AS entity_id,
       revision AS revision
FROM audit_events
WHERE (?1 = 0 OR id < ?2)
ORDER BY id DESC
LIMIT ?3";

pub const HEALTH: &str = "SELECT 1 AS ok";

pub fn all_statements() -> &'static [&'static str] {
    &[
        INSERT_SCRIPT,
        INSERT_SCRIPT_REVISION_NEW,
        SELECT_NEW_SCRIPT_ID,
        INSERT_SCRIPT_REVISION,
        SELECT_SCRIPT,
        SELECT_SCRIPT_SNAP,
        LIST_SCRIPTS,
        SCRIPT_EXISTS,
        LIST_SCRIPT_REVISIONS,
        SELECT_SCRIPT_REVISION,
        ARCHIVE_SCRIPT,
        INSERT_RUNBOOK,
        INSERT_RUNBOOK_REVISION_NEW,
        INSERT_RUNBOOK_STEP_NEW,
        SELECT_NEW_RUNBOOK,
        SELECT_NEW_RUNBOOK_STEPS,
        INSERT_RUNBOOK_REVISION,
        INSERT_RUNBOOK_STEP,
        SELECT_RUNBOOK,
        SELECT_RUNBOOK_STEPS,
        SELECT_EXPORT_STEPS,
        LIST_RUNBOOKS,
        RUNBOOK_EXISTS,
        LIST_RUNBOOK_REVISIONS,
        SELECT_RUNBOOK_REVISION,
        ARCHIVE_RUNBOOK,
        SELECT_RUNBOOK_SNAP,
        PIN_EXISTS,
        LIST_AUDIT,
        HEALTH,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statements_are_bound_and_do_not_manage_transactions() {
        for sql in all_statements() {
            let upper = sql.to_ascii_uppercase();
            assert!(!upper.contains("BEGIN"), "{sql}");
            assert!(!upper.contains("COMMIT"), "{sql}");
            assert!(!upper.contains("ROLLBACK"), "{sql}");
        }
    }

    #[test]
    fn search_pagination_archive_and_historical_pins() {
        assert!(LIST_SCRIPTS.contains("ORDER BY s.id DESC"));
        assert!(LIST_SCRIPTS.contains("instr(lower(r.title), lower(?5)) > 0"));
        assert!(LIST_SCRIPTS.contains("tag_index LIKE '%,' || ?7 || ',%'"));
        assert!(LIST_RUNBOOKS.contains("ORDER BY rb.id DESC"));
        assert!(LIST_SCRIPT_REVISIONS.contains("ORDER BY revision DESC"));
        assert!(LIST_AUDIT.contains("ORDER BY id DESC"));
        assert!(ARCHIVE_SCRIPT.contains("archived_at IS NULL"));
        assert!(ARCHIVE_SCRIPT.contains("current_revision = ?4"));
        assert!(ARCHIVE_RUNBOOK.contains("archived_by = ?2"));
        assert!(SELECT_EXPORT_STEPS.contains("sr.body AS script_body"));
        assert!(SELECT_EXPORT_STEPS.contains("sr.revision = st.script_revision"));
        assert!(SELECT_RUNBOOK_STEPS.contains("sr.script_id = st.script_id"));
        assert!(SELECT_NEW_RUNBOOK_STEPS.contains("st.revision = 1"));
        assert!(INSERT_SCRIPT_REVISION_NEW.contains("(SELECT max(id) FROM scripts), 1"));
        assert!(INSERT_RUNBOOK_REVISION_NEW.contains("(SELECT max(id) FROM runbooks), 1"));
        assert!(PIN_EXISTS.contains("script_id = ?1 AND revision = ?2"));
        assert!(!LIST_SCRIPTS.contains("DELETE"));
        assert!(!SELECT_SCRIPT.contains("BEGIN"));
    }
}
