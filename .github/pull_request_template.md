## Summary


## Verification

- [ ] `npm test`
- [ ] `npm run template:audit -- --strict`
- [ ] `npm run context:audit -- --strict`
- [ ] `npm run doctor -- --no-network`
- [ ] `npm pack --dry-run` when package contents, public docs, examples, skills, or CLI/package behavior changed.
- [ ] `node scripts/install-init.test.mjs` when install-anywhere, package-boundary, or wrapper behavior changed.

## Boundary Check

- [ ] No `.env`, API keys, private manuscript text, exports, model-call logs, or active project artifacts are included.
- [ ] Prompt/check/review changes preserve the untrusted-document-text boundary.
- [ ] Generated state stays under the configured manuscript/project root, not under `node_modules/`, `draft/`, or the caller workspace root.
