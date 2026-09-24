# Backlog

Open items from the 2026-09-23 code review, roughly in priority order.

## Engine strength

### Mate scores in the TT aren't ply-adjusted
`engine-worker.js` — `negamax` stores and probes mate scores (`-MATE + ply`) as-is.
A TT hit from a transposition at a different ply returns a mate distance measured
from the wrong root depth, so the engine can misjudge mate length, prefer a longer
mate, and the `score > MATE_TH` early exit in iterative deepening can trigger on a
wrong score. Fix: convert to "mate from this node" on store (`score + ply` /
`score - ply`) and back on probe.

### No repetition detection against game history
`engine-worker.js` — `parseFen` builds the position from FEN only, so the search
can't see positions from earlier in the game. The engine can walk into a threefold
repetition when winning, or miss one when losing. Fix: pass the game's position
hashes (or move list) with the `search` command and check them in `negamax`.

## Tooling

### `pgn2book.js` produces an incompatible book
Writes 4-field FEN keys (with EP square) and symbol evals, and by default
overwrites `book.json.js`. The engine looks up 3-field keys, so running it as
documented silently disables the standard book. Either delete it (superseded by
the crawler pipeline) or update it to 3-field keys.

### Book overrides file
Manual eval tweaks (e.g. 1.e4/1.Nf3/1.c4 raised to `$14` for variety) live
directly in `book.json.js` and are lost if the book is re-exported from crawler
checkpoints. Add an overrides file (position key → move → eval) that the export
step applies last.

## Performance

### Full move generation at depth-0 nodes
`negamax` generates all legal moves before dropping into quiescence at depth 0.
Check depth first and go straight to `quiesce`.

## Cleanup

- `gameEngine` / `gameLevel` in `index.html` are assigned in `newGame()` but never read.
- UCI mate-score parsing is duplicated between the game and analysis Stockfish handlers.
- PV move-number formatting is duplicated between `updateMoveList()` and `generatePGN()`.

## Decided — not doing

- **`CHEESE_VERSION` is the parent commit's hash.** The pre-commit hook can't know
  the new commit's hash. On a linear `main`, "child of P" is unambiguous, which is
  good enough. Exact hashes would need deploy-time stamping via a GitHub Actions
  Pages workflow.
