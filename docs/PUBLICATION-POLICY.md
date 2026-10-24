# KADAdesk Community · Public Source Publication Policy

## Two repositories, different histories

- **Original:** `AIMarshallLee/kadadesk` — stays **private** and retains historical commits, owner license issuance, internal systems and customer-specific information.
- **Community:** `AIMarshallLee/kadadesk-community` — independent Git repository and clean-source publication destination. This is the long-term collaborative development surface.

**Never:** change the original repository to Public; run `git push --mirror`, `git push --all` from the original; transfer private `.git`; use GitHub's repository-visibility switch; or add private commits as parents to public commits.

## Default to review, not to copy everything

A public-module transfer must follow these gates:

1. Inventory the private branch's current tracked source and dependency imports. Select modules by an explicit, reviewed allowlist; deny everything else.
2. Exclude real customer data, tokens, session cookies, chat/media archives, runtime profiles, private model endpoints, internal merchant/license issuance, and external assets without redistribution rights. No "placeholder" copied from a customer's actual data.
3. Distinguish protected source under your copyright from third-party code, fonts, libraries, images, models, proprietary connectors and firmware notices. Preserve third-party license notices, including permissive obligations.
4. Inspect **the full file**, its imports, tests and sample data; sanitize platform-specific or unsupported automatic account control. Do not imply changing product names changes permissions.
5. Copy eligible text **as new files with a new community Git commit**. Do not fetch private history into the community repository.
6. Run `node scripts/verify-publication.mjs`, `npm ci`, `npm test`, `npm run smoke`, `npm run build`. Review full PR diff and require license/provenance approval before merging.
7. Always disclose actual implementation, OS support, missing API rights, tests and unimplemented plugin features.

Private migration source of truth: `docs/community-export-allowlist.json` and `scripts/community-snapshot-audit.mjs` on the private development branch, with `--stage` to an **empty directory outside the source repository**. This is an offline export guard, not an automatic publishing bot.

## What may be released

- Workspace Core and non-sensitive plugin SDK contracts.
- Basic knowledge management and AI suggestion algorithms built against **synthetic fixtures**.
- Content planning, safe per-account tasks and user-triggered exports.
- Personal productivity, local files, open documented connectors, tests, demo configurations, good-first-issue examples.
- Desktop and hardware **only after separate third-party, privacy and platform boundary review**, using user-authorized, documented non-bypass functionality.

## What remains private or restricted

- Original Git history and old commits.
- Secrets, account tokens, real conversations, customer materials, proprietary business templates, owner-specific configuration.
- Merchant/license issuer and private payment/signing backends.
- Unlicensed third-party components or restricted binaries and brand assets.
- Unverified automatic actions involving third-party accounts or personal data.

## License changes

Current new-source license: [LICENSE v0.2](../LICENSE). It grants personal, non-commercial research, self-use and development; organizational internal use or business use requires a written license. This is **source-available, not OSI open source**. Do not imply v0.2 retroactively revokes valid earlier v0.1 grants; see [LICENSE-HISTORY](LICENSE-HISTORY.md). No automatic commercial rights are obtained in external PR contributions.

## Incident handling

If a secret or protected data appears in a public commit: stop releases, revoke/rotate the affected credential immediately, limit or delete exposed assets where technically possible, coordinate Git history remediation with the owner, and review affected customer rights. Deleting a working-tree file does not make a previous public commit inaccessible.
