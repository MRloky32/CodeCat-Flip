(() => {
'use strict';

// =============================================================================
//  TUNING: change these to change how the game feels. Flip has no free-fall
//  physics: everything moves one square per beat, so the "physics" are the
//  tempo, the timing windows and how fast each move is animated.
// =============================================================================
const BPM            = 110;    // tempo of the level; every move happens on a beat
const PERFECT_WINDOW = 0.060;  // seconds before/after the beat that count as PERFECT
const GOOD_WINDOW    = 0.135;  // seconds before/after the beat that still count as a hit
const SYNC_MAX       = 5;      // misses in a row before the level restarts
const COUNTIN_BEATS  = 4;      // beats of count-in before you can move
const RESPAWN_BEATS  = 1;      // beats until the level restarts after dying (1 beat = 0.55 s)
const GRACE_BEATS    = 2;      // free beats after a restart to find the rhythm again
const MOVE_TIME      = 0.10;   // seconds a sideways step takes on screen
const FALL_TIME_BASE = 0.05;   // seconds to start falling after walking off a ledge
const FLIP_TIME_BASE = 0.06;   // seconds to start a gravity flip
const FALL_PER_ROW   = 0.035;  // extra seconds per row fallen (bigger = floatier gravity)
const ENEMY_STEP     = 0.14;   // seconds an enemy arrow takes to slide one square
const CAMERA_LEAD    = 0.42;   // where CodeCat sits on screen (0 = left edge, 1 = right); lower shows more ahead
const CAMERA_SMOOTH  = 5;      // how quickly the camera catches up (higher = snappier)
// =============================================================================

const W = 960, H = 540, TS = 64, PF_Y = 84, PF_H = TS * 6;
const T = 60 / BPM;
const PERF = PERFECT_WINDOW, GOOD = GOOD_WINDOW;
const COUNTIN = COUNTIN_BEATS;
const INK = '#141634';
const FONT = '"Tiny5", ui-monospace, Menlo, Consolas, monospace';
const FONT_D = FONT;
const FONT_T = '"Pixelify Sans", ui-monospace, Menlo, Consolas, monospace'; // only the big "Flip" title
const C = {
  bg0: '#1d1745', bg1: '#0e0b22',
  mortar: '#7a63bf', bricks: ['#b6a0e8', '#a68fdd', '#c3b1f1', '#9c84d7', '#ae98e4'],
  surf: '#ebe3ff', wallA: '#4a5fcb', wallB: '#6d4cc2', wallHi: '#8ea0ff',
  spike: '#ff5f7e', spikeHi: '#ffb3c1',
  enemy: '#ff4fb0', enemyHi: '#ffa0da', enemyDk: '#c42b86',
  coin: '#ffd54a', coinHi: '#fff3b8', mint: '#5ff0b8', cyan: '#7fe7ff',
  lav: '#d6cdf6', btn: '#ece6ff', btnGlow: '236,230,255', dim: '#8d84bf', panel: '#1f1948', panel2: '#2a2462', coral: '#ff5f7e'
};

// ---------------------------------------------------------------- level (parsed from level.js)
// x: column, r: row from the bottom (0 floor tiles, 1..4 open space, 5 ceiling tiles)
const MAP = window.LEVEL_MAP;
if (!MAP || MAP.length !== 6 || MAP.some(row => row.length !== MAP[0].length)) throw new Error('level.js: LEVEL_MAP needs 6 rows of equal length');
const COLS = MAP[0].length;
const WALLS = [], SPIKES = [], COINS = [], ENEMY_START = [];
let STAR = null, START = [0, 1], GOAL = COLS - 1;
MAP.forEach((row, i) => {
  const r = 5 - i;
  [...row].forEach((ch, x) => {
    if (ch === 'B') WALLS.push([x, r]);
    else if (ch === '^' || ch === 'v') SPIKES.push([x, r]);
    else if (ch === 'o') COINS.push([x, r]);
    else if (ch === '*') STAR = [x, r];
    else if (ch === '<' || ch === '>') ENEMY_START.push([x, r, ch === '<' ? -1 : 1]);
    else if (ch === 'S') START = [x, r];
    else if (ch === 'F') GOAL = x;
  });
});
const SECTION_W = Math.ceil(COLS / 3);
const K = (x, r) => x + ',' + r;
const wallSet = new Set(WALLS.map(([x, r]) => K(x, r)));
const spikeSet = new Set(SPIKES.map(([x, r]) => K(x, r)));
const solid = (x, r) => r <= 0 || r >= 5 || x < 0 || x >= COLS || wallSet.has(K(x, r));
const eBlocked = (x, r) => x < 0 || x >= GOAL || wallSet.has(K(x, r)) || spikeSet.has(K(x, r));

function eStep(e) {
  let d = e.d, nx = e.x + d;
  if (eBlocked(nx, e.r)) { d = -d; nx = e.x + d; if (eBlocked(nx, e.r)) nx = e.x; }
  return { x: nx, r: e.r, d };
}
function fallFrom(x, r, g) {
  while (!solid(x, r + g)) { r += g; if (spikeSet.has(K(x, r))) return { r, dead: true }; }
  return { r, dead: false };
}
function doAction(p, a) {
  const { x, r, g } = p;
  if (a === 'left' || a === 'right') {
    const dx = a === 'right' ? 1 : -1, nx = x + dx;
    if (solid(nx, r)) return { x, r, g, kind: 'bump', dx };
    if (spikeSet.has(K(nx, r))) return { x: nx, r, g, kind: 'move', dx, dead: true };
    const f = fallFrom(nx, r, g);
    return { x: nx, r: f.r, g, kind: 'move', dx, dead: f.dead };
  }
  if (a === 'flip') { const f = fallFrom(x, r, -g); return { x, r: f.r, g: -g, kind: 'flip', dead: f.dead }; }
  return { x, r, g, kind: 'wait' };
}
const PATROLS = ENEMY_START.map(([x, r, d]) => {
  let e = { x, r, d }, mn = x, mx = x;
  for (let i = 0; i < 200; i++) { e = eStep(e); mn = Math.min(mn, e.x); mx = Math.max(mx, e.x); }
  return { r, mn, mx };
});
const rowTop = r => (5 - r) * TS;
const feetY = (r, g) => g < 0 ? rowTop(r) + TS : rowTop(r);

// ---------------------------------------------------------------- utils
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { } }
function load(key, def) { try { const v = localStorage.getItem(key); return v ? Object.assign({}, def, JSON.parse(v)) : def; } catch (e) { return def; } }
const settings = load('flip.settings', { volume: 0.8, offset: 0, shake: !reduceMotion });
let best = load('flip.best', { grade: null });

// ---------------------------------------------------------------- canvas
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let DPS = 1, LD = 1;
let layers = [];
function resize() {
  const wrap = canvas.parentElement, cs = getComputedStyle(wrap);
  const aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const cw = Math.max(240, Math.min(aw, ah * 16 / 9)), ch = cw * 9 / 16;
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  const dpr = window.devicePixelRatio || 1;
  DPS = Math.min(3, (cw / W) * dpr);
  canvas.width = Math.round(W * DPS); canvas.height = Math.round(H * DPS);
  const nl = Math.min(2, Math.max(1, Math.ceil(DPS * 2) / 2));
  if (nl !== LD || !layers.length) { LD = nl; buildLayers(); }
}
let resizeTimer = 0;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 60); });

// ---------------------------------------------------------------- drawing helpers
function rough(g, pts, R, j = 1.5, seg = 16, closed = true) {
  g.beginPath();
  const n = pts.length, m = closed ? n : n - 1;
  let first = true;
  for (let i = 0; i < m; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    const k = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / seg));
    for (let s = 0; s < k; s++) {
      const t = s / k, x = x0 + (x1 - x0) * t + (R() - .5) * 2 * j, y = y0 + (y1 - y0) * t + (R() - .5) * 2 * j;
      if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
    }
  }
  if (closed) g.closePath();
  else { const [x, y] = pts[n - 1]; g.lineTo(x + (R() - .5) * 2 * j, y + (R() - .5) * 2 * j); }
}
function roughRect(g, x, y, w, h, R, j = 1.5, seg = 16) { rough(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], R, j, seg); }
function roughCircle(g, cx, cy, r, R, j = 1.2, n = 14) {
  const pts = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  rough(g, pts, R, j, 99);
}
function ink(g, w = 4, col = INK) { g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
function text(g, s, x, y, size, col, align = 'left', weight = 600, shadow = true) {
  g.font = `400 ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
  if (shadow) { g.fillStyle = INK; g.fillText(s, x, y + Math.max(2, size * .08)); }
  g.fillStyle = col; g.fillText(s, x, y);
}
function outlinedText(g, s, x, y, size, col, align = 'center', weight = 700, font = FONT_D) {
  g.font = `${font === FONT_D ? 400 : weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = Math.max(4, size * .16); g.strokeStyle = INK; g.strokeText(s, x, y);
  g.fillStyle = col; g.fillText(s, x, y);
}
function starPts(cx, cy, r, rot) { const p = []; for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .47 : r; p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return p; }

// ---------------------------------------------------------------- static level layers (3 boil variants)
function buildLayers() {
  layers = [];
  for (let v = 0; v < 3; v++) {
    const c = document.createElement('canvas');
    c.width = COLS * TS * LD; c.height = PF_H * LD;
    const g = c.getContext('2d'); g.scale(LD, LD);
    drawStatic(g, mulberry(1000 + v * 7919), v);
    layers.push(c);
  }
}
function drawStatic(g, R, v) {
  const LW = COLS * TS;
  const brickR = mulberry(42); // same brick layout for all variants, only lines boil
  for (const band of [0, 5]) {
    const y0 = rowTop(band);
    g.fillStyle = C.mortar; g.fillRect(0, y0, LW, TS);
    for (let row = 0; row < 2; row++) {
      let bx = -(row * 23 + brickR() * 18);
      while (bx < LW) {
        const bw = 38 + brickR() * 34, col = C.bricks[Math.floor(brickR() * C.bricks.length)];
        roughRect(g, bx + 2, y0 + row * 32 + 2, bw - 4, 28, R, 1.2, 12);
        g.fillStyle = col; g.fill();
        if (brickR() < .35) { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(bx + 8, y0 + row * 32 + 7, Math.min(14, bw * .3), 3); }
        bx += bw;
      }
    }
    const sh = g.createLinearGradient(0, y0, 0, y0 + TS);
    if (band === 0) { sh.addColorStop(0, 'rgba(20,22,52,0)'); sh.addColorStop(1, 'rgba(20,22,52,.45)'); }
    else { sh.addColorStop(0, 'rgba(20,22,52,.45)'); sh.addColorStop(1, 'rgba(20,22,52,0)'); }
    g.fillStyle = sh; g.fillRect(0, y0, LW, TS);
  }
  // walkable surfaces
  rough(g, [[-4, 320], [LW + 4, 320]], R, 1.3, 20, false); ink(g, 5);
  rough(g, [[-4, 325], [LW + 4, 325]], R, .8, 24, false); ink(g, 2, C.surf);
  rough(g, [[-4, 64], [LW + 4, 64]], R, 1.3, 20, false); ink(g, 5);
  rough(g, [[-4, 59], [LW + 4, 59]], R, .8, 24, false); ink(g, 2, C.surf);

  // patrol tracks (enemy paths are readable before you meet them)
  PATROLS.forEach(p => {
    const yy = p.r === 1 ? 312 : 72;
    for (let x = p.mn * TS + 12; x <= p.mx * TS + 52; x += 11) {
      g.beginPath(); g.arc(x + (R() - .5), yy + (R() - .5), 2.6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,79,176,.6)'; g.fill();
    }
    for (const ex of [p.mn * TS + 6, p.mx * TS + 58]) {
      const a = p.r === 1 ? [[ex, 320], [ex, 300]] : [[ex, 64], [ex, 84]];
      rough(g, a, R, 1, 30, false); ink(g, 3.5, C.enemy);
    }
  });

  // walls (two-tone like CodeCat's body)
  const runs = {};
  WALLS.forEach(([x, r]) => { (runs[x] = runs[x] || []).push(r); });
  for (const xs in runs) {
    const x = +xs, rs = runs[x].sort((a, b) => a - b), rA = rs[0], rB = rs[rs.length - 1];
    let top = rowTop(rB), bot = rowTop(rA) + TS;
    if (rA === 1) bot += 7; if (rB === 4) top -= 7;
    const x0 = x * TS + 4, w = TS - 8;
    g.save();
    roughRect(g, x0, top, w, bot - top, R, 1.6, 14); g.clip();
    g.fillStyle = C.wallA; g.fillRect(x0 - 4, top - 4, w / 2 + 4, bot - top + 8);
    g.fillStyle = C.wallB; g.fillRect(x0 + w / 2, top - 4, w / 2 + 4, bot - top + 8);
    g.fillStyle = 'rgba(142,160,255,.45)'; g.fillRect(x0 + 6, top, 5, bot - top);
    g.restore();
    for (let rr = rA; rr < rB; rr++) { const yy = rowTop(rr); rough(g, [[x0 + 4, yy], [x0 + w - 4, yy]], R, 1.2, 14, false); ink(g, 2.5, 'rgba(20,22,52,.55)'); }
    for (let rr = rA; rr <= rB; rr++) {
      const yy = rowTop(rr);
      for (const [dx, dy] of [[10, 10], [w - 10, 10], [10, TS - 10], [w - 10, TS - 10]]) { g.beginPath(); g.arc(x0 + dx, yy + dy, 2.4, 0, 7); g.fillStyle = 'rgba(255,255,255,.75)'; g.fill(); }
    }
    roughRect(g, x0, top, w, bot - top, R, 1.6, 14); ink(g, 4.5);
  }

  // spikes
  SPIKES.forEach(([x, r]) => {
    const by = r === 1 ? 320 : 64, d = r === 1 ? -1 : 1, x0 = x * TS + 5, x1 = x * TS + 59, cx = x * TS + 32;
    rough(g, [[x0, by], [cx, by + d * 48], [x1, by]], R, 1.4, 12); g.fillStyle = C.spike; g.fill();
    rough(g, [[x0 + 11, by + d * 5], [cx - 2, by + d * 36]], R, .8, 30, false); ink(g, 3, C.spikeHi);
    rough(g, [[x0, by], [cx, by + d * 48], [x1, by]], R, 1.4, 12); ink(g, 4);
  });
}

// ---------------------------------------------------------------- background
const SKY = (() => { const R = mulberry(7); const a = []; for (let i = 0; i < 80; i++) a.push({ x: R() * 1600, y: R() * H, s: 3 + R() * 6, k: R() < .65 ? 'x' : 'd', p: .06 + R() * .22, tw: R(), rot: R() * 3 }); return a; })();
// each screen of the level has its own sky: calm violet, tense magenta, cool blue finale
const SKY_HUES = [[266, 228, 300], [322, 290, 342], [200, 232, 262]];
function drawSky(g, camX, pulse, now, bar, sec = 0, secPrev = 0, blend = 1) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, C.bg0); gr.addColorStop(1, C.bg1);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    const j = (i + bar) % 3, h = lerp(SKY_HUES[secPrev][j], SKY_HUES[sec][j], blend), bx = W * (.2 + i * .32) + Math.sin(now * .21 + i * 2) * 60 - (camX * .05) % 200, by = H * (.35 + .25 * Math.sin(now * .17 + i));
    const rad = g.createRadialGradient(bx, by, 0, bx, by, 360 + pulse * 30);
    rad.addColorStop(0, `hsla(${h},75%,58%,${.16 + pulse * .05})`); rad.addColorStop(1, `hsla(${h},75%,58%,0)`);
    g.fillStyle = rad; g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = 'rgba(205,198,236,.55)'; g.fillStyle = 'rgba(205,198,236,.55)'; g.lineCap = 'round';
  for (const s of SKY) {
    const sx = ((s.x - camX * s.p) % 1600 + 1600) % 1600 - 320;
    if (sx < -20 || sx > W + 20) continue;
    const z = s.s * (1 + (s.tw > .7 ? pulse * .6 : 0));
    if (s.k === 'x') {
      g.lineWidth = 2.4; g.beginPath();
      const c = Math.cos(s.rot) * z, sn = Math.sin(s.rot) * z;
      g.moveTo(sx - c, s.y - sn); g.lineTo(sx + c, s.y + sn); g.moveTo(sx + sn, s.y - c); g.lineTo(sx - sn, s.y + c); g.stroke();
    } else { g.beginPath(); g.arc(sx, s.y, z * .35, 0, 7); g.fill(); }
  }
}
let scanPattern = null;
function scanlines(g) {
  if (!scanPattern) { const c = document.createElement('canvas'); c.width = 2; c.height = 4; const cg = c.getContext('2d'); cg.fillStyle = 'rgba(0,0,0,.22)'; cg.fillRect(0, 0, 2, 1); scanPattern = g.createPattern(c, 'repeat'); }
  g.fillStyle = scanPattern; g.globalAlpha = .55; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
}

