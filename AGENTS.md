# KADAdesk Community Agent Instructions

This document provides behavioral constraints, architectural context, and extension guides for autonomous AI coding agents (Claude Code, Codex, Cursor, Antigravity, etc.) collaborating on the **KADAdesk Community** open-source repository.

---

## 1. Architecture Overview

```
kadadesk-community/
├── desktop/           # Electron main process host, local IPC bridge, MCP stdio & loopback servers
├── server/            # Local Node.js service (SQLite storage, document parsing, RAG retrieval, model callers)
├── shared/            # Universal TypeScript types, secret guards, model providers, manual content
├── src/               # React 19 single-page application (Knowledge Studio, Customer Profiles, MCP Open UI)
├── docs/manual/       # Markdown source chapters of the built-in user handbook
├── scripts/           # Build, verification, and manual bundling automation scripts
└── package.json       # Project scripts and runtime dependencies
```

- `desktop/`: Handles native OS integration, window state, MCP bridge, and desktop plugin security.
- `server/`: Lightweight local backend handling knowledge vector indexing, candidate extraction, and LLM completions.
- `shared/`: Pure isomorphic TypeScript schemas, regex patterns, and secret sanitization helpers.
- `src/`: Modern React SPA styled with design system tokens (light/dark themes, accessible components).

---

## 2. Extension Guides for AI Agents

### 2.1 How to Add a New Page / View
1. **Component**: Create your page component in `src/YourFeaturePage.tsx` using `components.tsx` UI primitives.
2. **Navigation**: Add your route to `navItems` and `getRoute()` in `src/App.tsx`.
3. **Feature Search Index**: Register the feature with searchable synonyms and breadcrumbs in `shared/feature-index.ts`.
4. **Verification**: Run `npm test` to verify route matching in `shared/feature-index.test.ts`.

### 2.2 How to Add a New API Endpoint
1. **Server Route**: Register the request handler in `server/service.ts` under the appropriate REST path.
2. **Type Definition**: Update request/response contracts in `shared/types.ts`.
3. **Frontend Client**: Invoke the endpoint via `api('/your-path', { method: 'POST', body: ... })` in `src/api.ts`.
4. **Unit Test**: Add a test case in `server/*.test.ts` validating happy-path and error cases.

### 2.3 How to Create a New Plugin
1. **Manifest**: Define a plugin manifest matching the schema in `shared/plugins.ts` (with `id`, `name`, `kind`, `version`).
2. **Permissions**: Explicitly declare required capabilities (e.g. `tool`, `content`, `workflow`).
3. **Import Flow**: Ensure the plugin can be imported via JSON drag-and-drop in `src/PluginsPage.tsx`.

---

## 3. Unbreakable Red Lines for AI Agents

1. **Zero Tolerance for Sensitive Credentials:**
   - Never inject real API keys (OpenAI, Anthropic, DeepSeek, etc.), tokens, private certificates, or database connection strings.
   - For unit tests, use synthetic mocked values or split string tokens.

2. **No Personally Identifiable Information (PII):**
   - Do not commit real mobile phone numbers, personal identities, local absolute workstation paths, or private customer records.

3. **Pure BYOK (Bring Your Own Keys):**
   - Never add hardcoded proxy relays or hidden test endpoints. The software must strictly connect to user-configured official or custom base URLs.

4. **No Unauthorized Platform Automation:**
   - The community edition is strictly human-in-the-loop. Reply generation produces drafts for the user to review and manually copy/send.

---

## 4. Mandatory Verification Checklist

Before reporting completion or pushing commits, execute and verify:
1. `node scripts/manual.mjs` -> Rebuilds `shared/manual-content.ts` when documentation changes.
2. `npm test` -> 100% pass across all unit test suites (`server`, `desktop`, `shared`).
3. `npm run build` -> Typechecks (`tsc --noEmit`) and Vite bundles frontend assets.
4. `npm run build:desktop` -> Compiles Electron preload and main bundles.
5. `node scripts/verify-publication.mjs` -> Scans the workspace and confirms zero sensitive data leaks.
