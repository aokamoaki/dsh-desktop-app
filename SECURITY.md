# Security Policy

## Supported versions

Only the latest release (and the `main` branch) receives security fixes. Older
installers on GitHub Releases are not patched retroactively — always upgrade to
the newest release.

| Version      | Supported |
| ------------ | --------- |
| latest       | ✅        |
| < latest     | ❌        |

## Reporting a vulnerability

Please do **not** open a public issue for a security vulnerability.

Report it privately instead:

- via a GitHub **security advisory** on this repository
  (Security → Report a vulnerability), or
- by email to the maintainer.

Include:

- the affected version,
- steps to reproduce, and
- the impact you observed or expect.

You'll get an acknowledgement within a few days and updates on a fix and release.

## Notes

This app is a thin Electron shell around an already-installed DeepSeek Harness
runtime (`dsh`). It locates an existing `dsh` (in `~/.dsh`, the profile
`node_modules`, or the npx cache) and spawns it locally on loopback; the shell
does not download, install, or update the runtime and does not ship or install
any plugin. Remote navigation is restricted to http(s), with any other scheme
handed off to the system browser.