// ---------------------------------------------------------------- images
const catImg = new Image(); catImg.src = 'assets/codecat.png';
const coverImg = new Image(); coverImg.src = 'assets/cover.jpg';
let coverCanvas = null;
function coverFeathered() {
  if (coverCanvas) return coverCanvas;
  if (!coverImg.complete || !coverImg.naturalWidth) return null;
  const S = 720, F = 96, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); g.drawImage(coverImg, 0, 0, S, S);
  g.globalCompositeOperation = 'destination-out';
  const edges = [[0, 0, F, 0, 0, 0, F, S], [S, 0, S - F, 0, S - F, 0, F, S], [0, 0, 0, F, 0, 0, S, F], [0, S, 0, S - F, 0, S - F, S, F]];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(rx, ry, rw, rh);
  }
  return (coverCanvas = c);
}
const CAT_SC = 80 / 300, CAT_AX = 98, SCREEN = { cx: 0, cy: -175, w: 150, h: 115 };

// ---------------------------------------------------------------- audio
let ac = null, master = null, musicBus = null, lpf = null, sfxBus = null, noiseBuf = null, outLat = 0;
function ensureAudio() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC({ latencyHint: 'interactive' });
    // music -> low-pass (muffles when you lose sync) -> comp -> volume ; sfx stay clear
    master = ac.createGain(); master.gain.value = settings.volume; master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -15; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .2;
    comp.connect(master);
    musicBus = ac.createGain();
    lpf = ac.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 20000; lpf.Q.value = .7;
    musicBus.connect(lpf); lpf.connect(comp);
    sfxBus = ac.createGain(); sfxBus.gain.value = 1; sfxBus.connect(comp);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
const SYNC_LP = [220, 900, 1900, 4200, 11000, 20000];
function syncFilter(instant = false) {
  if (!lpf) return;
  const f = SYNC_LP[clamp(G && mode !== 'title' ? G.bar : 5, 0, 5)], t = ac.currentTime, p = lpf.frequency;
  p.cancelScheduledValues(t);
  if (instant) p.setValueAtTime(f, t); else { p.setValueAtTime(p.value, t); p.setTargetAtTime(f, t, .12); }
}
function measureLatency() { outLat = Math.min(.25, (ac.outputLatency || 0) + (ac.baseLatency || 0)); }
const gnow = () => ac ? ac.currentTime - outLat : performance.now() / 1000;
const eventAudio = ts => ac.currentTime - Math.max(0, performance.now() - ts) / 1000;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function envAD(gn, t, a, peak, d) { const g = gn.gain; g.setValueAtTime(.0001, t); g.linearRampToValueAtTime(peak, t + a); g.exponentialRampToValueAtTime(.0001, t + a + d); }
function envASR(gn, t, a, peak, dur, rel) { const g = gn.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(peak, t + a); g.setValueAtTime(peak, t + Math.max(a, dur)); g.linearRampToValueAtTime(0, t + Math.max(a, dur) + rel); }
function tone(type, f, t, d, dest, gain = .2, a = .004, f2 = null, detune = 0) {
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  const g = ac.createGain(); envAD(g, t, a, gain, d); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + .05);
}
function noise(t, d, dest, gain = .3, type = 'highpass', f = 7000, q = .7, f2 = null) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d);
  const g = ac.createGain(); envAD(g, t, .002, gain, d);
  s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * .5); s.stop(t + d + .05);
}
// instruments
const kick = (t, D) => { tone('sine', 150, t, .26, D, .85, .002, 42); tone('square', 900, t, .012, D, .05); };
const snare = (t, D) => { noise(t, .16, D, .3, 'bandpass', 1900, .7); tone('triangle', 190, t, .07, D, .18); };
const hat = (t, D, v, open) => noise(t, open ? .18 : .035, D, v, 'highpass', 8000);
const click = (t, hi) => tone('square', hi ? 1760 : 1320, t, .045, sfxBus, .1);
function bass(t, m, dur, D) {
  const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
  const s = ac.createOscillator(); s.type = 'sine'; s.frequency.value = mtof(m - 12);
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(260, t + dur);
  const g = ac.createGain(); envAD(g, t, .004, .26, dur);
  const g2 = ac.createGain(); envAD(g2, t, .004, .22, dur);
  o.connect(f); f.connect(g); g.connect(D); s.connect(g2); g2.connect(D);
  o.start(t); s.start(t); o.stop(t + dur + .06); s.stop(t + dur + .06);
}
function pad(t, ms, dur, D) {
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.connect(D);
  ms.forEach(m => [-8, 8].forEach(dt => {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = dt;
    const g = ac.createGain(); envASR(g, t, .3, .03, dur - .3, .35); o.connect(g); g.connect(f); o.start(t); o.stop(t + dur + .5);
  }));
}
const pluck = (t, m, D) => tone('square', mtof(m), t, .1, D, .05);
function lead(t, m, dur, D) {
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200; f.connect(D);
  const lfo = ac.createOscillator(); lfo.frequency.value = 5.6; const lg = ac.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(5, t + .25); lfo.connect(lg);
  [['triangle', .15, 0], ['square', .03, 7]].forEach(([type, gv, dt]) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = mtof(m); o.detune.value = dt; lg.connect(o.frequency);
    const g = ac.createGain(); envASR(g, t, .012, gv, dur * .9, .09); o.connect(g); g.connect(f); o.start(t); o.stop(t + dur + .2);
  });
  lfo.start(t); lfo.stop(t + dur + .2);
}
// sfx
const sfx = {
  move: t => { const v = 1 + (Math.random() - .5) * .08; noise(t, .028, sfxBus, .11, 'bandpass', 2500 * v, 1.6); tone('sine', 230 * v, t, .045, sfxBus, .1, .001, 140); },
  flip: (t, up) => { const v = 1 + (Math.random() - .5) * .06; noise(t, .012, sfxBus, .06, 'highpass', 6500); noise(t, .13, sfxBus, .07, 'bandpass', (up ? 700 : 3000) * v, 1.1, (up ? 3000 : 700) * v); tone('sine', 110 * v, t + .09, .07, sfxBus, .09, .002, 70); },
  wait: t => noise(t, .016, sfxBus, .045, 'highpass', 7500),
  bump: t => { tone('sine', 120, t, .08, sfxBus, .13, .002, 70); noise(t, .05, sfxBus, .06, 'lowpass', 600); },
  miss: t => { tone('sawtooth', 104, t, .2, sfxBus, .09); tone('sawtooth', 111, t, .2, sfxBus, .09); noise(t, .12, sfxBus, .14, 'bandpass', 500, 1); },
  coin: t => { tone('square', 988, t, .05, sfxBus, .07); tone('square', 1319, t + .055, .12, sfxBus, .07); },
  star: t => [72, 76, 79, 84, 88].forEach((m, i) => tone('triangle', mtof(m), t + i * .055, .25, sfxBus, .12)),
  death: t => { tone('sawtooth', 560, t, .5, sfxBus, .14, .002, 50); noise(t, .35, sfxBus, .25, 'lowpass', 1800, .8, 200); },
  win: t => { [69, 73, 76, 81, 85, 88].forEach((m, i) => tone('triangle', mtof(m), t + i * .07, .6, sfxBus, .1)); tone('square', mtof(57), t + .42, .9, sfxBus, .05); },
  out: t => { tone('sawtooth', 440, t, .45, sfxBus, .14, .002, 60); noise(t, .3, sfxBus, .14, 'lowpass', 2000, .7, 120); },
  ui: t => tone('square', 880, t, .035, sfxBus, .045),
  section: t => [76, 83].forEach((m, i) => tone('triangle', mtof(m), t + i * .08, .2, sfxBus, .09))
};

