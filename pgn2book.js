#!/usr/bin/env node
'use strict';

// Minimal chess logic for PGN replay — no dependencies needed.
// Supports: all legal moves, castling, en passant, promotion.

const fs = require('fs');

// ── Compact Chess Position Tracker ──────────────────────────────

function Chess() {
  const EMPTY = 0;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const WHITE = 0, BLACK = 1;
  const piece = (type, color) => type | (color << 3);
  const typeOf = p => p & 7;
  const colorOf = p => (p >> 3) & 1;

  const board = new Array(64).fill(EMPTY);
  let turn = WHITE;
  let castling = 0b1111; // KQkq bits: 8=K,4=Q,2=k,1=q
  let epSquare = -1;
  let halfmove = 0;
  let fullmove = 1;

  const SQ = (f, r) => r * 8 + f;
  const FILE = sq => sq & 7;
  const RANK = sq => sq >> 3;

  const PIECE_CHARS = {P: PAWN, N: KNIGHT, B: BISHOP, R: ROOK, Q: QUEEN, K: KING};
  const FILE_CHARS = 'abcdefgh';
  const FEN_MAP = {
    P: piece(PAWN, WHITE), N: piece(KNIGHT, WHITE), B: piece(BISHOP, WHITE),
    R: piece(ROOK, WHITE), Q: piece(QUEEN, WHITE), K: piece(KING, WHITE),
    p: piece(PAWN, BLACK), n: piece(KNIGHT, BLACK), b: piece(BISHOP, BLACK),
    r: piece(ROOK, BLACK), q: piece(QUEEN, BLACK), k: piece(KING, BLACK),
  };

  function loadFen(fen) {
    const parts = fen.split(' ');
    board.fill(EMPTY);
    let sq = 56;
    for (const ch of parts[0]) {
      if (ch === '/') { sq -= 16; }
      else if (ch >= '1' && ch <= '8') { sq += parseInt(ch); }
      else { board[sq] = FEN_MAP[ch]; sq++; }
    }
    turn = parts[1] === 'b' ? BLACK : WHITE;
    castling = 0;
    if (parts[2].includes('K')) castling |= 8;
    if (parts[2].includes('Q')) castling |= 4;
    if (parts[2].includes('k')) castling |= 2;
    if (parts[2].includes('q')) castling |= 1;
    epSquare = parts[3] === '-' ? -1 : FILE_CHARS.indexOf(parts[3][0]) + parseInt(parts[3][1]) * 8 - 8;
    halfmove = parseInt(parts[4]) || 0;
    fullmove = parseInt(parts[5]) || 1;
  }

  function toFen() {
    let fen = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = board[SQ(f, r)];
        if (p === EMPTY) { empty++; continue; }
        if (empty) { fen += empty; empty = 0; }
        const ch = ' pnbrqk'[typeOf(p)];
        fen += colorOf(p) === WHITE ? ch.toUpperCase() : ch;
      }
      if (empty) fen += empty;
      if (r > 0) fen += '/';
    }
    fen += turn === WHITE ? ' w ' : ' b ';
    let c = '';
    if (castling & 8) c += 'K';
    if (castling & 4) c += 'Q';
    if (castling & 2) c += 'k';
    if (castling & 1) c += 'q';
    fen += (c || '-');
    if (epSquare >= 0) fen += ' ' + FILE_CHARS[FILE(epSquare)] + (RANK(epSquare) + 1);
    else fen += ' -';
    return fen;
  }

  function bookFen() {
    return toFen(); // first 4 fields only (no halfmove/fullmove)
  }

  function findKing(color) {
    const k = piece(KING, color);
    for (let i = 0; i < 64; i++) if (board[i] === k) return i;
    return -1;
  }

  function isAttacked(sq, byColor) {
    const f = FILE(sq), r = RANK(sq);
    // Knight attacks
    const knightDeltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    const kn = piece(KNIGHT, byColor);
    for (const [df, dr] of knightDeltas) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[SQ(nf, nr)] === kn) return true;
    }
    // King attacks
    const ki = piece(KING, byColor);
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[SQ(nf, nr)] === ki) return true;
    }
    // Pawn attacks
    const pawnDir = byColor === WHITE ? -1 : 1;
    const pw = piece(PAWN, byColor);
    for (const df of [-1, 1]) {
      const nf = f + df, nr = r + pawnDir;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[SQ(nf, nr)] === pw) return true;
    }
    // Sliding pieces (bishop/queen diagonals, rook/queen straights)
    const bq = [piece(BISHOP, byColor), piece(QUEEN, byColor)];
    for (const [df, dr] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      for (let nf = f+df, nr = r+dr; nf >= 0 && nf < 8 && nr >= 0 && nr < 8; nf += df, nr += dr) {
        const p = board[SQ(nf, nr)];
        if (p === EMPTY) continue;
        if (bq.includes(p)) return true;
        break;
      }
    }
    const rq = [piece(ROOK, byColor), piece(QUEEN, byColor)];
    for (const [df, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      for (let nf = f+df, nr = r+dr; nf >= 0 && nf < 8 && nr >= 0 && nr < 8; nf += df, nr += dr) {
        const p = board[SQ(nf, nr)];
        if (p === EMPTY) continue;
        if (rq.includes(p)) return true;
        break;
      }
    }
    return false;
  }

  function inCheck(color) {
    return isAttacked(findKing(color), color ^ 1);
  }

  // Apply a move given {from, to, promotion?} — returns undo info
  function makeMove(from, to, promo) {
    const undo = {
      from, to, promo,
      captured: board[to],
      movedPiece: board[from],
      castling, epSquare, halfmove, fullmove
    };

    const p = board[from];
    const typ = typeOf(p);
    const col = colorOf(p);

    // En passant capture
    if (typ === PAWN && to === epSquare) {
      const capSq = SQ(FILE(to), RANK(from));
      undo.epCapSq = capSq;
      undo.epCapPiece = board[capSq];
      board[capSq] = EMPTY;
    }

    board[to] = promo ? piece(promo, col) : p;
    board[from] = EMPTY;

    // Castling move rook
    if (typ === KING && Math.abs(FILE(from) - FILE(to)) === 2) {
      if (to === SQ(6, RANK(from))) { // kingside
        undo.rookFrom = SQ(7, RANK(from));
        undo.rookTo = SQ(5, RANK(from));
      } else { // queenside
        undo.rookFrom = SQ(0, RANK(from));
        undo.rookTo = SQ(3, RANK(from));
      }
      board[undo.rookTo] = board[undo.rookFrom];
      board[undo.rookFrom] = EMPTY;
    }

    // Update castling rights
    if (typ === KING) {
      if (col === WHITE) castling &= ~12;
      else castling &= ~3;
    }
    if (from === SQ(0, 0) || to === SQ(0, 0)) castling &= ~4;
    if (from === SQ(7, 0) || to === SQ(7, 0)) castling &= ~8;
    if (from === SQ(0, 7) || to === SQ(0, 7)) castling &= ~1;
    if (from === SQ(7, 7) || to === SQ(7, 7)) castling &= ~2;

    // En passant square
    if (typ === PAWN && Math.abs(RANK(to) - RANK(from)) === 2) {
      epSquare = SQ(FILE(from), (RANK(from) + RANK(to)) / 2);
    } else {
      epSquare = -1;
    }

    halfmove = (typ === PAWN || undo.captured !== EMPTY) ? 0 : halfmove + 1;
    if (col === BLACK) fullmove++;
    turn ^= 1;

    return undo;
  }

  function unmakeMove(undo) {
    board[undo.from] = undo.movedPiece;
    board[undo.to] = undo.captured;
    if (undo.epCapSq !== undefined) board[undo.epCapSq] = undo.epCapPiece;
    if (undo.rookFrom !== undefined) {
      board[undo.rookFrom] = board[undo.rookTo];
      board[undo.rookTo] = EMPTY;
    }
    castling = undo.castling;
    epSquare = undo.epSquare;
    halfmove = undo.halfmove;
    fullmove = undo.fullmove;
    turn ^= 1;
  }

  // Parse SAN like "Nf3", "exd5", "O-O", "e8=Q", "Bxe5+" and return {from, to, promo}
  function parseSAN(san) {
    san = san.replace(/[+#!?]+$/, '');
    if (san === 'O-O' || san === 'O-O-O') {
      const r = turn === WHITE ? 0 : 7;
      const from = SQ(4, r);
      const to = san === 'O-O' ? SQ(6, r) : SQ(2, r);
      return {from, to};
    }
    let s = san;
    let promo = 0;
    const promoMatch = s.match(/=([NBRQ])$/);
    if (promoMatch) {
      promo = PIECE_CHARS[promoMatch[1]];
      s = s.replace(/=[NBRQ]$/, '');
    }
    s = s.replace(/x/g, '');
    const destFile = FILE_CHARS.indexOf(s[s.length - 2]);
    const destRank = parseInt(s[s.length - 1]) - 1;
    const to = SQ(destFile, destRank);
    s = s.substring(0, s.length - 2);
    let pieceType = PAWN, disambigFile = -1, disambigRank = -1;
    if (s.length > 0 && s[0] >= 'A' && s[0] <= 'Z') {
      pieceType = PIECE_CHARS[s[0]];
      s = s.substring(1);
    }
    if (s.length >= 1) {
      if (s[0] >= 'a' && s[0] <= 'h') { disambigFile = FILE_CHARS.indexOf(s[0]); s = s.substring(1); }
    }
    if (s.length >= 1) {
      if (s[0] >= '1' && s[0] <= '8') { disambigRank = parseInt(s[0]) - 1; s = s.substring(1); }
    }
    const target = piece(pieceType, turn);
    for (let sq = 0; sq < 64; sq++) {
      if (board[sq] !== target) continue;
      if (disambigFile >= 0 && FILE(sq) !== disambigFile) continue;
      if (disambigRank >= 0 && RANK(sq) !== disambigRank) continue;
      if (!isLegalMove(sq, to, promo, pieceType)) continue;
      return {from: sq, to, promo};
    }
    return null;
  }

  function isLegalMove(from, to, promo, pieceType) {
    const col = turn;
    const typ = pieceType || typeOf(board[from]);
    const dest = board[to];
    if (dest !== EMPTY && colorOf(dest) === col) return false;

    if (typ === PAWN) {
      const dir = col === WHITE ? 1 : -1;
      const startRank = col === WHITE ? 1 : 6;
      const ff = FILE(from), fr = RANK(from);
      const tf = FILE(to), tr = RANK(to);
      if (tf === ff) {
        if (tr === fr + dir && dest === EMPTY) { /* single push */ }
        else if (tr === fr + 2 * dir && fr === startRank && dest === EMPTY && board[SQ(ff, fr + dir)] === EMPTY) { /* double push */ }
        else return false;
      } else if (Math.abs(tf - ff) === 1 && tr === fr + dir) {
        if (dest !== EMPTY) { /* capture */ }
        else if (to === epSquare) { /* en passant */ }
        else return false;
      } else return false;
    } else if (typ === KNIGHT) {
      const df = Math.abs(FILE(from) - FILE(to)), dr = Math.abs(RANK(from) - RANK(to));
      if (!((df === 1 && dr === 2) || (df === 2 && dr === 1))) return false;
    } else if (typ === BISHOP) {
      if (!isDiagClear(from, to)) return false;
    } else if (typ === ROOK) {
      if (!isStraightClear(from, to)) return false;
    } else if (typ === QUEEN) {
      if (!isDiagClear(from, to) && !isStraightClear(from, to)) return false;
    } else if (typ === KING) {
      const df = Math.abs(FILE(from) - FILE(to)), dr = Math.abs(RANK(from) - RANK(to));
      if (df <= 1 && dr <= 1) { /* normal king move */ }
      else if (df === 2 && dr === 0) {
        // castling
        const r = RANK(from);
        if (inCheck(col)) return false;
        if (FILE(to) === 6) { // kingside
          if (!(castling & (col === WHITE ? 8 : 2))) return false;
          if (board[SQ(5, r)] !== EMPTY || board[SQ(6, r)] !== EMPTY) return false;
          if (isAttacked(SQ(5, r), col ^ 1)) return false;
        } else { // queenside
          if (!(castling & (col === WHITE ? 4 : 1))) return false;
          if (board[SQ(3, r)] !== EMPTY || board[SQ(2, r)] !== EMPTY || board[SQ(1, r)] !== EMPTY) return false;
          if (isAttacked(SQ(3, r), col ^ 1)) return false;
        }
      } else return false;
    }

    // Check legality (not leaving king in check)
    const undo = makeMove(from, to, promo);
    const legal = !inCheck(col);
    unmakeMove(undo);
    return legal;
  }

  function isDiagClear(from, to) {
    const df = Math.sign(FILE(to) - FILE(from)), dr = Math.sign(RANK(to) - RANK(from));
    if (Math.abs(df) !== 1 || Math.abs(dr) !== 1) return false;
    if (Math.abs(FILE(to) - FILE(from)) !== Math.abs(RANK(to) - RANK(from))) return false;
    for (let f = FILE(from)+df, r = RANK(from)+dr; f !== FILE(to) || r !== RANK(to); f += df, r += dr) {
      if (board[SQ(f, r)] !== EMPTY) return false;
    }
    return true;
  }

  function isStraightClear(from, to) {
    if (FILE(from) !== FILE(to) && RANK(from) !== RANK(to)) return false;
    const df = Math.sign(FILE(to) - FILE(from)), dr = Math.sign(RANK(to) - RANK(from));
    for (let f = FILE(from)+df, r = RANK(from)+dr; f !== FILE(to) || r !== RANK(to); f += df, r += dr) {
      if (board[SQ(f, r)] !== EMPTY) return false;
    }
    return true;
  }

  function moveToUCI(from, to, promo) {
    let s = FILE_CHARS[FILE(from)] + (RANK(from) + 1) + FILE_CHARS[FILE(to)] + (RANK(to) + 1);
    if (promo) s += ' nbrq'[promo];
    return s;
  }

  loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  return { loadFen, toFen, bookFen, parseSAN, makeMove, unmakeMove, moveToUCI, inCheck, turn: () => turn };
}

// ── PGN Tokenizer ───────────────────────────────────────────────

function tokenize(pgn) {
  const tokens = [];
  let i = 0;
  while (i < pgn.length) {
    const ch = pgn[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') { i++; continue; }
    if (ch === '{') {
      const end = pgn.indexOf('}', i);
      i = end < 0 ? pgn.length : end + 1;
      continue;
    }
    if (ch === ';') {
      const end = pgn.indexOf('\n', i);
      i = end < 0 ? pgn.length : end + 1;
      continue;
    }
    if (ch === '(') { tokens.push({type: 'open'}); i++; continue; }
    if (ch === ')') { tokens.push({type: 'close'}); i++; continue; }
    if (ch === '$') {
      let j = i + 1;
      while (j < pgn.length && pgn[j] >= '0' && pgn[j] <= '9') j++;
      tokens.push({type: 'nag', value: parseInt(pgn.substring(i + 1, j))});
      i = j;
      continue;
    }
    if (ch === '[') {
      const end = pgn.indexOf(']', i);
      i = end < 0 ? pgn.length : end + 1;
      continue;
    }
    // Move number like "1." or "1..."
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < pgn.length && pgn[j] >= '0' && pgn[j] <= '9') j++;
      while (j < pgn.length && pgn[j] === '.') j++;
      const text = pgn.substring(i, j).replace(/\.+$/, '');
      if (text === '0' || text === '1') {
        // Could be result like "0-1", "1-0", "1/2-1/2"
        const rest = pgn.substring(i);
        const resultMatch = rest.match(/^(1-0|0-1|1\/2-1\/2|\*)/);
        if (resultMatch) {
          tokens.push({type: 'result', value: resultMatch[1]});
          i += resultMatch[1].length;
          continue;
        }
      }
      // Skip move number
      i = j;
      while (i < pgn.length && pgn[i] === ' ') i++;
      continue;
    }
    if (ch === '*') { tokens.push({type: 'result', value: '*'}); i++; continue; }
    // SAN move
    let j = i;
    while (j < pgn.length && pgn[j] !== ' ' && pgn[j] !== '\n' && pgn[j] !== '\r' &&
           pgn[j] !== '(' && pgn[j] !== ')' && pgn[j] !== '{' && pgn[j] !== '$') j++;
    const move = pgn.substring(i, j);
    if (move.length > 0) {
      tokens.push({type: 'move', value: move});
    }
    i = j;
  }
  return tokens;
}

