# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/quorumind/quorumind/security/advisories/new).
This covers the code of this repository and the hosted service built on it (quorumind.com,
app.quorumind.com).

Include what you found, how to reproduce it and what an attacker could do with it. We
acknowledge reports within three working days, keep you informed while we work on a fix, and
credit you in the advisory unless you prefer otherwise. Please test only against your own
installation, or your own account of the hosted service, and do not access other people's data.

## Supported versions

Quorumind has not reached 1.0. Security fixes go into the `main` branch; run the latest
version.

## Deployment notes

The self-hosted server has no user accounts: anyone who can reach it can start debates on your
API keys, and read, share or delete every session. Keep it on localhost (the
`docker-compose.yml` publishes it on `127.0.0.1` only), or put it behind a reverse proxy that
authenticates every request; never expose it directly to the internet. API keys live in the
server's environment (`.env`) and are never sent to the browser.

The context import fetches, from the server, the web pages and GitHub repositories a user names.
It refuses local and private addresses, but anything else the server can reach is fetched: run it
where that is acceptable.