// music: A minor, i-VI-iv-V, four-on-the-floor so the beat is easy to feel
const PROG = [{ root: 45, q: 'm' }, { root: 41, q: 'M' }, { root: 38, q: 'm' }, { root: 40, q: 'M' }];
const triad = q => q === 'm' ? [0, 3, 7] : [0, 4, 7];
const BASS = [0, null, 12, 0, null, 0, 7, 12];
const ARP = [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 0, 2, 3, 2];
const LEAD = [[0, 0, 76, 2], [0, 2, 81, 2], [0, 4, 79, 1], [0, 5, 76, 1], [0, 6, 74, 2], [1, 0, 72, 3], [1, 3, 74, 1], [1, 4, 76, 2], [1, 6, 72, 2], [2, 0, 74, 2], [2, 2, 77, 2], [2, 4, 76, 2], [2, 6, 74, 2], [3, 0, 71, 4], [3, 4, 68, 2], [3, 6, 71, 2], [4, 0, 81, 2], [4, 2, 84, 2], [4, 4, 83, 1], [4, 5, 81, 1], [4, 6, 79, 2], [5, 0, 77, 3], [5, 3, 79, 1], [5, 4, 81, 2], [5, 6, 77, 2], [6, 0, 74, 2], [6, 2, 77, 2], [6, 4, 81, 2], [6, 6, 77, 2], [7, 0, 76, 6], [7, 6, 80, 2]];
function chordAt(b) { return PROG[(Math.max(0, b - COUNTIN) >> 2) % 4]; }
const crash = (t, D, v = .12) => { noise(t, 1.6, D, v, 'highpass', 5000, .5); noise(t, .9, D, v * .6, 'bandpass', 9000, 1.2); };
class Music {
  constructor() {
    this.out = ac.createGain(); this.out.connect(musicBus);
    this.L = {};
    for (const n of ['drums', 'bass', 'pad', 'arp', 'lead']) { const g = ac.createGain(); g.gain.value = 0; this.L[n] = g; }
    this.padDuck = ac.createGain(); this.L.pad.connect(this.padDuck); this.padDuck.connect(this.out);
    for (const n of ['drums', 'bass', 'arp', 'lead']) this.L[n].connect(this.out);
    const dl = ac.createDelay(1); dl.delayTime.value = T * .75;
    const fb = ac.createGain(); fb.gain.value = .3;
    const df = ac.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 2200;
    this.arpIn = ac.createGain(); this.arpIn.connect(this.L.arp); this.arpIn.connect(dl); dl.connect(df); df.connect(fb); fb.connect(dl); df.connect(this.L.arp);
    this.levels = { drums: .9, bass: .8, pad: .8, arp: .8, lead: .8 };
    this.running = false; this.section = -9; this.pendingCrash = false; this.menu = false;
  }
  start(t0) { this.t0 = t0; this.step = 0; this.running = true; this.setSection(0, true); }
  startMenu() { this.menu = true; this.t0 = ac.currentTime + .12 - COUNTIN * T; this.step = COUNTIN * 4; this.running = true; this.setSection(-1, true); }
  stepTime(s) { return this.t0 + s * T / 4; }
  setSection(n, instant = false) {
    if (n === this.section) return;
    if (!instant && n > this.section) this.pendingCrash = true;
    this.section = n;
    const on = n < 0 ? { drums: .32, bass: .55, pad: 1, arp: .75, lead: 0 } : { drums: 1, bass: 1, pad: 1, arp: n >= 1 ? 1 : 0, lead: n >= 2 ? 1 : 0 };
    const t = ac.currentTime;
    for (const k in on) { const g = this.L[k].gain, v = on[k] * this.levels[k]; g.cancelScheduledValues(t); if (instant) g.setValueAtTime(v, t); else { g.setValueAtTime(g.value, t); g.setTargetAtTime(v, t, .5); } }
  }
  pump() { if (!this.running) return; const ahead = ac.currentTime + .15; while (this.stepTime(this.step) < ahead) { this.sched(this.step, this.stepTime(this.step)); this.step++; } }
  sched(s, t) {
    if (t < ac.currentTime - .02) return;
    const b = s >> 2, sub = s & 3;
    if (b < COUNTIN) { if (sub === 0) click(t, b === 0); if (sub === 2) hat(t, this.L.drums, .05, false); return; }
    const mb = b - COUNTIN, bar = mb >> 2, bib = mb & 3, ch = PROG[bar % 4], tn = triad(ch.q), D = this.L.drums;
    const fill = !this.menu && bar % 8 === 7 && bib === 3;
    if (sub === 0) {
      if (!(this.menu && bib % 2)) kick(t, D);
      if ((bib === 1 || bib === 3) && !fill) snare(t, D);
      const pd = this.padDuck.gain; pd.cancelScheduledValues(t); pd.setValueAtTime(.4, t); pd.linearRampToValueAtTime(1, t + T * .7);
      if (bib === 0 && this.pendingCrash) { crash(t, D); this.pendingCrash = false; }
      if (bib === 0 && bar % 8 === 0 && bar > 0 && !this.menu) crash(t, D, .07);
    }
    if (fill) { const v = .12 + sub * .06; noise(t, .1, D, v, 'bandpass', 1700 + sub * 300, .7); tone('triangle', 200 + sub * 30, t, .06, D, .12); }
    if (sub === 2) hat(t, D, bib === 3 ? .14 : .09, bib === 3);
    if (sub % 2 === 1) hat(t, D, .03, false);
    if (sub % 2 === 0) { const o = BASS[bib * 2 + (sub >> 1)]; if (o !== null) bass(t, ch.root + o, T * .45, this.L.bass); }
    if (bib === 0 && sub === 0) pad(t, tn.map(x => ch.root + 12 + x), T * 4, this.L.pad);
    const ai = ARP[bib * 4 + sub]; pluck(t, ai === 3 ? ch.root + 36 : ch.root + 24 + tn[ai], this.arpIn);
    if (sub % 2 === 0) { const lb = bar % 8, sl = bib * 2 + (sub >> 1); for (const n of LEAD) if (n[0] === lb && n[1] === sl) lead(t, n[2], n[3] * T / 2, this.L.lead); }
  }
  beatPhase(now) { return ((now - this.t0) / T) % 1; }
  stop(fade = .4) {
    this.running = false; const g = this.out.gain, n = ac.currentTime;
    g.cancelScheduledValues(n); g.setValueAtTime(g.value, n); g.linearRampToValueAtTime(0, n + fade);
    const out = this.out; setTimeout(() => { try { out.disconnect(); } catch (e) { } }, (fade + .6) * 1000);
  }
}
let music = null;
setInterval(() => { if (music && ac && ac.state === 'running') music.pump(); if (calib && ac) calibPump(); }, 25);

// ---------------------------------------------------------------- game state
let mode = 'title'; // title | playing | paused | out | results | calib
let G = null;
let camX = 0, shake = 0, glitch = 0, lastTs = 0, touchMode = false;
let ui = [], touchUI = [], pauseSel = 0, overlayT = 0, crtT = -9;
function crt() { crtT = performance.now(); }
// CRT power-on: a bright line opens into the picture
function drawCRTOn(g) {
  const k = (performance.now() - crtT) / 380;
  if (k < 0 || k >= 1) return;
  const e = easeOut(k), h = Math.max(2, H * e);
  g.fillStyle = '#05040f';
  g.fillRect(0, 0, W, (H - h) / 2); g.fillRect(0, (H + h) / 2, W, (H - h) / 2 + 1);
  g.globalAlpha = 1 - k;
  g.fillStyle = '#e8e2ff'; g.fillRect(0, (H - h) / 2 - 2, W, 3); g.fillRect(0, (H + h) / 2 - 1, W, 3);
  if (k < .25) { g.globalAlpha = 1 - k * 4; g.fillStyle = '#fff'; g.fillRect(0, H / 2 - 2, W, 4); }
  g.globalAlpha = 1;
}
const titleClock0 = performance.now() / 1000;

const freshEnemies = () => ENEMY_START.map(([x, r, d]) => ({ x, r, d, px: x, pr: r, t0: -9, turn: false }));
function newGame() {
  return {
    songStart: 0, lastTick: -1, nextTO: 0, lastBeatT: 0,
    resolved: new Set(), pending: new Map(), free: new Set(), pips: new Map(),
    player: { x: START[0], r: START[1], g: -1, facing: 1, dead: false, anim: null, spawnT: -9, deadT: -9 },
    enemies: freshEnemies(),
    bar: SYNC_MAX, section: 0, boil: 0, won: false, winT: 0, respawnBeat: -1, runStart: COUNTIN,
    coins: new Set(), star: false, deaths: 0, perfect: 0, good: 0, miss: 0, endBeat: 0,
    face: 'idle', faceT: -9, judge: null, marks: [], parts: [], cpT: -9, flash: 0,
    deltaSum: 0, deltaN: 0, barAnim: null, flipFlash: null, dust: [], killer: null,
    secPrev: 0, newBest: false, stamped: false, ripple: -9
  };
}
const beatTime = b => G.songStart + b * T;
const isFree = b => b < COUNTIN || G.free.has(b) || G.won;
// count-in without text: a row of dots that fill on each beat, then a burst on the first playable beat
function setPips(fromBeat, n) { for (let i = 0; i < n; i++) G.pips.set(fromBeat + i, { i, n }); G.pips.set(fromBeat + n, { go: true }); }

function startGame() {
  ensureAudio();
  const go = () => {
    measureLatency();
    if (music) music.stop(.15);
    lpf.frequency.cancelScheduledValues(ac.currentTime); lpf.frequency.setValueAtTime(20000, ac.currentTime);
    G = newGame();
    G.songStart = ac.currentTime + .3;
    setPips(0, COUNTIN);
    music = new Music(); music.start(G.songStart);
    camX = 0; mode = 'playing'; overlayT = 0; syncFilter(true); crt();
  };
  if (ac.state !== 'running') ac.resume().then(go); else go();
}

