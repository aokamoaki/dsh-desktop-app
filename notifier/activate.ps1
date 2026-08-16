# dsh-desktop-app activate.ps1 - toast click handler (ASCII only)
# Raises the DESKTOP APP when it is running (via the dsh-notify:// protocol);
# otherwise opens the DSH web UI in the default browser.
# Input: dsh-notify://open/<base64url(url)>
param([string]$Uri)

function ConvertFrom-Base64Url {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return "" }
    try {
        $b64 = $Value.Replace('-', '+').Replace('_', '/')
        $pad = (4 - ($b64.Length % 4)) % 4
        if ($pad -gt 0) { $b64 = $b64 + ('=' * $pad) }
        $bytes = [Convert]::FromBase64String($b64)
        return [Text.Encoding]::UTF8.GetString($bytes)
    } catch { return "" }
}

# The desktop app registers dsh-notify:// and raises its window on the link.
# Only hand off when it is actually running - an unregistered/absent app would
# pop the "how do you want to open this link?" dialog instead.
$desktopRunning = $false
try {
    $desktopRunning = [bool](Get-Process -Name 'dsh-desktop-app' -ErrorAction SilentlyContinue)
} catch { $desktopRunning = $false }

if ($desktopRunning -and -not [string]::IsNullOrEmpty($Uri) -and $Uri -like 'dsh-notify://*') {
    Start-Process $Uri
    exit 0
}

if ([string]::IsNullOrEmpty($Uri)) {
    Start-Process "http://127.0.0.1:3080"
    exit 0
}

try {
    $parsed = New-Object System.Uri $Uri
    $segments = @($parsed.AbsolutePath.Split('/') | Where-Object { $_ -ne "" })
    $target = ""
    if ($segments.Count -ge 2 -and $segments[0] -eq "open") {
        $target = ConvertFrom-Base64Url $segments[1]
    }
    if ([string]::IsNullOrEmpty($target)) { $target = "http://127.0.0.1:3080" }
    # Only http(s) may be launched; anything else (file:, custom schemes)
    # falls back to the DSH UI so a forged payload cannot open local files.
    if ($target -match '^https?://') { Start-Process $target }
    else { Start-Process "http://127.0.0.1:3080" }
} catch {
    Start-Process "http://127.0.0.1:3080"
}
exit 0
