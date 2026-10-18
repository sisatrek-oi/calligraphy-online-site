# Seven-person task synchronization implementation plan

**Goal:** Publish the approved seven-person allocation without changing any existing source materials or stored drafts.

**Architecture:** Add a pure assignment module shared by overview, scoped reader and export. Keep legacy four-part storage and full backup payloads. Filter the active view and text/tabular exports only.

**Tech stack:** Existing ES modules, browser localStorage, node:test, existing Python suite, isolated Playwright browser and GitHub Pages.

- [ ] Add `src/team-assignments.js` and `scripts/test-team-assignments.mjs`; verify1041-page disjoint coverage, retained drafts, invalid assignments and exact handoff counts.
- [ ] Update seven-card overview and member-scoped reader; keep originalpart IDs, full reviews and chunk validation; expose another-segment links and legacy full-part access.
- [ ] Extend bundle export with an optional validated member scope. Assert legacy export remains identical; scoped TXT/CSV exclude other pages while JSON retains every original review, baseline and edit.
- [ ] Run `node --test scripts/test-team-assignments.mjs scripts/test-collation-export.mjs`, then `npm test`, `npm run check`, `git diff --check`.
- [ ] Run isolated browser cases: seven cards; all ten segment ranges; old links; preserved hidden drafts before and after editing, ZIP download and JSON restore; invalid member; no outer scrolling at desktop and mobile viewport sizes. Do not read/write real member storage.
- [ ] Compare SHA256 of every tracked screening-data file to pre-change baseline. Review final diff and update roadmap. Commit focused changes, push HEAD to main with normal fast-forward protection, wait Pages success and verify deployed resources plus actual browser behavior.

Execution is inline under the user's existing instruction to implement and publish; no new approval boundary is introduced. A clean release worktree and before-hashes.json isolate existing user changes.
