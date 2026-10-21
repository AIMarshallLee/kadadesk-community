# Security Policy

Supported scope: the latest community branch only.

The service binds to **127.0.0.1**, uses a random session token, checks request Origin/Host, and doesn't log in to or publish via personal WeChat. It is not a multi-tenant hosted service.

**Do not bind to 0.0.0.0 or expose via a public reverse proxy** without a separate authentication, risk and deployment review. Never post production tokens, account details, customer conversations or secrets in public Issues or pull requests.

For vulnerabilities, prefer GitHub private vulnerability reporting when available, or contact the repository maintainer privately through an official channel. If no private channel is listed, ask for one publicly without revealing exploit details.

Passing local tests is not proof of native WeChat account compatibility or platform endorsement.
