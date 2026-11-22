---
name: git-workflow
description: Required workflow for any git work in this repo: committing, pushing, branching, or opening pull requests. Use it whenever you are about to change code that will be committed, run `git commit` / `git push`, or the user says "commit", "push", "ship it", "open a PR", "merge". Never push to main: always work on a descriptively named branch and open a PR with a clear description.
---

# Git workflow: branch → commit → PR (never push to `main`)

`main` is the deploy branch. CI deploys every push to `main` once deployment is enabled, so nothing reaches it except
through a reviewed pull request.

## Hard rules

1. **Never commit directly to `main`, and never push to `main`.** This includes `git push origin main`,
   `git push origin HEAD:main`, and `--force` to `main`. No exceptions, even for one-line fixes or docs.
2. **Always work on a branch with a relevant name** (format below).
3. **Every change lands through a PR** with a clear description (template below).
4. **Never merge a PR yourself** unless the user explicitly asks you to merge that PR.
5. Never rewrite history on a branch that has an open PR someone else may have pulled. Prefer new commits over
   `--force` pushes; if a force push is truly needed, use `--force-with-lease`.

## 1. Start: get onto the right branch

Before editing files for a new piece of work:

```sh
git status                       # must be clean, or the changes must belong to this task
git switch main && git pull --ff-only
git switch -c <type>/<short-kebab-description>
```

- If you are already on a feature branch **for this same task**, keep using it.
- If you're on `main` with uncommitted changes, don't commit them there: `git switch -c <branch>` (the changes come with you).
- If you're on an unrelated feature branch, ask the user whether to stack on it or branch from `main`.

### Branch names

`<type>/<short-kebab-description>`: lowercase, 2–5 words, describing the outcome, not the files.

| type | use for |
| --- | --- |
| `feat/` | new user-facing capability (`feat/strava-webhook-sync`, `feat/food-photo-logging`) |
| `fix/` | bug fix (`fix/number-input-leading-zero`) |
| `refactor/` | behaviour-preserving restructuring |
| `perf/` | performance |
| `test/` | tests only |
| `docs/` | README / docs only |
| `ci/` | GitHub Actions, build pipeline |
| `infra/` | Terraform, wrangler config, Cloudflare resources |
| `db/` | schema + migrations only |
| `chore/` | tooling, deps, housekeeping |

Bad: `update`, `fix-stuff`, `thomas-branch`, `feat/changes`, `feat/PlanWizard.tsx`.

## 2. Commit

- Small, logical commits. Each one should build and make sense on its own.
- Message: imperative summary of ≤ 72 chars, optionally prefixed with the area (`plan engine: ease running back in after winter`),
  then a blank line and a body explaining **why** when it isn't obvious.
- End every commit message with the attribution trailer the session specifies (e.g. `Co-Authored-By: …`), if any.
- Never commit secrets: `.dev.vars`, `*.tfvars`, `*.tfstate`, tokens, API keys. Check `git diff --cached` before committing.
- Schema change? Commit `apps/worker/src/db/schema.ts` together with its generated migration (`npm run db:generate`).

## 3. Verify before pushing

Run what CI runs, and fix failures before opening the PR:

```sh
npm run typecheck
npm test
npm run db:check
npm run build
```

For UI changes, also run the app (`npm run dev`) and check the change in a phone-sized viewport.

## 4. Push the branch and open the PR

```sh
git push -u origin <branch>
gh pr create --base main --head <branch> --title "<title>" --body-file <file>
```

**Title:** same style as a commit summary. It says what the PR achieves (`Add Strava webhook for live activity sync`).

**Body:** use this template. Write for a reader who hasn't seen the conversation, and delete sections that don't apply:

```markdown
## Summary
What this PR does and why, in 1–3 sentences. Link the issue or roadmap milestone if there is one.

## Changes
- Grouped by area (engine / worker / web / infra / db), describing behaviour, not a file list.

## How it was tested
- Commands run and their results (typecheck, tests: N passed, build).
- Manual checks (e.g. "ran the wizard end to end at 390×844, no console errors").

## Screenshots
(UI changes only.)

## Migration / deploy notes
New migrations, new secrets or env vars, Terraform changes, anything to do before or after merge. "None" if none.

## Risks & follow-ups
Known limitations, things deliberately left out, next steps.
```

End the body with the PR attribution line the session specifies, if any.

## 5. After opening

- Give the user the PR URL and a one-line summary.
- Check CI: `gh pr checks <number> --watch`. If it fails, fix it on the same branch and push again.
- Address review feedback with new commits on the same branch.
- Don't merge, and don't delete the branch, unless the user asks. Once a PR is merged, start the next task from an
  updated `main` (step 1).