function advance(t) {
  if (!G) return;
  while (beatTime(G.lastTick + 1) <= t) tick(G.lastTick + 1);
  while (G.nextTO <= G.lastTick && beatTime(G.nextTO) + GOOD < t) {
    const b = G.nextTO++;
    if (!isFree(b) && !G.resolved.has(b)) resolve(b, null, 0, false);
    if (mode !== 'playing' && mode !== 'results') return;
  }
}
function tick(b) {
  G.lastTick = b; G.lastBeatT = beatTime(b); G.boil = (G.boil + 1) % 3;
  if (b === G.respawnBeat) restartRun(b);
  const free = isFree(b);
  for (const e of G.enemies) {
    e.px = e.x; e.pr = e.r;
    if (!free) { const n = eStep(e); e.turn = n.d !== e.d; e.x = n.x; e.d = n.d; e.t0 = beatTime(b); }
  }
  const p = G.pending.get(b);
  if (p) { G.pending.delete(b); if (!free) resolve(b, p.a, p.delta, !!p.spoiled, !!p.judged); }
  G.ripple = beatTime(b);
}
function setFace(f, dur = .35) { G.face = f; G.faceT = gnow() + dur; }
// hit feedback without words: sparkle = perfect, ring = good (+ arrow if early/late), X = miss
function mark(kind, side = 0) {
  const P = G.player;
  G.marks = G.marks.filter(m => gnow() - m.t0 < .2);
  G.marks.push({ kind, side, x: P.x * TS + 32, y: P.g < 0 ? rowTop(P.r) - 22 : rowTop(P.r) + TS + 22, dir: P.g < 0 ? -1 : 1, t0: gnow() });
}
function registerMiss(kind = 'miss') {
  G.miss++; G.bar--; setFace('miss'); mark(kind);
  G.barAnim = { kind: 'loss', idx: G.bar, t: gnow() };
  G.judge = { j: 'miss', t: gnow() }; glitch = Math.max(glitch, .3); if (settings.shake) shake = Math.max(shake, 3);
  sfx.miss(ac.currentTime);
  if (G.bar <= 0) outOfSync(); else syncFilter();
}
function registerHit(delta) {
  const j = Math.abs(delta) <= PERF ? 'perfect' : 'good';
  G[j]++; G.deltaSum += delta; G.deltaN++;
  if (G.bar < SYNC_MAX) { G.barAnim = { kind: 'gain', idx: G.bar, t: gnow() }; G.bar++; syncFilter(); }
  G.judge = { j, t: gnow() };
  if (j === 'perfect') { mark('perfect'); setFace('happy'); G.flash = 1; }
  else mark('good', delta < 0 ? -1 : 1);
}
function resolve(b, a, delta, spoiled, judged = false) {
  G.resolved.add(b);
  const P = G.player;
  if (P.dead || G.won) return;
  let act = a;
  if (a == null) { if (!spoiled) registerMiss(); act = 'wait'; } else if (!judged) registerHit(delta);
  if (mode !== 'playing' || P.dead) return;
  const p0 = { x: P.x, r: P.r, g: P.g };
  const res = doAction(p0, act);
  const tA = Math.max(gnow(), beatTime(b));
  P.anim = { t0: tA, kind: res.kind, fx: p0.x, fr: p0.r, fg: p0.g, tx: res.x, tr: res.r, tg: res.g, dx: res.dx || 0 };
  P.x = res.x; P.r = res.r; P.g = res.g;
  if (res.dx && res.kind !== 'wait') P.facing = res.dx;
  const rows = Math.abs(res.r - p0.r);
  if (res.kind === 'flip' || (res.kind === 'move' && rows)) {
    const land = tA + (res.kind === 'flip' ? FLIP_TIME_BASE + rows * FALL_PER_ROW : MOVE_TIME + FALL_TIME_BASE + rows * FALL_PER_ROW);
    G.dust.push({ t: land, x: res.x * TS + 32, y: res.g < 0 ? 320 : 64, g: res.g });
    if (res.kind === 'flip') G.flipFlash = { t0: tA, x: res.x * TS + 32, y: res.g < 0 ? 320 : 64 };
  }
  if (res.dead) { G.killer = { x: res.x, r: res.r, t: gnow(), spike: true }; return die(b); }
  for (const e of G.enemies) {
    if ((P.x === e.x && P.r === e.r) || (P.x === e.px && P.r === e.pr && p0.x === e.x && p0.r === e.r)) { G.killer = { e, t: gnow() }; return die(b); }
  }
  const ck = K(P.x, P.r);
  COINS.forEach(([cx, cr], i) => { if (!G.coins.has(i) && K(cx, cr) === ck) { G.coins.add(i); sfx.coin(ac.currentTime + .02); burst(cx * TS + 32, rowTop(cr) + 32, C.coin, 12); } });
  if (STAR && !G.star && K(STAR[0], STAR[1]) === ck) { G.star = true; sfx.star(ac.currentTime + .02); burst(STAR[0] * TS + 32, rowTop(STAR[1]) + 32, C.coin, 26); }
  // music and sky change as you enter each section of the level
  const sec = Math.min(2, Math.floor(P.x / SECTION_W));
  if (sec > G.section) { G.secPrev = G.section; G.section = sec; G.cpT = gnow(); sfx.section(ac.currentTime + .05); music.setSection(sec); }
  if (P.x >= GOAL) win(b);
}
// any death restarts the whole level one beat later, without leaving the music
function die(b) {
  const P = G.player; P.dead = true; P.deadT = gnow(); G.deaths++;
  setFace('dead', 99); sfx.death(ac.currentTime);
  glitch = .9; if (settings.shake) shake = 12;
  const cy = feetY(P.r, P.g) + P.g * 34;
  burst(P.x * TS + 32, cy, C.wallA, 14); burst(P.x * TS + 32, cy, C.wallB, 14); burst(P.x * TS + 32, cy, '#fff', 8);
  for (let k = 1; k <= RESPAWN_BEATS + GRACE_BEATS; k++) { G.free.add(b + k); G.pending.delete(b + k); }
  G.respawnBeat = b + RESPAWN_BEATS;
}
function restartRun(b) {
  const P = G.player;
  Object.assign(P, { x: START[0], r: START[1], g: -1, facing: 1, dead: false, anim: null, spawnT: beatTime(b) });
  G.enemies = freshEnemies();
  G.coins = new Set(); G.star = false;
  G.bar = SYNC_MAX; G.barAnim = null; syncFilter();
  if (G.section !== 0) { G.secPrev = G.section; G.section = 0; G.cpT = gnow(); music.setSection(0); }
  G.face = 'idle'; G.faceT = 0;
  G.runStart = b + GRACE_BEATS;
  setPips(b, GRACE_BEATS);
}
function win(b) {
  G.won = true; G.endBeat = b; G.winT = gnow(); setFace('win', 99);
  sfx.win(ac.currentTime + .05); music.setSection(2);
  for (let i = 0; i < 4; i++) setTimeout(() => G && burst(GOAL * TS + 20, 100 + Math.random() * 200, [C.mint, C.coin, C.enemy, C.cyan][i], 18), i * 160);
  const r = results();
  const order = { S: 4, A: 3, B: 2, C: 1 };
  if (!best.grade || order[r.grade] > order[best.grade] || (r.grade === best.grade && r.secs < best.secs)) { G.newBest = !!best.grade; best = { grade: r.grade, secs: r.secs }; store('flip.best', best); }
  setTimeout(() => { if (G && G.won && mode === 'playing') { mode = 'results'; overlayT = performance.now(); } }, 1600);
}
// sync bar empty: the music "tape-stops" for a moment and the level restarts
function outOfSync() {
  glitch = 1; if (settings.shake) shake = 10;
  sfx.out(ac.currentTime);
  lpf.frequency.cancelScheduledValues(ac.currentTime); lpf.frequency.setValueAtTime(lpf.frequency.value, ac.currentTime); lpf.frequency.exponentialRampToValueAtTime(160, ac.currentTime + .3);
  die(G.lastTick);
}
function results() {
  const judged = G.perfect + G.good + G.miss;
  const acc = judged ? (G.perfect + G.good * .6) / judged : 0;
  const secs = Math.max(0, (G.endBeat - G.runStart) * T);
  let grade = 'C';
  if (acc >= .9 && G.deaths === 0 && G.star) grade = 'S';
  else if (acc >= .8 && G.deaths <= 1) grade = 'A';
  else if (acc >= .65) grade = 'B';
  return { acc, secs, grade };
}
function burst(x, y, col, n) {
  if (!G) return;
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 220; G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: .5 + Math.random() * .5, t: 0, col, sz: 3 + Math.random() * 5, rot: Math.random() * 6 }); }
}

// ---------------------------------------------------------------- input
function gameAction(a, ts) {
  if (mode !== 'playing' || !G || G.won || !ac) return;
  const tIn = eventAudio(ts) - outLat - settings.offset / 1000;
  advance(tIn);
  if (mode !== 'playing' || G.player.dead) return;
  const b = Math.round((tIn - G.songStart) / T), delta = tIn - beatTime(b);
  if (b < 0 || isFree(b) || G.resolved.has(b) || G.pending.has(b)) return;
  if (Math.abs(delta) <= GOOD) {
    const at = Math.max(ac.currentTime, beatTime(b));
    if (a === 'flip') sfx.flip(at, G.player.g < 0);
    else if (a === 'wait') sfx.wait(at);
    else sfx.move(at);
    registerHit(delta); // judge right away so feedback is instant; the move itself lands on the beat
    if (G.lastTick >= b) resolve(b, a, delta, false, true); else G.pending.set(b, { a, delta, judged: true });
  } else {
    registerMiss('off');
    G.pending.set(b, { a: null, delta, spoiled: true });
    if (G.lastTick >= b) { G.pending.delete(b); resolve(b, null, delta, true); }
  }
}
function pauseGame() {
  if (mode !== 'playing' || !G || G.won) return;
  mode = 'paused'; pauseSel = 0; ac.suspend();
}
function resumeGame() {
  if (mode !== 'paused') return;
  ac.resume().then(() => {
    const bNow = Math.floor((gnow() - G.songStart) / T);
    for (let k = 0; k <= 4; k++) { const b = bNow + k; if (!G.resolved.has(b)) { G.free.add(b); G.pending.delete(b); } }
    setPips(bNow + 1, 4);
    mode = 'playing';
  });
}
function toTitle() {
  if (music) { music.stop(.3); music = null; }
  G = null; mode = 'title'; calib = null; crt();
  if (ac) {
    const go = () => { syncFilter(true); music = new Music(); music.startMenu(); };
    if (ac.state !== 'running') ac.resume().then(go); else go();
  }
}
const TOUCH_BTNS = [{ a: 'left', x: 14, y: 470, w: 66, h: 60 }, { a: 'right', x: 88, y: 470, w: 66, h: 60 }, { a: 'flip', x: 806, y: 470, w: 66, h: 60 }, { a: 'wait', x: 880, y: 470, w: 66, h: 60 }];
const PAUSE_ITEMS = [
  { label: () => 'Resume', fn: () => resumeGame() },
  { label: () => 'Restart level', fn: () => { ac.resume().then(startGame); } },
  { label: () => `Volume   ${Math.round(settings.volume * 100)}%`, adj: d => { settings.volume = clamp(Math.round((settings.volume + d * .1) * 10) / 10, 0, 1); master.gain.value = settings.volume; store('flip.settings', settings); } },
  { label: () => `Timing offset   ${settings.offset > 0 ? '+' : ''}${settings.offset} ms`, adj: d => { settings.offset = clamp(settings.offset + d * 5, -250, 250); store('flip.settings', settings); } },
  { label: () => `Screen shake   ${settings.shake ? 'On' : 'Off'}`, fn: () => { settings.shake = !settings.shake; store('flip.settings', settings); }, adj: () => { settings.shake = !settings.shake; store('flip.settings', settings); } },
  { label: () => 'Quit to title', fn: () => toTitle() }
];

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'flip', KeyW: 'flip', Space: 'flip', ArrowDown: 'wait', KeyS: 'wait',
  Escape: 'pause', KeyP: 'pause', Enter: 'enter', NumpadEnter: 'enter', KeyR: 'restart', KeyC: 'calib', Backspace: 'back'
};
function onKey(code, ts, rawKey) {
  const a = KEYMAP[code];
  if (!a) return false;
  input(a, ts, code);
  return true;
}
function input(a, ts, code) {
  if (mode === 'title') {
    if (a === 'enter' || a === 'flip') startGame();
    else if (a === 'calib') openCalib();
    return;
  }
  if (mode === 'playing') {
    if (a === 'pause') return pauseGame();
    if (a === 'restart') return startGame();
    if (G && G.won && a === 'enter') { mode = 'results'; return; }
    if (['left', 'right', 'flip', 'wait'].includes(a)) gameAction(a, ts);
    return;
  }
  if (mode === 'paused') {
    if (a === 'pause' || a === 'back') return resumeGame();
    if (a === 'restart') return void ac.resume().then(startGame);
    if (code === 'ArrowUp' || code === 'KeyW') { pauseSel = (pauseSel + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length; return; }
    if (a === 'wait') { pauseSel = (pauseSel + 1) % PAUSE_ITEMS.length; return; }
    const it = PAUSE_ITEMS[pauseSel];
    if ((a === 'left' || a === 'right') && it.adj) { it.adj(a === 'left' ? -1 : 1); return; }
    if ((a === 'enter' || code === 'Space') && it.fn) it.fn();
    return;
  }
  if (mode === 'out' || mode === 'results') {
    if (performance.now() - overlayT < 450) return;
    if (a === 'enter' || a === 'restart' || code === 'Space') startGame();
    else if (a === 'pause' || a === 'back') toTitle();
    return;
  }
  if (mode === 'calib') {
    if (code === 'Space' || a === 'flip' || a === 'wait') calibTap(ts);
    else if (a === 'left' || a === 'right') { calib.offset = clamp(calib.offset + (a === 'left' ? -5 : 5), -250, 250); }
    else if (a === 'enter') { settings.offset = calib.offset; store('flip.settings', settings); closeCalib(); }
    else if (a === 'pause' || a === 'back') closeCalib();
  }
}
window.addEventListener('keydown', e => {
  if (e.repeat) { if (KEYMAP[e.code]) e.preventDefault(); return; }
  if (onKey(e.code, e.timeStamp, e.key)) e.preventDefault();
});
window.addEventListener('blur', () => { if (mode === 'playing') pauseGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'playing') pauseGame(); });

function toLogical(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
const hit = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); canvas.focus();
  if (e.pointerType === 'touch') touchMode = true;
  const [x, y] = toLogical(e);
  if (mode === 'playing' && touchMode) { for (const b of touchUI) if (hit(b, x, y)) { b.press = performance.now(); return input(b.a, e.timeStamp); } }
  for (let i = ui.length - 1; i >= 0; i--) if (hit(ui[i], x, y)) { if (ac) sfx.ui(ac.currentTime); return ui[i].fn(e); }
  if (mode === 'title') startGame();
  else if (mode === 'calib') calibTap(e.timeStamp);
});

