# Human final merge

After a separate Reviewer session records LGTM with `npm run review:lgtm`, the human operator runs exactly:

```bash
npm run pr:merge
```

No SHA or PR number is typed manually. The command reads the local Git-external proof, checks it against the current PR and local HEAD, waits for CI with fail-fast behavior, rechecks the PR HEAD, then calls GitHub CLI with `--match-head-commit`. The proof is removed only after a successful merge.

AI agents are prohibited from executing this command.
