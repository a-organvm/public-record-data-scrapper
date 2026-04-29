# Using npm as the Rustling Teacup

**Date:** 2026-04-29
**Scope:** `/Users/4jp/Workspace/organvm/public-record-data-scrapper`
**Branch:** `feature/stripe-checkout-integration` (currently checked out, working tree clean except `.lh/`)

---

## Context

VS Code surfaced two warnings simultaneously in this repo:

1. **Lockfile collision** — `Using npm as the preferred package manager. Found multiple lockfiles for /Users/4jp/Workspace/organvm/public-record-data-scrapper.`
2. **Stale project ID** — `The set project ID (funky-coda-zbphb) was invalid, or the current account lacks permission to view it.`

These are **co-occurring but unrelated**. Disk audit:

| Question                                              | Evidence                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Are there really two lockfiles?                       | Yes. `package-lock.json` (776KB, 2026-04-20) AND `pnpm-lock.yaml` (298KB, 2026-03-04).                                                                                                                                                                                                      |
| Which manager does the repo actually use?             | npm workspaces. Every script in `package.json` uses `npm --workspace …`. `CLAUDE.md` documents only `npm` commands. The repo originated as `"name": "spark-template"` (GitHub Spark, npm-based) and was extended into an `apps/*` + `packages/*` monorepo. No `pnpm-workspace.yaml` exists. |
| Is `pnpm-lock.yaml` recent or stale?                  | Stale by ~7 weeks. The npm lockfile has been the working one since at least the Stripe-integration branch began.                                                                                                                                                                            |
| Does `funky-coda-zbphb` appear anywhere in this repo? | **No.** Greps across `*.json`, `*.yaml`, `*.env*`, `*.ts`, `*.js` returned nothing.                                                                                                                                                                                                         |
| Does it appear in gcloud / firebase config?           | **No.** `gcloud config` resolves to `gen-lang-client-0694505879` (Gemini-API auto-project). `~/.config/configstore/firebase-tools.json` is empty/absent.                                                                                                                                    |
| Does the repo have any Firebase artifacts?            | **No.** No `firebase.json`, `.firebaserc`, `apphosting*.yaml`, `genkit*.yaml`, `.idx/`.                                                                                                                                                                                                     |
| Where is `funky-coda-zbphb` likely set?               | A VS Code extension's workspace/global state (Cloud Code, Firebase, Genkit, Project IDX) — **not on disk in this repo, gcloud, or firebase-tools config.**                                                                                                                                  |

**Outcome:** the npm warning is fully diagnosable and fixable now. The project-ID warning is unactionable until we know which tool emitted it (deferred — see "Open Questions" below).

---

## Recommended Approach

Make npm the _declared_ package manager (not just the de-facto one) and remove the stale pnpm artifact. This eliminates the VS Code warning at its root rather than silencing it via the `npm.packageManager` setting.

### Why declare via `package.json`, not `.vscode/settings.json`

