# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in `readme-demo-recorder`, please **do not open a public issue**. Instead, use GitHub's private vulnerability reporting:

> [Report a vulnerability](https://github.com/cjcsecurity/readme-demo-recorder/security/advisories/new)

This routes the report directly to the maintainers with no public disclosure. We aim to acknowledge within **72 hours** and triage within **7 days**.

## Scope

This project ships a Claude Code skill that drives Playwright + ffmpeg to record browser demos. It executes user-supplied YAML scripts that select selectors on web pages and run ffmpeg subprocesses. The most likely vulnerability classes here are:

- **Command-injection vectors in `scripts/record.mjs`** — caption text and selector strings flow into ffmpeg argv and into Playwright locators. The driver mitigates this by writing caption text to a file rather than passing it as a `text=` argument, but new code paths could re-introduce the risk.
- **Prompt-injection in `SKILL.md` or reference docs** that could mislead a Claude session running the skill into executing unrelated commands.
- **Cursor-inject script issues** — `references/click-pulse-cursor.md` documents an inject that runs in the target page's context. A user pointing the recorder at a hostile page could in theory have that page interact with the inject; the inject doesn't expose anything sensitive but new features could.
- **Recording of unintended secrets** — if a user records a target page that displays an API key or token, the resulting MP4/GIF will contain it. This is user-controlled and not strictly a vulnerability in the recorder, but we'd still like to hear about it if there's a class of pages where the recorder makes this worse than expected.

Out of scope:

- Bugs in user-generated YAML scripts (the skill produces these; once they live in your repo, they're yours)
- Issues in third-party `awesome-list` entries that point at this project
- Theoretical issues without a concrete reproduction scenario
- Headless Chromium CVEs — those belong upstream at the Playwright / Chromium projects; we'll bump the supported version when fixes ship

## Disclosure

We follow coordinated disclosure. Once a fix is merged, a security advisory will be published in this repository's [Security Advisories](https://github.com/cjcsecurity/readme-demo-recorder/security/advisories) tab with credit to the reporter (unless anonymity is requested).

## Supported versions

Only the latest minor version on `main` is supported. Pin to a release tag (`v0.1.0`, etc.) for reproducible installs.
