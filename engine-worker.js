'use strict';

// === Piece Constants ===
const EMPTY = 0;
const WP = 1, WN = 2, WB = 3, WR = 4, WQ = 5, WK = 6;
const BP = 9, BN = 10, BB = 11, BR = 12, BQ = 13, BK = 14;

const TYPE = p => p & 7;
const COLOR = p => (p & 8) ? 1 : 0;
const ONBOARD = sq => (sq & 0x88) === 0;
const FILE0 = sq => sq & 7;
const RANK0 = sq => sq >> 4;
const S64 = sq => (sq >> 4) * 8 + (sq & 7);

// === Move Encoding ===
const M = (from, to, promo, flags) => from | (to << 8) | (promo << 16) | (flags << 20);
const MFROM = m => m & 0x7f;
const MTO = m => (m >> 8) & 0x7f;
const MPROMO = m => (m >> 16) & 0xf;
const MFLAG = m => (m >> 20) & 0xf;
const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;

// === Board State ===
const board = new Array(128).fill(0);
let stm = 0, castle = 0, ep = -1, halfmove = 0;
const kingSq = [0, 0];
let hash = 0;

// === Zobrist Hashing (32-bit) ===
const zP = Array.from({length: 15}, () => new Array(128).fill(0));
let zSide = 0;
const zCastle = new Array(16).fill(0);
const zEp = new Array(8).fill(0);
let smState = 0;

function sm() {
    smState = (smState ^ (smState << 13)) | 0;
    smState = (smState ^ (smState >>> 17)) | 0;
    smState = (smState ^ (smState << 5)) | 0;
    return smState;
}

function zobInit() {
    smState = 88172645;
    for (let p = 0; p < 15; p++)
        for (let s = 0; s < 128; s++)
            zP[p][s] = sm();
    zSide = sm();
    for (let i = 0; i < 16; i++) zCastle[i] = sm();
    for (let f = 0; f < 8; f++) zEp[f] = sm();
}

function fullHash() {
    let h = 0;
    for (let s = 0; s < 128; s++)
        if (ONBOARD(s) && board[s]) h ^= zP[board[s]][s];
    if (stm) h ^= zSide;
    h ^= zCastle[castle];
    if (ep !== -1) h ^= zEp[FILE0(ep)];
    return h | 0;
}

// === Direction Tables ===
const KN = [33, 31, 18, 14, -33, -31, -18, -14];
const KG = [16, -16, 1, -1, 17, 15, -17, -15];
const BSH = [17, 15, -17, -15];
const RK = [16, -16, 1, -1];

// === Attack Detection ===
function attacked(sq, by) {
    if (by === 0) {
        if (ONBOARD(sq - 17) && board[sq - 17] === WP) return 1;
        if (ONBOARD(sq - 15) && board[sq - 15] === WP) return 1;
    } else {
        if (ONBOARD(sq + 17) && board[sq + 17] === BP) return 1;
        if (ONBOARD(sq + 15) && board[sq + 15] === BP) return 1;
    }
    for (let i = 0; i < 8; i++) {
        const t = sq + KN[i];
        if (ONBOARD(t) && board[t] && COLOR(board[t]) === by && TYPE(board[t]) === 2) return 1;
    }
    for (let i = 0; i < 8; i++) {
        const t = sq + KG[i];
        if (ONBOARD(t) && board[t] && COLOR(board[t]) === by && TYPE(board[t]) === 6) return 1;
    }
    for (let i = 0; i < 4; i++) {
        let t = sq + BSH[i];
        while (ONBOARD(t)) {
            if (board[t]) {
                if (COLOR(board[t]) === by && (TYPE(board[t]) === 3 || TYPE(board[t]) === 5)) return 1;
                break;
            }
            t += BSH[i];
        }
    }
    for (let i = 0; i < 4; i++) {
        let t = sq + RK[i];
        while (ONBOARD(t)) {
            if (board[t]) {
                if (COLOR(board[t]) === by && (TYPE(board[t]) === 4 || TYPE(board[t]) === 5)) return 1;
                break;
            }
            t += RK[i];
        }
    }
    return 0;
}

function inCheck(side) { return attacked(kingSq[side], side ^ 1); }