// gamepad
const padPrev = {};
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const st = {
      left: p.buttons[14]?.pressed || p.axes[0] < -.6, right: p.buttons[15]?.pressed || p.axes[0] > .6,
      flip: p.buttons[12]?.pressed || p.buttons[0]?.pressed || p.buttons[3]?.pressed, wait: p.buttons[13]?.pressed || p.buttons[1]?.pressed || p.buttons[2]?.pressed,
      pause: p.buttons[9]?.pressed, enter: p.buttons[9]?.pressed && mode !== 'playing'
    };
    const prev = padPrev[p.index] || {};
    const ts = performance.now();
    for (const k of ['left', 'right', 'flip', 'wait', 'pause']) if (st[k] && !prev[k]) {
      if (mode === 'paused' || mode === 'title' || mode === 'out' || mode === 'results') {
        const map = { left: 'ArrowLeft', right: 'ArrowRight', flip: 'ArrowUp', wait: 'ArrowDown', pause: 'Escape' };
        if (k === 'flip' && p.buttons[0]?.pressed && mode !== 'title') input('enter', ts, 'Enter'); else onKey(map[k], ts);
      } else input(k, ts, '');
    }
    padPrev[p.index] = st;
  }
}

// ---------------------------------------------------------------- calibration
let calib = null;
function openCalib() {
  ensureAudio();
  const go = () => { if (music) { music.stop(.2); music = null; } measureLatency(); calib = { t0: ac.currentTime + .5, next: 0, taps: [], offset: settings.offset, from: mode }; mode = 'calib'; crt(); };
  if (ac.state !== 'running') ac.resume().then(go); else go();
}
function closeCalib() { toTitle(); }
function calibPump() { if (!calib || ac.state !== 'running') return; while (calib.t0 + calib.next * T < ac.currentTime + .15) { click(calib.t0 + calib.next * T, calib.next % 4 === 0); calib.next++; } }
function calibTap(ts) {
  if (!calib) return;
  const t = eventAudio(ts) - outLat, i = Math.round((t - calib.t0) / T), d = t - (calib.t0 + i * T);
  if (i < 0 || Math.abs(d) > T * .45) return;
  calib.taps.push(d * 1000); if (calib.taps.length > 12) calib.taps.shift();
  if (calib.taps.length >= 4) { const s = [...calib.taps].sort((a, b) => a - b); calib.offset = Math.round(s[s.length >> 1] / 5) * 5; }
}

// ---------------------------------------------------------------- update
function update(dt, now) {
  shake = Math.max(0, shake - dt * 40); glitch = Math.max(0, glitch - dt * 1.8);
  if (!G) return;
  G.flash = Math.max(0, G.flash - dt * 4);
  for (const p of G.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.vx *= .98; }
  G.parts = G.parts.filter(p => p.t < p.life);
  G.dust = G.dust.filter(d => {
    if (now < d.t) return true;
    for (let i = 0; i < 9; i++) {
      const side = i % 2 ? 1 : -1;
      G.parts.push({ x: d.x + side * (4 + Math.random() * 12), y: d.y + d.g * 2, vx: side * (50 + Math.random() * 110), vy: d.g < 0 ? -(30 + Math.random() * 60) : (10 + Math.random() * 30), life: .28 + Math.random() * .2, t: 0, col: i % 3 ? C.surf : C.bricks[0], sz: 3 + Math.random() * 3, rot: Math.random() * 6 });
    }
    return false;
  });
  G.marks = G.marks.filter(m => now - m.t0 < .6);
  const pp = playerPos(now);
  const target = clamp(pp.x - W * CAMERA_LEAD, 0, COLS * TS - W);
  camX += (target - camX) * Math.min(1, dt * CAMERA_SMOOTH);
}
function playerPos(now) {
  const P = G.player, A = P.anim;
  let x = P.x * TS + 32, fy = feetY(P.r, P.g), gs = P.g < 0 ? 1 : -1, air = 0;
  if (A) {
    const k = now - A.t0;
    const sx = A.fx * TS + 32, sy = feetY(A.fr, A.fg), ex = A.tx * TS + 32, ey = feetY(A.tr, A.tg);
    if (A.kind === 'move') {
      const d1 = MOVE_TIME, fallRows = Math.abs(A.tr - A.fr), d2 = fallRows ? FALL_TIME_BASE + fallRows * FALL_PER_ROW : 0;
      if (k < d1) { x = lerp(sx, ex, easeOut(clamp(k / d1, 0, 1))); fy = sy; }
      else if (k < d1 + d2) { x = ex; const f = easeIn((k - d1) / d2); fy = lerp(sy, ey, f); air = 1; }
    } else if (A.kind === 'flip') {
      const rows = Math.abs(A.tr - A.fr), d = FLIP_TIME_BASE + rows * FALL_PER_ROW;
      if (k < d) { const f = easeIn(clamp(k / d, 0, 1)); fy = lerp(sy, ey, f); const s0 = A.fg < 0 ? 1 : -1; gs = s0 * Math.cos(Math.PI * clamp(k / d, 0, 1)); air = 1; }
    } else if (A.kind === 'bump') {
      if (k < .14) x = sx + Math.sin(k / .14 * Math.PI) * 10 * A.dx;
    }
  }
  return { x, fy, gs, air };
}

// ---------------------------------------------------------------- render: world objects
function drawCoin(g, cx, cy, R) {
  roughCircle(g, cx, cy, 13, R); g.fillStyle = C.coin; g.fill(); ink(g, 3.5);
  g.beginPath(); g.arc(cx - 3, cy - 3, 7, Math.PI * 1.05, Math.PI * 1.6); ink(g, 2.5, C.coinHi);
  rough(g, [[cx - 4, cy - 4], [cx + 1, cy - 8], [cx + 1, cy + 7]], R, .6, 30, false); ink(g, 3);
}
function drawStar(g, cx, cy, r, rot, R) { rough(g, starPts(cx, cy, r, rot), R, 1.2, 99); g.fillStyle = C.coin; g.fill(); ink(g, 4); rough(g, [[cx - r * .3, cy - r * .3], [cx - r * .05, cy - r * .55]], R, .5, 99, false); ink(g, 3, C.coinHi); }
const ARROW = [[-24, -11], [3, -11], [3, -21], [26, 0], [3, 21], [3, 11], [-24, 11]];
function drawArrow(g, e, now, pulse, R) {
  const k = clamp((now - e.t0) / ENEMY_STEP, 0, 1), ek = easeOut(k);
  const x = lerp(e.px, e.x, ek) * TS + 32, up = e.r === 4, cy = up ? 64 + 25 : 320 - 25;
  let sxDir = e.d; if (e.turn && k < 1) sxDir = e.d * lerp(-1, 1, ek);
  if (e.px !== e.x && k < 1) {
    for (let i = 1; i <= 2; i++) { const gx = lerp(e.px, e.x, Math.max(0, ek - i * .25)) * TS + 32; g.save(); g.globalAlpha = (1 - k) * (.32 - i * .1); g.translate(gx, cy); g.scale(e.d, up ? -1 : 1); rough(g, ARROW, R, .5, 99); g.fillStyle = C.enemy; g.fill(); g.restore(); }
  }
  const glow = g.createRadialGradient(x, cy, 4, x, cy, 46); glow.addColorStop(0, 'rgba(255,79,176,.35)'); glow.addColorStop(1, 'rgba(255,79,176,0)');
  g.fillStyle = glow; g.fillRect(x - 50, cy - 50, 100, 100);
  g.save(); g.translate(x, cy); g.scale(sxDir * (1 + pulse * .08), (up ? -1 : 1) * (1 - pulse * .12));
  rough(g, ARROW, R, 1.2, 12);
  const gr = g.createLinearGradient(0, -21, 0, 21); gr.addColorStop(0, C.enemyHi); gr.addColorStop(.45, C.enemy); gr.addColorStop(1, C.enemyDk);
  g.fillStyle = gr; g.fill(); ink(g, 4);
  g.fillStyle = '#fff'; g.fillRect(-17, -6, 5, 7); g.fillRect(-7, -6, 5, 7);
  rough(g, [[-19, -10], [-12, -8]], R, .4, 99, false); ink(g, 2.5); rough(g, [[-1, -10], [-8, -8]], R, .4, 99, false); ink(g, 2.5);
  g.restore();
}
function drawGoal(g, now, pulse, R) {
  const x = GOAL * TS + 16, glow = g.createRadialGradient(x + 14, 192, 10, x + 14, 192, 150);
  glow.addColorStop(0, `rgba(95,240,184,${.28 + pulse * .1})`); glow.addColorStop(1, 'rgba(95,240,184,0)');
  g.fillStyle = glow; g.fillRect(x - 140, 60, 300, 270);
  rough(g, [[x, 66], [x, 318]], R, 1, 20, false); ink(g, 8); rough(g, [[x, 68], [x, 316]], R, .6, 30, false); ink(g, 3, '#efeaff');
  const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([x + 2 + t * 40, 150 + Math.sin(now * 5 + t * 3) * 4 * t]); }
  for (let i = 6; i >= 0; i--) { const t = i / 6; pts.push([x + 2 + t * 40 - t * 6, 196 + Math.sin(now * 5 + t * 3 + .6) * 4 * t]); }
  rough(g, pts, R, .8, 99); g.fillStyle = C.mint; g.fill(); ink(g, 4);
  for (const yy of [66, 318]) { g.beginPath(); g.arc(x, yy, 6, 0, 7); g.fillStyle = C.mint; g.fill(); ink(g, 3); }
}
function drawFace(g, type, R, now, flash) {
  const cx = SCREEN.cx, cy = SCREEN.cy;
  if (flash > 0) { g.fillStyle = `rgba(127,231,255,${flash * .35})`; g.fillRect(cx - 74, cy - 56, 148, 112); }
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  const L = (pts, w = 12) => { rough(g, pts, R, 1.6, 99, false); g.lineWidth = w; g.strokeStyle = '#fff'; g.stroke(); };
  const sq = (x, y, w, h) => { roughRect(g, x, y, w, h, R, 1.8, 99); g.fill(); };
  const blink = type === 'idle' && (now % 3.3) < .12;
  const whiskers = () => { L([[cx - 72, cy + 8], [cx - 58, cy + 8]], 7); L([[cx - 72, cy + 20], [cx - 58, cy + 20]], 7); L([[cx + 58, cy + 8], [cx + 72, cy + 8]], 7); L([[cx + 58, cy + 20], [cx + 72, cy + 20]], 7); };
  const omega = () => L([[cx - 26, cy + 10], [cx - 20, cy + 22], [cx - 10, cy + 24], [cx, cy + 14], [cx + 10, cy + 24], [cx + 20, cy + 22], [cx + 26, cy + 10]], 9);
  if (type === 'dead') { for (const ex of [-38, 38]) { L([[cx + ex - 13, cy - 34], [cx + ex + 13, cy - 8]]); L([[cx + ex + 13, cy - 34], [cx + ex - 13, cy - 8]]); } L([[cx - 18, cy + 18], [cx + 18, cy + 18]], 9); return; }
  if (type === 'happy' || type === 'win') {
    for (const ex of [-38, 38]) L([[cx + ex - 15, cy - 12], [cx + ex, cy - 32], [cx + ex + 15, cy - 12]]);
    if (type === 'win') { rough(g, [[cx - 18, cy + 8], [cx + 18, cy + 8], [cx + 12, cy + 28], [cx - 12, cy + 28]], R, 1.2, 99); g.fill(); } else omega();
    whiskers(); return;
  }
  if (type === 'miss') {
    L([[cx - 52, cy - 34], [cx - 26, cy - 21], [cx - 52, cy - 8]]); L([[cx + 52, cy - 34], [cx + 26, cy - 21], [cx + 52, cy - 8]]);
    L([[cx - 18, cy + 18], [cx - 9, cy + 12], [cx, cy + 18], [cx + 9, cy + 12], [cx + 18, cy + 18]], 8); whiskers(); return;
  }
  if (blink) { L([[cx - 52, cy - 20], [cx - 24, cy - 20]], 9); L([[cx + 24, cy - 20], [cx + 52, cy - 20]], 9); }
  else if (type === 'worried') { sq(cx - 48, cy - 32, 22, 24); sq(cx + 26, cy - 32, 22, 24); }
  else { sq(cx - 52, cy - 36, 28, 30); sq(cx + 24, cy - 36, 28, 30); }
  if (type === 'worried') L([[cx - 18, cy + 18], [cx - 9, cy + 12], [cx, cy + 18], [cx + 9, cy + 12], [cx + 18, cy + 18]], 8); else omega();
  whiskers();
}
function catSprite(g, x, fy, gs, facing, sq, face, R, now, flash, alpha) {
  g.save(); g.globalAlpha = alpha;
  g.translate(x, fy);
  const s = Math.sign(gs || 1) * Math.max(.12, Math.abs(gs));
  g.scale(facing * CAT_SC * (1 + sq * .05), s * CAT_SC * (1 - sq * .07));
  if (catImg.complete) g.drawImage(catImg, -CAT_AX, -300, 224, 300);
  if (face) drawFace(g, face, R, now, flash);
  g.restore();
}
function drawCat(g, now, pulse, R) {
  const P = G.player;
  if (P.dead) {
    const k = now - P.deadT; if (k > .5 || Math.floor(k * 20) % 2) return;
  }
  const pp = playerPos(now);
  let alpha = 1;
  const sk = now - P.spawnT;
  if (sk >= 0 && sk < T * 1.6) {
    // respawn beam from ceiling to floor
    const k = sk / (T * 1.6), bx = P.x * TS + 32;
    const gr = g.createLinearGradient(bx - 30, 0, bx + 30, 0); gr.addColorStop(0, 'rgba(127,231,255,0)'); gr.addColorStop(.5, `rgba(127,231,255,${.55 * (1 - k)})`); gr.addColorStop(1, 'rgba(127,231,255,0)');
    g.fillStyle = gr; g.fillRect(bx - 30, 64, 60, 256);
    if (sk < T) alpha = (Math.floor(sk * 24) % 2 ? .35 : 1) * clamp(sk / T + .3, 0, 1);
  }
  const surfY = pp.gs > 0 ? 320 : 64, onSurf = Math.abs(pp.fy - surfY) < 2;
  if (onSurf || pp.air) { g.save(); g.globalAlpha = .35 * alpha * (onSurf ? 1 : .4); g.fillStyle = INK; g.beginPath(); g.ellipse(pp.x, P.g < 0 ? 321 : 63, 24, 5, 0, 0, 7); g.fill(); g.restore(); }
  let face = G.face;
  if (G.faceT < now && face !== 'dead' && face !== 'win') face = G.bar <= 2 ? 'worried' : 'idle';
  const sq = settings.shake ? pulse : pulse * .5;
  // afterimages while flipping
  if (pp.air && P.anim && P.anim.kind === 'flip') {
    for (let i = 1; i <= 3; i++) { const q = playerPos(now - i * .022); catSprite(g, q.x, q.fy, q.gs, P.facing, 0, null, R, now, 0, alpha * (.3 - i * .08)); }
  }
  let hop = 0;
  if (G.won) hop = Math.abs(Math.sin((now - G.winT) * Math.PI / T)) * 14 * (P.g < 0 ? -1 : 1);
  catSprite(g, pp.x, pp.fy + hop, pp.gs, P.facing, sq, face, R, now, G.flash, alpha);
}

