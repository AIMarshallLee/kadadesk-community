# KADAdesk Community · Public Source Publication Policy

## Two Repositories, Different Missions

- **Original Development Repository:** `AIMarshallLee/kadadesk` — stays **private**. It contains proprietary merchant billing backends, hardware firmware build scripts, internal deployment pipelines, and commercial channel integrations.
- **Community Repository:** `AIMarshallLee/kadadesk-community` — independent Git repository and clean-source destination for **KADAdesk Community (咔哒社区版)**. This is the long-term open collaborative surface.

**Absolute Safeguards:** Never convert the original private repository to public; never run `git push --mirror` or force-push private history; never transfer proprietary `.git` commit trees; and never include unverified platform automation or private credentials.

---

## Clean Source Publication Boundaries (社区公开源码边界)

Every public module release must satisfy the following safety gates:

1. **Explicit Architecture Inventory:** Select modules by explicit architectural boundary; deny proprietary extensions by default.
2. **Zero PII & Credentials:** Strictly exclude live customer records, authentication tokens, API keys, private certificates, runtime profiles, and real conversation captures.
3. **Platform Terms Compliance:** Remove unauthorized platform hooks, background process tampering, and unofficial protocol-cracking logic.
4. **Clean Git Lineage:** Changes must enter the community repository as new commits authored under clean community identities.
5. **Fail-Closed Security Gates:** Must pass `npm test` (100% pass), `npm run build`, and `node scripts/verify-publication.mjs` before opening PRs.

---

## What is Included in Community Core (v0.3)

- **Desktop Workspace Core:** Electron host, sidebar, floater, multi-window management, and the purple mascot theme engine.
- **Full Knowledge Base:** Parsing for Markdown, TXT, PDF, DOCX, XLSX, CSV, JSON, ZIP archives, candidate review, deduplication, and local backups.
- **BYOK Model Client:** Cloud LLM catalogue (OpenAI, SiliconFlow, DeepSeek, Zhipu, Moonshot, Baichuan, DashScope) with direct provider connections and zero bundled keys or proprietary relays.
- **Customer Profiles:** Local CRM tags, follow-up queues, and manual draft generation for copy-pasting (strictly human-in-the-loop).
- **Open MCP Standard:** Built-in Model Context Protocol server bridge exposing bounded knowledge and task execution to external AI agents.
- **In-App User Manual:** Comprehensive customer guide (`docs/manual/`) compiled into application bundles via `npm run manual`.

---

## What Remains Private or Excluded

- **Proprietary Commercial Modules:** Owner-only merchant station, automatic card issuance, license validation, and payment gateways (`server/license*`, `commerce-*`, `merchant-*`).
- **Unofficial Platform Exploits:** External chat platform protocol tampering, automated message injection, and unofficial web/app scraping bypasses.
- **Hardware Firmware:** Proprietary microcontroller (RP2040) firmware flashing binaries and hardware keys.
- **Customer Materials & Private Notes:** Internal merchant setups, commercial roadmaps, and unreleased consulting deliverables.

---

## Community License (KADAdesk Community License v1.0)

Current new-source license: [LICENSE v1.0](../LICENSE).
- **Free for Enterprise Self-Use:** Unrestricted, royalty-free internal deployment and self-use for individual developers, teams, and enterprises.
- **Four Reasonable Community Boundaries:**
  1. *No Hosted SaaS Resale:* May not be repackaged into multi-tenant cloud SaaS for direct subscription resale.
  2. *Retention of Branding & Copyright:* Derivative works must preserve original copyright notices and KADAdesk attribution.
  3. *No Trademark Grant:* KADAdesk trademarks and mascots remain proprietary assets.
  4. *Contributor License Flowback:* Contributions grant maintainers rights to distribute under dual-licensing models.
- For multi-tenant hosting, proprietary white-labeling, or enterprise commercial channel plugins, please refer to [COMMERCIAL-LICENSE.md](../COMMERCIAL-LICENSE.md).

---

## Incident Handling

If any secret, credential, or restricted private asset inadvertently appears in a public commit: immediately freeze releases, revoke and rotate affected credentials, coordinate Git history remediation, and review affected rights.
