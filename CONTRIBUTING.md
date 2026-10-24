# Contributing to KADAdesk Community

KADAdesk is intended to become a useful extensible AI workspace for developers, not merely a read-only demo. We welcome code, adapters with legitimate platform access, tests, docs, reusable enterprise workflows and issue reports.

## How to contribute

1. Read [LICENSE](LICENSE), [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) and [SECURITY.md](SECURITY.md). The code is **source-available for personal non-commercial use** and is not OSI open source.
2. Open an Issue for larger changes. Fork, create a topic branch, and send a focused pull request.
3. Run `npm ci && npm test && npm run smoke && npm run build`. Explain user-visible changes, edge cases, compatibility and limitations.
4. Use only synthetic data. Never include credentials, cookies, customer identities, real conversations, screenshots, private documents, proprietary vendor code, payment secrets or account bypasses.
5. Do not add auto-control features for third-party platforms without a documented official authorization and a separate permission-aware connector.
6. Keep the workspace core independent of business plugins. Prefer additive, scoped APIs and reversible enable/disable controls.

## Contributions and dual licensing

You retain rights in your own original code. **A PR alone does not give the project owner a commercial relicensing right.** Code intended for community-and-commercial dual use requires an explicit Contributor License Agreement or other suitable written grant before merge, and a maintainer review of any dependencies. Until a compatible process is established, larger code PRs may be held for rights review.

Companies wishing to deploy or internally operate KADAdesk need separate written authorization, even if they are not reselling it. This does not restrict personal hobby contributions made independently from company duties.

## Releases and safety

There is currently no guarantee of third-party plugin sandboxing, auto-installation, unattended account operation or compatibility with every desktop application. Respect `docs/PUBLICATION-POLICY.md` when publishing a fresh source snapshot. Report sensitive security problems privately using the guidance in [SECURITY.md](SECURITY.md). Maintainers are not obliged to provide free one-on-one deployment support.
