# KADAdesk Full Community Source Migration — Progress Ledger

Updated 2026-10-24. **Goal:** publish as much usable, legally redistributable KADAdesk code as practical, while keeping the original repository and Git history private.

| Area | Community status | Next gate |
| --- | --- | --- |
| Workspace Core | Implemented: local React shell, two trusted bundled modules, persistent server-side enable/disable | Real plugin SDK, install/uninstall, dependency and permission lifecycle |
| Content Operations | Implemented: local documents/images, multiple account-specific review jobs, ZIP handoff and manual verification | Accessibility, UX, native acceptance and optional official integrations |
| Knowledge Lite | **Implemented:** local text entry, review-first search, disable/enable, deletion and persistence | Import approved original parsing + enterprise scopes + optional model assistance |
| Private full Knowledge system | **Not copied**: original document import, advanced training, connectors and workflow integration | Dependency isolation, provenance, private source review |
| AI Reply Assistance | **Not copied** | Remove platform transport, separate knowledge/model suggestion from sending |
| Safe local utilities | Published two original isolated files (query normalization, abortable delay) through clean public commits | Add more source only after file-by-file provenance review |
| Desktop Electron host | **Not copied** | Audit platform authorization, runtime profile access and third-party dependencies |
| Hardware/firmware | **Not copied** | Copyright/license and device acceptance |
| Private merchant signing / billing | **Not copied; stays private** | No public export |
| Original Git history / secrets / customer materials | **Never copied** | Maintain strict exclusion |
| Third-party assets and proprietary connectors | **Not copied unless separately licensed** | Rights and security review |

Project policy: [PUBLICATION-POLICY.md](PUBLICATION-POLICY.md). Release detail: [EXTRACTION-AUDIT.md](EXTRACTION-AUDIT.md).

**Current delivery:** a buildable community workspace with two self-contained built-in modules and a public publication guard. It is NOT a mirror of the original complete application, nor a mature general third-party plugin installer. There are more than 500 tracked files in the private source branch and only a small, curated, reviewed subset is presently public.

Next acceptance targets: full safe dependency inventory, genuinely installable Plugin SDK, original advanced knowledge and model-assisted draft plugins, licensed platform connectors, desktop packaging and physical-device validation.