`"packageManager"` in `package.json` is the Corepack standard (and what VS Code's auto-detector consults first). It travels with the repo, applies to every contributor's editor, and is also honored by Yarn/pnpm/Corepack itself. A workspace-level `.vscode/settings.json` override would only fix the warning for one editor and leave a fresh contributor with the same confusion.

---

## Steps

### 1. Capture the active npm version (for the `packageManager` field)

```bash
npm --version
# → use that version in step 3
```

### 2. Delete the stale pnpm lockfile

```bash
cd /Users/4jp/Workspace/organvm/public-record-data-scrapper
rm pnpm-lock.yaml
```

No corresponding `pnpm-workspace.yaml`, `.pnpmrc`, or `pnpm`-specific script exists, so nothing else needs cleanup.

### 3. Pin the package manager in `package.json`

Edit [`/Users/4jp/Workspace/organvm/public-record-data-scrapper/package.json`](Workspace/organvm/public-record-data-scrapper/package.json) — add a top-level `"packageManager"` field next to `"version"` and `"type"`:

```jsonc
{
  "name": "spark-template",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "packageManager": "npm@<version-from-step-1>"
  // …
}
```

(Corepack-style format: `npm@10.9.2` etc. The version string must include a patch. No SHA suffix needed for npm.)

### 4. Optional defensive setting (skip unless step 3 alone doesn't silence the warning)

If VS Code still complains after reload, add this to `.vscode/settings.json` (the file does not currently exist; only `extensions.json` and `*.code-workspace` are there):

```json
{
  "npm.packageManager": "npm"
}
```

This is a fallback. Step 3 should make it unnecessary.

### 5. Commit

```bash
git add package.json
git rm pnpm-lock.yaml
git commit -m "chore: pin npm as packageManager and remove stale pnpm-lock"
```

The branch is `feature/stripe-checkout-integration`. This is a clean chore commit on the existing feature branch — fine to ship as part of the open PR, or branch off `main` if you'd rather isolate it.

### 6. Mirror the plan into the repo (per plan-discipline rule)

Per the user's global `CLAUDE.md` plan-file-discipline rule (project plans live in `<project-root>/.claude/plans/YYYY-MM-DD-{slug}.md` with `~/.claude/plans/` as fallback only), copy this file post-approval:

```bash
mkdir -p .claude/plans
cp ~/.claude/plans/using-npm-as-the-rustling-teacup.md \
   .claude/plans/2026-04-29-using-npm-as-the-rustling-teacup.md
git add .claude/plans/2026-04-29-using-npm-as-the-rustling-teacup.md
```

---

## Verification

After the commit:

```bash
# Lockfile state
ls -1 *lock* 2>/dev/null
# → expect ONLY: package-lock.json

# packageManager declaration
grep '"packageManager"' package.json
# → "packageManager": "npm@<version>",

# Sanity: install still works and produces no lockfile drift
npm install --dry-run

# Reload VS Code window — the "multiple lockfiles" warning should be gone.
```

If the warning persists after a window reload: apply step 4, then reload again.

---

## Critical Files

| File                                                                                           | Role                               | Action                                |
| ---------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------- |
| [`package.json`](Workspace/organvm/public-record-data-scrapper/package.json)                   | Declares scripts, workspaces, deps | **Edit** — add `"packageManager"`     |
| [`pnpm-lock.yaml`](Workspace/organvm/public-record-data-scrapper/pnpm-lock.yaml)               | Stale, no consumer                 | **Delete**                            |
| [`package-lock.json`](Workspace/organvm/public-record-data-scrapper/package-lock.json)         | Active lockfile                    | Keep untouched                        |
| [`.vscode/settings.json`](Workspace/organvm/public-record-data-scrapper/.vscode/settings.json) | Does not exist                     | Only create if step 3 is insufficient |

---

## Out of Scope (deferred)

### `package.json.main` and `package.json.pr`

Two artifacts from a January 2026 merge sit in the repo root: `package.json.main` (4816 B) and `package.json.pr` (4683 B). They look like the residue of a manual three-way merge resolution. Not causing the current warning, but they are dead weight. **Recommend a follow-up cleanup commit** to remove them after verifying nothing imports them by name. Not addressed in this plan.

### `funky-coda-zbphb` project-ID error

Cannot fix without knowing which tool surfaced it. Disk evidence rules out:

- `gcloud` (active project is `gen-lang-client-0694505879`)
- Firebase CLI (`~/.config/configstore/firebase-tools.json` empty/absent)
- This repo (no Firebase or IDX artifacts)
- The wider workspace (grep returned only the captured-utterance JSONL line — i.e., this very message)

**Most likely sources** (in order of probability):

1. VS Code **Cloud Code** extension — workspace state in extension storage (`~/Library/Application Support/Code/User/workspaceStorage/` or `~/.vscode/extensions/googlecloudtools.cloudcode-*/state/`).
2. VS Code **Firebase / Project IDX** extension — similar.
3. A previous `gcloud config configurations` that was deleted but left a dangling reference in an extension's cache.

**Recommended next step**: open VS Code → Output panel → switch the dropdown to whichever extension keeps surfacing the warning to identify the source. Then either:

- Update the extension's project setting to `gen-lang-client-0694505879` (or whichever project this repo should target), **or**
- Run the extension's "Sign Out / Reset" command to clear the stale ID.

Will plan a follow-up once the source extension is identified.

---

## Open Questions for the User

1. Which tool/extension is showing the `funky-coda-zbphb` warning? (Status bar? Notification toast? Output channel?) Answering this unblocks the deferred fix.
2. Should the `package.json.main` / `package.json.pr` cleanup ride along in the same commit, or stay separate?
