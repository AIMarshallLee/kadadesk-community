# Contributing to KADAdesk Community

We welcome reproducible bug reports, local UI improvements, documentation, synthetic tests and new safe workflow ideas. Please do not submit real chat records, passwords, WeChat IDs, cookies, access tokens, payment credentials, device dumps or other people's private content.

## Workflow

1. Open an Issue before starting a large change.
2. Fork, create a feature branch, and explain user-visible behavior.
3. Run `npm ci && npm test && npm run smoke && npm run build`.
4. Include tests, screenshots with synthetic content only, and third-party license attribution.
5. Never add private KADAdesk commercial/payment/authorization code, unsupported WeChat publishing methods, process injection or stealth automated posting.

## Copyright and commercial rights

This project is source-available under [LICENSE](LICENSE), **not MIT/Apache**.
Contributors keep their own copyright. A GitHub PR does not assign copyright or grant an automatic commercial sublicense to maintainers. For contributions that may be included in both community and commercial editions, maintainers may require a separately signed Contributor License Agreement before merging. Until a documented CLA process is ready, we may hold substantive code PRs for licensing review; Issues, bug reports and tests are welcome.

No automatic promise of free one-to-one support, merge acceptance or access to the private core. Security reports should follow [SECURITY.md](SECURITY.md).