// === Move Generation ===
function gen() {
    const list = [];
    const us = stm, them = us ^ 1;
    for (let s = 0; s < 128; s++) {
        if (!ONBOARD(s)) { s += 7; continue; }
        const p = board[s];
        if (!p || COLOR(p) !== us) continue;
        const t = TYPE(p);

        if (t === 1) {
            const dir = us ? -16 : 16, startRank = us ? 6 : 1, promoRank = us ? 0 : 7;
            const one = s + dir;
            if (ONBOARD(one) && board[one] === EMPTY) {
                if (RANK0(one) === promoRank) {
                    for (let pr = 5; pr >= 2; pr--) list.push(M(s, one, pr, 0));
                } else {
                    list.push(M(s, one, 0, 0));
                    if (RANK0(s) === startRank) {
                        const two = s + 2 * dir;
                        if (board[two] === EMPTY) list.push(M(s, two, 0, F_DOUBLE));
                    }
                }
            }
            const caps = us ? [s - 17, s - 15] : [s + 15, s + 17];
            for (let k = 0; k < 2; k++) {
                const c = caps[k];
                if (!ONBOARD(c)) continue;
                if (board[c] && COLOR(board[c]) === them) {
                    if (RANK0(c) === promoRank) {
                        for (let pr = 5; pr >= 2; pr--) list.push(M(s, c, pr, F_CAP));
                    } else list.push(M(s, c, 0, F_CAP));
                } else if (c === ep) list.push(M(s, c, 0, F_CAP | F_EP));
            }
        } else if (t === 2) {
            for (let i = 0; i < 8; i++) {
                const c = s + KN[i];
                if (!ONBOARD(c)) continue;
                if (!board[c]) list.push(M(s, c, 0, 0));
                else if (COLOR(board[c]) === them) list.push(M(s, c, 0, F_CAP));
            }
        } else if (t === 6) {
            for (let i = 0; i < 8; i++) {
                const c = s + KG[i];
                if (!ONBOARD(c)) continue;
                if (!board[c]) list.push(M(s, c, 0, 0));
                else if (COLOR(board[c]) === them) list.push(M(s, c, 0, F_CAP));
            }
        } else {
            let dd, nd;
            if (t === 3) { dd = BSH; nd = 4; }
            else if (t === 4) { dd = RK; nd = 4; }
            else { dd = KG; nd = 8; }
            for (let i = 0; i < nd; i++) {
                let c = s + dd[i];
                while (ONBOARD(c)) {
                    if (!board[c]) list.push(M(s, c, 0, 0));
                    else { if (COLOR(board[c]) === them) list.push(M(s, c, 0, F_CAP)); break; }
                    c += dd[i];
                }
            }
        }
    }
    if (us === 0) {
        if ((castle & 1) && board[5] === EMPTY && board[6] === EMPTY &&
            !attacked(4, 1) && !attacked(5, 1) && !attacked(6, 1))
            list.push(M(4, 6, 0, F_CASTLE));
        if ((castle & 2) && board[1] === EMPTY && board[2] === EMPTY && board[3] === EMPTY &&
            !attacked(4, 1) && !attacked(3, 1) && !attacked(2, 1))
            list.push(M(4, 2, 0, F_CASTLE));
    } else {
        if ((castle & 4) && board[117] === EMPTY && board[118] === EMPTY &&
            !attacked(116, 0) && !attacked(117, 0) && !attacked(118, 0))
            list.push(M(116, 118, 0, F_CASTLE));
        if ((castle & 8) && board[113] === EMPTY && board[114] === EMPTY && board[115] === EMPTY &&
            !attacked(116, 0) && !attacked(115, 0) && !attacked(114, 0))
            list.push(M(116, 114, 0, F_CASTLE));
    }
    return list;
}

// === Make / Unmake ===
const MAXHIST = 4096;
const hist = Array.from({length: MAXHIST}, () => ({cap:0, castle:0, ep:0, half:0, hash:0, kw:0, kb:0}));
let hply = 0;

function castleMask(sq) {
    if (sq === 4) return ~3;
    if (sq === 116) return ~12;
    if (sq === 0) return ~2;
    if (sq === 7) return ~1;
    if (sq === 112) return ~8;
    if (sq === 119) return ~4;
    return ~0;
}

