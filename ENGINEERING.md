# Develop Linkarooie

Use Node 22, pnpm 12.8.1 and the committed lockfile (`pnpm install --frozen-lockfile`). TypeScript 6.0.3, Wrangler 4.143.1 and Prettier 3.9.10 are pinned. No Bun or GitHub Actions are required.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Check and emit readable browser/publisher assets, then run the app with its actual source identity and manifest. |
| `pnpm source:write` | Strictly check Worker and browser source; regenerate committed JavaScript and publisher declaration. |
| `pnpm check:types` | Check separate Worker and DOM environments and reject stale generated output. |
| `pnpm lint` | TypeScript unused-local/parameter checks; this scoped semantic lint is not an ESLint claim. |
| `pnpm format:check` / `pnpm format` | Check or format the explicit maintained-source/gate list in `scripts/format-source.mjs`. |
| `pnpm test` | Behavior, guarded edit/recovery, provider revocation and sharing regressions with fictional fixtures. |
| `pnpm build` | Type/parity gate and a credential-free Wrangler dry run with exact identity defines. |
| `pnpm check` | Types, generated parity, semantic lint, formatting and tests. |
| `pnpm deploy` | Exact clean pushed main, full check/build, source recheck, upload and live source/sharing verification. |

`src/browser` owns collection search/group reconciliation, tag disclosure keyboard controls, owner login/settings, card edit/preview/reorder/recovery, achievements, tags and profile-settings review/apply. The checked `achievement-date.mts`, `profile-settings-fields.mts` and `profile-tag-fields.mts` implementations generate both their readable `public/brand/*.mjs` runtime modules and declarations consumed by the Worker. A declaration cannot silently assert a different implementation. `src/publisher.mts` likewise emits its implementation and declaration together. The two-line `profile-share.js` compatibility entry only imports the maintained shared sharing controller.

`scripts/source-map.json` explicitly maps every committed output. Checks compile in memory and never rewrite source. DOM-only declarations are not runtime assets and are discarded; shared data-helper/publisher declarations are committed and checked for drift. Edit typed source, run `pnpm source:write`, and commit reviewed source and output together.

The Worker program uses Workers globals and the browser program uses DOM globals, without combining their incompatible environments. Existing Worker SQL row/configuration `any` shapes remain a documented legacy boundary; this slice does not claim to validate every database result at runtime. New maintained browser/publisher modules use strict checking. The small pre-paint theme bootstrap remains a nonce-bearing server-rendered literal. DOM contracts are app-owned markup, with field helpers enforcing expected native control types. Response data enters through unknown/record checks before use; existing guarded revisions and conflict recovery remain in place. Shared launcher/sharing/performance code and the licensed web-vitals bundle retain their explicit upstream maintenance/provenance boundary. Each app commits and releases its own assets; no Composer runtime dependency or automatic update is added.

The deployment script captures the reviewed SHA/config/source before checking and building, then rechecks main/HEAD/origin-main, clean status, config and all tracked file bytes/types immediately before upload, including assume-unchanged/skip-worktree edits. It explicitly selects root `wrangler.jsonc` and the default environment. Local browser and build evidence does not establish production, physical-device or platform-unfurl acceptance.

Linkarooie owns its D1 profile configuration, authored cards, independent card presentation, tags and achievements. It consumes Guestbook's contract-1 `/api/items` and `/api/items/:id` through its reviewed provider binding/origin. Guestbook owns contribution records, private media and approval/revocation: featuring a moment here never grants permission to upload, approve or retain a private source item. Each public request rechecks linked items; unavailable/private items stay hidden. No resource identifiers, binding targets, provider schemas or Composer source pins change in this source-maintenance slice.

`src/card-view.ts` owns the browser-safe linked-content and mounted-destination
view decisions shared by the Worker resolver/collection and reviewed consumers.
It accepts only an already validated current provider item. A reviewed consumer
may copy this MIT source at an exact application revision with its own isolated
transport; no app record, account, credential or remote dependency is copied.
