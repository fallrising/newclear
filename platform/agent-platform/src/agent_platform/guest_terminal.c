/* Guest-only setuid launcher: control UID 2001 -> tool UID 2000, never root shell.
 * Installed root:2001 mode 4750 in the guest. No caller-supplied command, account,
 * environment, cwd or inherited descriptor is accepted. Compile as static ELF.
 */
#define _GNU_SOURCE
#include <grp.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

static void deny(void) {
    static const char message[] = "terminal_launcher_denied\n";
    ssize_t written = write(STDERR_FILENO, message, sizeof(message) - 1);
    (void)written;
    _exit(125);
}

int main(int argc, char **argv) {
    if (getuid() != 2001 || geteuid() != 0 || argc != 2 || strcmp(argv[1], "-i"))
        deny();
    struct rlimit core = {0, 0};
    umask(0077);
    if (setrlimit(RLIMIT_CORE, &core) || prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) ||
        close_range(3, ~0U, 0) || setgroups(0, NULL) ||
        setresgid(2000, 2000, 2000) || setresuid(2000, 2000, 2000) ||
        prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
        prctl(PR_SET_DUMPABLE, 0, 0, 0, 0))
        deny();
    uid_t real_uid, effective_uid, saved_uid;
    gid_t real_gid, effective_gid, saved_gid;
    if (getresuid(&real_uid, &effective_uid, &saved_uid) ||
        getresgid(&real_gid, &effective_gid, &saved_gid) ||
        real_uid != 2000 || effective_uid != 2000 || saved_uid != 2000 ||
        real_gid != 2000 || effective_gid != 2000 || saved_gid != 2000 ||
        chdir("/home/agentprobe/workspace"))
        deny();
    char *const args[] = {"bash", "--noprofile", "--norc", "-i", NULL};
    char *const env[] = {
        "HOME=/home/agentprobe", "USER=agentprobe", "LOGNAME=agentprobe",
        "PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8",
        "http_proxy=http://127.0.0.1:3128", "https_proxy=http://127.0.0.1:3128",
        "HTTP_PROXY=http://127.0.0.1:3128", "HTTPS_PROXY=http://127.0.0.1:3128",
        "no_proxy=localhost,127.0.0.1,::1", "NO_PROXY=localhost,127.0.0.1,::1",
        "TERM=xterm-256color", "SHELL=/bin/bash", NULL,
    };
    execve("/bin/bash", args, env);
    deny();
}