// ---------------------------------------------------------------- render: HUD
function drawCRT(g, cx, cy, w, h, face, R, pulse) {
  g.save(); g.translate(cx, cy); const s = 1 + pulse * .12; g.scale(s, s);
  rough(g, [[-w / 2 + 6, -h / 2 - 8], [-w / 2 + 12, -h / 2 + 1], [-w / 2 + 1, -h / 2 + 1]], R, .5, 99); g.fillStyle = C.wallA; g.fill(); ink(g, 3);
  rough(g, [[w / 2 - 6, -h / 2 - 8], [w / 2 - 12, -h / 2 + 1], [w / 2 - 1, -h / 2 + 1]], R, .5, 99); g.fillStyle = C.wallB; g.fill(); ink(g, 3);
  roughRect(g, -w / 2, -h / 2, w, h, R, 1, 99);
  g.save(); g.clip(); g.fillStyle = C.wallA; g.fillRect(-w / 2, -h / 2, w / 2, h); g.fillStyle = C.wallB; g.fillRect(0, -h / 2, w / 2, h); g.restore(); ink(g, 3.5);
  roughRect(g, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, R, .8, 99); g.fillStyle = '#0a1130'; g.fill();
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.lineCap = 'round';
  const ex = w * .18, ey = -3;
  if (face === 'x') { for (const sx of [-ex, ex]) { g.beginPath(); g.moveTo(sx - 4, ey - 4); g.lineTo(sx + 4, ey + 4); g.moveTo(sx + 4, ey - 4); g.lineTo(sx - 4, ey + 4); g.stroke(); } }
  else if (face === 'happy') { for (const sx of [-ex, ex]) { g.beginPath(); g.moveTo(sx - 4, ey + 2); g.lineTo(sx, ey - 3); g.lineTo(sx + 4, ey + 2); g.stroke(); } }
  else if (face === 'miss') { g.beginPath(); g.moveTo(-ex - 4, ey - 4); g.lineTo(-ex + 3, ey); g.lineTo(-ex - 4, ey + 4); g.moveTo(ex + 4, ey - 4); g.lineTo(ex - 3, ey); g.lineTo(ex + 4, ey + 4); g.stroke(); }
  else { g.fillRect(-ex - 3, ey - 4, 6, 7); g.fillRect(ex - 3, ey - 4, 6, 7); }
  g.beginPath(); g.moveTo(-6, 6); g.quadraticCurveTo(-3, 10, 0, 6); g.quadraticCurveTo(3, 10, 6, 6); g.stroke();
  g.restore();
}
function drawHUD(g, now, pulse, R) {
  // sync bar
  const lit = G.bar, low = lit <= 2;
  const BA = G.barAnim, bk = BA ? (now - BA.t) / .35 : 9;
  for (let i = 0; i < SYNC_MAX; i++) {
    const h0 = 14 + i * 6;
    let h = h0 * (i < lit ? 1 + pulse * .12 : 1);
    if (BA && BA.kind === 'gain' && BA.idx === i && bk < 1) h *= 1 + .45 * (1 - easeOut(bk));
    const x = 24 + i * 22, y = 64 - h;
    roughRect(g, x, y, 15, h, R, .8, 99);
    let col = '#2b2554';
    if (i < lit) col = low ? (Math.floor((now - G.songStart) / T) % 2 ? C.coral : '#ff9aac') : lit === 3 ? C.coin : C.mint;
    g.fillStyle = col; g.fill(); ink(g, 3);
  }
  if (BA && BA.kind === 'loss' && bk < 1) {
    const i = BA.idx, h0 = 14 + i * 6, x = 24 + i * 22;
    g.save(); g.globalAlpha = 1 - bk; g.translate(x + 7, 64 - h0 / 2 + easeIn(bk) * 34); g.rotate(bk * .9);
    roughRect(g, -7, -h0 / 2, 15, h0, R, .8, 99); g.fillStyle = C.coral; g.fill(); ink(g, 3); g.restore();
  }
  // progress line
  const x0 = 330, x1 = 630, y = 46;
  rough(g, [[x0, y], [x1, y]], R, .6, 30, false); ink(g, 3, 'rgba(214,205,246,.35)');
  const fx = x1; rough(g, [[fx, y + 8], [fx, y - 12]], R, .3, 99, false); ink(g, 3, C.lav); rough(g, [[fx, y - 12], [fx + 12, y - 8], [fx, y - 4]], R, .3, 99); g.fillStyle = C.mint; g.fill(); ink(g, 2.5);
  const pp = playerPos(now), px = lerp(x0, x1, clamp((pp.x - 32) / TS / GOAL, 0, 1));
  drawCRT(g, px, y, 18, 14, G.player.dead ? 'x' : 'n', R, 0);
  // collectibles
  // one slot per coin in the level: filled when collected
  const nC = COINS.length, cx0 = 868 - nC * 24;
  for (let i = 0; i < nC; i++) {
    const x = cx0 + i * 24, got = i < G.coins.size;
    g.save(); if (!got) g.globalAlpha = .45;
    roughCircle(g, x, 41, 8, R, .8, 12); g.fillStyle = got ? C.coin : '#2b2554'; g.fill(); ink(g, 2.5); g.restore();
  }
  if (STAR) { g.save(); g.translate(888, 40); if (!G.star) g.globalAlpha = .5; rough(g, starPts(0, 0, 12, 0), R, .7, 99); g.fillStyle = G.star ? C.coin : '#2b2554'; g.fill(); ink(g, 3); g.restore(); }
  // pause button
  const pb = { x: 912, y: 24, w: 34, h: 34 };
  roughRect(g, pb.x, pb.y, pb.w, pb.h, R, .8, 99); g.fillStyle = C.panel2; g.fill(); ink(g, 3);
  g.fillStyle = C.lav; g.fillRect(pb.x + 11, pb.y + 9, 4, 16); g.fillRect(pb.x + 19, pb.y + 9, 4, 16);
  ui.push({ ...pb, fn: () => pauseGame() });

  // beat track
  const bx = 480, by = 506;
  rough(g, [[150, by], [810, by]], R, .5, 40, false); ink(g, 2, 'rgba(214,205,246,.22)');
  const bCur = Math.floor((now - G.songStart) / T);
  for (let b = bCur - 1; b <= bCur + 5; b++) {
    if (b < 0) continue;
    const dtb = (beatTime(b) - now) / T;
    if (dtb < -.3 || dtb > 4.6) continue;
    const off = 30 + Math.max(0, dtb) * 72, free = isFree(b);
    const a = dtb < 0 ? clamp(1 + dtb / .3, 0, 1) : clamp(1 - (dtb - 3.2) / 1.4, 0, 1);
    for (const sgn of [-1, 1]) {
      const mx = bx + sgn * off;
      g.save(); g.globalAlpha = a;
      if (free) { g.beginPath(); g.arc(mx, by, 4, 0, 7); g.fillStyle = C.dim; g.fill(); }
      else { roughRect(g, mx - 4, by - 15, 8, 30, R, .6, 99); g.fillStyle = b % 4 === 0 ? C.cyan : '#fff'; g.fill(); ink(g, 2.5); }
      g.restore();
    }
  }
  let cf = 'n';
  if (G.judge && now - G.judge.t < .3) cf = G.judge.j === 'miss' ? 'miss' : 'happy';
  if (G.player.dead) cf = 'x';
  if (G.judge && now - G.judge.t < .35) {
    const k = (now - G.judge.t) / .35, col = G.judge.j === 'perfect' ? C.cyan : G.judge.j === 'good' ? C.lav : C.coral;
    g.save(); g.globalAlpha = 1 - k; g.beginPath(); g.arc(bx, by, 26 + k * 22, 0, 7); g.lineWidth = 4; g.strokeStyle = col; g.stroke(); g.restore();
  }
  drawCRT(g, bx, by, 46, 36, cf, R, pulse);

  // touch buttons
  touchUI = [];
  if (touchMode) {
    for (const b of TOUCH_BTNS) {
      const pressed = b.press && performance.now() - b.press < 120;
      roughRect(g, b.x, b.y, b.w, b.h, R, 1, 99); g.fillStyle = pressed ? C.wallB : 'rgba(42,36,98,.85)'; g.fill(); ink(g, 3);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      g.fillStyle = C.lav; g.strokeStyle = C.lav; g.lineWidth = 4; g.lineJoin = 'round';
      g.beginPath();
      if (b.a === 'left') { g.moveTo(cx + 8, cy - 11); g.lineTo(cx - 10, cy); g.lineTo(cx + 8, cy + 11); g.closePath(); g.fill(); }
      else if (b.a === 'right') { g.moveTo(cx - 8, cy - 11); g.lineTo(cx + 10, cy); g.lineTo(cx - 8, cy + 11); g.closePath(); g.fill(); }
      else if (b.a === 'flip') { g.moveTo(cx - 12, cy - 4); g.lineTo(cx - 5, cy - 13); g.lineTo(cx + 2, cy - 4); g.closePath(); g.moveTo(cx - 2, cy + 4); g.lineTo(cx + 5, cy + 13); g.lineTo(cx + 12, cy + 4); g.closePath(); g.fill(); g.fillRect(cx - 7, cy - 5, 4, 12); g.fillRect(cx + 3, cy - 7, 4, 12); }
      else { g.rect(cx - 8, cy - 8, 16, 16); g.fill(); }
      touchUI.push(b);
    }
  }
}

