# KADAdesk Full Community Source Migration — Progress Ledger

Updated 2026-10-24. **Goal:** move as much original product **code** as can legally and safely be distributed to the community. Do not mirror the original Git history or proprietary customer data.

| Area | Source of truth | Community status | Publication gate |
|---|---|---|---|
| Public workspace shell / plugin toggles | Community Core | Implemented as bundled trusted modules | Existing CI |
| Content operations | Community Content Ops | Working human-in-the-loop module | Existing CI; no automatic platform posting |
| Knowledge / review / retrieval | Private knowledge subsystem | Independent knowledge module planned as next public feature | Remove private state coupling; test local-only synthetic documents |
| AI reply assistance | Private conversation-routing/model adapters | Not yet transferred | Separate model advice from external message transport; guard user-provided data |
| Safe local utilities | Selected private source allowlist | Review candidate source copies on migration branch | Dependency and rights audit |
| Desktop app | Private Electron host | Not fully transferred | Review all OS/API/permission paths, remove restricted operations |
| USB/firmware | Private `firmware/` | Held | Hardware IP, third-party notices, physical testing |
| License/payment/merchant | Private merchant services | Must not publish in community | Closed-service boundary |
| Private Git history or customer data | Original repository | **Never publish** | Clean-file-only copy, new Git commits |
| Third-party assets | Per-component source licenses | Held until independently cleared | Provenance plus license notices |

**Operational distinction:** a public repository with an early prototype is not automatically a complete independently installable desktop product. Distinguish source-level build, synthetic tests, Windows/macOS native testing, actual commercial licenses and platform authorization.

Next acceptance gates: reliable safe export, open knowledge plugin, AI reply plugin, third-party plugin SDK, sandbox/signatures/rollbacks, real OS install tests. Contributions should focus on features that can be tested without live customer accounts or vendor-restricted assets.
