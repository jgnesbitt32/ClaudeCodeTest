# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A browser-based Tic Tac Toe game — single HTML file, no build step, no dependencies.

## Running the Game

Open directly in any browser:

```powershell
start tictactoe.html
```

There is no build, compile, lint, or test step. Changes to `tictactoe.html` are immediately reflected on the next browser refresh.

## Architecture

Everything lives in `tictactoe.html` as a single self-contained file with three sections:

- **`<style>`** — All CSS. Dark navy theme (`#1a1a2e` background). CSS classes `x`/`o` color the marks; `win` class highlights the winning triple with a gold border + pulse animation; `taken` blocks re-clicks via the JS guard.
- **`<body>`** — Static DOM: score display → status line → 3×3 grid of `.cell` divs (indexed via `data-i="0–8"`) → reset button.
- **`<script>`** — Vanilla JS, no frameworks. Key pieces:
  - `WINS` — hardcoded array of all 8 winning index triples.
  - `board` — flat 9-element array of `''`, `'X'`, or `'O'` mirroring the DOM.
  - `init()` — resets `board`, `current`, `over`, and DOM state.
  - `checkWin()` — iterates `WINS` against `board`; returns winning triple or `null`.
  - Click handler on each cell — updates `board`, DOM, checks win/draw, toggles `current`.
  - `scores` object (`{ X, O, draw }`) — persists across `init()` calls (survives "New Game").

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