// ---------------------------------------------------------------- render: screens
function panel(g, x, y, w, h, R) {
  roughRect(g, x, y, w, h, R, 1.4, 20); g.fillStyle = 'rgba(31,25,72,.97)'; g.fill(); ink(g, 5);
  roughRect(g, x + 8, y + 8, w - 16, h - 16, R, .8, 30); ink(g, 2, 'rgba(214,205,246,.18)');
}
function button(g, x, y, w, h, label, sel, R, fn, hint) {
  roughRect(g, x, y, w, h, R, 1, 99); g.fillStyle = sel ? C.btn : C.panel2; g.fill(); ink(g, 3.5);
  text(g, label, x + w / 2, y + h / 2 + 1, 18, sel ? INK : C.lav, 'center', 700, !sel);
  if (hint) text(g, hint, x + w / 2, y + h + 14, 12, C.dim, 'center', 500, false);
  ui.push({ x, y, w, h, fn });
}
const ARROW_ROT = { '→': 0, '↓': Math.PI / 2, '←': Math.PI, '↑': -Math.PI / 2 };
function keycap(g, x, y, label, R) {
  g.font = `400 14px ${FONT}`; const w = Math.max(28, g.measureText(label).width + 16);
  roughRect(g, x, y, w, 28, R, .7, 99); g.fillStyle = C.panel2; g.fill(); ink(g, 3);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 4, y + 4, w - 8, 4);
  if (label in ARROW_ROT) {
    g.save(); g.translate(x + w / 2, y + 15); g.rotate(ARROW_ROT[label]);
    g.beginPath(); g.moveTo(-5, 0); g.lineTo(4, 0); g.moveTo(1, -4); g.lineTo(5, 0); g.lineTo(1, 4);
    g.lineWidth = 2.2; g.strokeStyle = C.lav; g.lineCap = 'square'; g.lineJoin = 'miter'; g.stroke(); g.restore();
  } else text(g, label, x + w / 2, y + 15, 14, C.lav, 'center', 700, false);
  return w;
}
function drawTitle(g, now, pulse, R) {
  drawSky(g, now * 20, pulse * .6, now, Math.floor(now / (T * 4)));
  // the cover melts into the night sky instead of sitting in a frame
  const cv = coverFeathered();
  if (cv) {
    const s = 1 + pulse * .008, cy = 272 + Math.sin(now * 1.1) * 3;
    g.save(); g.translate(262, cy); g.scale(s, s); g.drawImage(cv, -270, -270, 540, 540); g.restore();
  }
  const X = 540;
  const shade = g.createLinearGradient(500, 0, 620, 0); shade.addColorStop(0, 'rgba(10,8,26,0)'); shade.addColorStop(1, 'rgba(10,8,26,.42)');
  g.fillStyle = shade; g.fillRect(500, 0, W - 500, H);
  text(g, 'LEVEL 0 · TUTORIAL', X, 66, 14, C.lav, 'left', 700, false);
  outlinedText(g, 'Flip', X, 112, 58, '#fff', 'left', 700, FONT_T);
  text(g, 'Act on every beat, even to wait.', X, 160, 16, C.lav, 'left', 500, false);
  text(g, `Miss ${SYNC_MAX} in a row and the level restarts.`, X, 182, 16, C.lav, 'left', 500, false);
  const rows = [[['←', '→'], ['A', 'D'], 'Move'], [['↑', 'W', 'Space'], [], 'Flip gravity'], [['↓', 'S'], [], 'Wait'], [['Esc'], [], 'Pause']];
  let y = 214;
  for (const [a, b, lbl] of rows) {
    let x = X; for (const k of a) x += keycap(g, x, y, k, R) + 6;
    if (b.length) { text(g, '/', x + 2, y + 15, 14, C.dim, 'left', 600, false); x += 16; for (const k of b) x += keycap(g, x, y, k, R) + 6; }
    text(g, lbl, X + 210, y + 15, 16, C.lav, 'left', 600, false);
    y += 38;
  }
  const gl = g.createRadialGradient(X + 110, 409, 10, X + 110, 409, 170);
  gl.addColorStop(0, `rgba(${C.btnGlow},${.1 + pulse * .12})`); gl.addColorStop(1, `rgba(${C.btnGlow},0)`);
  g.fillStyle = gl; g.fillRect(0, 0, W, H);
  button(g, X, 384, 220, 50, touchMode ? 'Tap to start' : 'Start  (Enter)', true, R, () => startGame());
  button(g, X + 232, 384, 150, 50, 'Calibrate', false, R, () => openCalib(), 'C');
  if (best.grade) text(g, `Best: ${best.grade}  ·  ${fmt(best.secs)}`, X, 466, 14, C.dim, 'left', 600, false);
  text(g, 'Gamepad: D-pad move · A flip · B wait', X, 492, 13, C.dim, 'left', 500, false);
}
function fmt(s) { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function drawPause(g, R) {
  g.fillStyle = 'rgba(8,6,22,.62)'; g.fillRect(0, 0, W, H);
  panel(g, 300, 96, 360, 350, R);
  outlinedText(g, 'Paused', 480, 140, 34, '#fff');
  PAUSE_ITEMS.forEach((it, i) => {
    const y = 176 + i * 42, sel = i === pauseSel;
    roughRect(g, 330, y, 300, 34, R, .8, 99); g.fillStyle = sel ? C.btn : C.panel2; g.fill(); ink(g, 3);
    text(g, it.label(), 348, y + 18, 16, sel ? INK : C.lav, 'left', 700, !sel);
    if (it.adj && sel) { g.fillStyle = INK; g.beginPath(); g.moveTo(594, y + 12); g.lineTo(588, y + 17); g.lineTo(594, y + 22); g.moveTo(604, y + 12); g.lineTo(610, y + 17); g.lineTo(604, y + 22); g.fill(); }
    ui.push({ x: 330, y, w: 300, h: 34, fn: (e) => { pauseSel = i; if (it.adj && !it.fn) { const [lx] = toLogical(e); it.adj(lx < 480 ? -1 : 1); } else if (it.fn) it.fn(); } });
  });
  text(g, 'Up/Down choose · Left/Right adjust · Enter select · R restart · Esc resume', 480, 470, 13, C.dim, 'center', 500, false);
}
function drawOut(g, R) {
  const k = clamp((performance.now() - overlayT) / 500, 0, 1);
  g.fillStyle = `rgba(8,6,22,${.7 * k})`; g.fillRect(0, 0, W, H);
  if (k < .4) return;
  panel(g, 270, 140, 420, 260, R);
  outlinedText(g, 'OUT OF SYNC', 480, 196, 40, C.coral);
  text(g, 'Your rhythm bar ran out.', 480, 240, 17, C.lav, 'center', 500, false);
  text(g, 'Keep pressing on every beat, even to wait.', 480, 264, 15, C.dim, 'center', 500, false);
  button(g, 310, 310, 160, 48, 'Retry', true, R, () => startGame(), 'Enter');
  button(g, 490, 310, 160, 48, 'Title', false, R, () => toTitle(), 'Esc');
}
function drawResults(g, R) {
  const el = performance.now() - overlayT, k = clamp(el / 400, 0, 1);
  g.fillStyle = `rgba(8,6,22,${.6 * k})`; g.fillRect(0, 0, W, H);
  const r = results();
  panel(g, 230, 66, 500, 418, R);
  outlinedText(g, 'LEVEL CLEAR', 480, 110, 38, C.mint);
  const rows = [['Time', fmt(r.secs)], ['Accuracy', Math.round(r.acc * 100) + '%'], ['Perfect', String(G.perfect), C.cyan], ['Good', String(G.good), C.lav], ['Miss', String(G.miss), C.coral], ['Coins', `${G.coins.size} / ${COINS.length}`], ['Star', G.star ? 'Found' : 'Missed'], ['Restarts', String(G.deaths)]];
  rows.forEach(([a, b, col], i) => {
    const rk = clamp((el - 250 - i * 80) / 180, 0, 1); if (rk <= 0) return;
    const y = 150 + i * 26, dx = (1 - easeOut(rk)) * 18;
    g.save(); g.globalAlpha = rk;
    text(g, a, 430 + dx, y, 15, col || C.dim, 'left', 600, false); text(g, b, 700 + dx, y, 17, '#fff', 'right', 700, false);
    g.restore();
  });
  // grade stamp lands after the rows
  const st = el - 250 - rows.length * 80 - 120;
  if (st > 0) {
    if (!G.stamped) { G.stamped = true; if (ac) { kick(ac.currentTime, sfxBus); crash(ac.currentTime, sfxBus, .1); sfx.star(ac.currentTime + .05); } if (settings.shake) shake = 6; }
    const sk = clamp(st / 180, 0, 1), sc = lerp(2.4, 1, easeOut(sk));
    g.save(); g.globalAlpha = sk; g.translate(330, 226); g.rotate(-.08); g.scale(sc, sc);
    roughCircle(g, 0, 0, 62, R, 2, 18); g.fillStyle = r.grade === 'S' ? C.coin : r.grade === 'A' ? C.mint : r.grade === 'B' ? C.cyan : C.lav; g.fill(); ink(g, 5);
    outlinedText(g, r.grade, 0, 2, 72, '#fff');
    g.restore();
    g.save(); g.globalAlpha = sk; text(g, 'GRADE', 330, 306, 13, C.dim, 'center', 700, false); g.restore();
    if (G.newBest && sk >= 1) {
      g.save(); g.translate(384, 170); g.rotate(.18); roughRect(g, -44, -13, 88, 26, R, .8, 99); g.fillStyle = C.coin; g.fill(); ink(g, 3);
      text(g, 'NEW BEST', 0, 1, 13, INK, 'center', 700, false); g.restore();
    }
  }
  if (G.deltaN >= 6 && el > 1400) {
    const avg = Math.round(G.deltaSum / G.deltaN * 1000);
    if (Math.abs(avg) >= 25) text(g, `You tend to hit ${Math.abs(avg)} ms ${avg > 0 ? 'late' : 'early'}. Try Calibrate on the title.`, 480, 362, 13, C.lav, 'center', 500, false);
  }
  button(g, 290, 392, 180, 48, 'Play again', true, R, () => startGame(), 'Enter');
  button(g, 490, 392, 180, 48, 'Title', false, R, () => toTitle(), 'Esc');
}
function drawCalib(g, now, R) {
  drawSky(g, now * 15, 0, now, 0);
  panel(g, 180, 60, 600, 420, R);
  outlinedText(g, 'Calibrate timing', 480, 106, 32, '#fff');
  text(g, 'Press Space (or tap) on every click. Use headphones if you play with them.', 480, 146, 15, C.lav, 'center', 500, false);
  const ph = calib ? (gnow() - calib.t0) / T : 0, bi = Math.floor(ph), fr = ph - bi;
  const p = bi >= 0 ? Math.exp(-fr * 6) : 0;
  roughCircle(g, 480, 222, 34 + p * 10, R, 1.4, 16); g.fillStyle = bi >= 0 && bi % 4 === 0 ? C.cyan : C.wallB; g.fill(); ink(g, 4);
  const x0 = 260, x1 = 700, y = 312, ms2x = ms => lerp(x0, x1, (clamp(ms, -250, 250) + 250) / 500);
  rough(g, [[x0, y], [x1, y]], R, .5, 40, false); ink(g, 3, 'rgba(214,205,246,.4)');
  rough(g, [[480, y - 16], [480, y + 16]], R, .5, 99, false); ink(g, 3, C.lav);
  text(g, 'early', x0, y + 28, 12, C.dim, 'left', 500, false); text(g, 'late', x1, y + 28, 12, C.dim, 'right', 500, false);
  calib.taps.forEach((d, i) => { g.beginPath(); g.arc(ms2x(d), y, 6, 0, 7); g.fillStyle = `rgba(255,213,74,${.35 + .65 * (i + 1) / calib.taps.length})`; g.fill(); });
  const ox = ms2x(calib.offset); rough(g, [[ox, y - 20], [ox + 7, y - 30], [ox - 7, y - 30]], R, .3, 99); g.fillStyle = C.mint; g.fill(); ink(g, 2.5);
  text(g, `Offset: ${calib.offset > 0 ? '+' : ''}${calib.offset} ms`, 480, 370, 22, '#fff', 'center', 700);
  text(g, calib.taps.length < 4 ? `Taps: ${calib.taps.length} (need 4+)` : `Taps: ${calib.taps.length}`, 480, 398, 14, C.dim, 'center', 500, false);
  button(g, 300, 424, 170, 40, 'Save', true, R, () => { settings.offset = calib.offset; store('flip.settings', settings); closeCalib(); }, null);
  button(g, 490, 424, 170, 40, 'Back', false, R, () => closeCalib(), null);
  text(g, 'Left/Right fine-tune · Enter save · Esc back', 480, 502, 13, C.dim, 'center', 500, false);
}

// ---------------------------------------------------------------- render: game
function drawMark(g, m, now, R) {
  const k = clamp((now - m.t0) / .6, 0, 1), y = m.y + m.dir * 18 * easeOut(k), x = m.x;
  g.save(); g.globalAlpha = 1 - easeIn(k); g.translate(x, y);
  if (m.kind === 'perfect') {
    const s = 1 + easeOut(k) * .4; g.scale(s, s); g.rotate(k * .8);
    rough(g, [[0, -14], [4, -4], [14, 0], [4, 4], [0, 14], [-4, 4], [-14, 0], [-4, -4]], R, .5, 99); g.fillStyle = C.cyan; g.fill(); ink(g, 3);
  } else if (m.kind === 'good') {
    g.beginPath(); g.arc(0, 0, 9 + easeOut(k) * 6, 0, 7); g.lineWidth = 4; g.strokeStyle = C.lav; g.stroke();
    if (m.side) { const sx = m.side * 22; g.beginPath(); g.moveTo(sx, -6); g.lineTo(sx + m.side * 7, 0); g.lineTo(sx, 6); g.closePath(); g.fillStyle = C.lav; g.fill(); }
  } else {
    const j = m.kind === 'off' ? Math.sin(now * 60) * 3 : 0;
    g.translate(j, 0); g.lineCap = 'round';
    for (const [w, col] of [[8, INK], [4.5, C.coral]]) { g.beginPath(); g.moveTo(-9, -9); g.lineTo(9, 9); g.moveTo(9, -9); g.lineTo(-9, 9); g.lineWidth = w; g.strokeStyle = col; g.stroke(); }
  }
  g.restore();
}
function drawEQ(g, now, pulse, hue) {
  const bIdx = G.lastTick, n = 30, w = 22, step = W / n, off = -((camX * .3) % step);
  g.save(); g.beginPath(); g.rect(0, PF_Y + 64, W, 256); g.clip();
  for (let i = -1; i <= n; i++) {
    const R = mulberry(i * 131 + bIdx * 977), v = R();
    const h = (16 + v * 120) * (.3 + .7 * pulse) + 8 + Math.sin(now * 2.6 + i * .7) * 6;
    const x = off + i * step + (step - w) / 2;
    g.fillStyle = `hsla(${hue},85%,72%,.085)`;
    g.fillRect(x, PF_Y + 320 - h, w, h);
    g.fillRect(x, PF_Y + 64, w, h * .55);
  }
  g.restore();
}
function drawGame(g, now, pulse, R) {
  const bar = Math.max(0, Math.floor((now - G.songStart) / T - COUNTIN) >> 2);
  const blend = clamp((now - G.cpT) / 1.6, 0, 1);
  drawSky(g, camX, pulse, now, bar, G.section, G.secPrev, blend);
  drawEQ(g, now, pulse, lerp(SKY_HUES[G.secPrev][0], SKY_HUES[G.section][0], blend));
  g.save();
  if (shake > 0) g.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
  const z = settings.shake ? 1 + pulse * .01 : 1;
  g.translate(W / 2, PF_Y + PF_H / 2); g.scale(z, z); g.translate(-W / 2, -(PF_Y + PF_H / 2));
  g.translate(-Math.round(camX), PF_Y);
  const sx = Math.max(0, Math.floor(camX) - 10), sw = Math.min(COLS * TS - sx, W + 20);
  const L = layers[G.boil % layers.length];
  if (L) g.drawImage(L, sx * LD, 0, sw * LD, PF_H * LD, sx, 0, sw, PF_H);
  const pp = playerPos(now), P = G.player;
  // beat ripple on the surface under CodeCat
  const rk = (now - G.ripple) / .45;
  if (!P.dead && rk >= 0 && rk < 1 && !pp.air) {
    const sy = P.g < 0 ? 320 : 64;
    g.save(); g.globalAlpha = (1 - rk) * .7; g.beginPath(); g.ellipse(pp.x, sy, 16 + 46 * easeOut(rk), 3 + 5 * rk, 0, 0, 7); g.lineWidth = 3; g.strokeStyle = C.surf; g.stroke(); g.restore();
  }
  // the surface you are flipping to lights up
  if (G.flipFlash) {
    const k = (now - G.flipFlash.t0) / .4;
    if (k < 1) {
      const f = G.flipFlash; g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - k) * .9;
      const gr = g.createLinearGradient(f.x - 110, 0, f.x + 110, 0); gr.addColorStop(0, 'rgba(127,231,255,0)'); gr.addColorStop(.5, 'rgba(127,231,255,1)'); gr.addColorStop(1, 'rgba(127,231,255,0)');
      g.fillStyle = gr; g.fillRect(f.x - 110, f.y - 4, 220, 8); g.restore();
    }
  }
  drawGoal(g, now, pulse, R);
  COINS.forEach(([x, r], i) => { if (!G.coins.has(i)) drawCoin(g, x * TS + 32, rowTop(r) + 32 - pulse * 4 * (r === 1 ? 1 : -1), R); });
  if (!G.star) drawStar(g, STAR[0] * TS + 32, rowTop(STAR[1]) + 30 - pulse * 5, 22 + pulse * 3, Math.sin(now * 2) * .2, R);
  for (const e of G.enemies) drawArrow(g, e, now, pulse, R);
  // whatever got you flashes, so a death always has a visible cause
  if (G.killer && now - G.killer.t < .6) {
    const k = (now - G.killer.t) / .6, kc = G.killer.e ? [G.killer.e.x * TS + 32, G.killer.e.r === 1 ? 295 : 89] : [G.killer.x * TS + 32, G.killer.r === 1 ? 296 : 88];
    g.save(); g.globalAlpha = 1 - k; g.beginPath(); g.arc(kc[0], kc[1], 22 + k * 30, 0, 7); g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke(); g.restore();
  }
  drawCat(g, now, pulse, R);
  for (const p of G.parts) { const a = 1 - p.t / p.life; g.save(); g.globalAlpha = a; g.translate(p.x, p.y); g.rotate(p.rot + p.t * 6); g.fillStyle = p.col; g.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz); g.restore(); }
  for (const m of G.marks) drawMark(g, m, now, R);
  g.restore();
  // spotlight
  const lx = pp.x - camX, ly = PF_Y + pp.fy - (P.g < 0 ? 40 : -40);
  const vg = g.createRadialGradient(lx, ly, 70, lx, ly, 620);
  vg.addColorStop(0, 'rgba(6,4,20,0)'); vg.addColorStop(1, 'rgba(6,4,20,.62)');
  g.fillStyle = vg; g.fillRect(0, PF_Y, W, PF_H);
  // low sync: the edges of the screen pulse red
  if (G.bar <= 2 && mode === 'playing' && !G.won) {
    const a = (G.bar <= 1 ? .5 : .3) * (.55 + .45 * pulse);
    const dv = g.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 620);
    dv.addColorStop(0, 'rgba(255,95,126,0)'); dv.addColorStop(1, `rgba(255,95,126,${a})`);
    g.fillStyle = dv; g.fillRect(0, 0, W, H);
  }
  // count-in: dots fill on each beat, then a ring bursts on the first playable beat
  const bNow = Math.floor((now - G.songStart) / T), pip = G.pips.get(bNow);
  if (pip && !G.won) {
    const k = clamp((now - beatTime(bNow)) / T, 0, 1);
    if (pip.go) {
      g.save(); g.globalAlpha = 1 - k; g.beginPath(); g.arc(480, 230, 30 + easeOut(k) * 140, 0, 7); g.lineWidth = 8 * (1 - k) + 2; g.strokeStyle = C.mint; g.stroke(); g.restore();
    } else {
      const sp = 44, x0 = 480 - (pip.n - 1) * sp / 2;
      for (let i = 0; i < pip.n; i++) {
        const on = i <= pip.i, cur = i === pip.i, r = cur ? 13 + (1 - easeOut(k)) * 7 : 11;
        roughCircle(g, x0 + i * sp, 230, r, R, .8, 14); g.fillStyle = on ? (cur ? '#fff' : C.lav) : 'rgba(31,25,72,.85)'; g.fill(); ink(g, 3.5);
      }
    }
  }
  drawHUD(g, now, pulse, R);
}

