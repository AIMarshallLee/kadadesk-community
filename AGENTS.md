# KADAdesk Community Agent Instructions

This document provides behavioral constraints and architectural context for autonomous AI coding agents collaborating on the **KADAdesk Community** open-source repository.

---

## 1. Architectural Architecture

- `desktop/`: Electron main process host, local IPC routers, desktop window lifecycle, and Model Context Protocol (MCP) server endpoints.
- `server/`: Lightweight local backend service handling knowledge base indexing, parsing, task pipelines, and model API client invocations.
- `shared/`: Isomorphic TypeScript utilities shared between server, desktop, and UI (schema definitions, secret guards, model error classifiers, customer types).
- `src/`: Modern React 18 single-page application (Sidebar, Knowledge Base management, Customer Profiles, Studio, Theme Engine).
- `docs/manual/`: Source files for the built-in customer user manual, compiled into application bundles via `npm run manual`.

---

## 2. Unbreakable Red Lines for AI Agents

1. **Zero Tolerance for Sensitive Credentials:**
   - Never inject real API keys (OpenAI, Anthropic, DeepSeek, etc.), tokens, private certificates, or database connection strings.
   - For unit tests, use synthetic mocked values or split string tokens.

2. **No Personally Identifiable Information (PII):**
   - Do not commit real mobile phone numbers, real personal identities, internal network IP addresses, or customer correspondence.

3. **Pure BYOK (Bring Your Own Keys):**
   - Never add hardcoded proxy relays or hidden test endpoints. The software must strictly connect to user-configured official or custom base URLs.

4. **Guarded Platform Compliance:**
   - Do not introduce unofficial chat protocol tampering or unauthorized background automation. Customer replies remain draft-only for human confirmation.

---

## 3. Mandatory Verification Checklist

Before reporting completion or creating pull requests, execute and verify:
1. `npm test` -> 100% pass across all unit test suites.
2. `npm run build` -> Successful compilation of TypeScript, Vite frontend, and manual generation.
3. `npm run build:desktop` -> Successful esbuild bundling of Electron desktop entry points.
4. `node scripts/verify-publication.mjs` -> Zero violations reported by the security scanner.
