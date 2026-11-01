use super::*;
use rustix::fs::{self, AtFlags, FileType, Mode, OFlags};
use std::{
    fs::{File, Metadata},
    io::Read,
    os::unix::fs::MetadataExt,
    path::{Component, Path},
};
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Stamp {
    pub dev: u64,
    pub ino: u64,
    pub size: u64,
    pub mtime: i64,
    pub mtime_ns: i64,
    pub ctime: i64,
    pub ctime_ns: i64,
}
impl Stamp {
    fn of(m: &Metadata) -> Self {
        Self {
            dev: m.dev(),
            ino: m.ino(),
            size: m.len(),
            mtime: m.mtime(),
            mtime_ns: m.mtime_nsec(),
            ctime: m.ctime(),
            ctime_ns: m.ctime_nsec(),
        }
    }
    pub fn identity(&self) -> (u64, u64) {
        (self.dev, self.ino)
    }
    pub fn millis(&self) -> Option<flowshot_db::Millis> {
        self.mtime
            .checked_mul(1000)?
            .checked_add(self.mtime_ns / 1_000_000)
            .filter(|v| *v >= 0)
            .map(flowshot_db::Millis)
    }
}
fn map_io(e: rustix::io::Errno) -> flowshot_core::contracts::AppErrorDto {
    error(
        match e {
            rustix::io::Errno::LOOP => AppErrorCode::SymlinkForbidden,
            rustix::io::Errno::NOENT => AppErrorCode::NotFound,
            _ => AppErrorCode::IoError,
        },
        false,
    )
}
fn meta(file: &File) -> Result<Stamp> {
    file.metadata()
        .map(|m| Stamp::of(&m))
        .map_err(|_| error(AppErrorCode::IoError, true))
}
fn directory_at(parent: &File, name: &std::ffi::OsStr) -> Result<File> {
    fs::openat(
        parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(|e| {
        if fs::statat(parent, name, AtFlags::SYMLINK_NOFOLLOW)
            .is_ok_and(|s| FileType::from_raw_mode(s.st_mode) == FileType::Symlink)
        {
            error(AppErrorCode::SymlinkForbidden, false)
        } else {
            map_io(e)
        }
    })
}
fn absolute_directory(path: &Path) -> Result<File> {
    if !path.is_absolute() {
        return Err(error(AppErrorCode::PathOutsideWorkspace, false));
    }
    let mut file = File::from(
        fs::open(
            "/",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(map_io)?,
    );
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => file = directory_at(&file, name)?,
            _ => return Err(error(AppErrorCode::PathOutsideWorkspace, false)),
        }
    }
    Ok(file)
}
#[derive(Default, Clone, Copy, Debug, serde::Serialize)]
pub struct IoTrace {
    pub body_reads: u64,
    pub child_directory_opens: u64,
    pub max_retained_entries: usize,
}
thread_local! {static TRACE:std::cell::Cell<IoTrace>=const{std::cell::Cell::new(IoTrace{body_reads:0,child_directory_opens:0,max_retained_entries:0})};}
#[must_use]
pub fn take_io_trace() -> IoTrace {
    TRACE.replace(IoTrace::default())
}
pub(crate) fn retained_entries(count: usize) {
    let mut trace = TRACE.get();
    trace.max_retained_entries = trace.max_retained_entries.max(count);
    TRACE.set(trace);
}
fn body_read() {
    let mut trace = TRACE.get();
    trace.body_reads += 1;
    TRACE.set(trace);
}
fn child_open() {
    let mut trace = TRACE.get();
    trace.child_directory_opens += 1;
    TRACE.set(trace);
}
pub(crate) struct Guard {
    root: File,
    path: std::path::PathBuf,
    stamp: Stamp,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReadPhase {
    BeforeFinalOpen,
    AfterRead,
}
pub(crate) struct ReadResult {
    pub bytes: Vec<u8>,
    pub stamp: Stamp,
}
impl Guard {
    pub fn open(path: &Path) -> Result<Self> {
        let root = absolute_directory(path)?;
        let stamp = meta(&root)?;
        Ok(Self {
            root,
            path: path.into(),
            stamp,
        })
    }
    pub fn identity(&self) -> (u64, u64) {
        self.stamp.identity()
    }
    pub fn ancestor_identities(&self) -> Result<Vec<(u64, u64)>> {
        let mut result = Vec::new();
        let mut file = self
            .root
            .try_clone()
            .map_err(|_| error(AppErrorCode::IoError, false))?;
        loop {
            let current = meta(&file)?.identity();
            result.push(current);
            let parent = directory_at(&file, std::ffi::OsStr::new(".."))?;
            if meta(&parent)?.identity() == current {
                break;
            }
            file = parent;
        }
        Ok(result)
    }
    pub fn revalidate(&self) -> Result<()> {
        let current = absolute_directory(&self.path)?;
        if meta(&current)?.identity() != self.stamp.identity() {
            return Err(error(AppErrorCode::IoError, true));
        }
        Ok(())
    }
    pub fn directory(&self, relative: &str) -> Result<File> {
        let components = direct_components(relative, true).map_err(|c| error(c, false))?;
        let mut file = self
            .root
            .try_clone()
            .map_err(|_| error(AppErrorCode::IoError, false))?;
        for component in components {
            child_open();
            file = directory_at(&file, std::ffi::OsStr::new(&component))?;
        }
        Ok(file)
    }
    pub fn stamp_directory(&self, relative: &str) -> Result<Stamp> {
        meta(&self.directory(relative)?)
    }
    pub fn entries(
        &self,
        relative: &str,
        mut visit: impl FnMut(String, FileType) -> Result<()>,
    ) -> Result<(Stamp, u32)> {
        let file = self.directory(relative)?;
        let before = meta(&file)?;
        let entries = fs::Dir::read_from(&file).map_err(map_io)?;
        let mut unsupported = 0_u32;
        for entry in entries {
            let entry = entry.map_err(map_io)?;
            let name = match entry.file_name().to_str() {
                Ok("." | "..") => continue,
                Ok(name) => name.to_owned(),
                Err(_) => {
                    unsupported = unsupported.saturating_add(1);
                    continue;
                }
            };
            let mut kind = entry.file_type();
            if kind == FileType::Unknown {
                let stat =
                    fs::statat(&file, name.as_str(), AtFlags::SYMLINK_NOFOLLOW).map_err(map_io)?;
                kind = FileType::from_raw_mode(stat.st_mode);
            }
            visit(name, kind)?;
        }
        self.revalidate()?;
        if meta(&file)? != before || self.stamp_directory(relative)? != before {
            return Err(error(AppErrorCode::Conflict, true));
        }
        Ok((before, unsupported))
    }
    pub fn regular_file(&self, relative: &str) -> Result<Stamp> {
        let parts = direct_components(relative, false).map_err(|c| error(c, false))?;
        let name = parts
            .last()
            .ok_or_else(|| error(AppErrorCode::ValidationError, false))?;
        let parent_path = parts[..parts.len() - 1].join("/");
        let parent = self.directory(&parent_path)?;
        let file = File::from(
            fs::openat(
                &parent,
                name.as_str(),
                OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
                Mode::empty(),
            )
            .map_err(map_io)?,
        );
        let m = file
            .metadata()
            .map_err(|_| error(AppErrorCode::IoError, true))?;
        if !m.is_file() {
            return Err(error(AppErrorCode::UnsupportedMediaType, false));
        }
        self.revalidate()?;
        let current = self.directory(&parent_path)?;
        let stat =
            fs::statat(&current, name.as_str(), AtFlags::SYMLINK_NOFOLLOW).map_err(map_io)?;
        let stamp = Stamp::of(&m);
        if !same_identity(&stat, &stamp)
            || FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile
        {
            return Err(error(AppErrorCode::IoError, true));
        }
        Ok(stamp)
    }
    pub fn read(
        &self,
        relative: &str,
        limit: usize,
        too_large: AppErrorCode,
    ) -> Result<ReadResult> {
        self.read_with_hook(relative, limit, too_large, |_, _| {})
    }
    pub fn read_with_hook(
        &self,
        relative: &str,
        limit: usize,
        too_large: AppErrorCode,
        mut hook: impl FnMut(usize, ReadPhase),
    ) -> Result<ReadResult> {
        for attempt in 0..=2 {
            match self.read_once(relative, limit, too_large, &mut hook, attempt) {
                Err(e) if e.retryable && attempt < 2 => {}
                result => return result,
            }
        }
        Err(error(AppErrorCode::IoError, true))
    }
    fn read_once(
        &self,
        relative: &str,
        limit: usize,
        too_large: AppErrorCode,
        hook: &mut impl FnMut(usize, ReadPhase),
        attempt: usize,
    ) -> Result<ReadResult> {
        let components = direct_components(relative, false).map_err(|c| error(c, false))?;
        let name = components
            .last()
            .ok_or_else(|| error(AppErrorCode::ValidationError, false))?;
        let parent_path = components[..components.len() - 1].join("/");
        let parent = self.directory(&parent_path)?;
        let parent_stamp = meta(&parent)?;
        hook(attempt, ReadPhase::BeforeFinalOpen);
        let fd = fs::openat(
            &parent,
            name.as_str(),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(map_io)?;
        let mut file = File::from(fd);
        let metadata = file
            .metadata()
            .map_err(|_| error(AppErrorCode::IoError, true))?;
        if !metadata.is_file() {
            return Err(error(AppErrorCode::UnsupportedMediaType, false));
        }
        let before = Stamp::of(&metadata);
        if before.size > u64::try_from(limit).unwrap_or(u64::MAX) {
            return Err(error(too_large, false));
        }
        let mut bytes =
            Vec::with_capacity(usize::try_from(before.size).unwrap_or(limit).min(limit));
        body_read();
        file.by_ref()
            .take(u64::try_from(limit).unwrap_or(u64::MAX) + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| error(AppErrorCode::IoError, true))?;
        if bytes.len() > limit {
            return Err(error(too_large, false));
        }
        hook(attempt, ReadPhase::AfterRead);
        self.revalidate()?;
        let new_parent = self.directory(&parent_path)?;
        let entry =
            fs::statat(&new_parent, name.as_str(), AtFlags::SYMLINK_NOFOLLOW).map_err(map_io)?;
        let same_entry = same_identity(&entry, &before)
            && FileType::from_raw_mode(entry.st_mode) == FileType::RegularFile;
        if !same_entry
            || meta(&file)? != before
            || meta(&new_parent)?.identity() != parent_stamp.identity()
        {
            return Err(error(AppErrorCode::IoError, true));
        }
        Ok(ReadResult {
            bytes,
            stamp: before,
        })
    }
}

#[allow(
    clippy::cast_lossless,
    clippy::cast_sign_loss,
    clippy::unnecessary_cast
)]
fn same_identity(stat: &rustix::fs::Stat, stamp: &Stamp) -> bool {
    stat.st_dev as u64 == stamp.dev && stat.st_ino as u64 == stamp.ino
}
#[cfg(test)]
#[path = "tests.rs"]
mod tests;