function make(m) {
    const u = hist[hply++];
    u.castle = castle; u.ep = ep; u.half = halfmove; u.hash = hash;
    u.kw = kingSq[0]; u.kb = kingSq[1];
    const from = MFROM(m), to = MTO(m), promo = MPROMO(m), fl = MFLAG(m);
    const p = board[from], us = COLOR(p);
    u.cap = EMPTY;
    if (ep !== -1) hash ^= zEp[FILE0(ep)];
    hash ^= zP[p][from]; board[from] = EMPTY; halfmove++;
    if (TYPE(p) === 1) halfmove = 0;
    if (fl & F_EP) {
        const csq = us ? to + 16 : to - 16;
        u.cap = board[csq]; hash ^= zP[board[csq]][csq]; board[csq] = EMPTY; halfmove = 0;
    } else if (fl & F_CAP) {
        u.cap = board[to]; hash ^= zP[board[to]][to]; halfmove = 0;
    }
    const placed = promo ? ((us ? 8 : 0) | promo) : p;
    hash ^= zP[placed][to]; board[to] = placed;
    if (TYPE(p) === 6) kingSq[us] = to;
    if (fl & F_CASTLE) {
        let rf, rt;
        if (to === 6) { rf = 7; rt = 5; }
        else if (to === 2) { rf = 0; rt = 3; }
        else if (to === 118) { rf = 119; rt = 117; }
        else { rf = 112; rt = 115; }
        const rook = board[rf];
        hash ^= zP[rook][rf]; board[rf] = EMPTY;
        hash ^= zP[rook][rt]; board[rt] = rook;
    }
    const oldc = castle;
    castle &= castleMask(from); castle &= castleMask(to);
    hash ^= zCastle[oldc]; hash ^= zCastle[castle];
    ep = -1;
    if (fl & F_DOUBLE) { ep = us ? to + 16 : to - 16; hash ^= zEp[FILE0(ep)]; }
    stm ^= 1; hash ^= zSide;
}

function unmake(m) {
    const u = hist[--hply];
    const from = MFROM(m), to = MTO(m), promo = MPROMO(m), fl = MFLAG(m);
    stm ^= 1;
    const us = stm;
    const moved = promo ? (us ? BP : WP) : board[to];
    if (fl & F_CASTLE) {
        let rf, rt;
        if (to === 6) { rf = 7; rt = 5; }
        else if (to === 2) { rf = 0; rt = 3; }
        else if (to === 118) { rf = 119; rt = 117; }
        else { rf = 112; rt = 115; }
        const rook = board[rt]; board[rt] = EMPTY; board[rf] = rook;
    }
    board[from] = moved; board[to] = EMPTY;
    if (fl & F_EP) { const csq = us ? to + 16 : to - 16; board[csq] = u.cap; }
    else if (fl & F_CAP) board[to] = u.cap;
    castle = u.castle; ep = u.ep; halfmove = u.half; hash = u.hash;
    kingSq[0] = u.kw; kingSq[1] = u.kb;
}

function legalMoves() {
    const ps = gen(), moves = [];
    for (let i = 0; i < ps.length; i++) {
        make(ps[i]);
        if (!inCheck(stm ^ 1)) moves.push(ps[i]);
        unmake(ps[i]);
    }
    return moves;
}

// === Evaluation (PeSTO) ===
const PIECE_MG = [0, 82, 337, 365, 477, 1025, 0];
const PIECE_EG = [0, 94, 281, 297, 512, 936, 0];
const PHASE_W  = [0, 0, 1, 1, 2, 4, 0];

