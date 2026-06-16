# Shipping Checklist

Use this before committing, pushing, tagging, releasing, or closing public
issues.

## Pre-Commit

1. Check status:

```bash
git status --short --ignored
```

2. Confirm ignored project/generated files are not staged:

```text
.doccheck/
PROJECT.md
brief.md
outline.md
style.md
draft/
exports/
projects/active/
projects/registry.json
sources/
state/
taste/
```

3. Run leakage scan for private names, secrets, or project facts when public
   files changed:

```bash
rg -n "sk-or-v1-[A-Za-z0-9_-]+|sk-proj-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+" --hidden -g '!.git/**' $(git ls-files)
```

4. Run gates:

```bash
npm test
npm run template:audit -- --strict
npm run context:audit -- --strict
npm run doctor -- --no-network
```

Run `npm pack --dry-run` when `package.json`, `bin/`, `scripts/`, `skills/`,
published docs, or package contents changed.

Run the fresh-project smoke test from `docs/CI.md` in a disposable clone,
worktree, or CI job when package, CLI init, project workspace, or
install-anywhere behavior changed. Do not run it inside a dirty active writing
workspace.

## Commit And Push

1. Stage only intended files.
2. Review staged names:

```bash
git diff --cached --name-status
git diff --cached --stat
```

3. Commit with a concise message.
4. Include `Closes #<issue>` only when the work fully closes a GitHub issue.
5. Push the current branch.

## Release

Use this only when a versioned release is requested or clearly intended.

1. Confirm `package.json` version and `CHANGELOG.md` agree.
2. Confirm `gh release view <tag>` does not already exist.
3. Create annotated tag:

```bash
git tag -a vX.Y.Z -m "Manuscript Lab vX.Y.Z"
git push origin vX.Y.Z
```

4. Create release:

```bash
gh release create vX.Y.Z --title "Manuscript Lab vX.Y.Z" --notes "<notes>"
```

5. Confirm release:

```bash
gh release view vX.Y.Z --json tagName,url,isDraft,isPrerelease,publishedAt
```

6. Confirm related issues or milestone state.
