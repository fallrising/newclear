use super::*;
use base64::Engine;
use std::collections::VecDeque;
use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tokio::io::unix::AsyncFd;

const READY: Duration = Duration::from_secs(40);
const PASTE: Duration = Duration::from_secs(10);

struct Fd(AsyncFd<OwnedFd>);
impl Fd {
    fn new(fd: OwnedFd) -> Result<Self> {
        // SAFETY: fd is owned and valid; preserve existing file flags.
        unsafe {
            let flags = libc::fcntl(fd.as_raw_fd(), libc::F_GETFL);
            ensure!(
                flags >= 0
                    && libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) >= 0,
                "TUI descriptor setup failed"
            );
        }
        Ok(Self(AsyncFd::new(fd).map_err(|_| {
            anyhow::anyhow!("TUI descriptor unavailable")
        })?))
    }
    fn duplicate(fd: RawFd) -> Result<Self> {
        // SAFETY: duplicate only standard descriptors owned by this helper.
        let n = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 3) };
        ensure!(n >= 0, "TUI standard descriptor unavailable");
        Self::new(unsafe { OwnedFd::from_raw_fd(n) })
    }
    async fn read(&self, buf: &mut [u8]) -> Result<usize> {
        loop {
            let mut ready = self.0.readable().await?;
            match ready.try_io(|fd| {
                let n = unsafe {
                    libc::read(fd.get_ref().as_raw_fd(), buf.as_mut_ptr().cast(), buf.len())
                };
                if n < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(n as usize)
                }
            }) {
                Ok(Ok(n)) => return Ok(n),
                Ok(Err(e)) if e.raw_os_error() == Some(libc::EIO) => return Ok(0),
                Ok(Err(_)) => bail!("TUI descriptor read failed"),
                Err(_) => {}
            }
        }
    }
    async fn write(&self, mut bytes: &[u8]) -> Result<()> {
        while !bytes.is_empty() {
            let mut ready = self.0.writable().await?;
            match ready.try_io(|fd| {
                let n = unsafe {
                    libc::write(fd.get_ref().as_raw_fd(), bytes.as_ptr().cast(), bytes.len())
                };
                if n < 0 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(n as usize)
                }
            }) {
                Ok(Ok(0)) | Ok(Err(_)) => bail!("TUI descriptor write failed"),
                Ok(Ok(n)) => bytes = &bytes[n..],
                Err(_) => {}
            }
        }
        Ok(())
    }
    async fn emit(&self, value: Value) -> Result<()> {
        let mut bytes = serde_json::to_vec(&value)?;
        bytes.push(b'\n');
        self.write(&bytes).await
    }
}