const PAWN_MG   = [0,0,0,0,0,0,0,0,98,134,61,95,68,126,34,-11,-6,7,26,31,65,56,25,-20,-14,13,6,21,23,12,17,-23,-27,-2,-5,12,17,6,10,-25,-26,-4,-4,-10,3,3,33,-12,-35,-1,-20,-23,-15,24,38,-22,0,0,0,0,0,0,0,0];
const PAWN_EG   = [0,0,0,0,0,0,0,0,178,173,158,134,147,132,165,187,94,100,85,67,56,53,82,84,32,24,13,5,-2,4,17,17,13,9,-3,-7,-7,-8,3,-1,4,7,-6,1,0,-5,-1,-8,13,8,8,10,13,0,2,-7,0,0,0,0,0,0,0,0];
const KNIGHT_MG = [-167,-89,-34,-49,61,-97,-15,-107,-73,-41,72,36,23,62,7,-17,-47,60,37,65,84,129,73,44,-9,17,19,53,37,69,18,22,-13,4,16,13,28,19,21,-8,-23,-9,12,10,19,17,25,-16,-29,-53,-12,-3,-1,18,-14,-19,-105,-21,-58,-33,-17,-28,-19,-23];
const KNIGHT_EG = [-58,-38,-13,-28,-31,-27,-63,-99,-25,-8,-25,-2,-9,-25,-24,-52,-24,-20,10,9,-1,-9,-19,-41,-17,3,22,22,22,11,8,-18,-18,-6,16,25,16,17,4,-18,-23,-3,-1,15,10,-3,-20,-22,-42,-20,-10,-5,-2,-20,-23,-44,-29,-51,-23,-15,-22,-18,-50,-64];
const BISHOP_MG = [-29,4,-82,-37,-25,-42,7,-8,-26,16,-18,-13,30,59,18,-47,-16,37,43,40,35,50,37,-2,-4,5,19,50,37,37,7,-2,-6,13,13,26,34,12,10,4,0,15,15,15,14,27,18,10,4,15,16,0,7,21,33,1,-33,-3,-14,-21,-13,-12,-39,-21];
const BISHOP_EG = [-14,-21,-11,-8,-7,-9,-17,-24,-8,-4,7,-12,-3,-13,-4,-14,2,-8,0,-1,-2,6,0,4,-3,9,12,9,14,10,3,2,-6,3,13,19,7,10,-3,-9,-12,-3,8,10,13,3,-7,-15,-14,-18,-7,-1,4,-9,-15,-27,-23,-9,-23,-5,-9,-16,-5,-17];
const ROOK_MG   = [32,42,32,51,63,9,31,43,27,32,58,62,80,67,26,44,-5,19,26,36,17,45,61,16,-24,-11,7,26,24,35,-8,-20,-36,-26,-12,-1,9,-7,6,-23,-45,-25,-16,-17,3,0,-5,-33,-44,-16,-20,-9,-1,11,-6,-71,-19,-13,1,17,16,7,-37,-26];
const ROOK_EG   = [13,10,18,15,12,12,8,5,11,13,13,11,-3,3,8,3,7,7,7,5,4,-3,-5,-3,4,3,13,1,2,1,-1,2,3,5,8,4,-5,-6,-8,-11,-4,0,-5,-1,-7,-12,-8,-16,-6,-6,0,2,-9,-9,-11,-3,-9,2,3,-1,-5,-13,4,-20];
const QUEEN_MG  = [-28,0,29,12,59,44,43,45,-24,-39,-5,1,-16,57,28,54,-13,-17,7,8,29,56,47,57,-27,-27,-16,-16,-1,17,-2,1,-9,-26,-9,-10,-2,-4,3,-3,-14,2,-11,-2,-5,2,14,5,-35,-8,11,2,8,15,-3,1,-1,-18,-9,10,-15,-25,-31,-50];
const QUEEN_EG  = [-9,22,22,27,27,19,10,20,-17,20,32,41,58,25,30,0,-20,6,9,49,47,35,19,9,3,22,24,45,57,40,57,36,-18,28,19,47,31,34,39,23,-16,-27,15,6,9,17,10,5,-22,-23,-30,-16,-16,-23,-36,-32,-33,-28,-22,-43,-5,-32,-20,-41];
const KING_MG   = [-65,23,16,-15,-56,-34,2,13,29,-1,-20,-7,-8,-4,-38,-29,-9,24,2,-16,-20,6,22,-22,-17,-20,-12,-27,-30,-25,-14,-36,-49,-1,-27,-39,-46,-44,-33,-51,-14,-14,-22,-46,-44,-30,-15,-27,1,7,-8,-64,-43,-16,9,8,-15,36,12,-54,8,-28,24,14];
const KING_EG   = [-74,-35,-18,-18,-11,15,4,-17,-12,17,14,17,17,38,23,11,10,17,23,15,20,45,44,13,-8,22,24,27,26,33,26,3,-18,-4,21,24,27,23,9,-11,-19,-3,11,21,23,16,7,-9,-27,-11,4,13,14,4,-5,-17,-53,-34,-21,-11,-28,-14,-24,-43];

const MGT = [null, PAWN_MG, KNIGHT_MG, BISHOP_MG, ROOK_MG, QUEEN_MG, KING_MG];
const EGT = [null, PAWN_EG, KNIGHT_EG, BISHOP_EG, ROOK_EG, QUEEN_EG, KING_EG];

