# Cheese

A browser-based chess app where you play against **Cheese** — a JavaScript chess engine ported from a custom C engine ([engine.c](https://github.com/M0HCTP/Engine)).

Play it live at **[m0hctp.github.io/cheese](https://m0hctp.github.io/cheese/)**

## Engine

Cheese is a from-scratch engine using:
- 0x88 board representation
- PeSTO tapered evaluation (middlegame/endgame piece-square tables)
- Negamax search with alpha-beta pruning
- Transposition table, quiescence search, killer moves, history heuristic

The engine runs in a Web Worker so the UI stays responsive during search.

## Controls

- **Engine** — select which engine to play against (Stockfish coming soon)
- **Level** (1–10) — directly sets the engine's search depth. Level 1 is beginner-friendly; level 10 is strong
- **Color** — play as White or Black
- **New Game** — start a fresh game
- **Flip** — rotate the board
- **Save PGN** — download the current game (with analysis annotations if available)
- **Load PGN** — load a saved game and continue playing from where it left off

## Game Analysis

After playing a game, click **Analyze** to have the engine evaluate every position and flag suboptimal moves.

### How it works

The engine searches each position to the selected analysis depth and compares consecutive evaluations. When a move loses significant centipawn (cp) value compared to what was available, it gets flagged.

### Classification thresholds

| Symbol | Category | Default | Meaning |
|--------|-----------|---------|---------|
| ?! | Inaccuracy | 50 cp | A slightly imprecise move |
| ? | Mistake | 100 cp | A move that gives up about a pawn's worth of advantage |
| ?? | Blunder | 200 cp | A serious error, often losing material or the game |

All three thresholds are tunable — adjust them in the analysis panel before running. For example, lowering the inaccuracy threshold to 25 cp will catch subtler imprecisions.

### Reading the results

- Moves are color-coded in the move list: **yellow** (inaccuracy), **orange** (mistake), **red** (blunder)
- Click any move to see that position on the board
- Use arrow keys to step through moves
- The saved PGN includes NAG annotations (?!, ?, ??) and eval-change comments

## Credits

Engine ported from [engine.c](https://github.com/M0HCTP/Engine). UI built with [chessboard.js](https://chessboardjs.com/) and [chess.js](https://github.com/jhlywa/chess.js).

Also check out [Translit](https://m0hctp.github.io/translit/) — a Russian transliteration tool by the same author.