struct OwnedDir(PathBuf);
impl OwnedDir {
    fn new() -> Result<Self> {
        // A fixed, whitespace-free base makes BUN_OPTIONS unambiguous. Never sweep old dirs.
        let path = PathBuf::from("/tmp").join(format!(
            "thinrouter-claude-tui-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(|_| anyhow::anyhow!("TUI private directory unavailable"))?;
        Ok(Self(path))
    }
    fn file(&self, name: &str, data: &[u8]) -> Result<PathBuf> {
        let path = self.0.join(name);
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&path)
            .map_err(|_| anyhow::anyhow!("TUI private file unavailable"))?;
        f.write_all(data)
            .map_err(|_| anyhow::anyhow!("TUI private file write failed"))?;
        Ok(path)
    }
}
impl Drop for OwnedDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// This watchdog has no Rust work after fork: only async-signal-safe syscalls.
// Its sole authority is the PTY group we just created. Pipe EOF also covers an
// uncatchable helper SIGKILL, when Rust Drop and parent-death of the leader alone
// cannot clean up an MCP descendant.
struct Watchdog {
    write: Option<OwnedFd>,
    pid: libc::pid_t,
    directory: PathBuf,
}
impl Watchdog {
    fn new(pgid: libc::pid_t, owned: &OwnedDir) -> Result<Self> {
        // Prepare every name and descriptor before fork. The monitor never scans a
        // directory, follows a symlink, allocates, or invokes Rust filesystem APIs.
        let directory = CString::new(owned.0.as_os_str().as_bytes())
            .map_err(|_| anyhow::anyhow!("TUI cleanup directory unavailable"))?;
        let dir = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&owned.0)
            .map_err(|_| anyhow::anyhow!("TUI cleanup directory unavailable"))?;
        let mut files = vec![
            CString::new("tap.js").unwrap(),
            CString::new("tap.jsonl").unwrap(),
        ];
        for n in 1..=64 {
            for extension in ["png", "jpg", "gif", "webp"] {
                files.push(CString::new(format!("image-{n}.{extension}")).unwrap());
            }
        }
        let mut pipe = [-1; 2];
        ensure!(
            unsafe { libc::pipe(pipe.as_mut_ptr()) } == 0,
            "TUI cleanup watchdog unavailable"
        );
        let read = unsafe { OwnedFd::from_raw_fd(pipe[0]) };
        let write = unsafe { OwnedFd::from_raw_fd(pipe[1]) };
        for fd in [&read, &write] {
            ensure!(
                unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } == 0,
                "TUI cleanup watchdog unavailable"
            );
        }
        let maxfd = unsafe { libc::sysconf(libc::_SC_OPEN_MAX) }.clamp(1024, 1_048_576) as i32;
        let pid = unsafe { libc::fork() };
        ensure!(pid >= 0, "TUI cleanup watchdog unavailable");
        if pid == 0 {
            unsafe {
                // Detach from the helper's group, so killing that group cannot kill
                // its cleanup monitor before the monitor sees pipe EOF.
                if libc::setsid() < 0 {
                    libc::kill(-pgid, libc::SIGKILL);
                    cleanup_watchdog_files(dir.as_raw_fd(), &files, &directory);
                    libc::_exit(1);
                }
                let kept = read.as_raw_fd();
                let dirfd = dir.as_raw_fd();
                let low = kept.min(dirfd);
                let high = kept.max(dirfd);
                #[cfg(target_os = "linux")]
                let closed = {
                    let a = if low > 0 {
                        libc::syscall(libc::SYS_close_range, 0u32, (low - 1) as u32, 0u32)
                    } else {
                        0
                    };
                    let b = if high > low + 1 {
                        libc::syscall(
                            libc::SYS_close_range,
                            (low + 1) as u32,
                            (high - 1) as u32,
                            0u32,
                        )
                    } else {
                        0
                    };
                    let c = libc::syscall(libc::SYS_close_range, (high + 1) as u32, u32::MAX, 0u32);
                    a == 0 && b == 0 && c == 0
                };
                #[cfg(not(target_os = "linux"))]
                let closed = false;
                if !closed {
                    for fd in 0..maxfd {
                        if fd != kept && fd != dirfd {
                            libc::close(fd);
                        }
                    }
                }
                let mut byte = 0u8;
                loop {
                    let n = libc::read(kept, (&mut byte as *mut u8).cast(), 1);
                    if n == 0 {
                        break;
                    }
                    if n > 0 {
                        libc::_exit(0);
                    } // Normal cleanup explicitly disarms us.
                    if n < 0 {
                        // EINTR is the only recoverable read error for this pipe.
                        #[cfg(target_os = "linux")]
                        if *libc::__errno_location() == libc::EINTR {
                            continue;
                        }
                        break;
                    }
                }
                libc::kill(-pgid, libc::SIGKILL);
                // Allow killed descendants to finish outstanding syscalls before
                // unlinking their private inputs; zombies need no further wait.
                let pause = libc::timespec {
                    tv_sec: 0,
                    tv_nsec: 10_000_000,
                };
                for _ in 0..100 {
                    if libc::kill(-pgid, 0) < 0 {
                        break;
                    }
                    libc::nanosleep(&pause, std::ptr::null_mut());
                }
                cleanup_watchdog_files(dirfd, &files, &directory);
                libc::_exit(0);
            }
        }
        drop(read);
        Ok(Self {
            write: Some(write),
            pid,
            directory: owned.0.clone(),
        })
    }
}

