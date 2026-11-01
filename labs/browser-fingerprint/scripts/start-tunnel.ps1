[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet('private', 'public')]
    [string]$Mode = 'private',

    [ValidateRange(1, 65535)]
    [int]$Port = 4173,

    [string[]]$AllowedMail = @(),

    [string]$CloudflaredPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$recipients = @(
    foreach ($entry in $AllowedMail) {
        foreach ($address in $entry.Split(',')) {
            $address = $address.Trim()
            if ($address -eq '' -or $address -notmatch '^[^@\s,]+@[^@\s,]+$') {
                throw 'AllowedMail must contain email addresses or wildcard domains such as *@example.com.'
            }
            $address
        }
    }
)

if ($Mode -eq 'private' -and $recipients.Count -eq 0) {
    throw 'Private mode requires -AllowedMail. No public tunnel was started.'
}
if ($Mode -eq 'public' -and $recipients.Count -gt 0) {
    throw 'AllowedMail requires private mode. Remove -Mode public to protect this tunnel.'
}

if (-not $CloudflaredPath) {
    $installed = Get-Command cloudflared -CommandType Application -ErrorAction SilentlyContinue
    if ($installed) {
        $CloudflaredPath = $installed.Source
    } else {
        $projectDir = Split-Path -Parent $PSScriptRoot
        $CloudflaredPath = Join-Path $projectDir '.runtime/cloudflared.exe'
    }
}
if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) {
    throw 'Install cloudflared on PATH or pass -CloudflaredPath to its executable.'
}
$CloudflaredPath = (Resolve-Path -LiteralPath $CloudflaredPath).Path

if ($Mode -eq 'private') {
    $tunnelHelp = & $CloudflaredPath tunnel --help 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $tunnelHelp -notmatch '(?m)^\s*--allowed-mail\s') {
        throw 'This cloudflared does not support --allowed-mail. Update it before starting a private tunnel. No public tunnel was started.'
    }
}

$originUrl = "http://127.0.0.1:$Port"
$tunnelArguments = @('tunnel', '--url', $originUrl, '--no-autoupdate')
foreach ($address in $recipients) {
    $tunnelArguments += @('--allowed-mail', $address)
}

# Show an executable preview, but always invoke an argument array, never a command string.
$preview = @($CloudflaredPath) + $tunnelArguments
$preview = ($preview | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ' '
Write-Host "& $preview"
if ($PSCmdlet.ShouldProcess($originUrl, "Start $Mode Quick Tunnel")) {
    & $CloudflaredPath @tunnelArguments
    if ($LASTEXITCODE -ne 0) {
        throw "cloudflared exited with code $LASTEXITCODE."
    }
}
