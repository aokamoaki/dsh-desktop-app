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

This app is an Electron shell around the DeepSeek Harness runtime (`dsh`). It
downloads the runtime and plugins from npm/GitHub at setup time, and it verifies
the installer's `sha512` + `size` before applying self-updates. The
`dsh-update.json` self-update manifest is integrity-checked by the client, so a
corrupted or tampered installer can never be applied.