// Called only in the fork child, with preallocated fixed names and its own dirfd.
unsafe fn cleanup_watchdog_files(dirfd: RawFd, files: &[CString], directory: &CString) {
    for name in files {
        libc::unlinkat(dirfd, name.as_ptr(), 0);
    }
    libc::rmdir(directory.as_ptr());
}
impl Drop for Watchdog {
    fn drop(&mut self) {
        // Keep the crash monitor armed until private payload removal is complete.
        // ChildGuard has already stopped/reaped the PTY group before field drops.
        let cleaned = std::fs::remove_dir_all(&self.directory).is_ok();
        if let Some(fd) = self.write.as_ref().filter(|_| cleaned) {
            let byte = 1u8;
            unsafe {
                libc::write(fd.as_raw_fd(), (&byte as *const u8).cast(), 1);
            }
        }
        self.write.take();
        unsafe {
            libc::waitpid(self.pid, std::ptr::null_mut(), 0);
        }
    }
}

struct ChildGuard(Child, Option<Watchdog>);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let pgid = self.0.id() as i32;
        // The child's setsid created this owned group. Signal it even if its leader exited.
        unsafe {
            libc::kill(-pgid, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            // Reap an exited leader promptly: otherwise its zombie alone makes
            // kill(-pgid, 0) succeed for the entire graceful shutdown window.
            let _ = self.0.try_wait();
            if unsafe { libc::kill(-pgid, 0) } < 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
        let _ = self.0.wait();
    }
}

