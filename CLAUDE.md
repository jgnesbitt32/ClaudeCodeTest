# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git / GitHub

- Remote: `https://github.com/jgnesbitt32/ClaudeCodeTest`
- Branch: `master`
- Git identity configured locally: `jgnesbitt32` / `johngarland@bluebirdpharm.com`

**Commit and push after every meaningful unit of work** — a new feature, a bug fix, a refactor, a config change. Never batch multiple unrelated changes into one commit. This ensures work is never lost and the history stays readable.

Commit message format:
- First line: short imperative summary (`Add AI opponent`, `Fix win detection on draw`, `Style score board`)
- If context is needed, add a blank line then a short body
- Always include the co-author trailer: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

After every commit, run `git push` immediately so GitHub is always up to date with local state.
