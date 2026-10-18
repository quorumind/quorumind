# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/quorumind/quorumind/security/advisories/new).

Include what you found, how to reproduce it and what an attacker could do with it. We
acknowledge reports within three working days, keep you informed while we work on a fix, and
credit you in the advisory unless you prefer otherwise.

## Supported versions

Quorumind has not reached 1.0. Security fixes go into the `main` branch; run the latest
version.

## Deployment notes

The self-hosted server has no user accounts. Keep it on localhost, or put it behind a reverse
proxy that authenticates every request; never expose it directly to the internet. API keys
live in the server's environment (`.env`) and are never sent to the browser.