// ---------------------------------------------------------------- main loop
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, lastTs ? (ts - lastTs) / 1000 : 0); lastTs = ts;
  pollPad();
  ui = [];
  const g = ctx;
  g.setTransform(DPS, 0, 0, DPS, 0, 0);
  let now = gnow(), pulse = 0;
  if (mode === 'title' || !G) {
    const tc = performance.now() / 1000 - titleClock0;
    if (music && music.menu && ac && ac.state === 'running') { music.pump(); const ph = ((gnow() - music.t0) / T) % 1; pulse = ph >= 0 ? Math.exp(-ph * 6) : 0; }
    else pulse = Math.exp(-((tc % T) / T) * 6);
    if (mode === 'calib' && calib) { drawCalib(g, tc, mulberry(Math.floor(tc / T) % 3 + 1)); }
    else drawTitle(g, tc, pulse, mulberry(Math.floor(tc / T) % 3 + 1));
  } else {
    if (mode === 'playing' || mode === 'results') { if (music) music.pump(); advance(now); }
    if (G.lastTick >= 0) pulse = Math.exp(-Math.max(0, now - G.lastBeatT) * 7);
    if (mode === 'out' || mode === 'paused') pulse = 0;
    update(dt, now);
    const R = mulberry(G.boil + 11);
    drawGame(g, now, pulse, R);
    if (mode === 'paused') drawPause(g, R);
    else if (mode === 'out') drawOut(g, R);
    else if (mode === 'results') drawResults(g, R);
  }
  scanlines(g);
  if (glitch > 0.02) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const cw = canvas.width, chh = canvas.height;
    for (let i = 0; i < 7; i++) {
      const sy = Math.random() * chh, h = (4 + Math.random() * 22) * DPS, off = (Math.random() - .5) * 46 * DPS * glitch;
      g.drawImage(canvas, 0, sy, cw, h, off, sy, cw, h);
    }
    g.globalCompositeOperation = 'screen';
    g.fillStyle = `rgba(255,79,176,${.22 * glitch})`; g.fillRect(0, Math.random() * chh, cw, 10 * DPS);
    g.fillStyle = `rgba(127,231,255,${.22 * glitch})`; g.fillRect(0, Math.random() * chh, cw, 8 * DPS);
    g.globalCompositeOperation = 'source-over';
  }
  g.setTransform(DPS, 0, 0, DPS, 0, 0);
  drawCRTOn(g);
  if (touchMode && window.innerHeight > window.innerWidth) {
    g.setTransform(DPS, 0, 0, DPS, 0, 0); g.fillStyle = 'rgba(8,6,22,.88)'; g.fillRect(0, 0, W, H);
    outlinedText(g, 'Rotate your phone', 480, 250, 40, '#fff'); text(g, 'Flip plays in landscape.', 480, 300, 18, C.lav, 'center', 500, false);
  }
}

// ---------------------------------------------------------------- boot
resize();
const fontReady = document.fonts && document.fonts.load ? Promise.race([Promise.all([document.fonts.load(`700 20px "Pixelify Sans"`), document.fonts.load(`400 20px "Tiny5"`)]), new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
fontReady.then(() => { requestAnimationFrame(frame); canvas.focus(); });

// debug hook used by the automated tests and to export a picture of the whole level
window.__flip = {
  overview: (scale = 1) => {
    const c = document.createElement('canvas'); c.width = COLS * TS * scale; c.height = PF_H * scale;
    const g = c.getContext('2d'); g.scale(scale, scale);
    const gr = g.createLinearGradient(0, 0, 0, PF_H); gr.addColorStop(0, C.bg0); gr.addColorStop(1, C.bg1); g.fillStyle = gr; g.fillRect(0, 0, COLS * TS, PF_H);
    const R = mulberry(5);
    g.drawImage(layers[0], 0, 0, COLS * TS, PF_H);
    drawGoal(g, 0, 0, R);
    COINS.forEach(([x, r]) => drawCoin(g, x * TS + 32, rowTop(r) + 32, R));
    if (STAR) drawStar(g, STAR[0] * TS + 32, rowTop(STAR[1]) + 30, 22, 0, R);
    for (const [x, r, d] of ENEMY_START) drawArrow(g, { x, r, d, px: x, pr: r, t0: -9, turn: false }, 0, 0, R);
    catSprite(g, START[0] * TS + 32, feetY(START[1], -1), 1, 1, 0, 'idle', R, 1, 0, 1);
    return c.toDataURL('image/png');
  },
  get G() { return G; }, get mode() { return mode; }, beatTime: b => beatTime(b), gnow: () => gnow(),
  inject: (a, b) => { const t = beatTime(b); const tsEq = performance.now() - (ac.currentTime - (t + outLat + settings.offset / 1000)) * 1000; gameAction(a, tsEq); },
  start: () => startGame(),
  audio: () => ({ ac, master, lpf })
};
})();