fn launch(bin: &str, args: &[String], dir: &OwnedDir, tap_path: &Path) -> Result<(ChildGuard, Fd)> {
    let mut master = -1;
    let mut slave = -1;
    let size = libc::winsize {
        ws_row: 40,
        ws_col: 160,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    ensure!(
        unsafe {
            libc::openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null(),
                &size,
            )
        } == 0,
        "TUI PTY unavailable"
    );
    let master = unsafe { OwnedFd::from_raw_fd(master) };
    let slave = unsafe { File::from_raw_fd(slave) };
    ensure!(
        unsafe { libc::fcntl(master.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } == 0,
        "TUI PTY setup failed"
    );
    ensure!(
        unsafe { libc::fcntl(slave.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) } == 0,
        "TUI PTY setup failed"
    );
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::from(slave.try_clone()?))
        .stdout(Stdio::from(slave.try_clone()?))
        .stderr(Stdio::from(slave));
    for (key, _) in std::env::vars_os() {
        let k = key.to_string_lossy();
        if matches!(
            k.as_ref(),
            "BUN_OPTIONS"
                | "NODE_OPTIONS"
                | "CLAUDECODE"
                | "CLAUDE_CODE_ENTRYPOINT"
                | "CLAUDE_CODE_CHILD_SESSION"
                | "CLAUDE_CODE_SESSION_ID"
                | "CLAUDE_CODE_SESSION_ATTENDED"
                | "CLAUDE_CODE_EXECPATH"
                | "CLAUDE_PID"
                | "CLAUDE_EFFORT"
                | "THINROUTER_CLAUDE_TAP"
        ) || k.starts_with("CLAUDE_CODE_MESSAGING_")
        {
            cmd.env_remove(key);
        }
    }
    cmd.env("TERM", "xterm-256color")
        .env("COLUMNS", "160")
        .env("LINES", "40")
        .env(
            "BUN_OPTIONS",
            format!("--preload {}", dir.0.join("tap.js").display()),
        )
        .env("THINROUTER_CLAUDE_TAP", tap_path);
    let parent = unsafe { libc::getpid() };
    unsafe {
        cmd.pre_exec(move || {
            if libc::setsid() < 0 || libc::ioctl(0, libc::TIOCSCTTY, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            #[cfg(target_os = "linux")]
            {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::getppid() != parent {
                    return Err(std::io::Error::from_raw_os_error(libc::ECHILD));
                }
            }
            Ok(())
        });
    }
    let child = cmd
        .spawn()
        .map_err(|_| anyhow::anyhow!("Claude TUI process could not start"))?;
    let mut child = ChildGuard(child, None);
    child.1 = Some(Watchdog::new(child.0.id() as i32, dir)?);
    Ok((child, Fd::new(master)?))
}

struct Tail {
    file: Option<File>,
    offset: u64,
    initial: u64,
    lines: Lines,
}
impl Tail {
    fn new(offset: u64) -> Self {
        Self {
            file: None,
            offset,
            initial: offset,
            lines: Lines::default(),
        }
    }
    fn poll(&mut self, path: &Path) -> Result<Vec<Value>> {
        if self.file.is_none() {
            if let Some(parent) = path.parent() {
                if let Ok(meta) = std::fs::symlink_metadata(parent) {
                    ensure!(
                        !meta.file_type().is_symlink(),
                        "unsafe TUI transcript location"
                    );
                }
            }
            match OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(path)
            {
                Ok(mut f) => {
                    ensure!(f.metadata()?.is_file(), "unsafe TUI observation file");
                    f.seek(SeekFrom::Start(self.offset))?;
                    self.file = Some(f);
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
                Err(_) => bail!("TUI observation file unavailable"),
            }
        }
        let f = self.file.as_mut().unwrap();
        let size = f.metadata()?.len();
        ensure!(
            size >= self.offset && size.saturating_sub(self.initial) <= MAX_FILE,
            "TUI observation file changed or exceeds limit"
        );
        let mut out = Vec::new();
        let mut bytes = [0; 65536];
        // Bound each poll so signals, stdin, PTY and tap remain fair.
        for _ in 0..16 {
            let n = f
                .read(&mut bytes)
                .map_err(|_| anyhow::anyhow!("TUI observation read failed"))?;
            if n == 0 {
                break;
            }
            self.offset += n as u64;
            out.extend(self.lines.push(&bytes[..n])?);
        }
        Ok(out)
    }
}

pub(super) fn plain(bytes: &[u8]) -> String {
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 27 {
            i += 1;
            if i >= bytes.len() {
                break;
            }
            if bytes[i] == b'[' {
                i += 1;
                while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                    i += 1;
                }
            } else if matches!(bytes[i], b']' | b'P' | b'^' | b'_') {
                i += 1;
                while i < bytes.len()
                    && bytes[i] != 7
                    && !(bytes[i] == 27 && bytes.get(i + 1) == Some(&b'\\'))
                {
                    i += 1;
                }
                if bytes.get(i) == Some(&27) {
                    i += 1;
                }
            }
            out.push(b' ');
        } else if bytes[i] >= 32 || bytes[i] == b'\n' || bytes[i] == b'\t' {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

struct Piece {
    text: String,
    image: bool,
}
fn pieces(value: &Value, dir: &OwnedDir, image_number: &mut usize) -> Result<Vec<Piece>> {
    let blocks = if value.is_string() {
        vec![json!({"type":"text","text":value})]
    } else {
        value
            .as_array()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("invalid TUI input content"))?
    };
    ensure!(blocks.len() <= 64, "TUI input has too many blocks");
    let mut out = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = block
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow::anyhow!("invalid TUI text"))?;
                if !text.trim().is_empty() {
                    out.push(Piece {
                        text: paste_text(text)?,
                        image: false,
                    });
                }
            }
            Some("image") => {
                ensure!(
                    block.pointer("/source/type").and_then(Value::as_str) == Some("base64"),
                    "TUI supports only inline base64 images; remote images are unsupported"
                );
                let ext = match block.pointer("/source/media_type").and_then(Value::as_str) {
                    Some("image/png") => "png",
                    Some("image/jpeg") => "jpg",
                    Some("image/gif") => "gif",
                    Some("image/webp") => "webp",
                    _ => bail!("unsupported TUI image type"),
                };
                let data = block
                    .pointer("/source/data")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow::anyhow!("invalid TUI image"))?;
                ensure!(data.len() <= MAX_LINE, "TUI image exceeds limit");
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .map_err(|_| anyhow::anyhow!("invalid TUI image encoding"))?;
                ensure!(
                    !bytes.is_empty() && *image_number < 64,
                    "TUI image limit reached"
                );
                *image_number += 1;
                let path = dir.file(&format!("image-{}.{ext}", image_number), &bytes)?;
                out.push(Piece {
                    text: path.to_string_lossy().into_owned(),
                    image: true,
                });
            }
            _ => bail!("unsupported TUI input block"),
        }
    }
    ensure!(!out.is_empty(), "empty TUI input");
    Ok(out)
}

