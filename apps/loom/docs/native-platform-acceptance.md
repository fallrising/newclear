# Native platform acceptance setup

This is an operator setup guide, not a platform pass report. Apply the [workspace acceptance specification](workspace-acceptance.md) and [window-close scenarios](window-close-safety-verification.md) inside each target operating system, recording the exact source and runtime versions.

## Proxmox Windows VM

A Windows guest on Proxmox QEMU/KVM runs Windows itself and can validate Loom's Windows binary, WebView2, filesystem and terminal behavior. A Linux guest, Docker container or WSL session does not supply that evidence. VM results cover the tested virtual hardware; physical GPU, monitor/DPI and peripheral behavior may need later hardware checks.

For an existing Windows 11 VM, verify UEFI/OVMF, Secure Boot capability and TPM 2.0 against the [official Proxmox administration guide](https://www.proxmox.com/images/download/pve/docs/pve-admin-guide-9.2.pdf), sections 10.2.11–12. For a new build/test VM, 4 vCPU, 8–16 GiB RAM and roughly 100 GiB storage are practical starting allocations, not operating-system minimum requirements. No GPU passthrough is required by this acceptance checklist. Keep a disposable test account/vault and a snapshot before installing build tools; take no actions against unrelated guests or the hypervisor as part of the Loom tests.

Inside Windows, install Git, a supported Node.js release, Rust with the MSVC toolchain, and Visual Studio Build Tools with the **Desktop development with C++** workload and Windows SDK. Ensure Microsoft Edge WebView2 Runtime is installed. Follow [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows). The repository pins Rust 1.88.

In PowerShell, from a checkout of the selected source commit:

```powershell
cd apps/loom
npm ci
npm run typecheck:contracts
npm run typecheck:app
npm test
cargo test --locked --workspace --no-fail-fast
npm run tauri -- build --no-bundle
```

These are proposed Windows commands; this guide does not claim they were run on Windows. Record any native build/runtime failure as a platform finding. Launch the built executable from the configured Cargo target directory in a logged-in interactive Windows desktop, with `LOOM_VAULT` set to a fresh disposable directory and no provider credentials. RDP/noVNC can be used for manual interaction; an SSH service alone does not establish an interactive desktop for GUI automation.

For automation, direct `tauri-driver` can use Microsoft Edge WebDriver. Pin a Rust-compatible driver (the Linux test environment uses tauri-driver 2.0.4 with Rust 1.88), install the Edge WebDriver matching the actual **WebView2 Runtime** version, and make it discoverable on PATH or select it through `--native-driver`. See [Tauri manual driver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/) and [Microsoft's WebView2 WebDriver guide](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver).

The Linux harness uses X11 and POSIX shell/proc observations and is not advertised as a Windows harness. Adapt native window-close delivery and terminal/shell/process oracles before using it on Windows, or execute the same six scenarios manually with recorded disk/session evidence. Test build, launch, edit/save/conflict, Run/Pin/routing, restart/history and normal close; record Windows, WebView2, binary/source versions and all failures.

## macOS

Use a Mac or a macOS VM hosted on a Mac under the applicable [Apple software license](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf); section 2B(iii) contains Apple-branded hardware and host-software conditions. A typical non-Apple Proxmox server is not the proposed macOS acceptance route.

Build with the macOS prerequisites and test WKWebView on macOS. Direct tauri-driver supports Windows/Linux, while the [Tauri WebDriver guide](https://v2.tauri.app/develop/tests/webdriver/) describes an embedded WebDriver route for macOS that requires test plugins. This slice adds none of those dependencies; manual native acceptance remains a possible first step. Do not infer Apple Silicon behavior from an Intel-only VM result.

## Linux

A Linux VM with a desktop session or a Linux Docker environment with WebKitGTK, Xvfb and a window manager can run the native Linux suite. The test must launch the actual Tauri binary and use real filesystem/PTY commands. Plain browser tests with mocked IPC remain a separate layer. Neither Linux route supplies Windows or macOS evidence.