const MATE = 1000000;
const MATE_TH = MATE - 1000;

function evaluate() {
    let mg = 0, eg = 0, phase = 0;
    const bishops = [0, 0];
    const pf = [[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0]];
    for (let s = 0; s < 128; s++) {
        if (!ONBOARD(s)) { s += 7; continue; }
        const p = board[s]; if (!p) continue;
        const t = TYPE(p), c = COLOR(p), s64 = S64(s);
        const idx = c ? s64 : (s64 ^ 56);
        const vmg = PIECE_MG[t] + MGT[t][idx];
        const veg = PIECE_EG[t] + EGT[t][idx];
        phase += PHASE_W[t];
        if (c === 0) { mg += vmg; eg += veg; } else { mg -= vmg; eg -= veg; }
        if (t === 3) bishops[c]++;
        if (t === 1) pf[c][FILE0(s)]++;
    }
    if (bishops[0] >= 2) { mg += 30; eg += 45; }
    if (bishops[1] >= 2) { mg -= 30; eg -= 45; }
    for (let f = 0; f < 8; f++) {
        if (pf[0][f] > 1) { const pen = 12 * (pf[0][f] - 1); mg -= pen; eg -= pen; }
        if (pf[1][f] > 1) { const pen = 12 * (pf[1][f] - 1); mg += pen; eg += pen; }
    }
    if (phase > 24) phase = 24;
    const score = ((mg * phase + eg * (24 - phase)) / 24) | 0;
    return stm ? -score : score;
}

// === Transposition Table ===
const TTBITS = 20;
const TTSIZE = 1 << TTBITS;
const TTMASK = TTSIZE - 1;
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

let ttKey, ttScore, ttMove, ttDepth, ttFlag;

function initTT() {
    ttKey   = new Int32Array(TTSIZE);
    ttScore = new Int32Array(TTSIZE);
    ttMove  = new Int32Array(TTSIZE);
    ttDepth = new Int16Array(TTSIZE);
    ttFlag  = new Uint8Array(TTSIZE);
}

function clearTT() {
    ttKey.fill(0); ttScore.fill(0); ttMove.fill(0); ttDepth.fill(0); ttFlag.fill(0);
}

// === Move Ordering ===
const MVV = [0, 100, 320, 330, 500, 900, 20000];
const killers = new Int32Array(256);
const histTable = new Int32Array(2 * 128 * 128);

function scoreMove(m, ply, ttm) {
    if (m === ttm) return 10000000;
    if (MFLAG(m) & F_CAP) {
        const to = MTO(m), fl = MFLAG(m);
        const vic = (fl & F_EP) ? 1 : TYPE(board[to]);
        const att = TYPE(board[MFROM(m)]);
        return 1000000 + MVV[vic] * 10 - MVV[att];
    }
    if (MPROMO(m)) return 900000 + MVV[MPROMO(m)];
    if (m === killers[ply * 2] || m === killers[ply * 2 + 1]) return 800000;
    return histTable[stm * 16384 + MFROM(m) * 128 + MTO(m)];
}

function sortMoves(mv, ply, ttm) {
    const sc = new Array(mv.length);
    for (let i = 0; i < mv.length; i++) sc[i] = scoreMove(mv[i], ply, ttm);
    for (let i = 1; i < mv.length; i++) {
        const km = mv[i], ks = sc[i];
        let j = i - 1;
        while (j >= 0 && sc[j] < ks) { sc[j + 1] = sc[j]; mv[j + 1] = mv[j]; j--; }
        sc[j + 1] = ks; mv[j + 1] = km;
    }
}

// === Search State ===
let gNodes = 0, stopFlag = 0, timeLimitMs = 0, tStart = 0, rootBest = 0;

function nowMs() { return performance.now() - tStart; }

// === Quiescence ===
function quiesce(alpha, beta) {
    gNodes++;
    const stand = evaluate();
    if (stand >= beta) return beta;
    if (alpha < stand) alpha = stand;
    const ps = gen();
    const caps = [];
    for (let i = 0; i < ps.length; i++)
        if ((MFLAG(ps[i]) & F_CAP) || MPROMO(ps[i])) caps.push(ps[i]);
    sortMoves(caps, 0, 0);
    for (let i = 0; i < caps.length; i++) {
        make(caps[i]);
        if (inCheck(stm ^ 1)) { unmake(caps[i]); continue; }
        const s = -quiesce(-beta, -alpha);
        unmake(caps[i]);
        if (s >= beta) return beta;
        if (s > alpha) alpha = s;
    }
    return alpha;
}