struct Sending {
    pieces: VecDeque<Piece>,
    shown: Option<Piece>,
    since: Instant,
    submitted: bool,
    rows: usize,
    image_paths: Vec<PathBuf>,
    image_count: usize,
}

pub(super) async fn run(args: Vec<String>) -> Result<()> {
    ensure!(!args.is_empty(), "missing Claude TUI executable");
    let sid = session_id(&args[1..])?;
    let translated = interactive_args(&args[1..], &sid)?;
    let cwd = std::env::current_dir()?.canonicalize()?;
    let config = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".claude")))
        .or_else(|| dirs::home_dir().map(|p| p.join(".claude")))
        .ok_or_else(|| anyhow::anyhow!("Claude TUI profile location unavailable"))?;
    let transcript = transcript_path(&config, &cwd, &sid)?;
    let offset = match std::fs::symlink_metadata(&transcript) {
        Ok(m) => {
            ensure!(
                m.is_file() && !m.file_type().is_symlink(),
                "unsafe TUI transcript location"
            );
            m.len()
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
        Err(_) => bail!("Claude TUI transcript unavailable"),
    };
    let owned = OwnedDir::new()?;
    owned.file("tap.js", include_bytes!("tap.js"))?;
    let tap_path = owned.file("tap.jsonl", &[])?;
    let input = Fd::duplicate(0)?;
    let output = Fd::duplicate(1)?;
    let (mut child, pty) = launch(&args[0], &translated, &owned, &tap_path)?;
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut interrupt = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
    let mut hangup = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup())?;
    // The entire worker future is cancellation-aware, including backpressured stdout.
    let work = async {
        let mut input_lines = Lines::default();
        let mut tap_tail = Tail::new(0);
        let mut transcript_tail = Tail::new(offset);
        let mut tap = Tap::default();
        let mut screen = Vec::new();
        let mut pending = VecDeque::new();
        let mut sending: Option<Sending> = None;
        let mut rows = 0;
        let mut ready = false;
        let mut images = 0;
        let mut submitted_observation: Option<(usize, bool)> = None;
        let mut unobserved_completion: Option<(usize, Instant)> = None;
        let started = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_millis(10));
        let mut ibuf = [0; 65536];
        let mut pbuf = [0; 65536];
        loop {
            tokio::select! {
                n = input.read(&mut ibuf) => {
                    let n = n?;
                    if n == 0 { input_lines.finish()?; tap_tail.lines.finish()?; tap.finish()?; return Ok::<(),anyhow::Error>(()); }
                    for row in input_lines.push(&ibuf[..n])? {
                        match row.get("type").and_then(Value::as_str) {
                            Some("user") => {
                                ensure!(pending.len() < 8, "TUI input queue exceeds limit");
                                pending.push_back(row.pointer("/message/content").cloned().ok_or_else(|| anyhow::anyhow!("invalid TUI user message"))?);
                            }
                            Some("control_request") => {
                                let ok = row.pointer("/request/subtype").and_then(Value::as_str) == Some("initialize");
                                output.emit(json!({"type":"control_response","response":{"subtype":if ok {"success"} else {"error"},"request_id":row.get("request_id"),"response":{},"error":if ok {Value::Null} else {json!("unsupported TUI control request")}}})).await?;
                            }
                            _ => bail!("unsupported TUI input record"),
                        }
                    }
                }
                n = pty.read(&mut pbuf) => {
                    let n = n?;
                    ensure!(n != 0, "Claude TUI process exited");
                    let mut queries = screen[screen.len().saturating_sub(8)..].to_vec();
                    let overlap = queries.len();
                    queries.extend_from_slice(&pbuf[..n]);
                    screen.extend_from_slice(&pbuf[..n]);
                    if screen.len() > 256 * 1024 { screen.drain(..screen.len()-128*1024); }
                    if queries.windows(4).enumerate().any(|(i,w)| i+4>overlap && w == b"\x1b[6n") { pty.write(b"\x1b[1;1R").await?; }
                    if queries.windows(3).enumerate().any(|(i,w)| i+3>overlap && w == b"\x1b[c") || queries.windows(4).enumerate().any(|(i,w)| i+4>overlap && w == b"\x1b[0c") { pty.write(b"\x1b[?62;c").await?; }
                }
                _ = tick.tick() => {
                    ensure!(child.0.try_wait()?.is_none(), "Claude TUI process exited");
                    for row in tap_tail.poll(&tap_path)? {
                        for event in tap.row(row, &sid)? { output.emit(event).await?; }
                    }
                    for row in transcript_tail.poll(&transcript)? {
                        if row.get("type").and_then(Value::as_str) == Some("user") {
                            rows += 1;
                            if let Some((_, acknowledged)) = &mut submitted_observation { *acknowledged = true; }
                        }
                        if row.get("type").and_then(Value::as_str) == Some("system")
                            && row.get("subtype").and_then(Value::as_str) == Some("turn_duration") {
                            if let Some((before, true)) = submitted_observation {
                                if tap.messages.len() <= before {
                                    unobserved_completion = Some((before, Instant::now()));
                                }
                                submitted_observation = None;
                            }
                        }
                    }
                    // Native completion and the response clone are independent writers.
                    // Allow their file observations to converge after completion only;
                    // this is not an active first-token or generation deadline.
                    if let Some((before, since)) = unobserved_completion {
                        if tap.messages.len() > before { unobserved_completion = None; }
                        else { ensure!(since.elapsed() < Duration::from_secs(1), "Claude TUI completed without observed response events"); }
                    }
                    let display = plain(&screen);
                    if !ready {
                        let lower = display.to_lowercase();
                        ensure!(!["trust this folder", "yes, i trust", "select login method", "log in with your claude account", "claude.ai/oauth/authorize", "security notes:", "choose the text style"].iter().any(|s| lower.contains(s)), "Claude TUI requires owner interaction for trust, login or onboarding");
                        if tap.on && (display.contains("❯ ") || display.contains("❯\u{a0}")) {
                            ready = true;
                            output.emit(json!({"type":"system","subtype":"init","session_id":sid})).await?;
                        }
                        ensure!(ready || started.elapsed() < READY, "Claude TUI readiness or response tap unavailable; select explicit print mode if needed");
                    }
                    if ready && sending.is_none() {
                        if let Some(value) = pending.pop_front() {
                            let parts=pieces(&value,&owned,&mut images)?;
                            let image_paths=parts.iter().filter(|p|p.image).map(|p|PathBuf::from(&p.text)).collect();
                            sending = Some(Sending { pieces: parts.into(), shown: None, since: Instant::now(), submitted: false, rows, image_paths, image_count:0 });
                        }
                    }
                    if let Some(s) = &mut sending {
                        if s.submitted {
                            if rows > s.rows {
                                for path in &s.image_paths { std::fs::remove_file(path).map_err(|_|anyhow::anyhow!("TUI image cleanup failed"))?; }
                                sending = None;
                            }
                            else { ensure!(s.since.elapsed() < Duration::from_secs(3), "Claude TUI did not acknowledge pasted input"); }
                        } else if let Some(piece) = &s.shown {
                            let tail: String = piece.text.chars().rev().take(16).collect::<String>().chars().rev().collect();
                            let shown = if piece.image { display.contains(&format!("[Image #{}]",s.image_count)) } else { display.contains("Pasted text") || display.contains(tail.trim()) };
                            if shown && s.since.elapsed() >= Duration::from_millis(150) {
                                s.shown = None;
                            } else { ensure!(s.since.elapsed() < PASTE, "Claude TUI did not acknowledge paste"); }
                        } else if let Some(piece) = s.pieces.pop_front() {
                            screen.clear();
                            if piece.image { s.image_count+=1; }
                            pty.write(format!("\x1b[200~{}\x1b[201~", piece.text).as_bytes()).await?;
                            s.shown = Some(piece); s.since = Instant::now();
                        } else {
                            pty.write(b"\r").await?;
                            submitted_observation = Some((tap.messages.len(), false));
                            s.submitted = true; s.since = Instant::now();
                        }
                    }
                }
            }
        }
    };
    let result = tokio::select! {
        r = work => r,
        _ = term.recv() => Err(anyhow::anyhow!("Claude TUI cancelled")),
        _ = interrupt.recv() => Err(anyhow::anyhow!("Claude TUI cancelled")),
        _ = hangup.recv() => Err(anyhow::anyhow!("Claude TUI cancelled")),
    };
    drop(child);
    if let Err(error) = &result {
        let diagnostic = error.to_string();
        // All generated diagnostics are fixed; never include screen, prompt, path or upstream error payloads.
        let _ = tokio::time::timeout(Duration::from_millis(200), output.emit(json!({"type":"result","subtype":"error_during_execution","is_error":true,"session_id":sid,"result":diagnostic}))).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn inline_images_are_private_owned_bounded_and_urls_never_fetched() {
        let dir = OwnedDir::new().unwrap();
        assert_eq!(
            std::fs::metadata(&dir.0).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let mut number = 0;
        let value = json!([{"type":"text","text":"inspect"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"aW1hZ2U="}}]);
        let out = pieces(&value, &dir, &mut number).unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[1].image);
        assert_eq!(std::fs::read(&out[1].text).unwrap(), b"image");
        assert_eq!(
            std::fs::metadata(&out[1].text)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert!(pieces(&json!([{"type":"image","source":{"type":"url","url":"https://secret.invalid/private"}}]),&dir,&mut number).is_err());
        let path = dir.0.clone();
        drop(dir);
        assert!(!path.exists());
    }

    #[test]
    fn tail_rejects_symlink_and_truncated_rows() {
        let dir = OwnedDir::new().unwrap();
        let target = dir.file("target", b"{\"type\":\"user\"}\n").unwrap();
        let link = dir.0.join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(Tail::new(0).poll(&link).is_err());
        let mut tail = Tail::new(0);
        assert_eq!(tail.poll(&target).unwrap().len(), 1);
        std::fs::write(&target, b"x").unwrap();
        assert!(tail.poll(&target).is_err());
    }

    #[test]
    fn terminal_escapes_are_not_part_of_ready_text() {
        assert_eq!(plain(b"\x1b[32mhello\x1b[0m"), " hello ");
        assert!(!plain(b"\x1b]0;private\x07prompt").contains("private"));
    }
}