// ── Build Book ──────────────────────────────────────────────────

const EVAL_TIERS = {
  18: '+-', 16: '+/-', 14: '+=',
  10: '=', 11: '=', 12: '=',
  15: '=+', 17: '-/+', 19: '-+',
  13: '='
};

function buildBook(pgnText) {
  const tokens = tokenize(pgnText);
  const book = {};  // bookFen -> [{move, eval}]
  const chess = Chess();
  let moveCount = 0;

  function addEntry(fen, uci, nag) {
    if (!book[fen]) book[fen] = [];
    const evalStr = EVAL_TIERS[nag] || '=';
    const existing = book[fen].find(e => e.move === uci);
    if (existing) {
      existing.eval = evalStr;
    } else {
      book[fen].push({move: uci, eval: evalStr});
    }
    moveCount++;
  }

  // Recursive descent parser
  let pos = 0;

  function parseVariation() {
    // Save state at the start of this variation
    const savedFen = chess.toFen();
    const undos = [];

    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.type === 'close' || tok.type === 'result') break;

      if (tok.type === 'move') {
        const fen = chess.bookFen();
        const parsed = chess.parseSAN(tok.value);
        if (!parsed) {
          console.error(`Failed to parse move: ${tok.value} at FEN: ${chess.toFen()}`);
          pos++;
          continue;
        }
        const uci = chess.moveToUCI(parsed.from, parsed.to, parsed.promo);

        // Look ahead for NAG
        let nag = 10; // default = equal
        if (pos + 1 < tokens.length && tokens[pos + 1].type === 'nag') {
          nag = tokens[pos + 1].value;
          pos++;
        }

        addEntry(fen, uci, nag);
        const undo = chess.makeMove(parsed.from, parsed.to, parsed.promo);
        undos.push(undo);
        pos++;
      } else if (tok.type === 'open') {
        pos++; // skip '('
        // Rewind to before the last move in this line
        if (undos.length > 0) {
          const lastUndo = undos[undos.length - 1];
          chess.unmakeMove(lastUndo);
          parseVariation();
          chess.makeMove(lastUndo.from, lastUndo.to, lastUndo.promo);
        } else {
          parseVariation();
        }
        if (pos < tokens.length && tokens[pos].type === 'close') pos++;
      } else if (tok.type === 'nag') {
        pos++; // stray NAG, skip
      } else {
        pos++;
      }
    }

    // Restore to saved state
    while (undos.length > 0) chess.unmakeMove(undos.pop());
    chess.loadFen(savedFen);
  }

  parseVariation();

  console.log(`Processed ${moveCount} book entries across ${Object.keys(book).length} positions`);
  return book;
}

// ── Main ────────────────────────────────────────────────────────

const pgnFile = process.argv[2] || 'book.pgn';
const outFile = process.argv[3] || 'book.json';
const jsFile = outFile.replace(/\.json$/, '.json.js');

const pgn = fs.readFileSync(pgnFile, 'utf8');
const book = buildBook(pgn);
fs.writeFileSync(outFile, JSON.stringify(book, null, 2));
fs.writeFileSync(jsFile, 'var CHEESE_BOOK = ' + JSON.stringify(book) + ';\n');
console.log(`Written to ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
console.log(`Written to ${jsFile} (${(fs.statSync(jsFile).size / 1024).toFixed(1)} KB)`);