// === Negamax ===
function negamax(depth, alpha, beta, ply) {
    if (stopFlag || ((gNodes & 2047) === 0 && nowMs() > timeLimitMs)) { stopFlag = 1; return 0; }
    const alpha0 = alpha;
    const key = hash | 0;
    const idx = key & TTMASK;
    let ttm = 0;
    if (ttKey[idx] === key) {
        ttm = ttMove[idx];
        if (ttDepth[idx] >= depth && ply > 0) {
            const s = ttScore[idx];
            if (ttFlag[idx] === TT_EXACT) return s;
            else if (ttFlag[idx] === TT_LOWER) { if (s > alpha) alpha = s; }
            else { if (s < beta) beta = s; }
            if (alpha >= beta) return s;
        }
    }
    const ps = gen();
    const mv = [];
    for (let i = 0; i < ps.length; i++) {
        make(ps[i]);
        if (!inCheck(stm ^ 1)) mv.push(ps[i]);
        unmake(ps[i]);
    }
    if (mv.length === 0) return inCheck(stm) ? -MATE + ply : 0;
    if (halfmove >= 100) return 0;
    if (depth === 0) return quiesce(alpha, beta);
    gNodes++;
    sortMoves(mv, ply, ttm);
    let best = -2 * MATE, bestm = 0;
    for (let i = 0; i < mv.length; i++) {
        make(mv[i]);
        const s = -negamax(depth - 1, -beta, -alpha, ply + 1);
        unmake(mv[i]);
        if (stopFlag) return 0;
        if (s > best) { best = s; bestm = mv[i]; }
        if (s > alpha) alpha = s;
        if (alpha >= beta) {
            if (!(MFLAG(mv[i]) & F_CAP)) {
                if (mv[i] !== killers[ply * 2]) {
                    killers[ply * 2 + 1] = killers[ply * 2];
                    killers[ply * 2] = mv[i];
                }
                histTable[stm * 16384 + MFROM(mv[i]) * 128 + MTO(mv[i])] += depth * depth;
            }
            break;
        }
    }
    if (!stopFlag) {
        ttKey[idx] = key; ttScore[idx] = best; ttMove[idx] = bestm; ttDepth[idx] = depth;
        ttFlag[idx] = best <= alpha0 ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
        if (ply === 0) rootBest = bestm;
    }
    return best;
}

// === Iterative Deepening ===
function search(maxDepth, movetime) {
    tStart = performance.now(); timeLimitMs = movetime; stopFlag = 0; gNodes = 0;
    killers.fill(0); histTable.fill(0);
    let best = 0, finalScore = 0;
    for (let d = 1; d <= maxDepth; d++) {
        rootBest = 0;
        const score = negamax(d, -2 * MATE, 2 * MATE, 0);
        if (stopFlag) break;
        if (rootBest) best = rootBest;
        finalScore = score;
        postMessage({type: 'info', depth: d, score: score, nodes: gNodes});
        if (score > MATE_TH || score < -MATE_TH) break;
    }
    return { move: best, score: finalScore };
}

// === Position Setup ===
function setStartpos() {
    board.fill(0);
    const back = [WR, WN, WB, WQ, WK, WB, WN, WR];
    for (let f = 0; f < 8; f++) {
        board[f] = back[f]; board[16 + f] = WP;
        board[96 + f] = BP; board[112 + f] = back[f] | 8;
    }
    stm = 0; castle = 15; ep = -1; halfmove = 0;
    kingSq[0] = 4; kingSq[1] = 116; hply = 0;
    hash = fullHash();
}

