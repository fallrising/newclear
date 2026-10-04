use std::fs::{self, OpenOptions};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::PathBuf;

use crate::{DatabasePathErrorKind, EventStoreError};

pub(crate) struct ValidatedDatabasePath {
    pub(crate) path: PathBuf,
}

pub(crate) fn validate_and_prepare(
    path: PathBuf,
) -> Result<ValidatedDatabasePath, EventStoreError> {
    if !path.is_absolute() {
        return invalid(DatabasePathErrorKind::Relative);
    }
    if path.file_name().is_none() {
        return invalid(DatabasePathErrorKind::MissingFileName);
    }

    let parent = path.parent().ok_or(EventStoreError::InvalidDatabasePath {
        reason: DatabasePathErrorKind::ParentUnavailable,
    })?;
    let parent_metadata =
        fs::symlink_metadata(parent).map_err(|_| EventStoreError::InvalidDatabasePath {
            reason: DatabasePathErrorKind::ParentUnavailable,
        })?;
    if !parent_metadata.file_type().is_dir() {
        return invalid(DatabasePathErrorKind::ParentNotDirectory);
    }
    let canonical_parent =
        fs::canonicalize(parent).map_err(|_| EventStoreError::InvalidDatabasePath {
            reason: DatabasePathErrorKind::ParentUnavailable,
        })?;
    if canonical_parent != parent {
        return invalid(DatabasePathErrorKind::ParentNotCanonical);
    }
    let effective_uid = effective_uid();
    if let Some(reason) = owner_mode_error(
        parent_metadata.uid(),
        parent_metadata.mode(),
        effective_uid,
        DatabasePathErrorKind::ParentWrongOwner,
        DatabasePathErrorKind::ParentOpenPermissions,
    ) {
        return invalid(reason);
    }

    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return invalid(DatabasePathErrorKind::TargetSymlink);
            }
            if !metadata.file_type().is_file() {
                return invalid(DatabasePathErrorKind::TargetNotRegular);
            }
            if let Some(reason) = owner_mode_error(
                metadata.uid(),
                metadata.mode(),
                effective_uid,
                DatabasePathErrorKind::TargetWrongOwner,
                DatabasePathErrorKind::TargetOpenPermissions,
            ) {
                return invalid(reason);
            }
            Ok(ValidatedDatabasePath { path })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
            {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let metadata = fs::symlink_metadata(&path).map_err(|_| {
                        EventStoreError::InvalidDatabasePath {
                            reason: DatabasePathErrorKind::CreateFailed,
                        }
                    })?;
                    if metadata.file_type().is_symlink() {
                        return invalid(DatabasePathErrorKind::TargetSymlink);
                    }
                    if !metadata.file_type().is_file() {
                        return invalid(DatabasePathErrorKind::TargetNotRegular);
                    }
                    if let Some(reason) = owner_mode_error(
                        metadata.uid(),
                        metadata.mode(),
                        effective_uid,
                        DatabasePathErrorKind::TargetWrongOwner,
                        DatabasePathErrorKind::TargetOpenPermissions,
                    ) {
                        return invalid(reason);
                    }
                    return Ok(ValidatedDatabasePath { path });
                }
                Err(_) => return invalid(DatabasePathErrorKind::CreateFailed),
            }
            Ok(ValidatedDatabasePath { path })
        }
        Err(_) => invalid(DatabasePathErrorKind::CreateFailed),
    }
}

fn invalid<T>(reason: DatabasePathErrorKind) -> Result<T, EventStoreError> {
    Err(EventStoreError::InvalidDatabasePath { reason })
}

fn effective_uid() -> u32 {
    // SAFETY: `geteuid` takes no arguments and has no memory-safety preconditions.
    unsafe { libc::geteuid() }
}

fn owner_mode_error(
    actual_uid: u32,
    mode: u32,
    expected_uid: u32,
    wrong_owner: DatabasePathErrorKind,
    open_permissions: DatabasePathErrorKind,
) -> Option<DatabasePathErrorKind> {
    if actual_uid != expected_uid {
        Some(wrong_owner)
    } else if mode & 0o077 != 0 {
        Some(open_permissions)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_owner_policy_rejects_foreign_parent_and_target() {
        let expected_uid = 1_000;
        assert_eq!(
            owner_mode_error(
                expected_uid + 1,
                0o700,
                expected_uid,
                DatabasePathErrorKind::ParentWrongOwner,
                DatabasePathErrorKind::ParentOpenPermissions,
            ),
            Some(DatabasePathErrorKind::ParentWrongOwner)
        );
        assert_eq!(
            owner_mode_error(
                expected_uid + 1,
                0o600,
                expected_uid,
                DatabasePathErrorKind::TargetWrongOwner,
                DatabasePathErrorKind::TargetOpenPermissions,
            ),
            Some(DatabasePathErrorKind::TargetWrongOwner)
        );
    }
}
