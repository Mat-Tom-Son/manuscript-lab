## Summary


## Verification

- [ ] `npm test`
- [ ] `npm run template:audit -- --strict`
- [ ] `npm run context:audit -- --strict`

## Boundary Check

- [ ] No `.env`, API keys, private manuscript text, exports, model-call logs, or active project artifacts are included.
- [ ] Prompt/check/review changes preserve the untrusted-document-text boundary.