function parseFen(p) {
    board.fill(0);
    let sq = 112, i = 0;
    for (; i < p.length && p[i] !== ' '; i++) {
        if (p[i] === '/') { sq -= 24; }
        else if (p[i] >= '1' && p[i] <= '8') { sq += (p.charCodeAt(i) - 48); }
        else {
            const map = {P:WP,N:WN,B:WB,R:WR,Q:WQ,K:WK,p:BP,n:BN,b:BB,r:BR,q:BQ,k:BK};
            const pc = map[p[i]] || 0;
            board[sq] = pc;
            if (pc === WK) kingSq[0] = sq;
            if (pc === BK) kingSq[1] = sq;
            sq++;
        }
    }
    while (i < p.length && p[i] === ' ') i++;
    stm = (p[i] === 'b') ? 1 : 0; if (i < p.length) i++;
    while (i < p.length && p[i] === ' ') i++;
    castle = 0;
    for (; i < p.length && p[i] !== ' '; i++) {
        if (p[i] === 'K') castle |= 1;
        else if (p[i] === 'Q') castle |= 2;
        else if (p[i] === 'k') castle |= 4;
        else if (p[i] === 'q') castle |= 8;
    }
    while (i < p.length && p[i] === ' ') i++;
    ep = -1;
    if (i < p.length && p[i] !== '-') {
        const f = p.charCodeAt(i) - 97, r = p.charCodeAt(i + 1) - 49;
        ep = r * 16 + f;
    }
    halfmove = 0; hply = 0; hash = fullHash();
}

function parseSq(s) { return (s.charCodeAt(1) - 49) * 16 + (s.charCodeAt(0) - 97); }

function fmtMove(m) {
    const from = MFROM(m), to = MTO(m), pr = MPROMO(m);
    let s = String.fromCharCode(97 + FILE0(from)) + String.fromCharCode(49 + RANK0(from)) +
            String.fromCharCode(97 + FILE0(to)) + String.fromCharCode(49 + RANK0(to));
    if (pr) s += '  nbrq'[pr];
    return s;
}

function applyUciMove(s) {
    const mv = legalMoves();
    const from = parseSq(s), to = parseSq(s.substring(2));
    let promo = 0;
    if (s.length > 4) {
        const c = s[4];
        promo = c === 'n' ? 2 : c === 'b' ? 3 : c === 'r' ? 4 : 5;
    }
    for (let i = 0; i < mv.length; i++) {
        if (MFROM(mv[i]) === from && MTO(mv[i]) === to &&
            (promo === 0 || MPROMO(mv[i]) === promo)) {
            make(mv[i]); return;
        }
    }
}

// === Perft (for verification) ===
function perft(d) {
    if (d === 0) return 1;
    const ps = gen();
    let nodes = 0;
    for (let i = 0; i < ps.length; i++) {
        make(ps[i]);
        if (!inCheck(stm ^ 1)) nodes += perft(d - 1);
        unmake(ps[i]);
    }
    return nodes;
}

// === Opening Book ===
let book = null;

const EVAL_ORDER = {'+-': 6, '+/-': 5, '+=': 4, '=': 3, '=+': 2, '-/+': 1, '-+': 0};
const EVAL_SCORE = {'+-': 300, '+/-': 150, '+=': 50, '=': 0, '=+': -50, '-/+': -150, '-+': -300};

function bookKey(fen) {
    return fen.split(' ').slice(0, 4).join(' ');
}

function bookLookup(fen) {
    if (!book) return null;
    const entries = book[bookKey(fen)];
    if (!entries || entries.length === 0) return null;
    const best = Math.max(...entries.map(e => EVAL_ORDER[e.eval] || 3));
    const candidates = entries.filter(e => (EVAL_ORDER[e.eval] || 3) === best);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return {move: pick.move, score: EVAL_SCORE[pick.eval] || 0};
}

function loadBook() {
    try {
        importScripts('book.json.js');
        if (typeof CHEESE_BOOK !== 'undefined') book = CHEESE_BOOK;
    } catch(e) {}
}

// === Worker Message Handler ===
zobInit();
initTT();

onmessage = function(e) {
    const data = e.data;
    if (data.cmd === 'search') {
        const bookMove = bookLookup(data.fen);
        if (bookMove) {
            postMessage({type: 'info', depth: 0, score: bookMove.score, nodes: 0, book: true});
            postMessage({type: 'bestmove', move: bookMove.move, score: bookMove.score, book: true});
            return;
        }
        parseFen(data.fen);
        const result = search(data.depth, data.movetime || 30000);
        const move = result.move ? fmtMove(result.move) : '0000';
        postMessage({type: 'bestmove', move: move, score: result.score});
    } else if (data.cmd === 'perft') {
        setStartpos();
        const n = perft(data.depth);
        postMessage({type: 'perft', depth: data.depth, nodes: n});
    }
};

loadBook();
postMessage({type: 'ready'});
