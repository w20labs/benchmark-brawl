// Benchmark Brawl page. The rules live in ../fight.ts and ../league.ts; this file draws and plays them.
import { formatValue, planFight, STYLE_NAMES, weaponName } from '../fight.ts';
import { planRoyale, ROYALE_MAX, ROYALE_MIN } from '../royale.ts';
import { judgeClaim } from '../claims.ts';
import { drawMove, moveNameFor, startMove, updateMove } from './specials.js';
import { CLASSES, dailyBrawl, inClass, MAX_ROUNDS, MIN_ROUNDS, newChallengers, PRESETS, runTournament } from '../league.ts';

/** @type {import('../types.ts').BrawlData} */
const DATA = JSON.parse(document.getElementById('brawl-data').textContent);
const SITE_URL = document.querySelector('meta[name="brawl-url"]')?.content || location.href.split('#')[0];
const NOW = new Date();

const $ = (id) => document.getElementById(id);
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
};
/** A link from the data, only if it's a web link; anything else (javascript:, data:…) is dropped. */
const safeUrl = (u) => { try { return ['https:', 'http:'].includes(new URL(u).protocol) ? u : null; } catch { return null; } };
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = motionQuery.matches;
motionQuery.addEventListener?.('change', (e) => { reduced = e.matches; });
const byId = new Map(DATA.models.map((m) => [m.id, m]));
const roundById = new Map(DATA.rounds.map((r) => [r.id, r]));
const benchById = new Map(DATA.benchmarks.map((b) => [b.id, b]));
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ---------- fighter looks: each lab its own robot, in colours close to its brand (no logos) ----------
const PALETTE = ['#D4F25C', '#F28DB2', '#7FD3F0', '#F2B544', '#B79CF2', '#2EC4A6', '#FF8A65', '#9BE36D', '#6EA8FF', '#F2E85C'];
const hash = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
/** body: the robot; accent: its trim; ui: a colour that reads well as text on the dark page; outline: for dark bodies. */
const LAB_LOOKS = {
  Anthropic: { kind: 'anthropic', body: '#D97757', accent: '#F0EEE6', ui: '#E8906F' },
  OpenAI: { kind: 'openai', body: '#E9EAEE', accent: '#10A37F', ui: '#4FD8B0' },
  'Google DeepMind': { kind: 'google', body: '#4285F4', accent: '#FBBC05', ui: '#7FA9FF' },
  xAI: { kind: 'xai', body: '#1A1C24', accent: '#F3F4F8', ui: '#E6E7EC', outline: true },
  DeepSeek: { kind: 'deepseek', body: '#4D6BFE', accent: '#BFD0FF', ui: '#8DA0FF' },
  Alibaba: { kind: 'alibaba', body: '#615CED', accent: '#FF6A00', ui: '#A29EFF' },
  Moonshot: { kind: 'moonshot', body: '#1C1E28', accent: '#FFE38A', ui: '#FFE38A', outline: true },
  'Z.ai (Zhipu AI)': { kind: 'zai', body: '#23317A', accent: '#F3F4F8', ui: '#93A4FF', outline: true },
  MiniMax: { kind: 'minimax', body: '#E73562', accent: '#FFC2D3', ui: '#FF7A9C' },
  Nvidia: { kind: 'nvidia', body: '#76B900', accent: '#1A1C24', ui: '#A5DC3C' },
  'Thinking Machines': { kind: 'thinking', body: '#ECE8DE', accent: '#2B2B2B', ui: '#DCD5C4' },
  Meta: { kind: 'meta', body: '#0866FF', accent: '#9EC5FF', ui: '#5E9BFF' },
  'Meta AI': { kind: 'meta', body: '#0866FF', accent: '#9EC5FF', ui: '#5E9BFF' },
  'Mistral AI': { kind: 'mistral', body: '#FA520F', accent: '#FFC24D', ui: '#FF8A50' },
};
/** Big for flagships, small and bouncy for fast models. */
const sizeOf = (m) => (/flash|haiku|mini|nano|luna|lite|small|air\b/i.test(m.name) ? 0.86 : /opus|fable|\bpro\b|max|ultra|astra/i.test(m.name) ? 1.1 : 1);
const mix = (hex, to, k) => { const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16); const c = [16, 8, 0].map((sh) => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k)); return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`; };
/** A fighter's look. `variant` > 0 lightens it, so two models from one lab are told apart. */
function lookOf(m, variant = 0) {
  const base = LAB_LOOKS[m.org] ?? { kind: 'default', body: PALETTE[hash(m.org) % PALETTE.length], accent: '#2b3350', ui: PALETTE[hash(m.org) % PALETTE.length] };
  const k = Math.min(0.6, variant * 0.3);
  return { ...base, size: sizeOf(m), body: variant ? mix(base.body, '#FFFFFF', base.outline ? k * 0.6 : k) : base.body, ui: variant ? mix(base.ui, '#FFFFFF', k) : base.ui };
}
const colorOf = (m) => lookOf(m).ui;
/** Looks for a list of fighters: repeats from the same lab get lighter shades. */
function looksFor(ms) { const seen = {}; return ms.map((m) => lookOf(m, (seen[m.org] = (seen[m.org] ?? -1) + 1))); }
const fightColors = (a, b) => looksFor([a, b]).map((l) => l.ui);

// ---------- sound (synthesized) ----------
let soundOn = true, actx = null, master = null, recDest = null;
try { soundOn = localStorage.getItem('brawl-sound') !== 'off'; } catch { /* default on */ }
function audio() {
  if (!soundOn) return null;
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); }
  if (!master) {
    const comp = actx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 6; comp.connect(actx.destination);
    master = actx.createGain(); master.gain.value = 0.26; master.connect(comp);
    if (recDest) master.connect(recDest);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f, { at = 0, dur = 0.12, type = 'square', vol = 0.5, to = 0 } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise({ at = 0, dur = 0.12, vol = 1, freq = 900, to = 0, type = 'lowpass' } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at, len = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = type; f.frequency.setValueAtTime(freq, t); if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur); g.gain.value = vol;
  src.connect(f).connect(g).connect(master); src.start(t);
}
const sfx = {
  bell: () => { tone(1320, { dur: 0.5, type: 'triangle', vol: 0.4 }); tone(1980, { dur: 0.35, type: 'sine', vol: 0.2 }); },
  tick: () => tone(880, { dur: 0.03, vol: 0.12 }),
  blip: (up) => tone(up ? 660 : 330, { dur: 0.06, vol: 0.25 }),
  ko: () => { noise({ dur: 0.4, vol: 1.4, freq: 500 }); [392, 330, 262, 196].forEach((f, i) => tone(f, { at: 0.15 + i * 0.14, dur: 0.2, vol: 0.4 })); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.11, dur: i === 3 ? 0.4 : 0.12, vol: 0.4 })),
  shot: () => { noise({ dur: 0.07, vol: 1.2, freq: 5000, to: 700 }); tone(150, { to: 55, dur: 0.06, vol: 0.35 }); },
  casing: () => tone(3000 + Math.random() * 900, { at: 0.12, dur: 0.03, type: 'triangle', vol: 0.06 }),
  ricochet: () => tone(2400 + Math.random() * 800, { to: 900, dur: 0.12, type: 'sine', vol: 0.12 }),
  launch: () => { noise({ dur: 0.6, vol: 1, freq: 400, to: 3800, type: 'bandpass' }); tone(80, { to: 220, dur: 0.45, type: 'sawtooth', vol: 0.22 }); },
  boom: (big) => { noise({ dur: big ? 1.3 : 0.75, vol: big ? 2.2 : 1.6, freq: big ? 1000 : 1500, to: 110 }); tone(big ? 68 : 96, { to: 26, dur: big ? 1 : 0.55, type: 'sine', vol: 1 }); },
  whistle: () => tone(1600 + Math.random() * 300, { to: 380, dur: 0.6, type: 'sine', vol: 0.16 }),
  rumble: () => noise({ dur: 1.8, vol: 0.55, freq: 180 }),
  lock: () => { tone(1900, { dur: 0.05, vol: 0.18 }); tone(1900, { at: 0.12, dur: 0.05, vol: 0.18 }); },
  charge: () => { tone(140, { to: 1500, dur: 0.85, type: 'sawtooth', vol: 0.16 }); tone(143, { to: 1530, dur: 0.85, type: 'square', vol: 0.07 }); },
  zap: () => { tone(2400, { to: 80, dur: 0.7, type: 'sawtooth', vol: 0.45 }); noise({ dur: 0.6, vol: 1.3, freq: 7000, to: 300 }); },
  clink: () => tone(2600 + Math.random() * 700, { dur: 0.06, type: 'triangle', vol: 0.22 }),
};
function renderSound() { $('soundBtn').setAttribute('aria-pressed', String(soundOn)); $('soundBtn').textContent = soundOn ? '♪ On' : '♪ Off'; }
$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  if (!soundOn && master) { master.gain.setValueAtTime(0, actx.currentTime); master.disconnect(); master = null; }
  try { localStorage.setItem('brawl-sound', soundOn ? 'on' : 'off'); } catch { /* fine */ }
  renderSound(); $('soundBtn').blur();
});
renderSound();

// ---------- the robot ----------
/*
 * Every lab has its own body; models from the same lab share it. All bodies use the same points so weapons,
 * moves and hits line up: about 170 tall, chest near y = -90, gun grip at (40, -104), raised fist at (24, -176).
 * x is the centre, y the floor, dir 1 faces right. pose: idle | aim | summon | hurt | down | win. gear: { kind, muzzle }.
 * `look` is a colour (the plain robot) or a look from lookOf().
 */
const INK = '#0A0C14', STEEL = '#2b3350', IRON = '#3a3f52';
function drawBot(g, x, y, dir, look, pose, t, flash = 0, gear = null) {
  const L = typeof look === 'string' ? { kind: 'default', body: look, accent: STEEL, size: 1 } : look;
  const K = BODIES[L.kind] ? L.kind : 'default', sz = L.size || 1;
  const B = flash > 0 ? '#ffffff' : L.body, A = L.accent;
  const still = reduced ? 0 : 1;
  g.save();
  g.translate(x, y); g.scale(dir * sz, sz);
  const bob = pose === 'idle' ? Math.sin(t * (sz < 1 ? 7 : 4)) * (sz < 1 ? 3 : 2) * still : 0;
  const recoil = gear?.muzzle > 0 ? -4 : 0;
  const lean = pose === 'aim' ? 4 + recoil : pose === 'hurt' ? -12 : 0;
  if (pose === 'down') { g.rotate(-Math.PI / 2 * 0.92); g.translate(-20, 30); }
  g.translate(lean, bob);
  const P = { g, B, A, L, pose, t: t * still, flash, edge: () => { if (L.outline && !flash) { g.strokeStyle = 'rgba(201,207,220,.75)'; g.lineWidth = 2; g.stroke(); } } };
  const shoulder = BODIES[K](P);
  drawArm(P, shoulder, gear);
  g.restore();
}
const rr = (g, x, y, w, hgt, r, fill) => { g.fillStyle = fill; roundRect(g, x, y, w, hgt, r); g.fill(); };
const dot = (g, x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
const eye = (P, x, y, w = 10, hgt = 6) => { P.g.fillStyle = P.pose === 'hurt' || P.pose === 'down' ? '#FF6B6B' : '#F3F4F8'; P.g.fillRect(x, y, w, hgt); };
const legs = (g, x1, x2, top, w = 14, stride = 0) => { g.fillStyle = STEEL; g.fillRect(x1 - stride, top, w, -top); g.fillRect(x2 + stride, top, w, -top); g.fillStyle = INK; g.fillRect(x1 - stride - 4, -6, w + 6, 6); g.fillRect(x2 + stride - 2, -6, w + 8, 6); };
const striding = (P) => (P.pose === 'aim' || P.pose === 'summon' ? 8 : 0);
function cape(P, color, trim) {
  const { g, t } = P, w = Math.sin(t * 5) * 6;
  g.fillStyle = color; g.beginPath(); g.moveTo(-18, -128); g.lineTo(-62 + w, -26); g.lineTo(-40 + w * 0.5, -32); g.lineTo(-28, -20); g.lineTo(-2, -128); g.closePath(); g.fill();
  if (trim) { g.strokeStyle = trim; g.lineWidth = 1.5; g.stroke(); }
}

/** The front arm and whatever it holds, from the body's shoulder. Same points for every body. */
function drawArm(P, [sx, sy], gear) {
  const { g, B, pose } = P;
  const reach = (hx, hy) => { g.strokeStyle = STEEL; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(hx, hy); g.stroke(); g.lineCap = 'butt'; };
  if (pose === 'aim' && gear?.kind === 'rocket') {
    reach(22, -128);
    rr(g, -40, -158, 124, 26, 6, '#39402f');
    g.fillStyle = B; g.fillRect(-10, -158, 10, 26); g.fillRect(54, -158, 6, 26);
    g.fillStyle = '#1b1f17'; g.beginPath(); g.ellipse(84, -145, 6, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5b6448'; g.fillRect(14, -134, 14, 18);
    if (gear.muzzle > 0) { g.fillStyle = 'rgba(255,200,90,.9)'; g.beginPath(); g.moveTo(-40, -158); g.lineTo(-90, -145); g.lineTo(-40, -132); g.fill(); }
  } else if (pose === 'aim') {
    reach(40, -104);
    rr(g, 30, -118, 62, 20, 4, IRON);
    g.fillStyle = '#262a38'; g.fillRect(92, -113, 40, 8); g.fillRect(48, -100, 12, 18); g.fillRect(18, -114, 14, 10);
    g.fillStyle = B; g.fillRect(60, -118, 22, 4);
    if (gear?.muzzle > 0) {
      g.fillStyle = '#FFE066'; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 9 : 22 + Math.random() * 8; g.lineTo(140 + Math.cos(a) * r, -109 + Math.sin(a) * r * 0.6); }
      g.fill();
    }
  } else if (pose === 'summon' || pose === 'win') {
    reach(24, -168);
    g.fillStyle = B; roundRect(g, 12, -186, 24, 24, 6); g.fill(); P.edge();
    if (pose === 'summon') { g.fillStyle = gear?.kind === 'laser' ? 'rgba(127,211,240,.55)' : 'rgba(255,120,60,.55)'; g.beginPath(); g.arc(24, -176, 16 + Math.sin(P.t * 18) * 5, 0, Math.PI * 2); g.fill(); }
  } else {
    reach(46, -100);
    g.fillStyle = B; roundRect(g, 42, -112, 22, 24, 6); g.fill(); P.edge();
  }
}

/** One body per lab. Each draws itself and returns its shoulder point. */
const BODIES = {
  // The plain robot: labs without their own body.
  default(P) {
    const { g, B } = P, s = striding(P);
    legs(g, -20, 6, -44, 14, s);
    rr(g, -30, -112, 60, 70, 10, B); rr(g, -30, -60, 60, 18, 6, 'rgba(0,0,0,.18)');
    g.fillStyle = INK; g.fillRect(-10, -96, 20, 20); g.fillStyle = B; g.fillRect(-6, -92, 12, 12);
    rr(g, -24, -152, 48, 38, 9, B); rr(g, -16, -142, 38, 12, 5, INK); eye(P, 6, -139);
    g.fillStyle = STEEL; g.fillRect(-3, -162, 6, 10); dot(g, 0, -164, 5, B);
    g.fillStyle = STEEL; g.fillRect(-36, -104, 12, 36); rr(g, -40, -74, 20, 20, 6, B);
    return [16, -104];
  },
  // Anthropic: the thoughtful humanoid, on one wheel, with reading glasses and a scroll.
  anthropic(P) {
    const { g, B, t } = P;
    g.save(); g.translate(-30, -96); g.rotate(-0.45); rr(g, -7, -40, 14, 62, 3, '#F0EEE6'); g.fillStyle = '#B9A88A'; g.fillRect(-9, -43, 18, 6); g.fillRect(-9, 19, 18, 6); g.restore();
    g.fillStyle = STEEL; g.fillRect(-5, -50, 10, 22);
    dot(g, 0, -22, 21, INK); dot(g, 0, -22, 12, IRON);
    g.strokeStyle = '#59607a'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { const a = t * 6 + (i * Math.PI * 2) / 3; g.beginPath(); g.moveTo(0, -22); g.lineTo(Math.cos(a) * 18, -22 + Math.sin(a) * 18); g.stroke(); }
    rr(g, -30, -112, 60, 64, 12, B); rr(g, -30, -64, 60, 16, 8, 'rgba(0,0,0,.16)');
    g.fillStyle = INK; g.fillRect(-10, -96, 20, 20); g.fillStyle = B; g.fillRect(-6, -92, 12, 12);
    rr(g, -24, -152, 48, 38, 10, B); rr(g, -16, -142, 38, 12, 5, INK); eye(P, 6, -139);
    g.strokeStyle = STEEL; g.lineWidth = 2.5; g.beginPath(); g.arc(1, -136, 7.5, 0, Math.PI * 2); g.moveTo(25.5, -136); g.arc(18, -136, 7.5, 0, Math.PI * 2); g.moveTo(8.5, -136); g.lineTo(10.5, -136); g.stroke();
    g.fillStyle = STEEL; g.fillRect(-3, -162, 6, 10); dot(g, 0, -164, 5, '#F0EEE6');
    g.fillStyle = STEEL; g.fillRect(-36, -104, 12, 34); rr(g, -40, -76, 20, 20, 6, B);
    return [16, -104];
  },
  // OpenAI: a sleek capsule that hovers, no legs.
  openai(P) {
    const { g, B, A, t, flash } = P, hover = Math.sin(t * 3) * 4;
    g.fillStyle = 'rgba(16,163,127,.28)'; g.beginPath(); g.ellipse(0, -6, 26 + hover, 7, 0, 0, Math.PI * 2); g.fill();
    g.translate(0, hover - 6);
    rr(g, -28, -164, 56, 146, 28, B); rr(g, -28, -48, 56, 30, 15, 'rgba(0,0,0,.08)');
    rr(g, -12, -24, 24, 6, 3, '#cfd3dc');
    g.save(); g.shadowColor = A; g.shadowBlur = 10; g.fillStyle = flash ? '#fff' : A; g.fillRect(-12, -134, 34, 4); g.restore();
    dot(g, 0, -88, 5, flash ? B : A);
    return [14, -100];
  },
  // Google: twin bots, fighting side by side.
  google(P) {
    const { g, B } = P, s = striding(P);
    const twin = (tx, ty, sc, body, antenna) => {
      g.save(); g.translate(tx, ty); g.scale(sc, sc);
      legs(g, -14, 2, -34, 11, s / 2);
      dot(g, 0, -64, 31, body);
      for (const [i, c] of ['#EA4335', '#FBBC05', '#34A853'].entries()) { g.fillStyle = c; g.fillRect(-20 + i * 14, -46, 11, 4); }
      dot(g, 0, -112, 20, body); rr(g, -10, -118, 26, 10, 4, INK); eye(P, 6, -116, 8, 5);
      g.fillStyle = STEEL; g.fillRect(-2, -138, 4, 8); dot(g, 0, -140, 4.5, antenna);
      g.restore();
    };
    twin(-30, -2, 0.78, P.flash ? B : mix(B, '#000000', 0.25), '#34A853');
    twin(8, 0, 1, B, '#EA4335');
    return [26, -78];
  },
  // xAI: a rocket on mech legs, shades and a cape.
  xai(P) {
    const { g, B } = P, s = striding(P);
    cape(P, IRON, '#F3F4F8');
    g.strokeStyle = IRON; g.lineWidth = 10; g.lineJoin = 'round';
    for (const lx of [-12 - s, 10 + s]) { g.beginPath(); g.moveTo(lx, -52); g.lineTo(lx + 10, -28); g.lineTo(lx - 2, -4); g.stroke(); }
    g.fillStyle = INK; g.fillRect(-20 - s, -6, 18, 6); g.fillRect(4 + s, -6, 18, 6);
    g.fillStyle = IRON; for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * 22, -72); g.lineTo(sx * 38, -46); g.lineTo(sx * 22, -52); g.fill(); }
    rr(g, -22, -150, 44, 102, 12, B); P.edge();
    g.fillStyle = B; g.beginPath(); g.moveTo(-22, -146); g.quadraticCurveTo(-18, -178, 0, -192); g.quadraticCurveTo(18, -178, 22, -146); g.closePath(); g.fill(); P.edge();
    dot(g, 6, -122, 13, '#F3F4F8'); dot(g, 6, -122, 10, INK);
    g.fillStyle = '#05060a'; g.fillRect(-6, -128, 26, 9); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(-2, -127, 5, 2); g.fillRect(10, -127, 5, 2);
    if (!P.flash) { g.fillStyle = 'rgba(255,169,77,.8)'; g.beginPath(); g.moveTo(-10, -48); g.lineTo(0, -38 - Math.random() * 8); g.lineTo(10, -48); g.fill(); }
    return [14, -100];
  },
  // DeepSeek: a whale with robot legs, spouting.
  deepseek(P) {
    const { g, B, A, t } = P, s = striding(P);
    legs(g, -20, 6, -46, 13, s);
    g.fillStyle = B; g.beginPath(); g.moveTo(-40, -86); g.lineTo(-76, -122); g.lineTo(-62, -88); g.lineTo(-76, -58); g.closePath(); g.fill();
    g.fillStyle = B; g.beginPath(); g.ellipse(0, -84, 48, 38, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.flash ? B : A; g.beginPath(); g.ellipse(4, -64, 38, 16, 0, 0, Math.PI); g.fill();
    g.strokeStyle = 'rgba(10,12,20,.25)'; g.lineWidth = 2; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-18 + i * 12, -60); g.lineTo(-14 + i * 12, -50); g.stroke(); }
    dot(g, 26, -94, 7, '#F3F4F8'); dot(g, 28, -94, 3.5, P.pose === 'hurt' || P.pose === 'down' ? '#FF6B6B' : INK);
    g.strokeStyle = INK; g.lineWidth = 2.5; g.beginPath(); g.arc(30, -82, 9, 0.2, 1.2); g.stroke();
    g.fillStyle = '#9FD8FF'; for (let i = 0; i < 4; i++) { const p = (t * 1.5 + i / 4) % 1; g.globalAlpha = 1 - p; dot(g, 4 + Math.sin(i * 2) * 10 * p, -124 - p * 34, 4 - p * 2, '#9FD8FF'); } g.globalAlpha = 1;
    return [16, -92];
  },
  // Alibaba (Qwen): a walking stack of delivery boxes.
  alibaba(P) {
    const { g, B, A } = P, s = striding(P), card = P.flash ? '#fff' : '#C99A5B', side = P.flash ? '#fff' : '#a87c45';
    legs(g, -18, 6, -26, 11, s);
    const box = (bx, by, w, hgt, rot, tape) => {
      g.save(); g.translate(bx, by); g.rotate(rot);
      rr(g, -w / 2, -hgt, w, hgt, 3, card); g.fillStyle = side; g.fillRect(-w / 2, -hgt, w, 5);
      g.fillStyle = tape; g.fillRect(-5, -hgt, 10, hgt); g.restore();
    };
    box(0, -24, 62, 46, 0, B); box(2, -70, 54, 40, -0.04, A); box(-1, -110, 46, 34, 0.05, B);
    g.fillStyle = '#F3F4F8'; g.fillRect(-14, -100, 28, 9); g.fillStyle = INK; g.font = '700 7px sans-serif'; g.textAlign = 'center'; g.fillText('FRAGILE', 0, -93);
    rr(g, -16, -138, 34, 11, 4, INK); eye(P, 6, -135, 9, 5);
    return [20, -92];
  },
  // Moonshot (Kimi): a lunar rover, with a crescent moon on its mast.
  moonshot(P) {
    const { g, B, A, t } = P;
    for (const wx of [-26, 26]) { dot(g, wx, -16, 16, INK); dot(g, wx, -16, 8, IRON); g.strokeStyle = '#59607a'; g.lineWidth = 2.5; for (let i = 0; i < 4; i++) { const a = t * 5 + (i * Math.PI) / 2; g.beginPath(); g.moveTo(wx, -16); g.lineTo(wx + Math.cos(a) * 14, -16 + Math.sin(a) * 14); g.stroke(); } }
    rr(g, -44, -46, 88, 22, 6, B); P.edge();
    g.save(); g.translate(-18, -58); g.rotate(-0.12); rr(g, -26, -6, 52, 12, 2, '#2c3e7a'); g.strokeStyle = '#6EA8FF'; g.lineWidth = 1; for (let i = -18; i <= 18; i += 9) { g.beginPath(); g.moveTo(i, -6); g.lineTo(i, 6); g.stroke(); } g.restore();
    g.fillStyle = IRON; g.fillRect(6, -132, 9, 88);
    rr(g, -10, -156, 46, 26, 6, B); P.edge(); dot(g, 26, -143, 8, INK); dot(g, 26, -143, 4.5, A); eye(P, -2, -146, 10, 5);
    g.fillStyle = STEEL; g.fillRect(10, -168, 4, 12); g.fillStyle = A; g.beginPath(); g.arc(12, -174, 8, -Math.PI / 2, Math.PI / 2); g.arc(8, -174, 7, Math.PI / 2, -Math.PI / 2, true); g.fill();
    return [12, -100];
  },
  // Z.ai: a masked egg on a pogo spring, Zorro hat and cape.
  zai(P) {
    const { g, B, t } = P, boing = Math.sin(t * 6) * 4;
    cape(P, '#0d0f16');
    g.strokeStyle = '#9aa3b8'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -4); for (let i = 1; i <= 8; i++) g.lineTo(i % 2 ? 10 : -10, -4 - i * (5.5 + boing / 8)); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.ellipse(0, -3, 16, 4, 0, 0, Math.PI * 2); g.fill();
    g.translate(0, boing);
    g.fillStyle = B; g.beginPath(); g.ellipse(0, -96, 31, 44, 0, 0, Math.PI * 2); g.fill(); P.edge();
    g.fillStyle = '#05060a'; g.fillRect(-31, -126, 62, 15); g.beginPath(); g.moveTo(-30, -124); g.lineTo(-44, -132); g.lineTo(-42, -116); g.lineTo(-30, -113); g.fill();
    eye(P, 8, -122, 11, 6);
    g.fillStyle = '#05060a'; g.beginPath(); g.ellipse(0, -140, 38, 6, 0, 0, Math.PI * 2); g.fill(); rr(g, -17, -164, 34, 24, 7, '#05060a');
    g.fillStyle = '#C0392B'; g.fillRect(-17, -148, 34, 4);
    return [16, -98];
  },
  // MiniMax: a giant head on tiny legs.
  minimax(P) {
    const { g, B, A } = P, s = striding(P);
    legs(g, -13, 3, -28, 9, s / 2);
    dot(g, 0, -92, 60, B);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.ellipse(0, -52, 46, 14, 0, 0, Math.PI); g.fill();
    rr(g, -30, -112, 66, 22, 9, INK); eye(P, 12, -106, 14, 9); eye(P, -14, -106, 10, 9);
    dot(g, -22, -78, 7, P.flash ? B : A); dot(g, 30, -78, 7, P.flash ? B : A);
    g.fillStyle = STEEL; g.fillRect(-3, -160, 6, 10); dot(g, 0, -162, 6, A);
    return [30, -86];
  },
  // Nvidia: a walking graphics card, fans spinning, gold-pin legs.
  nvidia(P) {
    const { g, B, t } = P, s = striding(P), gold = '#C9A227';
    g.fillStyle = gold; g.fillRect(-20 - s, -42, 12, 42); g.fillRect(8 + s, -42, 12, 42);
    g.fillStyle = '#8a6d14'; for (let i = 0; i < 5; i++) { g.fillRect(-19 - s, -38 + i * 7, 10, 2); g.fillRect(9 + s, -38 + i * 7, 10, 2); }
    g.fillStyle = INK; g.fillRect(-24 - s, -6, 20, 6); g.fillRect(4 + s, -6, 20, 6);
    rr(g, -34, -156, 68, 116, 8, '#1b1f2b');
    g.fillStyle = B; g.fillRect(-34, -156, 68, 6); g.fillRect(-34, -46, 68, 6); g.fillRect(28, -150, 6, 104);
    for (const fy of [-122, -76]) {
      dot(g, -2, fy, 22, INK); dot(g, -2, fy, 6, IRON);
      g.strokeStyle = P.flash ? '#fff' : B; g.lineWidth = 4;
      for (let i = 0; i < 5; i++) { const a = t * 14 + (i * Math.PI * 2) / 5; g.beginPath(); g.moveTo(-2, fy); g.lineTo(-2 + Math.cos(a) * 19, fy + Math.sin(a) * 19); g.stroke(); }
    }
    g.fillStyle = '#F3F4F8'; g.fillRect(8, -152, 14, 3);
    return [26, -100];
  },
  // Thinking Machines: a brain in a jar, on a tripod.
  thinking(P) {
    const { g, B, t } = P;
    g.strokeStyle = IRON; g.lineWidth = 6; g.lineCap = 'round';
    for (const [x1, x2] of [[-6, -28], [0, 2], [6, 28]]) { g.beginPath(); g.moveTo(x1, -48); g.lineTo(x2, -2); g.stroke(); }
    g.lineCap = 'butt';
    rr(g, -32, -56, 64, 10, 4, IRON);
    rr(g, -28, -150, 56, 96, 14, 'rgba(160,200,235,.16)'); g.strokeStyle = 'rgba(230,240,255,.75)'; g.lineWidth = 2; roundRect(g, -28, -150, 56, 96, 14); g.stroke();
    rr(g, -26, -92, 52, 36, 10, 'rgba(110,200,180,.22)');
    const brain = P.flash ? '#ffffff' : '#F28DB2';
    for (const [bx, by, r] of [[-10, -108, 14], [8, -110, 15], [-2, -120, 14], [12, -96, 11], [-12, -96, 11]]) dot(g, bx, by, r, brain);
    g.strokeStyle = '#c96a92'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-2, -132); g.quadraticCurveTo(-6, -110, 0, -86); g.moveTo(-18, -108); g.quadraticCurveTo(-10, -102, -16, -94); g.moveTo(16, -112); g.quadraticCurveTo(8, -104, 18, -98); g.stroke();
    eye(P, 6, -108, 6, 4); eye(P, -6, -108, 6, 4);
    g.fillStyle = 'rgba(230,240,255,.6)'; for (let i = 0; i < 3; i++) { const p = (t * 0.6 + i / 3) % 1; dot(g, -16 + i * 14, -60 - p * 80, 2.5, 'rgba(230,240,255,.6)'); }
    rr(g, -32, -160, 64, 12, 5, B);
    return [24, -100];
  },
  // Meta: a four-legged llama mech.
  meta(P) {
    const { g, B, A } = P, s = striding(P) / 2;
    g.fillStyle = STEEL; for (const lx of [-38 - s, -24 + s, 12 - s, 26 + s]) g.fillRect(lx, -50, 9, 50);
    g.fillStyle = INK; for (const lx of [-38 - s, -24 + s, 12 - s, 26 + s]) g.fillRect(lx - 2, -6, 13, 6);
    rr(g, -46, -94, 86, 46, 20, B);
    g.fillStyle = P.flash ? B : A; for (const [wx, wy] of [[-30, -92], [-12, -96], [6, -94], [-22, -80], [-2, -82]]) dot(g, wx, wy, 8, P.flash ? B : A);
    g.fillStyle = B; g.fillRect(-52, -88, 10, 12);
    rr(g, 16, -146, 18, 60, 8, B);
    rr(g, 12, -166, 40, 26, 11, B); rr(g, 40, -156, 16, 14, 6, B); dot(g, 54, -150, 2, INK);
    eye(P, 30, -160, 8, 5);
    rr(g, 14, -190, 8, 28, 4, B); rr(g, 26, -190, 8, 28, 4, B); g.fillStyle = P.flash ? B : A; g.fillRect(16, -184, 3, 16); g.fillRect(28, -184, 3, 16);
    return [24, -96];
  },
  // Mistral: a swirling wind cloud with a scarf.
  mistral(P) {
    const { g, B, A, t } = P, drift = Math.sin(t * 2.5) * 4;
    g.translate(0, drift);
    g.strokeStyle = 'rgba(190,225,255,.5)'; g.lineWidth = 3;
    for (let i = 0; i < 4; i++) { const y0 = -60 + i * 12, w0 = 28 - i * 6; g.beginPath(); g.ellipse(Math.sin(t * 4 + i) * 4, y0, w0, 5, 0, 0, Math.PI * 2); g.stroke(); }
    for (const [cx, cy, r] of [[-18, -108, 26], [14, -116, 30], [0, -90, 30], [24, -92, 20], [-26, -88, 18]]) dot(g, cx, cy, r, B);
    rr(g, -10, -122, 34, 12, 5, INK); eye(P, 10, -119, 9, 6);
    const w = Math.sin(t * 6) * 5;
    g.fillStyle = A; g.fillRect(-24, -76, 48, 8); g.beginPath(); g.moveTo(-22, -76); g.quadraticCurveTo(-46, -78 + w, -66, -64 - w); g.lineTo(-62, -58 - w); g.quadraticCurveTo(-42, -68 + w, -22, -68); g.fill();
    return [20, -96];
  },
};
function roundRect(g, x, y, w, hgt, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hgt, r); g.arcTo(x + w, y + hgt, x, y + hgt, r); g.arcTo(x, y + hgt, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ---------- state ----------
let rounds = [...DATA.defaultRounds];
let classId = 'all', query = '', sortBy = 'eci';
let picks = [], cursor = 0;
let mode = '1v1'; // or 'royale': 3 to 8 fighters at once
let F = null; // the fight being shown
let bracket = null, fromBracket = false, wantTourney = false;

// ---------- header, credits ----------
$('updated').textContent = `Scores updated ${fmtDate(DATA.generatedAt.slice(0, 10))}`;
$('credits').replaceChildren(
  'Scores: Epoch AI, ', h('a', { href: 'https://epoch.ai/benchmarks', target: '_blank', rel: 'noopener' }, '“Capabilities & benchmarking”'), ', licensed ',
  h('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener' }, 'CC BY 4.0'),
  '; changes: scores shown as percentages, each model’s best reasoning setting, coding averaged over shared benchmarks. Includes ',
  h('a', { href: 'https://deepswe.datacurve.ai/', target: '_blank', rel: 'noopener' }, 'DeepSWE'), ' (Datacurve) and ' , h('a', { href: 'https://htihle.github.io/weirdml.html', target: '_blank', rel: 'noopener' }, 'WeirdML'), ' (Håvard Tveit Ihle) as republished by Epoch AI. Prices: each lab’s own API list price via ',
  h('a', { href: 'https://models.dev', target: '_blank', rel: 'noopener' }, 'models.dev'), ' (MIT). Benchmark Brawl is independent and not affiliated with any AI lab or with these sources. ',
  h('a', { href: 'https://github.com/w20labs/benchmark-brawl', target: '_blank', rel: 'noopener' }, 'Source code'), '.');

// ---------- arena builder ----------
function renderBuilder() {
  const same = (p) => p.rounds.length === rounds.length && p.rounds.every((r, i) => r === rounds[i]);
  $('presets').replaceChildren(h('span', { class: 'fine' }, 'Presets:'), ...PRESETS.map((p) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(same(p)), onclick: () => { rounds = [...p.rounds]; renderAll(); sfx.blip(true); } }, p.name)));
  $('roundChips').replaceChildren(h('span', { class: 'fine' }, 'Rounds:'), ...DATA.rounds.map((r) => {
    const on = rounds.includes(r.id);
    return h('button', { type: 'button', class: 'chip round', 'aria-pressed': String(on), title: r.benches.map((b) => benchById.get(b).name).join(', then '),
      onclick: () => {
        if (on && rounds.length <= MIN_ROUNDS) return toast(`An arena needs at least ${MIN_ROUNDS} rounds`);
        if (!on && rounds.length >= MAX_ROUNDS) return toast(`At most ${MAX_ROUNDS} rounds`);
        rounds = on ? rounds.filter((x) => x !== r.id) : [...rounds, r.id];
        renderAll(); sfx.blip(!on);
      } }, `${on ? rounds.indexOf(r.id) + 1 + ' · ' : ''}${r.name}`);
  }));
  const preset = PRESETS.find(same);
  $('builderSummary').textContent = `Rounds: ${preset ? preset.name : 'Custom'} · ${rounds.map((id) => roundById.get(id).name).join(', ')}`;
  $('roundHelp').textContent = rounds.map((id) => { const r = roundById.get(id); return `${r.name}: ${r.benches.map((b) => benchById.get(b).name).join(' → ')}`; }).join(' · ');
}

// ---------- roster ----------
function visibleModels() {
  const q = query.trim().toLowerCase();
  const list = DATA.models.filter((m) => inClass(m, classId) && (!q || `${m.name} ${m.org}`.toLowerCase().includes(q)));
  if (sortBy === 'new') list.sort((a, b) => b.released.localeCompare(a.released));
  else if (sortBy === 'cheap') list.sort((a, b) => (a.price?.blended ?? 1e9) - (b.price?.blended ?? 1e9));
  return list;
}
const fresh = new Set(newChallengers(DATA.models, NOW).map((m) => m.id));
/** One "power" bar per card: the Epoch Capabilities Index, scaled across the roster. */
const ECIS = DATA.models.map((m) => m.eci).filter((x) => x != null);
const ECI_LO = Math.min(...ECIS), ECI_HI = Math.max(...ECIS);
const powerOf = (m) => (m.eci == null ? 0 : 8 + (92 * (m.eci - ECI_LO)) / Math.max(1, ECI_HI - ECI_LO));
const botCanvas = (m, w, hgt, pose) => { const c = h('canvas', { width: w * 2, height: hgt * 2, 'aria-hidden': 'true' }); const g2 = c.getContext('2d'); g2.scale(w / 110, w / 110); drawBot(g2, 100, 236, 1, lookOf(m), pose, 0); return c; };
function renderClassChips() {
  $('classChips').replaceChildren(h('span', { class: 'fine' }, 'Weight class:'), ...CLASSES.map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(c.id === classId), onclick: () => { classId = c.id; renderAll(); } },
    `${c.name} (${DATA.models.filter((m) => inClass(m, c.id)).length})`)));
}
function renderRoster() {
  const list = visibleModels();
  cursor = Math.min(cursor, Math.max(0, list.length - 1));
  $('rosterEmpty').hidden = list.length > 0;
  $('roster').replaceChildren(...list.map((m, i) => {
    const slot = picks.indexOf(m.id), c = colorOf(m);
    const card = h('button', { type: 'button', class: `fighter ${i === cursor ? 'cursor' : ''}`, style: `--c:${c}`, 'data-id': m.id, 'data-slot': slot >= 0 ? `P${slot + 1}` : null, 'aria-pressed': String(slot >= 0), onclick: () => { cursor = i; pick(m.id); } },
      h('div', { class: 'top' }, botCanvas(m, 54, 64, slot >= 0 ? 'win' : 'idle'), h('div', null, h('div', { class: 'nm' }, m.name), h('div', { class: 'meta' }, m.org))),
      h('div', { class: 'power', title: 'Epoch Capabilities Index' }, h('i', null, h('b', { style: `width:${powerOf(m)}%` })), m.eci != null ? `ECI ${m.eci.toFixed(0)}` : 'ECI –'),
      h('div', { class: 'badges' }, fresh.has(m.id) ? h('span', { class: 'badge new' }, 'NEW') : null, m.open ? h('span', { class: 'badge open' }, 'OPEN') : null,
        m.price ? h('span', { class: 'badge' }, `$${m.price.blended.toFixed(2)}/M`) : null));
    return card;
  }));
  renderSlots();
  const [a, b] = picks.map((id) => byId.get(id));
  const nm = (m) => h('b', { style: `color:${colorOf(m)}` }, m.name);
  if (mode === 'royale') {
    const ms = picks.map((id) => byId.get(id));
    $('vsLine').replaceChildren(...(ms.length ? [`👑 ${ms.length}/${ROYALE_MAX}: `, ...ms.flatMap((m, i) => [i ? ' · ' : '', nm(m)])] : [`👑 Pick ${ROYALE_MIN} to ${ROYALE_MAX} fighters`]),
      ms.length && ms.length < ROYALE_MIN ? ` · ${ROYALE_MIN - ms.length} more` : '');
    $('fight').disabled = picks.length < ROYALE_MIN;
  } else {
    $('vsLine').replaceChildren(...(a && b ? [nm(a), ' VS ', nm(b)] : a ? [nm(a), ' VS ? · pick player 2'] : ['Pick player 1']));
    $('fight').disabled = picks.length < 2;
  }
}
/** The picked fighters, shown big above the roster. */
function renderSlots() {
  const slot = (m, label) => h('div', { class: `slot ${m ? 'on' : ''}`, style: m ? `--c:${colorOf(m)}` : null },
    m ? botCanvas(m, 66, 78, 'win') : null,
    h('div', { style: 'min-width:0' }, h('div', { class: 'tag' }, label), h('div', { class: 'nm' }, m ? m.name : 'Pick a fighter'), m ? h('div', { class: 'meta' }, `${m.org} · ECI ${m.eci != null ? m.eci.toFixed(0) : '–'}${m.price ? ` · $${m.price.blended.toFixed(2)}/M` : ''}`) : null));
  const ms = picks.map((id) => byId.get(id));
  $('slots').className = `slots ${mode === 'royale' ? 'royale' : ''}`;
  $('slots').replaceChildren(...(mode === 'royale'
    ? (ms.length ? ms.map((m, i) => slot(m, `#${i + 1}`)) : [slot(null, `Pick ${ROYALE_MIN}–${ROYALE_MAX}`)])
    : [slot(ms[0], 'PLAYER 1'), h('span', { class: 'vs' }, 'VS'), slot(ms[1], 'PLAYER 2')]));
}
function pick(id) {
  if (picks.includes(id)) picks = picks.filter((p) => p !== id);
  else if (mode === 'royale') { if (picks.length >= ROYALE_MAX) return toast(`A royale has at most ${ROYALE_MAX} fighters`); picks = [...picks, id]; }
  else picks = picks.length >= 2 ? [picks[0], id] : [...picks, id];
  sfx.blip(picks.includes(id));
  renderRoster();
  writeHash();
}
$('search').addEventListener('input', (e) => { query = e.target.value; cursor = 0; renderRoster(); });
$('sort').addEventListener('change', (e) => { sortBy = e.target.value; renderRoster(); });
addEventListener('keydown', (e) => {
  if (!['play', 'royale'].includes(document.body.dataset.view) || e.target.closest?.('input, select, textarea')) return;
  if (e.target.closest?.('button, a') && !e.target.closest('.fighter')) return;
  const list = visibleModels(), n = list.length;
  if (!n) return;
  const focused = e.target.closest?.('.fighter');
  if (focused) cursor = Math.max(0, list.findIndex((m) => m.id === focused.dataset.id));
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') cursor = (cursor + 1) % n;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') cursor = (cursor + n - 1) % n;
  else if ((e.key === 'Enter' || e.key === ' ') && mode === '1v1' && picks.length === 2 && picks.includes(list[cursor].id)) { e.preventDefault(); return startFight(); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return pick(list[cursor].id); }
  else return;
  e.preventDefault(); renderRoster();
  document.querySelectorAll('.fighter')[cursor]?.focus({ preventScroll: false });
});
function renderMode() {
  $('selectTitle').textContent = mode === 'royale' ? `Choose ${ROYALE_MIN} to ${ROYALE_MAX} fighters` : 'Choose two fighters';
  $('modeChips').replaceChildren(...[
    mode === 'royale' ? h('button', { type: 'button', class: 'btn small', id: 'fillTop', title: 'The 8 most capable in this weight class, by Epoch Capabilities Index',
      onclick: () => { picks = DATA.models.filter((m) => inClass(m, classId)).sort((a, b) => (b.eci ?? -1) - (a.eci ?? -1)).slice(0, ROYALE_MAX).map((m) => m.id); renderAll(); sfx.blip(true); } }, 'Fill with the top 8') : null].filter(Boolean)); // replaceChildren would print null
}
function renderAll() { renderBuilder(); renderMode(); renderClassChips(); renderRoster(); if (tab === 'play' || tab === 'royale') writeHash(); }

// ---------- links: #a=<id>&b=<id>&r=coding,math ----------
function royaleHash(ids, rs) { return `#m=royale&f=${ids.map(encodeURIComponent).join(',')}&r=${rs.join(',')}`; }
function hashFor(a, b, rs) { return `#a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&r=${rs.join(',')}`; }
const classPart = () => (classId === 'all' ? '' : `&c=${classId}`);
function writeHash() { const h2 = mode === 'royale' ? royaleHash(picks, rounds) + classPart() : picks.length === 2 ? hashFor(picks[0], picks[1], rounds) + classPart() : `#r=${rounds.join(',')}${classPart()}`; history.replaceState(null, '', h2); }
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const rs = [...new Set((p.get('r') || '').split(',').filter((r) => roundById.has(r)))];
  if (rs.length >= MIN_ROUNDS) rounds = rs.slice(0, MAX_ROUNDS);
  const c = p.get('c');
  if (c && CLASSES.some((x) => x.id === c)) classId = c;
  if (p.get('t') === '1') wantTourney = true;
  if (p.get('m') === 'royale') {
    mode = 'royale';
    picks = [...new Set((p.get('f') || '').split(',').filter((id) => byId.has(id)))].slice(0, ROYALE_MAX);
    return picks.length >= ROYALE_MIN;
  }
  const a = p.get('a'), b = p.get('b');
  if (a && b && byId.has(a) && byId.has(b) && a !== b) { picks = [a, b]; return true; }
  return false;
}

// ---------- the fight ----------
const cv = $('cv'), g = cv.getContext('2d');
const W = 960, H = 440, FLOOR = 380;
let raf = 0, last = 0;
const PHASES = [['banner', 1.2], ['reveal', 1.2], ['attack', 1.1], ['after', 0.8]];
const NO_DATA_PHASES = [['banner', 1.0], ['after', 0.9]];

function startFight(opts = {}) {
  const [a, b] = picks.map((id) => byId.get(id));
  if (!a || !b) return;
  const plan = planFight(DATA, a, b, opts.rounds || rounds);
  if (!plan.rounds.length) return toast(`${a.name} and ${b.name} have no benchmark in common in these rounds. Try other rounds.`);
  F = { roundIds: opts.rounds || rounds, arena: opts.daily ? arenaFor(`daily|${opts.daily.no}`) : arenaFor(`${a.id}|${b.id}`), daily: opts.daily || null, replay: !!opts.replay, plan, colors: fightColors(a, b), looks: looksFor([a, b]), i: 0, phase: 0, t: 0, x: [300, 660], pose: ['idle', 'idle'], flash: [0, 0], shake: 0, white: 0, sparks: [], floats: [], booms: [], fx: null, hp: [100, 100], over: false, recording: !!opts.recording, onDone: opts.onDone || null, special: reduced ? [-1, -1] : bigHits(plan) };
  setView('arena');
  $('arena').classList.remove('royale');
  $('arenaNote').textContent = 'Damage = 2 × score gap · bigger gap, bigger weapon · a tie grazes both for 3 HP';
  $('rec').hidden = !F.recording;
  $('arena').classList.toggle('recording', F.recording);
  for (const k of [0, 1]) {
    $(`s${k + 1}`).style.setProperty('--c', F.colors[k]);
    $(`n${k + 1}`).textContent = plan.fighters[k].name;
    $(`rs${k + 1}`).style.setProperty('--c', F.colors[k]);
    $(`sl${k + 1}`).textContent = plan.fighters[k].name;
  }
  $('pips').replaceChildren(...plan.rounds.map(() => h('span')));
  setHp(true);
  if (F.daily) history.replaceState(null, '', `#today=${F.daily.no}`); else writeHashFight();
  if (!F.recording) track(F.daily ? `today/${F.daily.no}` : `fight/${a.id}-vs-${b.id}`);
  $('arena').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  enterPhase();
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function writeHashFight() { history.replaceState(null, '', hashFor(F.plan.fighters[0].id, F.plan.fighters[1].id, rounds)); }
$('quit').addEventListener('click', () => { cancelAnimationFrame(raf); if (F) F.done = true; openTab(tab); });
const phasesOf = (R) => (R.winner == null ? NO_DATA_PHASES : PHASES);
function setHp(instant) {
  for (const k of [0, 1]) {
    const w = `${F.hp[k]}%`;
    for (const id of [`h${k + 1}`, `hl${k + 1}`]) { const el = $(id); if (instant) { el.style.transition = 'none'; el.style.width = w; void el.offsetWidth; el.style.transition = ''; } else el.style.width = w; }
    $(`hn${k + 1}`).textContent = `${F.hp[k]} HP`;
  }
}
function banner(big, sub, cls = '') {
  if (F) F.bannerText = big ? { big, sub, ko: cls === 'ko' } : null; // recorded clips draw it into the canvas
  const b = $('banner'); b.className = `banner ${cls}`;
  b.replaceChildren(...[big && h('div', { class: 'big' }, big), sub && h('div', { class: 'sub' }, sub)].filter(Boolean)); // replaceChildren would print null
}
function benchLine(R) {
  if (!R.bench) return 'No benchmark in common: round skipped';
  return `${R.bench.name}: ${R.bench.what}`;
}
function roundBar(R, shown, result) {
  $('rname').textContent = `ROUND ${F.i + 1}: ${R.round.name.toUpperCase()}`;
  $('rtest').textContent = benchLine(R);
  for (const k of [0, 1]) {
    $(`sc${k + 1}`).textContent = shown ? shown[k] : '–';
    $(`rs${k + 1}`).classList.toggle('won', !!result && R.winner === k);
  }
  $('rres').textContent = result || '';
}
/** "−3 HP each", or each side's number when one fighter is down to its last HP. */
const grazeText = (R) => (R.graze[0] === R.graze[1] ? `−${R.graze[0]} HP each` : `−${R.graze[0]} / −${R.graze[1]} HP`);
/** "by K.O.", "by unanimous decision" or "by split decision". */
const decisionText = (p) => (p.ko ? 'by K.O.' : p.decision === 'unanimous' ? 'by unanimous decision' : p.decision === 'split' ? 'by split decision' : '');
function resultLine(R) {
  const [a, b] = F.plan.fighters;
  if (R.winner == null) return 'No shared benchmark for this round. No damage.';
  if (R.winner === -1) {
    const why = R.tie === 'margin' ? `Within the margin of error (±${R.margin})` : R.tie === 'price' ? 'Prices within 15% of each other' : 'Dead even';
    const [x, y] = R.tieStyles.map((st) => STYLE_NAMES[st].toLowerCase());
    return `${why}. ${x[0].toUpperCase()}${x.slice(1)} vs ${y}: both grazed, ${grazeText(R)}.`;
  }
  const w = R.winner === 0 ? a : b;
  const by = R.bench.kind === 'price' ? `${(Math.max(...R.values) / Math.min(...R.values)).toFixed(1)}× cheaper` : `by ${R.points} point${R.points === 1 ? '' : 's'}`;
  return `${F.special?.[R.winner] === F.plan.rounds.indexOf(R) ? moveNameFor(w.org) : (STYLE_NAMES[R.style] || weaponName(R.weapon))}! ${w.name} ${by}${R.bench.kind === 'score' && R.margin == null ? ' (no margin published)' : ''} → −${R.dmg} HP`;
}
function enterPhase() {
  const R = F.plan.rounds[F.i];
  const name = phasesOf(R)[F.phase][0];
  F.t = 0;
  if (name === 'banner') {
    $('roundNo').textContent = `ROUND ${F.i + 1}/${F.plan.rounds.length}`;
    banner(`ROUND ${F.i + 1}`, R.round.name);
    roundBar(R, null, R.winner == null ? resultLine(R) : '');
    F.pose = ['idle', 'idle'];
    sfx.bell();
  } else if (name === 'reveal') banner('', '');
  else if (name === 'attack') { F.fx = startFx(R); roundBar(R, R.values.map((v) => formatValue(R.bench, v)), resultLine(R)); }
  else if (name === 'after') {
    banner('', '');
    const pip = $('pips').children[F.i];
    if (R.winner === 0 || R.winner === 1) { pip.style.background = F.colors[R.winner]; pip.style.borderColor = F.colors[R.winner]; }
    else pip.style.borderColor = R.winner == null ? '#3a4364' : '#F3F4F8';
  }
}
function nextPhase() {
  F.phase++;
  if (F.phase >= phasesOf(F.plan.rounds[F.i]).length) {
    F.phase = 0; F.i++;
    if (F.i >= F.plan.rounds.length) return finish();
  }
  enterPhase();
}
function finish() {
  F.over = true; F.t = 0; F.fx = null;
  const p = F.plan, w = p.winner;
  F.hp = [...p.hp]; setHp(false);
  if (w >= 0) { F.pose[w] = 'win'; F.pose[1 - w] = p.ko ? 'down' : 'hurt'; }
  if (p.ko) { banner('K.O.!', `${p.fighters[w].name} wins`, 'ko'); sfx.ko(); }
  else if (w >= 0) { banner(`${p.fighters[w].name.toUpperCase()} WINS`, p.decision === 'unanimous' ? 'By unanimous decision: more HP and more rounds won' : (p.roundsWon[0] === p.roundsWon[1] ? 'By split decision: same rounds won, more HP left' : 'By split decision: fewer rounds won, but more HP left')); sfx.win(); }
  else banner('DRAW', 'Same HP after the last round');
}
function frame(now) {
  if (!F || $('arena').hidden || F.done) { raf = 0; return; } // nothing on screen: stop until the next fight starts
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  if (F.royale) { stepRoyale(dt); drawRoyale(now / 1000); } else { step(dt); draw(now / 1000); }
  if (!F.done) raf = requestAnimationFrame(frame);
}
/** Sparks, smoke, explosions and floating numbers, for both fights and royales. */
function stepParticles(dt) {
  F.flash = F.flash.map((v) => Math.max(0, v - dt));
  F.shake = Math.max(0, F.shake - dt * 30);
  F.white = Math.max(0, F.white - dt * 3);
  for (const s of F.sparks) {
    if (s.kind === 'smoke') { s.x += s.vx * dt; s.y += s.vy * dt; s.vy *= 1 - dt; s.r += 26 * dt; }
    else { s.vy += (s.kind === 'fire' ? 200 : 900) * dt; s.x += s.vx * dt; s.y += s.vy * dt; if (s.kind === 'fire') s.r *= 1 - dt * 2.5; }
    s.life -= dt;
  }
  F.sparks = F.sparks.filter((s) => s.life > 0);
  for (const b of F.booms) b.t += dt;
  F.booms = F.booms.filter((b) => b.t < 0.7);
  for (const f of F.floats) { f.y -= 50 * dt; f.life -= dt; }
  F.floats = F.floats.filter((f) => f.life > 0);
}
function step(dt) {
  F.t += dt;
  stepParticles(dt);
  if (F.over) { if (F.t > (F.recording ? 4.2 : 2.6)) endFight(); return; }
  const R = F.plan.rounds[F.i];
  const [name, len] = phasesOf(R)[F.phase];
  if (name === 'reveal' && R.bench) {
    const k = Math.min(1, F.t / 0.9);
    const shown = R.values.map((v) => (R.bench.kind === 'price' ? formatValue(R.bench, v * k) : (v * k).toFixed(1)));
    const key = shown.join();
    if (key !== F.lastShown) { F.lastShown = key; roundBar(R, shown, ''); if (Math.round(F.t * 30) % 3 === 0) sfx.tick(); }
  }
  if (name === 'attack' && F.fx) updateFx(F.fx, R, dt);
  if (name === 'after') { F.fx = null; F.pose = F.pose.map((p) => (p === 'aim' || p === 'summon' ? 'idle' : p)); }
  const attackLen = F.fx?.kind === 'special' ? F.fx.sp.len : F.fx?.len ?? (F.fx?.kind === 'rocket' ? 1.7 : 2.25);
  if (F.t >= (name === 'attack' ? attackLen : len)) nextPhase();
}
function endFight() {
  if (F.done) return;
  F.done = true;
  if (F.onDone) return F.onDone();
  showResult();
}

// ---------- weapons ----------
/** What a signature move needs from the page. */
const moveKit = () => ({ tone, noise, sfx, burstSparks, explode, drawBot, roundRect, floats: F.floats });
/** A big centred title (weapon or move name), shrunk to fit. */
function drawTitle(text, color, alpha, scale = 1, y = 96) {
  g.save(); g.globalAlpha = alpha; g.textAlign = 'center';
  let size = 30; g.font = `400 ${size}px "Press Start 2P", monospace`;
  while (g.measureText(text).width * scale > W - 60 && size > 12) { size -= 2; g.font = `400 ${size}px "Press Start 2P", monospace`; }
  g.translate(W / 2, y); g.scale(scale, scale);
  g.fillStyle = '#000'; g.fillText(text, 4, 4); g.fillStyle = color; g.fillText(text, 0, 0);
  g.restore();
}
/** Per fighter, the round of its biggest hit: that's where its signature move plays. */
function bigHits(plan) {
  return [0, 1].map((k) => { let best = -1, d = 0; plan.rounds.forEach((R, i) => { if (R.winner === k && R.dmg > d) { d = R.dmg; best = i; } }); return best; });
}
const dirOf = (k) => (k === 0 ? 1 : -1);
/** Small-gun styles: how many shots, how often, how fast, pellets per shot, and how they look. */
/** The plain bullet, used when a royale fighter dodges. */
const GUNS = { mg: { speed: 1700, len: 26, width: 3, c: '#FFF3B0', glow: '#FFE066' } };
/** Which old-style weapon family a style belongs to (thrown items have their own engine). */
const FAMILY = { rocket: 'rocket', grenade: 'rocket', plasma: 'rocket', meteor: 'meteor', lightning: 'meteor', swarm: 'meteor', laser: 'laser', anvil: 'laser' };
// ---------- thrown, rolled and dropped weapons (shared by fights and royales) ----------
/*
 * Each style: how it moves (motion), how long it flies (dur), how many (n, every), the pose it's thrown from,
 * and what happens when it lands (hit). Positions are worldspace; `s` scales the picture (royales draw smaller).
 */
const ITEMS = {
  glove: { motion: 'punch', dur: 0.3, n: 2, every: 0.55, pose: 'idle', hit: 'bonk' },
  pie: { motion: 'arc', dur: 0.6, arc: 50, n: 1, pose: 'win', hit: 'splat' },
  balloon: { motion: 'arc', dur: 0.75, arc: 120, n: 2, every: 0.35, pose: 'win', hit: 'splash' },
  chicken: { motion: 'arc', dur: 0.65, arc: 80, n: 1, pose: 'win', hit: 'squeak' },
  boomerang: { motion: 'boomerang', dur: 0.5, arc: 70, n: 1, pose: 'win', hit: 'bonk' },
  pebble: { motion: 'line', dur: 0.2, n: 3, every: 0.22, pose: 'win', hit: 'ping' },
  tokens: { motion: 'line', dur: 0.45, n: 7, every: 0.11, pose: 'idle', hit: 'tick', from: 'mouth' },
  bowling: { motion: 'roll', dur: 0.85, n: 1, pose: 'idle', hit: 'strike' },
  drone: { motion: 'drone', dur: 1.2, n: 1, pose: 'summon', hit: 'boom' },
  cannon: { motion: 'arc', dur: 0.8, arc: 160, n: 1, pose: 'win', hit: 'boom' },
  meteor: { motion: 'meteor', dur: 0.45, n: 5, every: 0.17, pose: 'summon', hit: 'boom' },
  piano: { motion: 'fall', dur: 0.6, wait: 0.35, n: 1, pose: 'summon', hit: 'klong' },
  tornado: { motion: 'spot', dur: 1.25, n: 1, pose: 'summon', hit: 'whirl' },
  blackhole: { motion: 'spot', dur: 1.4, n: 1, pose: 'summon', hit: 'boomBig' },
  foot: { motion: 'fall', dur: 0.5, wait: 0.6, n: 1, pose: 'summon', hit: 'stomp' },
};
const TOKEN_WORDS = ['the', 'delve', 'tapestry', '—', 'certainly!', 'synergy', 'as an AI', 'robust', 'leverage', '🙂', 'crucial', 'in summary'];
const ease = (k) => 1 - (1 - k) ** 3;

/** A flying item. `from` is the thrower's hand, `to` the target's chest, `floor` the ground line. */
function makeItem(style, from, to, { delay = 0, s = 1, floor = FLOOR, onLand }) {
  const d = ITEMS[style];
  const spread = style === 'tokens' || style === 'pebble' || style === 'balloon' || style === 'meteor' ? 1 : 0;
  if (d.motion === 'meteor') from = { x: to.x - (Math.sign(to.x - from.x) || 1) * (200 + Math.random() * 140) * s, y: -40 }; // in from the thrower's side of the sky
  return { style, d, x0: from.x, y0: from.y, x1: to.x, y1: to.y + spread * (Math.random() - 0.5) * 50 * s, x: from.x, y: from.y, a: 0, t: -delay - (d.wait || 0), dur: d.dur, s, floor, onLand, landed: false,
    word: TOKEN_WORDS[Math.floor(Math.random() * TOKEN_WORDS.length)], col: ['#9BE36D', '#7FD3F0', '#F28DB2', '#F2B544'][Math.floor(Math.random() * 4)] };
}
/** Moves an item; calls onLand once on arrival. Returns true when it can be removed. */
function stepItem(it, dt) {
  it.t += dt;
  if (it.t < 0) return false;
  const { d } = it, k = Math.min(1, it.t / it.dur), m = d.motion;
  const lerp = (a, b, q) => a + (b - a) * q;
  if (m === 'line' || m === 'arc' || m === 'boomerang' || m === 'meteor') {
    const q = m === 'boomerang' && it.landed ? 1 - Math.min(1, (it.t - it.dur) / it.dur) : k;
    const arc = (d.arc || 0) * (m === 'boomerang' && it.landed ? -1 : 1);
    it.x = lerp(it.x0, it.x1, q); it.y = lerp(it.y0, it.y1, q) - Math.sin(q * Math.PI) * arc * it.s;
  } else if (m === 'punch') {
    const q = it.landed ? Math.max(0, 1 - (it.t - it.dur) / 0.25) : ease(k);
    it.x = lerp(it.x0, it.x1, q); it.y = lerp(it.y0, it.y1, q);
  } else if (m === 'roll') {
    it.x = lerp(it.x0, it.x1, k); it.y = it.floor - 15 * it.s; it.a = (it.x - it.x0) / (15 * it.s) * Math.sign(it.x1 - it.x0);
  } else if (m === 'drone') {
    const fly = Math.min(1, k / 0.6), drop = Math.max(0, (k - 0.6) / 0.4);
    it.dx = lerp(it.x0, it.x1, ease(fly)); it.dy = 120 * it.s;
    it.x = it.dx; it.y = drop > 0 ? lerp(it.dy + 20 * it.s, it.y1, drop * drop) : it.dy + 20 * it.s;
  } else if (m === 'fall') {
    it.x = it.x1; it.y = lerp(-160 * it.s, it.y1, k * k);
  } else if (m === 'spot') { it.x = it.x1; it.y = it.y1; }
  if (k >= 1 && !it.landed) { it.landed = true; it.onLand?.(it); }
  const linger = m === 'boomerang' ? it.dur : m === 'punch' ? 0.25 : m === 'fall' ? 0.35 : 0;
  return it.landed && it.t >= it.dur + linger;
}
/** What a landing looks and sounds like, on top of the usual hit. */
function itemImpact(it, x, y, last) {
  const s = it.s, say = (text, c = '#F2B544') => F.floats.push({ x, y: y - 70 * s, text, c, life: 1, size: Math.round(16 * Math.max(0.8, s)) });
  const blob = (n, c, sp = 260, r = 7) => { for (let i = 0; i < (reduced ? Math.ceil(n / 3) : n); i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random()); F.sparks.push({ kind: 'fire', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, r: r * s * (0.6 + Math.random() * 0.8), life: 0.5 + Math.random() * 0.3, c }); } };
  switch (it.d.hit) {
    case 'bonk': tone(320, { to: 140, dur: 0.12, type: 'square', vol: 0.3 }); burstSparks(x, y, 6, '#FFE066'); if (last) say('BONK!'); break;
    case 'splat': noise({ dur: 0.25, vol: 1.2, freq: 900, to: 200 }); blob(16, '#FFF6E0', 200, 8); say('SPLAT!', '#FFF6E0'); break;
    case 'splash': noise({ dur: 0.35, vol: 1, freq: 3000, to: 600, type: 'bandpass' }); blob(18, '#7FD3F0', 240, 6); if (last) say('SPLASH!', '#7FD3F0'); break;
    case 'squeak': tone(1500, { to: 2100, dur: 0.12, type: 'triangle', vol: 0.3 }); tone(1900, { at: 0.13, to: 1300, dur: 0.15, type: 'triangle', vol: 0.3 }); burstSparks(x, y, 8, '#F2E85C'); say('SQUEAK!', '#F2E85C'); break;
    case 'ping': tone(2600, { dur: 0.08, type: 'sine', vol: 0.25 }); burstSparks(x, y, 4, '#C9CFDC'); break;
    case 'tick': tone(1100 + Math.random() * 400, { dur: 0.04, vol: 0.12 }); burstSparks(x, y, 5, it.col); if (last) say('TL;DR', '#9BE36D'); break;
    case 'strike': noise({ dur: 0.5, vol: 1.5, freq: 1800, to: 300 }); for (let i = 0; i < 5; i++) tone(500 + i * 90, { at: i * 0.03, dur: 0.06, type: 'square', vol: 0.12 }); say('STRIKE!'); explode(x, y, false, 0); break;
    case 'klong': [98, 147, 196, 247].forEach((f) => tone(f, { dur: 1.1, type: 'square', vol: 0.18 })); noise({ dur: 0.5, vol: 1.2, freq: 500 }); say('KLONNG!'); explode(x, y, true, 0.2); break;
    case 'whirl': noise({ dur: 0.6, vol: 0.9, freq: 400, to: 2000, type: 'bandpass' }); explode(x, y, false, 0); break;
    case 'stomp': tone(55, { to: 30, dur: 0.6, type: 'sine', vol: 1 }); noise({ dur: 0.4, vol: 1.6, freq: 300 }); say('STOMP!'); explode(x, y, true, 0.3); break;
    case 'boomBig': explode(x, y, true, 0.6); break;
    default: explode(x, y, !!last, 0);
  }
}
/** The sound when it's thrown. */
function itemLaunch(style) {
  ({ glove: () => tone(180, { to: 700, dur: 0.12, type: 'square', vol: 0.2 }), pie: () => noise({ dur: 0.15, vol: 0.5, freq: 1200 }), balloon: () => tone(600, { to: 400, dur: 0.1, type: 'sine', vol: 0.15 }),
    chicken: () => tone(1200, { to: 1700, dur: 0.1, type: 'triangle', vol: 0.18 }), boomerang: () => noise({ dur: 0.5, vol: 0.5, freq: 1500, to: 600, type: 'bandpass' }), pebble: () => tone(900, { to: 1600, dur: 0.06, type: 'triangle', vol: 0.2 }),
    tokens: () => tone(1300, { dur: 0.02, vol: 0.06 }), bowling: () => noise({ dur: 0.8, vol: 0.5, freq: 160 }), drone: () => tone(220, { to: 260, dur: 1, type: 'sawtooth', vol: 0.08 }),
    meteor: () => sfx.whistle(), cannon: () => { tone(60, { to: 30, dur: 0.3, type: 'sine', vol: 0.8 }); noise({ dur: 0.3, vol: 1.2, freq: 600 }); }, piano: () => sfx.whistle(), tornado: () => noise({ dur: 1.2, vol: 0.7, freq: 250, to: 900, type: 'bandpass' }),
    blackhole: () => tone(300, { to: 40, dur: 1.3, type: 'sine', vol: 0.4 }), foot: () => sfx.whistle() })[style]?.();
}
/** Draws an item at its position (and, for the punch and drone, what it's attached to). */
function drawItem(c, it, t) {
  if (it.t < 0 && it.d.motion !== 'fall') return;
  const { x, y, s } = it, dir = Math.sign(it.x1 - it.x0) || 1;
  c.save();
  switch (it.style) {
    case 'glove': {
      c.strokeStyle = '#9aa3b8'; c.lineWidth = 3 * s; c.beginPath(); const n = 10;
      for (let i = 0; i <= n; i++) { const q = i / n, px = it.x0 + (x - it.x0) * q, py = it.y0 + (y - it.y0) * q + (i % 2 ? -7 : 7) * s * (i && i < n ? 1 : 0); i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.stroke(); c.translate(x, y); c.scale(dir * s, s);
      c.fillStyle = '#E03131'; c.beginPath(); c.ellipse(4, 0, 15, 13, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(-2, -10, 6, 5, -0.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#F3F4F8'; c.fillRect(-14, -9, 6, 18); c.fillStyle = 'rgba(255,255,255,.4)'; c.beginPath(); c.ellipse(8, -5, 5, 3, 0, 0, Math.PI * 2); c.fill();
      break;
    }
    case 'pie': c.translate(x, y); c.scale(s, s); c.rotate(dir * -0.4); c.fillStyle = '#C98B4A'; c.beginPath(); c.ellipse(0, 4, 18, 7, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#FFF6E0'; c.beginPath(); c.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#E03131'; c.beginPath(); c.arc(0, -5, 3, 0, Math.PI * 2); c.fill(); break;
    case 'balloon': c.translate(x, y); c.scale(s, s); c.fillStyle = '#4DABF7'; c.beginPath(); c.ellipse(0, 0, 12, 14, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#1C7ED6'; c.beginPath(); c.moveTo(-3, 14); c.lineTo(3, 14); c.lineTo(0, 19); c.fill(); c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(-4, -5, 3, 5, -0.4, 0, Math.PI * 2); c.fill(); break;
    case 'chicken': {
      const flop = Math.sin(it.t * 18) * 0.35;
      c.translate(x, y); c.scale(dir * s * 1.25, s * 1.25); c.rotate(it.t * 9);
      const skin = '#F7E27A', shade = '#D9BE4F';
      c.strokeStyle = '#F2994A'; c.lineWidth = 3; c.lineCap = 'round';
      for (const [lx, sw] of [[-6, flop], [4, -flop]]) {
        c.save(); c.translate(lx, 8); c.rotate(sw); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 20); c.stroke();
        c.beginPath(); c.moveTo(0, 20); c.lineTo(-5, 25); c.moveTo(0, 20); c.lineTo(0, 26); c.moveTo(0, 20); c.lineTo(5, 25); c.stroke(); c.restore();
      }
      c.fillStyle = skin; c.beginPath(); c.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = shade; c.beginPath(); c.ellipse(-2, 5, 14, 5, 0, 0, Math.PI); c.fill();
      c.fillStyle = skin; c.beginPath(); c.moveTo(-18, -4); c.lineTo(-28, -10); c.lineTo(-24, 0); c.lineTo(-28, 6); c.lineTo(-18, 4); c.fill();
      c.save(); c.translate(16, -4); c.rotate(-0.5 + flop);
      c.strokeStyle = skin; c.lineWidth = 8; c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(10, -6, 16, -16); c.stroke();
      c.translate(17, -19); c.fillStyle = skin; c.beginPath(); c.arc(0, 0, 8, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#E03131'; for (const cx of [-5, 0, 5]) { c.beginPath(); c.arc(cx, -8, 3.2, 0, Math.PI * 2); c.fill(); }
      c.beginPath(); c.ellipse(6, 7, 2.5, 4, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#F2994A'; c.beginPath(); c.moveTo(6, -2); c.lineTo(15, 1); c.lineTo(6, 4); c.fill();
      c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, -3); c.lineTo(3, 0); c.moveTo(3, -3); c.lineTo(0, 0); c.stroke();
      c.restore(); break;
    }
    case 'boomerang': c.translate(x, y); c.scale(s, s); c.rotate(it.t * 18); c.strokeStyle = '#B07A3F'; c.lineWidth = 7; c.lineCap = 'round'; c.beginPath(); c.moveTo(-16, -10); c.lineTo(0, 4); c.lineTo(16, -10); c.stroke(); break;
    case 'meteor': {
      const a = Math.atan2(it.y1 - it.y0, it.x1 - it.x0), r = 13 * s;
      const tail = c.createLinearGradient(x, y, x - Math.cos(a) * 70 * s, y - Math.sin(a) * 70 * s); tail.addColorStop(0, 'rgba(255,169,77,.9)'); tail.addColorStop(1, 'rgba(255,107,107,0)');
      c.strokeStyle = tail; c.lineWidth = r * 1.6; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); c.lineTo(x - Math.cos(a) * 70 * s, y - Math.sin(a) * 70 * s); c.stroke();
      c.shadowColor = '#FF8A3D'; c.shadowBlur = 20; c.fillStyle = '#7a3b22'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0; c.fillStyle = '#FFB36B'; c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2); c.fill(); break;
    }
    case 'pebble': c.fillStyle = '#8a8f9e'; c.beginPath(); c.arc(x, y, 6 * s, 0, Math.PI * 2); c.fill(); c.strokeStyle = 'rgba(200,205,220,.5)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x - dir * 20 * s, y); c.stroke(); break;
    case 'tokens': {
      const px = Math.round(14 * Math.max(0.8, s)), col = it.col;
      c.font = `700 ${px}px "JetBrains Mono", monospace`; c.textAlign = 'center';
      const w = c.measureText(it.word).width + 14, hgt = px + 10;
      c.fillStyle = '#0E1120'; roundRect(c, x - w / 2, y - hgt / 2, w, hgt, hgt / 2); c.fill();
      c.strokeStyle = col; c.lineWidth = 2; c.stroke();
      c.fillStyle = col; c.fillText(it.word, x, y + px * 0.36); break;
    }
    case 'bowling': c.translate(x, y); c.rotate(it.a); c.fillStyle = '#1b1f2b'; c.beginPath(); c.arc(0, 0, 15 * s, 0, Math.PI * 2); c.fill(); c.fillStyle = '#4a4f63'; for (const [hx, hy] of [[-4, -6], [3, -7], [-1, -1]]) { c.beginPath(); c.arc(hx * s, hy * s, 2.2 * s, 0, Math.PI * 2); c.fill(); } break;
    case 'drone': {
      c.save(); c.translate(it.dx ?? x, it.dy ?? y); c.scale(1.7 * s, 1.7 * s);
      c.fillStyle = '#3a3f52'; roundRect(c, -18, -5, 36, 10, 4); c.fill(); c.strokeStyle = '#9aa3b8'; c.lineWidth = 2;
      for (const px of [-22, 22]) { c.beginPath(); c.moveTo(px - 10 * Math.cos(t * 40), -9); c.lineTo(px + 10 * Math.cos(t * 40), -9); c.stroke(); c.fillStyle = '#9aa3b8'; c.fillRect(px - 1, -9, 2, 5); }
      c.fillStyle = Math.sin(t * 12) > 0 ? '#FF6B6B' : '#5d1f1f'; c.fillRect(-2, 4, 4, 3); c.restore();
      if (y > (it.dy ?? 0) + 21 * s) { c.fillStyle = '#1b1f2b'; c.beginPath(); c.arc(x, y, 8 * s, 0, Math.PI * 2); c.fill(); c.fillStyle = '#FFA94D'; c.fillRect(x - 1, y - 12 * s, 2, 4 * s); }
      break;
    }
    case 'cannon': c.fillStyle = '#1b1f2b'; c.beginPath(); c.arc(x, y, 18 * s, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.arc(x - 4 * s, y - 4 * s, 4 * s, 0, Math.PI * 2); c.fill(); break;
    case 'piano': {
      if (it.t < 0) { c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(it.x1, it.floor + 4, 30 * s, 6 * s, 0, 0, Math.PI * 2); c.fill(); break; }
      c.translate(x, y); c.scale(1.4 * s, 1.4 * s); c.rotate(0.15);
      c.fillStyle = '#111318'; c.beginPath(); c.moveTo(-54, -10); c.lineTo(30, -10); c.quadraticCurveTo(60, -10, 58, 14); c.lineTo(-54, 14); c.closePath(); c.fill();
      c.fillStyle = '#F3F4F8'; c.fillRect(-54, 14, 60, 8); c.fillStyle = INK; for (let i = 0; i < 9; i++) c.fillRect(-50 + i * 6.5, 14, 3, 5);
      c.fillStyle = '#111318'; c.fillRect(-48, 22, 5, 18); c.fillRect(40, 18, 5, 22); c.fillStyle = '#C9A227'; c.fillRect(-56, 12, 116, 2);
      break;
    }
    case 'tornado': { const k = Math.min(1, Math.max(0, it.t / it.dur));
      c.translate(x, it.floor); c.scale(s, s); c.globalAlpha = 0.85;
      for (let i = 0; i < 9; i++) { const yy = -i * 22, w = 12 + i * 7, off = Math.sin(t * 10 + i) * 6; c.strokeStyle = i % 2 ? '#9aa3b8' : '#c9cfdc'; c.lineWidth = 4; c.beginPath(); c.ellipse(off, yy, w, 5, 0, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = '#c9cfdc'; for (let i = 0; i < 6; i++) { const a = t * 8 + i; c.fillRect(Math.cos(a) * 40 * k, -40 - i * 18 + Math.sin(a) * 6, 4, 4); }
      break; }
    case 'blackhole': { const k = Math.min(1, Math.max(0, it.t / it.dur)), r = (10 + 34 * ease(k)) * s;
      c.translate(x, y);
      for (let i = 0; i < 3; i++) { c.strokeStyle = ['#B79CF2', '#7048E8', '#F28DB2'][i]; c.lineWidth = 3; c.beginPath(); c.ellipse(0, 0, r * (1.6 + i * 0.35), r * (0.45 + i * 0.1), t * (2 + i), 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = '#000'; c.shadowColor = '#B79CF2'; c.shadowBlur = 30; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
      break; }
    case 'foot': {
      if (it.t < 0) { c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(it.x1, it.floor + 4, (30 + 20 * (1 + it.t / 0.6)) * s, 7 * s, 0, 0, Math.PI * 2); c.fill(); break; }
      c.translate(x, y + 40 * s); c.scale(s, s); c.fillStyle = '#E8B48A';
      c.fillRect(-26, -220, 52, 170); c.beginPath(); c.ellipse(10, -40, 62, 34, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#d99c70'; for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(52 - i * 3, -62 + i * 11, 9 - i, 7 - i * 0.6, 0, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#5c3b26'; c.fillRect(-26, -220, 52, 8);
      break;
    }
  }
  c.restore();
}

function startFx(R) {
  const w = R.winner, style = R.style || R.weapon, kind = R.weapon === 'tie' ? 'tie' : ITEMS[style] ? R.weapon : FAMILY[style] || R.weapon;
  const fx = { kind, style, gear: style === 'rocket' ? 'rocket' : kind === 'meteor' || kind === 'laser' ? kind : 'mg', t: 0, shots: [], rockets: [], meteors: [], hits: 0, landed: 0, fired: 0, nextShot: 0.25, muzzle: [0, 0],
    title: kind === 'tie' ? R.tieStyles.map((x) => STYLE_NAMES[x]).join(' vs ') : STYLE_NAMES[style] || weaponName(kind), titleC: w >= 0 ? F.colors[w] : '#F3F4F8' };
  if (kind === 'tie') return startItems(fx, R);
  if (F.special[w] === F.i) {
    const l = 1 - w, m = F.plan.fighters[w];
    F.pose[w] = 'summon';
    Object.assign(fx, { kind: 'special', hits: 1, title: moveNameFor(m.org) });
    fx.sp = startMove(m.org, { ...moveKit(), ax: F.x[w] + dirOf(w) * 24, ay: FLOOR - 176, x: F.x[w], tx: F.x[l], ty: FLOOR - 100, floor: FLOOR, s: 1, dir: dirOf(w), color: F.colors[w], look: F.looks[w], ko: R.hpAfter[l] === 0,
      land: () => landHit(fx, R, F.x[l], FLOOR - 100, 'big') });
    return fx;
  }
  if (ITEMS[style]) return startItems(fx, R);
  F.pose[w] = kind === 'meteor' || kind === 'laser' ? 'summon' : 'aim';
  if (kind === 'rocket') fx.hits = fx.toFire = R.points >= 7 ? 2 : 1;
  else if (kind === 'meteor') fx.hits = fx.toFire = style === 'swarm' ? 6 : style === 'lightning' ? 5 : 6;
  else fx.hits = fx.toFire = 1;
  if (style === 'meteor') sfx.rumble();
  if (style === 'lightning') noise({ dur: 1.4, vol: 0.4, freq: 120 });
  if (style === 'laser') { sfx.lock(); setTimeout(() => sfx.charge(), 250); }
  if (style === 'anvil') sfx.whistle();
  return fx;
}
/** Thrown items: the winner throws at the loser, or in a tie both throw and the items collide in the middle. */
/** Where a thrown item starts, for fighter k: its hand, its mouth, or the floor in front of it. */
function throwFrom(d, x, dir, size, s = 1) {
  return d.motion === 'punch' ? { x: x + dir * 54 * size * s, y: FLOOR - 100 * size * s }
    : d.motion === 'roll' ? { x: x + dir * 40 * s, y: FLOOR - 15 * s }
    : d.from === 'mouth' ? { x: x + dir * 22 * size * s, y: FLOOR - 136 * size * s }
    : { x: x + dir * 24 * size * s, y: FLOOR - 176 * size * s };
}
/** The middle of a fighter's body, allowing for its size (flagships are taller). */
const bodyOf = (k) => ({ x: F.x[k], y: FLOOR - 92 * (F.looks[k].size || 1) });
function startItems(fx, R) {
  const w = R.winner, tie = w === -1, styleOf = (k) => (tie ? R.tieStyles[k] : fx.style);
  Object.assign(fx, { mode: 'items', items: [], gear: 'none', hits: ITEMS[fx.style].n, landed: 0, len: 0 });
  for (const k of tie ? [0, 1] : [w]) {
    const d = ITEMS[styleOf(k)];
    F.pose[k] = d.pose;
    fx.len = Math.max(fx.len, 0.25 + (d.n - 1) * (d.every || 0) + (d.wait || 0) + d.dur * (d.motion === 'boomerang' ? 2 : 1) + 0.8);
    const l = 1 - k, body = bodyOf(l), to = { x: body.x - dirOf(k) * 8, y: body.y };
    for (let i = 0; i < d.n; i++) {
      const last = i === d.n - 1;
      fx.items.push(makeItem(styleOf(k), throwFrom(d, F.x[k], dirOf(k), F.looks[k].size || 1), to, { delay: 0.25 + i * (d.every || 0), onLand: (it) => {
        if (tie) { itemImpact(it, it.x, it.y, last); F.flash[l] = 0.08; F.pose[l] = 'hurt'; return; } // the graze lands once both have hit
        fx.itemHit = it; landHit(fx, R, it.x, it.y, last ? 'mid' : 'small');
      } }));
    }
  }
  return fx;
}
/** A tie: both fighters lose the graze. */
function grazeBoth(fx, R) {
  fx.grazed = true;
  F.hp = [...R.hpAfter]; setHp(false);
  for (const k of [0, 1]) {
    if (!R.graze[k]) continue;
    F.flash[k] = 0.1; F.pose[k] = 'hurt';
    burstSparks(F.x[k] - dirOf(k) * 20, FLOOR - 110, 6, '#FFE066');
    F.floats.push({ x: F.x[k], y: FLOOR - 200, text: `−${R.graze[k]}`, c: '#FF6B6B', life: 1.1, size: 20 });
  }
  sfx.ricochet();
}
function landHit(fx, R, x, y, size) {
  const l = 1 - R.winner;
  fx.landed++;
  const dealt = Math.round(R.dmg * fx.landed / fx.hits);
  F.hp[l] = fx.landed >= fx.hits ? R.hpAfter[l] : Math.max(0, R.hpBefore[l] - dealt);
  setHp(false);
  F.pose[l] = 'hurt'; F.flash[l] = 0.12;
  F.shake = reduced ? 0 : Math.max(F.shake, size === 'big' ? 18 : size === 'mid' ? 10 : 4);
  if (fx.mode === 'items') itemImpact(fx.itemHit, x, y, fx.landed >= fx.hits);
  else if (size !== 'small') explode(x, y, size === 'big', fx.style === 'laser' ? 0.85 : undefined);
  else burstSparks(x, y, 6, '#FFE066');
  if (fx.landed >= fx.hits) F.floats.push({ x: F.x[l], y: FLOOR - 200, text: `−${R.hpBefore[l] - R.hpAfter[l]}`, c: '#FF6B6B', life: 1.3 });
}
function burstSparks(x, y, n, c) {
  if (reduced) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 320; F.sparks.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, life: 0.3 + Math.random() * 0.3, c }); }
}
function explode(x, y, big, flash = big ? 0.3 : 0) {
  F.booms.push({ x, y, t: 0, size: big ? 150 : 90 });
  if (!reduced) F.white = Math.max(F.white, flash);
  const n = reduced ? 6 : big ? 28 : 16;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = (big ? 160 : 100) + Math.random() * 220;
    F.sparks.push({ kind: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, r: 10 + Math.random() * (big ? 18 : 10), life: 0.4 + Math.random() * 0.3, c: ['#FFE066', '#FFA94D', '#FF6B6B'][i % 3] });
    if (i % 2 === 0) F.sparks.push({ kind: 'smoke', x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 60, r: 12 + Math.random() * 10, life: 1 + Math.random() * 0.6, c: '#3b3f52' });
  }
  burstSparks(x, y, big ? 20 : 10, '#FFE066');
  sfx.boom(big);
}
function updateFx(fx, R, dt) {
  fx.t += dt;
  fx.muzzle = fx.muzzle.map((m) => Math.max(0, m - dt));
  const w = R.winner, l = 1 - w;
  if (fx.kind === 'special') { updateMove(fx.sp, dt); return; }
  if (fx.mode === 'items') {
    for (const it of fx.items) if (it.t < 0 && it.t + dt >= 0) itemLaunch(it.style);
    fx.items = fx.items.filter((it) => !stepItem(it, dt));
    if (R.winner === -1 && !fx.grazed && !fx.items.length) grazeBoth(fx, R);
    return;
  }
  if (fx.kind === 'rocket') {
    if (fx.fired < fx.toFire && fx.t >= 0.3 + fx.fired * 0.35) {
      const st = fx.style, x0 = F.x[w] + dirOf(w) * (st === 'rocket' ? 84 : 132), y0 = FLOOR - (st === 'rocket' ? 145 : 109);
      fx.rockets.push({ x0, y0, x1: F.x[l], y1: FLOOR - 100, t: 0, dur: st === 'grenade' ? 0.8 : st === 'plasma' ? 0.5 : 0.55, arc: st === 'grenade' ? 170 : st === 'plasma' ? 0 : 70, style: st });
      fx.muzzle[w] = 0.12; fx.fired++;
      if (st === 'plasma') { tone(220, { to: 900, dur: 0.35, type: 'sawtooth', vol: 0.2 }); } else if (st === 'grenade') { tone(320, { dur: 0.08, type: 'square', vol: 0.25 }); sfx.whistle(); } else sfx.launch();
      if (st === 'rocket') for (let i = 0; i < 6; i++) F.sparks.push({ kind: 'smoke', x: F.x[w] - dirOf(w) * 50, y: y0, vx: -dirOf(w) * (40 + Math.random() * 80), vy: -20 - Math.random() * 30, r: 10, life: 0.9, c: '#4a4f63' });
    }
    fx.rockets = fx.rockets.filter((r) => {
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.x = r.x0 + (r.x1 - r.x0) * k; r.y = r.y0 + (r.y1 - r.y0) * k - Math.sin(k * Math.PI) * r.arc;
      r.a = Math.atan2((r.y1 - r.y0) - Math.cos(k * Math.PI) * Math.PI * r.arc, r.x1 - r.x0);
      if (!reduced && r.style === 'rocket') F.sparks.push({ kind: 'smoke', x: r.x - Math.cos(r.a) * 26, y: r.y - Math.sin(r.a) * 26, vx: (Math.random() - 0.5) * 20, vy: -10, r: 6, life: 0.6, c: '#5a5f73' });
      if (!reduced && r.style === 'plasma') F.sparks.push({ kind: 'spark', x: r.x, y: r.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.3, c: '#B79CF2' });
      if (k < 1) return true;
      landHit(fx, R, r.x1, r.y1, fx.toFire > 1 ? 'mid' : 'big'); return false;
    });
  } else if (fx.kind === 'meteor' && fx.style === 'lightning') {
    if (fx.fired < fx.toFire && fx.t >= 0.35 + fx.fired * 0.22) {
      const tx = F.x[l] + (Math.random() - 0.5) * 50, ty = FLOOR - 60 - Math.random() * 70;
      fx.meteors.push({ bolt: true, tx, ty, t: 0, pts: Array.from({ length: 9 }, (_, i) => [tx + (i === 8 ? 0 : (Math.random() - 0.5) * 50), (ty * i) / 8]) });
      fx.fired++; noise({ dur: 0.25, vol: 1.4, freq: 6000, to: 400 }); if (!reduced) F.white = Math.max(F.white, 0.25);
      landHit(fx, R, tx, ty, fx.landed === fx.hits - 1 ? 'big' : 'mid');
    }
    for (const m of fx.meteors) m.t += dt;
    fx.meteors = fx.meteors.filter((m) => m.t < 0.22);
  } else if (fx.kind === 'meteor' && fx.style === 'swarm') {
    if (fx.fired < fx.toFire && fx.t >= 0.3 + fx.fired * 0.12) {
      fx.rockets.push({ x0: F.x[w], y0: FLOOR - 186, x1: F.x[l] + (Math.random() - 0.5) * 60, y1: FLOOR - 70 - Math.random() * 60, t: 0, dur: 0.75, arc: 220, style: 'mini' });
      fx.fired++; tone(500 + fx.fired * 60, { to: 1400, dur: 0.2, type: 'sawtooth', vol: 0.1 });
    }
    fx.rockets = fx.rockets.filter((r) => {
      r.t += dt; const k = Math.min(1, r.t / r.dur);
      r.x = r.x0 + (r.x1 - r.x0) * k; r.y = r.y0 + (r.y1 - r.y0) * k - Math.sin(k * Math.PI) * r.arc;
      r.a = Math.atan2((r.y1 - r.y0) - Math.cos(k * Math.PI) * Math.PI * r.arc, r.x1 - r.x0);
      if (!reduced) F.sparks.push({ kind: 'smoke', x: r.x, y: r.y, vx: 0, vy: -8, r: 4, life: 0.4, c: '#5a5f73' });
      if (k < 1) return true;
      landHit(fx, R, r.x1, r.y1, fx.landed === fx.hits - 1 ? 'big' : 'mid'); return false;
    });
  } else if (fx.kind === 'laser' && fx.style === 'anvil') {
    const k = Math.min(1, Math.max(0, (fx.t - 0.35) / 0.7));
    fx.anvilY = -120 + (FLOOR - 70 + 120) * k * k;
    if (fx.fired === 0 && k >= 1) { fx.fired = 1; landHit(fx, R, F.x[l], FLOOR - 40, 'big'); tone(70, { to: 30, dur: 0.5, type: 'square', vol: 0.5 }); tone(2400, { dur: 0.4, type: 'triangle', vol: 0.15 }); }
  } else if (fx.kind === 'laser') {
    if (fx.fired === 0 && fx.t >= 1.15) { fx.fired = 1; fx.beamT = 0; sfx.zap(); landHit(fx, R, F.x[l], FLOOR - 90, 'big'); }
    if (fx.beamT != null) fx.beamT += dt;
  }
}
function drawFx(fx, t) {
  if (!fx) return;
  if (fx.t < 1.1) drawTitle(fx.title, fx.titleC, Math.min(1, fx.t * 6) * Math.min(1, (1.1 - fx.t) * 3), 1 + Math.max(0, 0.25 - fx.t) * 2);
  if (fx.kind === 'special') drawMove(fx.sp, g, t);
  if (fx.mode === 'items') for (const it of fx.items) drawItem(g, it, t);
  for (const b of fx.shots) {
    const gun = b.gun || GUNS.mg, a = Math.atan2(b.vy, Math.abs(b.vx));
    g.save(); g.shadowColor = gun.glow; g.shadowBlur = 10; g.strokeStyle = gun.c; g.lineWidth = gun.width;
    g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - Math.sign(b.vx) * gun.len, b.y - Math.sin(a) * gun.len); g.stroke(); g.restore();
  }
  for (const r of fx.rockets) {
    if (r.style === 'grenade') {
      g.save(); g.translate(r.x, r.y); g.rotate(r.t * 14); g.fillStyle = '#4b5a2a'; g.beginPath(); g.ellipse(0, 0, 11, 14, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2f3a18'; g.lineWidth = 2; g.beginPath(); g.moveTo(-11, 0); g.lineTo(11, 0); g.moveTo(0, -14); g.lineTo(0, 14); g.stroke(); g.fillStyle = '#9aa3b8'; g.fillRect(-4, -19, 8, 6); g.restore();
      continue;
    }
    if (r.style === 'plasma') {
      g.save(); g.shadowColor = '#B79CF2'; g.shadowBlur = 30; g.fillStyle = '#E4D8FF'; g.beginPath(); g.arc(r.x, r.y, 16, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#B79CF2'; g.beginPath(); g.arc(r.x, r.y, 10 + Math.sin(r.t * 40) * 2, 0, Math.PI * 2); g.fill(); g.restore();
      continue;
    }
    g.save(); g.translate(r.x, r.y); g.rotate(r.a); if (r.style === 'mini') g.scale(0.55, 0.55);
    g.fillStyle = '#FFA94D'; g.beginPath(); g.moveTo(-18, -5); g.lineTo(-34 - Math.random() * 12, 0); g.lineTo(-18, 5); g.fill();
    g.fillStyle = '#d9dde8'; roundRect(g, -18, -6, 30, 12, 4); g.fill();
    g.fillStyle = '#FF6B6B'; g.beginPath(); g.moveTo(12, -6); g.lineTo(22, 0); g.lineTo(12, 6); g.fill();
    g.fillStyle = '#7a8094'; g.fillRect(-18, -10, 8, 4); g.fillRect(-18, 6, 8, 4);
    g.restore();
  }
  for (const m of fx.meteors) {
    if (m.bolt) {
      g.save(); g.globalAlpha = 1 - m.t / 0.22; g.shadowColor = '#7FD3F0'; g.shadowBlur = 20; g.strokeStyle = '#F3FBFF'; g.lineWidth = 5; g.lineJoin = 'round';
      g.beginPath(); m.pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke(); g.lineWidth = 2; g.strokeStyle = '#7FD3F0'; g.stroke(); g.restore();
      continue;
    }
    g.save(); g.shadowColor = '#FF8A3D'; g.shadowBlur = 24;
    g.fillStyle = '#7a3b22'; g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFB36B'; g.beginPath(); g.arc(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.45, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  if (fx.style === 'anvil' && fx.anvilY != null) {
    const l = 1 - F.plan.rounds[F.i].winner, x = F.x[l], y = fx.anvilY, k = Math.min(1, (y + 120) / (FLOOR + 50));
    g.save(); g.globalAlpha = 0.25 + k * 0.4; g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, FLOOR + 4, 30 + k * 40, 8, 0, 0, Math.PI * 2); g.fill(); g.restore();
    if (!fx.fired || fx.t < 1.6) {
      g.save(); g.translate(x, y); g.fillStyle = '#4a4f63';
      g.beginPath(); g.moveTo(-70, -34); g.lineTo(54, -34); g.quadraticCurveTo(84, -32, 92, -14); g.lineTo(28, -12); g.lineTo(22, 6); g.lineTo(-24, 6); g.lineTo(-30, -12); g.lineTo(-62, -14); g.closePath(); g.fill();
      g.fillRect(-40, 6, 74, 22); g.fillStyle = '#6b7189'; g.fillRect(-70, -34, 124, 6);
      g.font = '400 12px "Press Start 2P", monospace'; g.textAlign = 'center'; g.fillStyle = '#F3F4F8'; g.fillText('1000 KG', -4, 22); g.restore();
    }
  }
  if (fx.style === 'laser') {
    const l = 1 - F.plan.rounds[F.i].winner, x = F.x[l];
    if (fx.t < 1.15) {
      const k = Math.min(1, fx.t / 1.1), r = 90 - k * 50;
      g.save(); g.strokeStyle = '#FF6B6B'; g.lineWidth = 3; g.setLineDash([10, 8]); g.lineDashOffset = -t * 60;
      g.beginPath(); g.arc(x, FLOOR - 90, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.moveTo(x - r - 14, FLOOR - 90); g.lineTo(x + r + 14, FLOOR - 90); g.moveTo(x, FLOOR - 90 - r - 14); g.lineTo(x, FLOOR - 90 + r + 14); g.stroke();
      g.globalAlpha = 0.25 + k * 0.5; g.fillStyle = '#7FD3F0'; g.fillRect(x - 2, 0, 4, FLOOR); g.restore();
    } else if (fx.beamT != null && fx.beamT < 0.7) {
      const k = fx.beamT / 0.7, wdt = 80 * (1 - k * 0.6);
      g.save(); g.globalAlpha = 1 - k * 0.8;
      const grad = g.createLinearGradient(x - wdt, 0, x + wdt, 0); grad.addColorStop(0, 'rgba(127,211,240,0)'); grad.addColorStop(0.5, '#7FD3F0'); grad.addColorStop(1, 'rgba(127,211,240,0)');
      g.fillStyle = grad; g.fillRect(x - wdt, 0, wdt * 2, FLOOR + 10);
      g.fillStyle = '#ffffff'; g.fillRect(x - wdt * 0.18, 0, wdt * 0.36, FLOOR + 10);
      g.restore();
    }
  }
}

// ---------- drawing ----------
function draw(t) {
  drawBackdrop(t, F.fx && { kind: F.fx.style === 'meteor' ? 'meteor' : F.fx.style === 'laser' ? 'laser' : null, t: F.fx.t });
  for (const k of [0, 1]) {
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(F.x[k], FLOOR + 6, 46, 9, 0, 0, Math.PI * 2); g.fill();
    drawBot(g, F.x[k], FLOOR, k === 0 ? 1 : -1, F.looks[k], F.pose[k], t + k, F.flash[k], F.fx ? { kind: F.fx.gear || F.fx.kind, muzzle: F.fx.muzzle[k] } : null);
  }
  drawSmoke();
  drawFx(F.fx, t);
  drawParticles();
  if (!F.recording) drawArenaLabel(g, F.arena, H - 12);
  if (F.recording) drawClipOverlay(t);
}
/** Sky, city, floor; darkened for meteors and laser lock-ons. Leaves the screen-shake transform on. */
function drawBackdrop(t, fx) {
  const sx = F.shake ? (Math.random() - 0.5) * F.shake : 0, sy = F.shake ? (Math.random() - 0.5) * F.shake : 0;
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawArena(F.arena || 'city', g, W, H, FLOOR, t, () => {
    g.translate(sx, sy);
  }, () => {
    if (fx?.kind === 'meteor') { g.fillStyle = `rgba(120,30,20,${Math.min(0.45, fx.t * 0.6)})`; g.fillRect(0, 0, W, FLOOR); }
    if (fx?.kind === 'laser' && fx.t < 1.15) { g.fillStyle = `rgba(0,0,0,${Math.min(0.45, fx.t * 0.5)})`; g.fillRect(0, 0, W, H); }
  });
}
// ---------- arenas: a different place for every fight ----------
/** Each arena paints the sky and scenery, then the floor. `afterSky` and `beforeFloor` let a fight add shake and weapon tints. */
const ARENAS = [
  { id: 'city', name: 'Neon City' }, { id: 'servers', name: 'Server Farm' }, { id: 'moon', name: 'Moon Base' }, { id: 'synth', name: 'Synthwave' },
  { id: 'dojo', name: 'Dojo' }, { id: 'volcano', name: 'Volcano' }, { id: 'sea', name: 'Deep Sea' }, { id: 'snow', name: 'Snow Peak' },
];
/** The arena for a fight, fixed by its seed (the matchup), so replays and share links look the same. */
function arenaFor(seed) { return ARENAS[hash(`arena|${seed}`) % ARENAS.length].id; }
const arenaName = (id) => ARENAS.find((a) => a.id === id)?.name ?? 'Neon City';
/** Deterministic "random" numbers for scenery: the same every frame, no flicker. */
const rnd01 = (i, salt = 0) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };
function gradient(c, hgt, stops) { const gr = c.createLinearGradient(0, 0, 0, hgt); stops.forEach((col, i) => gr.addColorStop(i / (stops.length - 1), col)); return gr; }
function stars(c, w, top, n, t, tw = true) {
  for (let i = 0; i < n; i++) { const a = tw && !reduced ? 0.4 + 0.6 * Math.abs(Math.sin(t * (0.5 + rnd01(i, 3)) + i)) : 0.7; c.globalAlpha = a; c.fillStyle = '#F3F4F8'; c.fillRect(rnd01(i, 1) * w, rnd01(i, 2) * top, rnd01(i, 4) < 0.15 ? 2.5 : 1.5, rnd01(i, 4) < 0.15 ? 2.5 : 1.5); }
  c.globalAlpha = 1;
}
const SCENES = {
  city(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, hgt, ['#0d1022', '#170d1a']); c.fillRect(0, 0, w, hgt);
    return () => {
      for (let i = 0; i < Math.ceil(w / 84) + 1; i++) {
        const x = i * 84 - 10, top = floor - 260 + (i % 3) * 16;
        c.fillStyle = '#12162a'; c.fillRect(x, top, 64, floor - top);
        for (let j = 0; j < 9; j++) {
          const on = (Math.sin(t * (1.3 + (i * 7 + j) % 5) + i * j) > 0.2) && !reduced || (i + j) % 3 === 0;
          c.fillStyle = on ? ((i + j) % 4 === 0 ? '#D4F25C' : '#7FD3F0') : '#1d2440';
          c.fillRect(x + 8 + (j % 3) * 18, top + 14 + Math.floor(j / 3) * 26, 8, 4);
        }
      }
    };
  },
  servers(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, hgt, ['#070b16', '#0c1428']); c.fillRect(0, 0, w, hgt);
    return () => {
      c.fillStyle = '#1b2440'; for (let x = 0; x < w; x += 140) { c.fillRect(x, 20, 120, 6); for (let k = 0; k < 4; k++) c.fillRect(x + 10 + k * 30, 26, 3, 18); }
      for (let i = 0; i < Math.ceil(w / 74) + 1; i++) {
        const x = i * 74 - 6, top = floor - 250;
        c.fillStyle = '#121a30'; c.fillRect(x, top, 62, floor - top);
        c.fillStyle = '#0b1122'; for (let r = 0; r < 11; r++) c.fillRect(x + 4, top + 8 + r * 21, 54, 16);
        for (let r = 0; r < 11; r++) for (let l = 0; l < 3; l++) {
          const on = reduced ? (i + r + l) % 3 === 0 : Math.sin(t * (2 + rnd01(i * 33 + r * 3 + l) * 6) + i + r) > 0.3;
          c.fillStyle = on ? ['#2EC4A6', '#7FD3F0', '#F2B544'][(i + r + l) % 3] : '#1a2440';
          c.fillRect(x + 42 + l * 5, top + 14 + r * 21, 3, 3);
        }
      }
    };
  },
  moon(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, hgt, ['#03040a', '#0b0e1c']); c.fillRect(0, 0, w, hgt);
    stars(c, w, floor - 40, 120, t);
    return () => {
      const ex = w * 0.8, ey = floor * 0.28, er = Math.min(60, w * 0.06);
      c.fillStyle = '#2f6fd6'; c.beginPath(); c.arc(ex, ey, er, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3fa36b'; c.beginPath(); c.ellipse(ex - er * 0.3, ey - er * 0.1, er * 0.35, er * 0.5, 0.4, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(ex + er * 0.35, ey + er * 0.3, er * 0.25, er * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(ex + er * 0.35, ey, er, -Math.PI / 2, Math.PI / 2); c.fill();
      c.fillStyle = '#2a2d38'; c.beginPath(); c.moveTo(0, floor); for (let x = 0; x <= w; x += 40) c.lineTo(x, floor - 40 - Math.abs(Math.sin(x * 0.012)) * 50 - rnd01(x) * 14); c.lineTo(w, floor); c.fill();
    };
  },
  synth(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, floor, ['#12052b', '#3b0d4f', '#b8336a']); c.fillRect(0, 0, w, floor);
    stars(c, w, floor * 0.4, 50, t);
    return () => {
      const sx = w / 2, sy = floor - 30, sr = Math.min(150, w * 0.17);
      const sun = c.createLinearGradient(0, sy - sr, 0, sy); sun.addColorStop(0, '#FFE066'); sun.addColorStop(1, '#FF4F8B');
      c.fillStyle = sun; c.beginPath(); c.arc(sx, sy, sr, Math.PI, 0); c.fill();
      c.fillStyle = '#b8336a'; for (let i = 0; i < 6; i++) { const yy = sy - sr * 0.5 + i * sr * 0.1; c.fillRect(sx - sr, yy, sr * 2, 2 + i * 1.5); }
      c.fillStyle = '#2a0a3e'; c.beginPath(); c.moveTo(0, floor); for (let x = 0; x <= w; x += 60) c.lineTo(x, floor - 30 - Math.abs(Math.sin(x * 0.009 + 1)) * 80); c.lineTo(w, floor); c.fill();
    };
  },
  dojo(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, hgt, ['#1d120c', '#2a1810']); c.fillRect(0, 0, w, hgt);
    return () => {
      for (let x = -20; x < w; x += 150) {
        c.fillStyle = '#4a3324'; c.fillRect(x, floor - 280, 130, 280);
        c.fillStyle = '#e8dcc3'; c.globalAlpha = 0.22; c.fillRect(x + 8, floor - 270, 114, 262); c.globalAlpha = 1;
        c.strokeStyle = '#3a2618'; c.lineWidth = 3; for (let k = 1; k < 3; k++) { c.beginPath(); c.moveTo(x + 8 + k * 38, floor - 270); c.lineTo(x + 8 + k * 38, floor - 8); c.stroke(); } for (let k = 1; k < 6; k++) { c.beginPath(); c.moveTo(x + 8, floor - 270 + k * 44); c.lineTo(x + 122, floor - 270 + k * 44); c.stroke(); }
      }
      for (let i = 0; i < Math.ceil(w / 300); i++) { const lx = 150 + i * 300, ly = 70 + Math.sin(t * 1.5 + i) * 3; c.strokeStyle = '#3a2618'; c.lineWidth = 2; c.beginPath(); c.moveTo(lx, 0); c.lineTo(lx, ly - 22); c.stroke(); c.fillStyle = '#c0392b'; c.beginPath(); c.ellipse(lx, ly, 18, 24, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(255,200,120,.25)'; c.beginPath(); c.arc(lx, ly, 46, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#F7B6C8'; for (let i = 0; i < 26; i++) { const px = (rnd01(i, 7) * w + (reduced ? 0 : t * 30)) % w, py = (rnd01(i, 8) * floor + (reduced ? 0 : t * (25 + rnd01(i) * 25))) % floor; c.beginPath(); c.ellipse(px, py, 4, 2.5, t + i, 0, Math.PI * 2); c.fill(); }
    };
  },
  volcano(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, floor, ['#0a0505', '#2a0b08', '#5a1a0c']); c.fillRect(0, 0, w, floor);
    return () => {
      const vx = w * 0.5;
      c.fillStyle = '#1a0d0a'; c.beginPath(); c.moveTo(vx - w * 0.45, floor); c.lineTo(vx - 70, floor - 230); c.lineTo(vx + 70, floor - 230); c.lineTo(vx + w * 0.45, floor); c.fill();
      const glow = c.createRadialGradient(vx, floor - 230, 0, vx, floor - 230, 160); glow.addColorStop(0, 'rgba(255,140,40,.7)'); glow.addColorStop(1, 'rgba(255,80,20,0)'); c.fillStyle = glow; c.fillRect(vx - 160, floor - 390, 320, 320);
      c.strokeStyle = '#FF6B1A'; c.lineWidth = 5; c.lineCap = 'round'; for (const dx of [-40, 10, 45]) { c.beginPath(); c.moveTo(vx + dx * 0.6, floor - 230); c.quadraticCurveTo(vx + dx, floor - 170, vx + dx * 1.6, floor - 110); c.stroke(); }
      for (let i = 0; i < 30; i++) { const ex = vx + (rnd01(i, 5) - 0.5) * 260, ey = floor - 230 - ((rnd01(i, 6) * 300 + (reduced ? 0 : t * (40 + rnd01(i) * 60))) % 300); c.fillStyle = rnd01(i, 9) < 0.5 ? '#FFA94D' : '#FF6B6B'; c.globalAlpha = 0.8; c.fillRect(ex, ey, 3, 3); }
      c.globalAlpha = 1;
    };
  },
  sea(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, hgt, ['#0b3a5c', '#071d33', '#040d1a']); c.fillRect(0, 0, w, hgt);
    return () => {
      c.fillStyle = 'rgba(160,220,255,.06)'; for (let i = 0; i < 5; i++) { const x = (i + 0.3) * w / 5 + Math.sin(t * 0.4 + i) * 20; c.beginPath(); c.moveTo(x - 20, 0); c.lineTo(x + 30, 0); c.lineTo(x + 120, floor); c.lineTo(x + 40, floor); c.fill(); }
      c.strokeStyle = 'rgba(200,235,255,.5)'; c.lineWidth = 1.5; for (let i = 0; i < 24; i++) { const bx = rnd01(i, 2) * w + Math.sin(t * 2 + i) * 6, by = floor - ((rnd01(i, 3) * floor + (reduced ? 0 : t * (30 + rnd01(i) * 40))) % floor); c.beginPath(); c.arc(bx, by, 2 + rnd01(i, 4) * 4, 0, Math.PI * 2); c.stroke(); }
      for (let i = 0; i < Math.ceil(w / 90); i++) { const x = 30 + i * 90 + rnd01(i, 9) * 30; c.strokeStyle = '#1f6b4a'; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, floor); for (let k = 1; k <= 6; k++) c.lineTo(x + Math.sin(t * 1.5 + i + k * 0.7) * 8 * (k / 6), floor - k * 18); c.stroke(); }
    };
  },
  snow(c, w, hgt, floor, t) {
    c.fillStyle = gradient(c, floor, ['#070b1c', '#152241', '#2a3c66']); c.fillRect(0, 0, w, floor);
    stars(c, w, floor * 0.45, 60, t);
    return () => {
      c.fillStyle = '#E8EEF8'; c.beginPath(); c.arc(w * 0.18, floor * 0.22, 26, 0, Math.PI * 2); c.fill();
      for (const [col, peak, off] of [['#3b4f7a', 250, 0], ['#566c99', 180, 120]]) {
        c.fillStyle = col; c.beginPath(); c.moveTo(0, floor); for (let x = 0; x <= w; x += 30) c.lineTo(x, floor - peak * (0.5 + 0.5 * Math.abs(Math.sin((x + off) * 0.006)))); c.lineTo(w, floor); c.fill();
      }
      c.fillStyle = '#F3F4F8'; for (let i = 0; i < 70; i++) { const sx = (rnd01(i, 1) * w + Math.sin(t + i) * 10 + (reduced ? 0 : t * 12)) % w, sy = (rnd01(i, 2) * floor + (reduced ? 0 : t * (20 + rnd01(i) * 30))) % floor; c.globalAlpha = 0.5 + rnd01(i, 5) * 0.5; c.beginPath(); c.arc(sx, sy, 1 + rnd01(i, 6) * 2, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
    };
  },
};
const FLOORS = {
  city: ['#2a2140', '#0a0c14', '#FF6B6B'], servers: ['#1a2238', '#080b16', '#2EC4A6'], moon: ['#4a4d58', '#16171d', '#C9CFDC'], synth: ['#1a0730', '#06020d', '#FF4F8B'],
  dojo: ['#6b4428', '#2a180c', '#C9A227'], volcano: ['#2a120c', '#0a0505', '#FF6B1A'], sea: ['#6b5a3a', '#2a2214', '#7FD3F0'], snow: ['#b9c6dc', '#56627e', '#E8EEF8'],
};
/** Paints an arena: sky and scenery, a dark veil so fighters stand out, then the floor. */
function drawArena(id, c, w, hgt, floor, t, afterSky, beforeFloor) {
  const scenery = (SCENES[id] || SCENES.city)(c, w, hgt, floor, t);
  afterSky?.();
  scenery();
  c.fillStyle = id === 'synth' || id === 'snow' ? 'rgba(10,12,20,.35)' : 'rgba(10,12,20,.5)'; c.fillRect(0, 0, w, hgt);
  beforeFloor?.();
  const [top, bottom, edge] = FLOORS[id] || FLOORS.city;
  c.fillStyle = gradient(c, hgt - floor, [top, bottom]); c.save(); c.translate(0, floor); c.fillRect(0, 0, w, hgt - floor); c.restore();
  if (id === 'synth') { c.strokeStyle = 'rgba(255,79,139,.55)'; c.lineWidth = 1.5; for (let i = 1; i < 8; i++) { const y = floor + (hgt - floor) * (i / 8) ** 1.6; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } for (let i = -10; i <= 10; i++) { c.beginPath(); c.moveTo(w / 2 + i * 30, floor); c.lineTo(w / 2 + i * 160, hgt); c.stroke(); } }
  if (id === 'servers') { c.strokeStyle = 'rgba(127,211,240,.12)'; c.lineWidth = 1; for (let x = 0; x < w; x += 48) { c.beginPath(); c.moveTo(x, floor); c.lineTo(x, hgt); c.stroke(); } }
  if (id === 'dojo') { c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; for (let y = floor + 12; y < hgt; y += 14) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }
  if (id === 'volcano') { c.strokeStyle = 'rgba(255,107,26,.6)'; c.lineWidth = 2; for (let i = 0; i < 8; i++) { const x = rnd01(i, 4) * w; c.beginPath(); c.moveTo(x, floor + 6); c.lineTo(x + 30, floor + 20 + rnd01(i) * 20); c.lineTo(x + 70, floor + 30); c.stroke(); } }
  if (id === 'moon') { c.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(rnd01(i, 8) * w, floor + 14 + rnd01(i, 9) * (hgt - floor - 20), 26, 6, 0, 0, Math.PI * 2); c.fill(); } }
  c.fillStyle = edge; c.fillRect(0, floor, w, 3);
}
/** "📍 Moon Base", bottom left of the arena. */
function drawArenaLabel(c, id, y) {
  c.save(); c.globalAlpha = 0.65; c.font = '600 12px "JetBrains Mono", monospace'; c.textAlign = 'left'; c.fillStyle = '#F3F4F8'; c.fillText(`📍 ${arenaName(id)}`, 12, y); c.restore();
}
function drawSmoke() {
  for (const s of F.sparks) if (s.kind === 'smoke') { g.globalAlpha = Math.max(0, Math.min(0.5, s.life * 0.5)); g.fillStyle = s.c; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
}
/** Explosions, sparks and floating numbers, then the white flash. Resets the transform. */
function drawParticles() {
  for (const b of F.booms) {
    const k = b.t / 0.7, r = b.size * (0.3 + k * 0.9);
    g.save(); g.globalAlpha = 1 - k;
    const fire = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 0.8); fire.addColorStop(0, '#FFF6C8'); fire.addColorStop(0.4, '#FFA94D'); fire.addColorStop(1, 'rgba(255,107,107,0)');
    g.fillStyle = fire; g.beginPath(); g.arc(b.x, b.y, r * 0.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#FFE066'; g.lineWidth = 4 * (1 - k); g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
  for (const s of F.sparks) {
    if (s.kind === 'smoke') continue;
    g.globalAlpha = Math.max(0, Math.min(1, s.life * 2.5)); g.fillStyle = s.c;
    if (s.kind === 'fire') { g.beginPath(); g.arc(s.x, s.y, Math.max(0.5, s.r), 0, Math.PI * 2); g.fill(); } else g.fillRect(s.x, s.y, 5, 5);
  }
  g.globalAlpha = 1;
  for (const f of F.floats) {
    g.font = `400 ${f.size || 26}px "Press Start 2P", monospace`; g.textAlign = 'center'; g.globalAlpha = Math.min(1, f.life * 2);
    g.fillStyle = '#000'; g.fillText(f.text, f.x + 3, f.y + 3); g.fillStyle = f.c; g.fillText(f.text, f.x, f.y);
  }
  g.globalAlpha = 1;
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (F.white > 0) { g.fillStyle = `rgba(255,255,255,${Math.min(0.85, F.white)})`; g.fillRect(0, 0, W, H); }
}

/** The DOM HUD isn't in the video, so a recorded clip draws its own: names, HP, round, result and the link. */
function drawClipOverlay() {
  const p = F.plan;
  g.save();
  for (const k of [0, 1]) {
    const left = k === 0, x0 = left ? 16 : W - 16 - 380;
    g.font = '400 14px "Press Start 2P", monospace'; g.textAlign = left ? 'left' : 'right';
    g.fillStyle = F.colors[k]; g.fillText(p.fighters[k].name, left ? 16 : W - 16, 28);
    g.fillStyle = '#2a0f14'; g.fillRect(x0, 38, 380, 16);
    g.fillStyle = '#F2B544'; const wv = 380 * F.hp[k] / 100; g.fillRect(left ? x0 : x0 + 380 - wv, 38, wv, 16);
    g.strokeStyle = '#F3F4F8'; g.lineWidth = 2; g.strokeRect(x0, 38, 380, 16);
  }
  const R = p.rounds[Math.min(F.i, p.rounds.length - 1)];
  g.fillStyle = 'rgba(10,12,20,.82)'; g.fillRect(0, H - 52, W, 52);
  g.textAlign = 'center'; g.fillStyle = '#F2B544'; g.font = '400 13px "Press Start 2P", monospace';
  g.fillText(F.over ? 'FINAL' : `ROUND ${F.i + 1}: ${R.round.name.toUpperCase()}${R.bench ? ` · ${R.bench.name}` : ''}`, W / 2, H - 30);
  g.fillStyle = '#F3F4F8'; g.font = '600 14px Inter, sans-serif';
  g.fillText(F.over ? verdictText() : $('rres').textContent, W / 2, H - 11);
  if (F.bannerText) {
    const { big, sub, ko } = F.bannerText;
    g.textAlign = 'center';
    let size = ko ? 72 : 36;
    g.font = `400 ${size}px "Press Start 2P", monospace`;
    while (g.measureText(big).width > W - 60 && size > 14) { size -= 2; g.font = `400 ${size}px "Press Start 2P", monospace`; }
    g.fillStyle = '#000'; g.fillText(big, W / 2 + 4, 162 + 4);
    g.fillStyle = ko ? '#FF6B6B' : '#F3F4F8'; g.fillText(big, W / 2, 162);
    if (sub) { g.font = '600 18px Inter, sans-serif'; g.fillStyle = '#C9CFDC'; g.fillText(sub, W / 2, 200); }
  }
  g.textAlign = 'center'; g.fillStyle = 'rgba(243,244,248,.75)'; g.font = '500 12px "JetBrains Mono", monospace';
  g.fillText(SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, 22);
  g.restore();
}
function verdictText() {
  const p = F.plan;
  if (p.winner < 0) return `Draw · ${p.hp[0]} HP each`;
  return `${p.fighters[p.winner].name} wins ${decisionText(p)} · ${p.roundsWon[p.winner]}–${p.roundsWon[1 - p.winner]} in rounds`;
}

// ---------- result ----------
function shareText(plan = F.plan) {
  const [a, b] = plan.fighters;
  const row = plan.rounds.map((R) => (R.winner == null ? '⬛' : R.winner < 0 ? '🟨' : R.winner === 0 ? '🟩' : '🟥')).join('');
  const how = plan.winner < 0 ? 'Draw' : `${plan.fighters[plan.winner].name} wins ${decisionText(plan)} (${plan.hp[plan.winner]} HP left)`;
  return [`🥊 Benchmark Brawl`, `${a.name} vs ${b.name} · ${plan.roundsWon[0]}–${plan.roundsWon[1]}`, row, how, `${SITE_URL}${hashFor(a.id, b.id, rounds)}`].join('\n');
}
function showResult() {
  const p = F.plan, [a, b] = p.fighters;
  if (F.daily && !F.replay) recordDaily(p);
  setView('result');
  const w = p.winner >= 0 ? p.fighters[p.winner] : null;
  $('verdict').style.setProperty('--c', w ? F.colors[p.winner] : '#F3F4F8');
  $('verdict').textContent = w ? `${w.name.toUpperCase()} WINS` : 'A DRAW';
  $('verdictSub').textContent = !w ? `Same HP after the last round` : `${decisionText(p)} · ${p.roundsWon[p.winner]}–${p.roundsWon[1 - p.winner]} in rounds${p.decision === 'split' ? (p.roundsWon[0] === p.roundsWon[1] ? ': same rounds won, bigger wins' : ': fewer rounds, but bigger wins') : ''}`;
  drawVictory($('winCv'), p, F.looks);
  const rec = F.daily ? todayRec() : null;
  $('yourCall').hidden = !F.daily;
  if (F.daily) $('yourCall').replaceChildren(...callBadge(rec));
  $('rematch').textContent = F.daily ? '▶ WATCH AGAIN' : 'REMATCH';
  $('copy').textContent = F.daily ? 'Share' : 'Share result';
  $('th1').textContent = a.name; $('th1').style.color = F.colors[0];
  $('th2').textContent = b.name; $('th2').style.color = F.colors[1];
  $('rows').replaceChildren(...p.rounds.map((R) => h('tr', null,
    h('td', null, R.round.name, h('span', { class: 't' }, R.parts
      ? ['Average of ', ...R.parts.flatMap((p, i) => [i ? ' + ' : '', h('a', { href: safeUrl(p.bench.source.url), target: '_blank', rel: 'noopener' }, p.bench.name)])]
      : R.bench ? [h('a', { href: safeUrl(R.bench.source.url), target: '_blank', rel: 'noopener' }, R.bench.name), ` · ${R.bench.source.name}`] : 'No benchmark in common')),
    ...[0, 1].map((k) => {
      const m = p.fighters[k], s = R.bench && R.bench.kind === 'score' ? m.scores[R.bench.id] : null;
      return h('td', { class: `num ${R.winner === k ? 'win' : ''}`, style: `--c:${F.colors[k]}` },
        safeUrl(s?.log) ? h('a', { href: safeUrl(s.log), target: '_blank', rel: 'noopener', title: 'Epoch AI run logs', style: 'color:inherit' }, formatValue(R.bench, R.values[k])) : formatValue(R.bench, R.values[k]),
        R.winner === k ? ' ✓' : '',
        R.parts ? h('span', { class: 't' }, R.parts.map((pt) => { const sc = m.scores[pt.bench.id]; return `${pt.bench.name} ${pt.values[k].toFixed(1)} (${sc.setting}${sc.se != null ? `, ±${(1.96 * sc.se).toFixed(1)}` : ''})`; }).join(' · '), R.margin != null ? ` · combined ±${R.margin}` : '')
          : s ? h('span', { class: 't' }, `${s.setting} setting · ${s.se != null ? `±${(1.96 * s.se).toFixed(1)}` : 'no margin published'}`) : R.bench?.kind === 'price' ? h('span', { class: 't' }, 'per M tokens') : '');
    }),
    h('td', { class: 'num' }, R.winner == null ? 'skipped' : R.winner < 0 ? h('span', null, R.tie === 'margin' ? 'tie (margin)' : 'tie', h('span', { class: 't' }, grazeText(R))) : `−${R.dmg} HP`))));
  $('share').textContent = F.daily ? dailyText(p, rec) : shareText();
  $('skippedNote').hidden = !p.skipped.length;
  $('skippedNote').textContent = p.skipped.length ? `Left out: ${p.skipped.map((r) => r.name).join(', ')}. These two have no benchmark in common there, so the fight skipped ${p.skipped.length === 1 ? 'it' : 'them'} instead of playing empty rounds.` : '';
  $('backToBracket').hidden = !fromBracket;
  $('result').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
/** "Your call" for a daily brawl: right, wrong, or watched without a call. */
function callBadge(rec) {
  const st = dailyStats();
  if (!rec?.pick) return [h('span', { class: 'pill meh' }, 'Watched without a call'), h('span', null, `🔥 Streak ${st.streak}`)];
  return [h('span', { class: `pill ${rec.correct ? 'ok' : 'no'}` }, rec.correct ? '✅ You called it' : '❌ Not this time'),
    h('span', null, `🔥 Streak ${st.streak}`), h('span', { class: 'fine' }, `You've called ${st.right} of ${st.called}`)];
}
/** The winner posing, the loser down, on the city backdrop. */
function drawVictory(cv, p, looks) {
  const phone = matchMedia('(max-width: 760px)').matches, [w, hgt] = phone ? [780, 520] : [1200, 400];
  if (cv.width !== w) { cv.width = w; cv.height = hgt; }
  const c = cv.getContext('2d'), floor = hgt - 50, s = phone ? 1.05 : 1.1;
  drawArena(F?.arena || 'city', c, w, hgt, floor, 1);
  p.fighters.forEach((m, k) => {
    const pose = p.winner === k ? 'win' : p.winner < 0 ? 'idle' : p.ko ? 'down' : 'hurt';
    c.save(); c.translate(w * (k ? 0.68 : 0.32), floor); c.scale(s, s); drawBot(c, 0, 0, k ? -1 : 1, looks[k], pose, k); c.restore();
  });
}
function backHome() {
  cancelAnimationFrame(raf);
  fromBracket = false;
  openTab(tab);
}

/** Anonymous GoatCounter event (published site only; a no-op locally or when blocked). */
function track(path) { try { window.goatcounter?.count?.({ path, event: true }); } catch { /* fine */ } }

let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200); }
async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { toast('Copy failed: select the text and copy it yourself'); }
}

$('fight').addEventListener('click', () => (mode === 'royale' ? startRoyale() : startFight()));
$('rematch').addEventListener('click', () => startFight(F?.daily ? { daily: F.daily, rounds: F.daily.rounds, replay: true } : {}));
$('again').addEventListener('click', () => { cancelAnimationFrame(raf); fromBracket = false; openTab('play'); });
$('copy').addEventListener('click', () => { track(F.daily ? 'share-today' : 'share'); shareOrCopy($('share').textContent, 'Copied result and link'); });
$('card').addEventListener('click', () => { track('card'); shareCard(F.plan, F.looks, F.daily ? todayRec() : null, F.daily); });
$('skip').addEventListener('click', () => {
  if (F?.royale) return skipRoyale();
  if (!F || F.over) return endFight();
  F.i = F.plan.rounds.length - 1; F.fx = null; F.white = 0;
  [...$('pips').children].forEach((pip, i) => { const R = F.plan.rounds[i]; const c = R.winner === 0 || R.winner === 1 ? F.colors[R.winner] : '#F3F4F8'; pip.style.background = R.winner === 0 || R.winner === 1 ? c : ''; pip.style.borderColor = c; });
  finish(); F.t = F.recording ? 0 : 2.6;
});

// ---------- fight clips ----------
$('clip').addEventListener('click', recordClip);
async function recordClip() {
  if (!cv.captureStream || !window.MediaRecorder) return toast("This browser can't record clips. Try Chrome or Edge.");
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) return toast("This browser can't record clips");
  track('clip');
  const stream = cv.captureStream(30);
  const a = audio();
  if (a) { recDest = a.createMediaStreamDestination(); master?.connect(recDest); for (const tr of recDest.stream.getAudioTracks()) stream.addTrack(tr); }
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  const finished = F; // record the fight that was just watched, not whatever the builder now says
  picks = finished.plan.fighters.map((m) => m.id);
  startFight({ recording: true, rounds: finished.roundIds, daily: finished.daily, replay: true, onDone: () => rec.state !== 'inactive' && rec.stop() });
  try { await done; } finally {
    for (const tr of stream.getTracks()) tr.stop();
    if (recDest) { try { master?.disconnect(recDest); } catch { /* fine */ } recDest = null; }
  }
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const [x, y] = F.plan.fighters.map((m) => m.id);
  const file = new File(chunks, `benchmark-brawl-${x}-vs-${y}.${ext}`, { type: mimeType.split(';')[0] });
  F.recording = false;
  $('arena').classList.remove('recording');
  showResult();
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], text: shareText() }); return; } catch { /* fall back to download */ }
  }
  const url = URL.createObjectURL(file);
  h('a', { href: url, download: file.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast(`Saved ${file.name}${ext === 'webm' ? ' (WebM: convert to MP4 for X)' : ''}`);
}

// ---------- tournament ----------
$('tourneyClose').addEventListener('click', () => openTab('today'));
$('backToBracket').addEventListener('click', () => { $('result').hidden = true; showBracket(); });
function openTournament() {
  const pool = DATA.models.filter((m) => inClass(m, classId));
  bracket = runTournament(DATA, pool, rounds);
  if (!bracket) return toast('A tournament needs at least 8 fighters in this weight class');
  bracket.key = `${classId}|${rounds.join(',')}`; bracket.roundIds = [...rounds];
  track(`tournament/${classId}`);
  sfx.bell();
  showBracket();
}
function showBracket() {
  const cls = CLASSES.find((c) => c.id === classId).name;
  tab = 'tournament';
  setView('tournament');
  $('tourneyTitle').textContent = `Tournament · ${cls} · ${rounds.map((r) => roundById.get(r).name).join(', ')}`;
  const champ = bracket.champion;
  $('champ').style.setProperty('--c', colorOf(champ));
  $('champ').replaceChildren('🏆 Champion: ', h('b', null, champ.name));
  const titles = ['Quarterfinals', 'Semifinals', 'Final'];
  $('bracket').replaceChildren(...bracket.rounds.map((ms, ri) => h('div', { class: 'bcol' }, h('h3', null, titles[ri]), ...ms.map((m) => {
    const side = (x, k) => h('div', { class: `p ${m.winner === x ? 'w' : ''}`, style: `--c:${colorOf(x)}` }, h('span', { class: 'n' }, `${bracket.seeds.indexOf(x) + 1}. ${x.name}`), h('span', { class: 'hp2' }, `${m.fight.hp[k]} HP`));
    return h('button', { type: 'button', class: 'match', title: 'Watch this fight', onclick: () => { picks = [m.a.id, m.b.id]; fromBracket = true; startFight({ rounds: bracket.roundIds }); } },
      side(m.a, 0), side(m.b, 1), h('span', { class: 'note2' }, m.tiebreak ? 'Draw: higher seed advances' : m.fight.ko ? 'K.O.' : `${m.fight.decision === 'unanimous' ? 'Unanimous' : 'Split'} decision · ${m.fight.roundsWon[0]}–${m.fight.roundsWon[1]}`));
  }))));
  $('tshare').textContent = tournamentText();
  $('tourney').scrollIntoView({ block: 'start' });
}
function tournamentText() {
  const fin = bracket.rounds.at(-1)[0], loser = fin.winner === fin.a ? fin.b : fin.a;
  const semis = bracket.rounds[1].map((m) => (m.winner === m.a ? m.b : m.a).name);
  return [`🏆 Benchmark Brawl tournament · ${CLASSES.find((c) => c.id === classId).name}`, `Champion: ${bracket.champion.name}`, `Final: beat ${loser.name}`, `Semifinalists: ${semis.join(', ')}`, `${SITE_URL}#t=1&r=${rounds.join(',')}${classPart()}`].join('\n');
}
$('watchFinal').addEventListener('click', () => { const f = bracket.rounds.at(-1)[0]; picks = [f.a.id, f.b.id]; fromBracket = true; startFight({ rounds: bracket.roundIds }); });
$('tcopy').addEventListener('click', () => { track('share-bracket'); copyText(tournamentText(), 'Copied bracket and link'); });

// ---------- battle royale ----------
const R_PHASES = [['banner', 1.2], ['reveal', 1.0], ['attack', 0], ['after', 1.0]];
const R_NO_DATA = [['banner', 1.0], ['after', 0.6]];
/** Distinct colours for up to 8 fighters: lab colour first, the next free one if taken. */

function startRoyale() {
  const ms = picks.map((id) => byId.get(id)).filter(Boolean);
  if (ms.length < ROYALE_MIN) return;
  const plan = planRoyale(DATA, ms, rounds), n = ms.length;
  if (!plan.rounds.length) return toast('No two of these fighters share a benchmark in these rounds. Try other rounds or fighters.');
  const gap = (W - 80) / n;
  const looks = looksFor(ms);
  F = { royale: true, arena: arenaFor(ms.map((m) => m.id).join('|')), plan, n, looks, colors: looks.map((l) => l.ui), x: ms.map((_, i) => 40 + gap * (i + 0.5)), s: n >= 6 ? 0.6 : n >= 4 ? 0.74 : 0.9, gap,
    pose: ms.map(() => 'idle'), flash: ms.map(() => 0), dodge: ms.map(() => 0), hp: ms.map(() => 100), shown: ms.map(() => null),
    i: 0, phase: 0, t: 0, sparks: [], floats: [], booms: [], shots: [], fx: null, shake: 0, white: 0, over: false, done: false, moveTitle: null,
    // per fighter, its biggest hit as leader: where its signature move plays
    special: ms.map((_, k) => { if (reduced) return null; let best = null, d = 0; plan.rounds.forEach((R, i) => { if (R.leader === k) for (const x of R.hits) if (x.dmg > d) { d = x.dmg; best = { i, target: x.target }; } }); return best; }) };
  setView('arena');
  $('arena').classList.add('royale'); $('rec').hidden = true;
  $('arenaNote').textContent = 'Best result fires at everyone · damage = 2 × gap to the leader · inside the margin = dodge';
  $('pips').replaceChildren(...plan.rounds.map(() => h('span')));
  writeHash();
  track(`royale/${n}`);
  renderBoard();
  $('arena').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  rEnter();
  cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame);
}
const rPhases = (R) => (R.bench ? R_PHASES : R_NO_DATA);
const shortName = (m) => m.name.replace(/\s*\(.*\)$/, '');
function rResult(R) {
  const ms = F.plan.fighters;
  if (!R.bench) return 'No benchmark that two or more fighters share. No damage.';
  if (R.leader == null) return '';
  const dodged = R.hits.filter((x) => x.dmg === 0).length, sat = F.n - R.inRound.length - R.hpBefore.filter((x) => x === 0).length;
  const lead = R.bench.kind === 'price' ? `${shortName(ms[R.leader])} is cheapest` : `${shortName(ms[R.leader])} tops it with ${R.values[R.leader].toFixed(1)}`;
  return [lead, dodged ? `${dodged} dodge${dodged === 1 ? 's' : ''} inside the margin` : '', sat > 0 ? `${sat} sit${sat === 1 ? 's' : ''} out (no result)` : ''].filter(Boolean).join(' · ');
}
function rEnter() {
  const R = F.plan.rounds[F.i], name = rPhases(R)[F.phase][0];
  F.t = 0;
  if (name === 'banner') {
    $('roundNo').textContent = `ROUND ${F.i + 1}/${F.plan.rounds.length}`;
    banner(`ROUND ${F.i + 1}`, `${R.round.name}${R.bench ? ` · ${R.bench.name}` : ''}`);
    $('rname').textContent = `ROUND ${F.i + 1}: ${R.round.name.toUpperCase()}`;
    $('rtest').textContent = R.bench ? `${R.bench.name}: ${R.bench.what}` : 'Round skipped';
    $('rres').textContent = R.bench ? '' : rResult(R);
    F.shown = F.shown.map(() => null); F.pose = F.pose.map((p, k) => (F.hp[k] === 0 ? 'down' : 'idle'));
    renderBoard(); sfx.bell();
  } else if (name === 'reveal') banner('', '');
  else if (name === 'attack') { F.shown = [...R.values]; $('rres').textContent = rResult(R); renderBoard(); rStartFx(R); }
  else if (name === 'after') {
    banner(...(R.out.length ? [R.out.length > 1 ? `${R.out.length}× K.O.!` : 'K.O.!', R.out.map((k) => shortName(F.plan.fighters[k])).join(', '), 'ko'] : ['', '']));
    if (R.out.length) sfx.ko();
    const pip = $('pips').children[F.i];
    if (R.leader != null) { pip.style.background = F.colors[R.leader]; pip.style.borderColor = F.colors[R.leader]; } else pip.style.borderColor = '#3a4364';
  }
}
/** The leader fires at each fighter in turn, with the weapon its gap earns. */
function rStartFx(R) {
  const L = R.leader;
  F.fx = { t: 0, queue: R.hits.map((hit, j) => ({ hit, at: 0.45 + j * 0.28, fired: false })), len: 0.45 + R.hits.length * 0.28 + 1.3, kind: null };
  if (L == null) return;
  F.pose[L] = 'summon';
  const real = R.hits.filter((x) => x.dmg > 0).map((x) => x.weapon), top = ['laser', 'meteor', 'rocket', 'mg'].find((w) => real.includes(w));
  F.fx.kind = top || null;
  const topHits = R.hits.filter((x) => x.dmg > 0 && x.weapon === top), styles = [...new Set(topHits.map((x) => STYLE_NAMES[x.style] || weaponName(top)))];
  F.fx.title = top ? `${styles.join(' + ')}${styles.length === 1 && topHits.length > 1 ? ` ×${topHits.length}` : ''}` : 'ALL DODGE!';
  F.fx.titleC = F.colors[L];
  if (top === 'meteor') sfx.rumble();
  if (top === 'laser') sfx.lock();
}
const orbOf = (k) => ({ x: F.x[k] + (F.x[k] < W / 2 ? 1 : -1) * 24 * F.s, y: FLOOR - 24 * F.s - 176 * F.s });
const chestOf = (k) => ({ x: F.x[k], y: FLOOR - 92 * F.s * (F.looks[k].size || 1) });
function rLand(R, hit, last, size, it = null) {
  const k = hit.target;
  if (it) itemImpact(it, chestOf(k).x, chestOf(k).y, last);
  if (!last) { if (!it) burstSparks(chestOf(k).x, chestOf(k).y, 4, '#FFE066'); return; }
  F.hp[k] = R.hpAfter[k];
  F.flash[k] = 0.15; F.pose[k] = F.hp[k] === 0 ? 'down' : 'hurt';
  F.shake = reduced ? 0 : Math.max(F.shake, size === 'big' ? 14 : size === 'mid' ? 8 : 4);
  if (it) { /* the item's own impact already played */ }
  else if (size !== 'small') explode(chestOf(k).x, chestOf(k).y, size === 'big', size === 'big' ? 0.25 : 0);
  else burstSparks(chestOf(k).x, chestOf(k).y, 8, '#FFE066');
  F.floats.push({ x: F.x[k], y: FLOOR - 200 * F.s - 30, text: `−${R.hpBefore[k] - R.hpAfter[k]}`, c: '#FF6B6B', life: 1.3, size: 18 });
  renderBoard();
}
function rFire(R, hit) {
  const L = R.leader, k = hit.target, o = orbOf(L), c = chestOf(k);
  if (hit.dmg === 0) {
    F.dodge[k] = 0.5;
    F.shots.push({ kind: 'bullet', x: o.x, y: o.y, tx: c.x, ty: c.y - 70 * F.s, v: 1500, onLand: () => {} });
    F.floats.push({ x: F.x[k], y: FLOOR - 200 * F.s - 30, text: 'DODGE', c: '#7FD3F0', life: 1.1, size: 13 });
    sfx.shot(); sfx.ricochet();
    return;
  }
  const sp = F.special[L];
  if (sp && sp.i === F.i && sp.target === k) {
    const m = F.plan.fighters[L];
    F.moveTitle = { text: moveNameFor(m.org), c: F.colors[L], t: 0 };
    F.shots.push({ kind: 'move', sp: startMove(m.org, { ...moveKit(), ax: o.x, ay: o.y, x: F.x[L], tx: c.x, ty: c.y, floor: FLOOR, s: F.s, dir: Math.sign(c.x - F.x[L]) || 1, color: F.colors[L], look: F.looks[L], ko: R.hpAfter[k] === 0,
      land: () => rLand(R, hit, true, 'big') }) });
    return;
  }
  const st = hit.style || hit.weapon;
  if (ITEMS[st]) {
    const d = ITEMS[st], dir = Math.sign(c.x - F.x[L]) || 1;
    const from = d.motion === 'punch' || d.motion === 'roll' || d.from === 'mouth' ? throwFrom(d, F.x[L], dir, F.looks[L].size || 1, F.s) : o;
    for (let i = 0; i < d.n; i++) F.shots.push({ kind: 'item', it: makeItem(st, from, c, { delay: i * (d.every || 0), s: F.s, onLand: (it) => rLand(R, hit, i === d.n - 1, i === d.n - 1 ? 'mid' : 'small', it) }) });
  } else if (st === 'plasma') {
    F.shots.push({ kind: 'plasma', x: o.x, y: o.y, tx: c.x, ty: c.y, v: 900, onLand: () => rLand(R, hit, true, 'mid') });
    tone(220, { to: 900, dur: 0.3, type: 'sawtooth', vol: 0.18 });
  } else if (st === 'rocket' || st === 'grenade') {
    F.shots.push({ kind: 'rocket', style: st, x0: o.x, y0: o.y, x1: c.x, y1: c.y, t: 0, dur: st === 'grenade' ? 0.8 : 0.6, arc: st === 'grenade' ? 140 : 80, onLand: () => rLand(R, hit, true, 'mid') });
    if (st === 'grenade') sfx.whistle(); else sfx.launch();
  } else if (st === 'lightning') {
    for (let b = 0; b < 3; b++) { const tx = c.x + (Math.random() - 0.5) * 30, ty = c.y + (Math.random() - 0.5) * 30; F.shots.push({ kind: 'bolt', delay: b * 0.18, t: 0, tx, ty, pts: Array.from({ length: 8 }, (_, i) => [tx + (i === 7 ? 0 : (Math.random() - 0.5) * 36), (ty * i) / 7]), onLand: () => { rLand(R, hit, b === 2, b === 2 ? 'big' : 'mid'); noise({ dur: 0.2, vol: 1.2, freq: 6000, to: 400 }); } }); }
  } else if (st === 'swarm') {
    for (let b = 0; b < 3; b++) F.shots.push({ kind: 'rocket', style: 'mini', delay: b * 0.12, x0: o.x, y0: o.y, x1: c.x + (Math.random() - 0.5) * 30, y1: c.y + (Math.random() - 0.5) * 30, t: 0, dur: 0.7, arc: 170, onLand: () => rLand(R, hit, b === 2, b === 2 ? 'big' : 'mid') });
    tone(600, { to: 1500, dur: 0.25, type: 'sawtooth', vol: 0.1 });
  } else if (st === 'anvil') {
    F.shots.push({ kind: 'anvil', x: c.x, y: -60, tx: c.x, ty: FLOOR - 30 * F.s, v: 1100, onLand: () => { rLand(R, hit, true, 'big'); tone(70, { to: 30, dur: 0.4, type: 'square', vol: 0.4 }); } });
    sfx.whistle();
  } else {
    F.shots.push({ kind: 'beam', x: c.x, t: 0, onLand: () => rLand(R, hit, true, 'big') });
    sfx.zap();
  }
}
function stepRoyale(dt) {
  F.t += dt;
  stepParticles(dt);
  F.dodge = F.dodge.map((v) => Math.max(0, v - dt));
  if (F.moveTitle) F.moveTitle.t += dt;
  for (const s of F.shots) {
    if (s.delay > 0) { s.delay -= dt; continue; }
    if (s.kind === 'move') { if (updateMove(s.sp, dt)) s.done = true; continue; }
    if (s.kind === 'item') { if (s.it.t < 0 && s.it.t + dt >= 0) itemLaunch(s.it.style); if (stepItem(s.it, dt)) s.done = true; continue; }
    if (s.kind === 'bolt') { s.t += dt; if (!s.hit) { s.hit = true; s.onLand(); } if (s.t > 0.22) s.done = true; continue; }
    if (s.kind === 'bullet' || s.kind === 'meteor' || s.kind === 'plasma' || s.kind === 'anvil') {
      const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy), st = s.v * dt;
      if (s.kind === 'meteor' && !reduced) F.sparks.push({ kind: 'fire', x: s.x, y: s.y, vx: 0, vy: -20, r: s.r * 0.8, life: 0.22, c: Math.random() < 0.5 ? '#FFA94D' : '#FF6B6B' });
      s.a = Math.atan2(dy, dx);
      if (d <= st) { s.done = true; s.onLand(); } else { s.x += dx / d * st; s.y += dy / d * st; }
    } else if (s.kind === 'rocket') {
      s.t += dt; const k = Math.min(1, s.t / s.dur);
      s.x = s.x0 + (s.x1 - s.x0) * k; s.y = s.y0 + (s.y1 - s.y0) * k - Math.sin(k * Math.PI) * (s.arc ?? 80);
      if (!reduced) F.sparks.push({ kind: 'smoke', x: s.x, y: s.y, vx: 0, vy: -10, r: 5, life: 0.5, c: '#5a5f73' });
      if (k >= 1) { s.done = true; s.onLand(); }
    } else if (s.kind === 'beam') {
      s.t += dt; if (!s.hit && s.t > 0.12) { s.hit = true; s.onLand(); } if (s.t > 0.6) s.done = true;
    }
  }
  F.shots = F.shots.filter((s) => !s.done);
  if (F.over) { if (F.t > 2.8) rEnd(); return; }
  const R = F.plan.rounds[F.i];
  const [name, len] = rPhases(R)[F.phase];
  if (name === 'reveal') {
    const k = Math.min(1, F.t / 0.8);
    F.shown = R.values.map((v) => (v == null ? null : v * k));
    if (Math.round(F.t * 30) % 3 === 0) sfx.tick();
  }
  if (name === 'attack' && F.fx) {
    F.fx.t += dt;
    for (const q of F.fx.queue) if (!q.fired && F.fx.t >= q.at) { q.fired = true; rFire(R, q.hit); }
    if (F.fx.t >= F.fx.len && !F.shots.length) return rNext();
    return;
  }
  if (name === 'after') { F.fx = null; F.pose = F.pose.map((p, k) => (F.hp[k] === 0 ? 'down' : 'idle')); }
  if (F.t >= len) rNext();
}
function rNext() {
  F.phase++;
  if (F.phase >= rPhases(F.plan.rounds[F.i]).length) { F.phase = 0; F.i++; if (F.i >= F.plan.rounds.length) return rFinish(); }
  rEnter();
}
function rFinish() {
  const p = F.plan;
  F.over = true; F.t = 0; F.fx = null; F.shots = [];
  F.hp = [...p.hp];
  F.pose = p.fighters.map((_, k) => (p.hp[k] === 0 ? 'down' : k === p.winner ? 'win' : 'idle'));
  F.shown = F.shown.map(() => null);
  renderBoard();
  const alive = p.hp.filter((x) => x > 0).length;
  if (p.winner < 0) banner('SHARED CROWN', 'The top two finish level on HP');
  else banner(`${shortName(p.fighters[p.winner]).toUpperCase()} WINS`, alive === 1 ? 'Last one standing' : `Most HP after the last round · ${alive} still standing`);
  sfx.win();
}
function skipRoyale() {
  if (F.over) return rEnd();
  [...$('pips').children].forEach((pip, i) => { const L = F.plan.rounds[i].leader; if (L != null) { pip.style.background = F.colors[L]; pip.style.borderColor = F.colors[L]; } });
  F.i = F.plan.rounds.length - 1; rFinish(); F.t = 2.8;
}
function rEnd() { if (F.done) return; F.done = true; showRoyaleResult(); }

/** The phone-readable board under the canvas: every fighter, its HP and this round's result. */
function renderBoard() {
  const p = F.plan, R = p.rounds[Math.min(F.i, p.rounds.length - 1)];
  $('board').replaceChildren(...p.fighters.map((m, k) => {
    const v = F.shown[k], out = F.hp[k] === 0;
    return h('div', { class: `bf ${out ? 'out' : ''} ${!F.over && R?.leader === k && F.shown.some((x) => x != null) ? 'lead' : ''}`, style: `--c:${F.colors[k]}` },
      h('span', { class: 'bn' }, shortName(m)), h('i', { class: 'bhp' }, h('b', { style: `width:${F.hp[k]}%` })),
      h('span', { class: 'bv' }, out ? 'K.O.' : v != null && R?.bench ? formatValue(R.bench, v) : `${F.hp[k]} HP`));
  }));
}
function drawRoyale(t) {
  drawBackdrop(t, F.fx?.kind && F.plan.rounds[F.i] ? { kind: F.fx.kind, t: F.fx.t } : null);
  const R = F.plan.rounds[Math.min(F.i, F.plan.rounds.length - 1)];
  for (let k = 0; k < F.n; k++) {
    const x = F.x[k], dir = x < W / 2 ? 1 : -1, lead = !F.over && F.fx && R.leader === k;
    const dy = lead ? -24 * F.s : F.dodge[k] > 0 ? -Math.sin((F.dodge[k] / 0.5) * Math.PI) * 50 * F.s : 0;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(x, FLOOR + 5, 40 * F.s, 8 * F.s, 0, 0, Math.PI * 2); g.fill();
    if (lead) { g.save(); g.globalAlpha = 0.35 + Math.sin(t * 8) * 0.15; g.strokeStyle = F.colors[k]; g.lineWidth = 4; g.beginPath(); g.ellipse(x, FLOOR + 5, 56 * F.s, 12 * F.s, 0, 0, Math.PI * 2); g.stroke(); g.restore(); }
    g.save(); g.translate(x, FLOOR + dy); g.scale(F.s, F.s);
    drawBot(g, 0, 0, dir, F.looks[k], F.pose[k], t + k, F.flash[k]);
    g.restore();
    // HP bar and value above, name below
    const bw = Math.min(96, F.gap - 16), top = FLOOR - 196 * F.s - 16;
    if (F.pose[k] !== 'down') {
      g.fillStyle = '#2a0f14'; g.fillRect(x - bw / 2, top, bw, 7);
      g.fillStyle = F.hp[k] > 30 ? '#F2B544' : '#FF6B6B'; g.fillRect(x - bw / 2, top, bw * F.hp[k] / 100, 7);
      g.strokeStyle = 'rgba(243,244,248,.8)'; g.lineWidth = 1.5; g.strokeRect(x - bw / 2, top, bw, 7);
    }
    const v = F.shown[k];
    if (v != null && R.bench) { g.font = '400 13px "Press Start 2P", monospace'; g.textAlign = 'center'; g.fillStyle = '#000'; g.fillText(formatValue(R.bench, v), x + 2, top - 8); g.fillStyle = R.leader === k && F.phase >= 2 ? F.colors[k] : '#F3F4F8'; g.fillText(formatValue(R.bench, v), x, top - 10); }
    g.font = '600 13px Inter, sans-serif'; g.textAlign = 'center'; g.fillStyle = F.hp[k] === 0 ? '#5d6680' : F.colors[k];
    let nm = shortName(F.plan.fighters[k]);
    while (g.measureText(nm).width > F.gap - 8 && nm.length > 4) nm = nm.slice(0, -2) + '…';
    g.fillText(nm, x, FLOOR + 46);
  }
  drawSmoke();
  for (const s of F.shots) {
    if (s.delay > 0) continue;
    if (s.kind === 'bullet') { const gun = s.gun || GUNS.mg; g.save(); g.shadowColor = gun.glow; g.shadowBlur = 10; g.strokeStyle = gun.c; g.lineWidth = gun.width; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(s.a || 0) * Math.min(30, gun.len), s.y - Math.sin(s.a || 0) * Math.min(30, gun.len)); g.stroke(); g.restore(); }
    else if (s.kind === 'item') drawItem(g, s.it, t);
    else if (s.kind === 'plasma') { g.save(); g.shadowColor = '#B79CF2'; g.shadowBlur = 24; g.fillStyle = '#E4D8FF'; g.beginPath(); g.arc(s.x, s.y, 11, 0, Math.PI * 2); g.fill(); g.restore(); }
    else if (s.kind === 'bolt') { g.save(); g.globalAlpha = 1 - s.t / 0.22; g.shadowColor = '#7FD3F0'; g.shadowBlur = 16; g.strokeStyle = '#F3FBFF'; g.lineWidth = 4; g.beginPath(); s.pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke(); g.restore(); }
    else if (s.kind === 'anvil') { g.save(); g.translate(s.x, s.y); g.scale(F.s, F.s); g.fillStyle = '#4a4f63'; g.beginPath(); g.moveTo(-50, -26); g.lineTo(40, -26); g.quadraticCurveTo(62, -24, 68, -10); g.lineTo(20, -9); g.lineTo(16, 4); g.lineTo(-18, 4); g.lineTo(-22, -9); g.lineTo(-44, -10); g.closePath(); g.fill(); g.fillRect(-28, 4, 54, 16); g.restore(); }
    else if (s.kind === 'rocket' && s.style === 'grenade') { g.save(); g.translate(s.x, s.y); g.rotate(s.t * 14); g.fillStyle = '#4b5a2a'; g.beginPath(); g.ellipse(0, 0, 8, 10, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#9aa3b8'; g.fillRect(-3, -14, 6, 4); g.restore(); }
    else if (s.kind === 'rocket') { g.save(); g.translate(s.x, s.y); if (s.style === 'mini') g.scale(0.6, 0.6); g.fillStyle = '#d9dde8'; roundRect(g, -12, -5, 24, 10, 4); g.fill(); g.fillStyle = '#FF6B6B'; g.beginPath(); g.arc(12, 0, 5, 0, Math.PI * 2); g.fill(); g.restore(); }
    else if (s.kind === 'meteor') { g.save(); g.shadowColor = '#FF8A3D'; g.shadowBlur = 20; g.fillStyle = '#7a3b22'; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill(); g.fillStyle = '#FFB36B'; g.beginPath(); g.arc(s.x - s.r * 0.3, s.y - s.r * 0.3, s.r * 0.45, 0, Math.PI * 2); g.fill(); g.restore(); }
    else if (s.kind === 'move') drawMove(s.sp, g, t);
    else if (s.kind === 'beam') { const k = s.t / 0.6, wd = 44 * (1 - k * 0.6); g.save(); g.globalAlpha = 1 - k * 0.8; const gr = g.createLinearGradient(s.x - wd, 0, s.x + wd, 0); gr.addColorStop(0, 'rgba(127,211,240,0)'); gr.addColorStop(0.5, '#7FD3F0'); gr.addColorStop(1, 'rgba(127,211,240,0)'); g.fillStyle = gr; g.fillRect(s.x - wd, 0, wd * 2, FLOOR + 10); g.fillStyle = '#fff'; g.fillRect(s.x - wd * 0.18, 0, wd * 0.36, FLOOR + 10); g.restore(); }
  }
  if (F.moveTitle && F.moveTitle.t < 1.5) drawTitle(F.moveTitle.text, F.moveTitle.c, Math.min(1, F.moveTitle.t * 6) * Math.min(1, (1.5 - F.moveTitle.t) * 3), 1, 70);
  else if (F.fx?.title && F.fx.t < 1.2) drawTitle(F.fx.title, F.fx.titleC, Math.min(1, F.fx.t * 6) * Math.min(1, (1.2 - F.fx.t) * 3), 1, 70);
  drawParticles();
  drawArenaLabel(g, F.arena, 20);
}

// ---------- royale result ----------
const MEDALS = ['🥇', '🥈', '🥉'];
function royaleText() {
  const p = F.plan, ko = p.hp.filter((x) => x === 0).length;
  return [`👑 Benchmark Brawl battle royale · ${F.n} models`, ...p.placing.slice(0, 3).map((k, i) => `${MEDALS[i]} ${shortName(p.fighters[k])} (${p.hp[k]} HP)`),
    ko ? `💀 ${ko} knocked out` : '🛡️ Nobody knocked out', `${SITE_URL}${royaleHash(p.fighters.map((m) => m.id), rounds)}`].join('\n');
}
function showRoyaleResult() {
  const p = F.plan;
  cancelAnimationFrame(raf);
  setView('royaleResult');
  const w = p.winner >= 0 ? p.fighters[p.winner] : null;
  $('rverdict').style.setProperty('--c', w ? F.colors[p.winner] : '#F3F4F8');
  $('rverdict').replaceChildren(...(w ? ['👑 ', h('b', null, w.name), ' wins the royale'] : ['👑 A shared crown']));
  $('rhead').replaceChildren(h('th', null, '#'), h('th', null, 'Fighter'), ...p.rounds.map((R) => h('th', null, R.round.name, R.bench ? h('span', { class: 't' }, h('a', { href: safeUrl(R.bench.source.url), target: '_blank', rel: 'noopener' }, R.bench.name)) : h('span', { class: 't' }, 'skipped'))), h('th', null, 'HP'));
  $('rrows').replaceChildren(...p.placing.map((k, place) => h('tr', null,
    h('td', { class: 'num' }, MEDALS[place] || `${place + 1}`),
    h('td', { style: `color:${F.colors[k]};font-weight:700` }, shortName(p.fighters[k]), h('span', { class: 't' }, p.fighters[k].org)),
    ...p.rounds.map((R) => {
      const v = R.values[k], hit = R.hits.find((x) => x.target === k);
      const note = R.hpBefore[k] === 0 ? 'out' : v == null ? 'sat out' : R.leader === k ? '👑 fired' : hit.dmg ? `−${hit.dmg}` : 'dodged';
      return h('td', { class: `num ${R.leader === k ? 'win' : ''}`, style: `--c:${F.colors[k]}` }, R.hpBefore[k] === 0 ? '' : formatValue(R.bench, v), h('span', { class: 't' }, note));
    }),
    h('td', { class: 'num' }, p.hp[k] === 0 ? `K.O. (R${p.outIn[k] + 1})` : p.hp[k]))));
  $('rshare').textContent = royaleText();
  $('royaleResult').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
$('rrematch').addEventListener('click', startRoyale);
$('rcopy').addEventListener('click', () => { track('share-royale'); copyText(royaleText(), 'Copied royale and link'); });
$('ragain').addEventListener('click', backHome);

// ---------- claim check ----------
const VERDICTS = { match: '✅ Matches', lab: '🔺 Lab higher', ind: '🔻 Independent higher', unknown: '❔ No margin published' };
const verdictOf = judgeClaim;
let claimLab = 'all';
function openClaims(lab = 'all') {
  claimLab = lab;
  tab = 'claims';
  setView('claims');
  history.replaceState(null, '', `#claims${lab === 'all' ? '' : `=${encodeURIComponent(lab)}`}`);
  track('claims');
  renderClaims();
  $('claims').scrollIntoView({ block: 'start' });
}
function claimList() { return DATA.claims.filter((c) => claimLab === 'all' || byId.get(c.modelId).org === claimLab); }
function renderClaims() {
  const labs = [...new Set(DATA.claims.map((c) => byId.get(c.modelId).org))].sort();
  $('claimLab').replaceChildren(h('option', { value: 'all' }, 'All labs'), ...labs.map((l) => h('option', { value: l, selected: l === claimLab ? '' : null }, l)));
  const list = claimList().map((c) => ({ c, m: byId.get(c.modelId), b: benchById.get(c.bench), v: verdictOf(c) }))
    .sort((x, y) => (y.m.eci ?? 0) - (x.m.eci ?? 0) || x.b.name.localeCompare(y.b.name));
  const n = { match: 0, lab: 0, ind: 0, unknown: 0 }; for (const x of list) n[x.v.kind]++;
  $('claimSummary').replaceChildren(h('span', { class: 'stat' }, h('b', null, list.length), ' claims checked'),
    ...Object.entries(VERDICTS).filter(([k]) => k !== 'unknown' || n.unknown).map(([k, label]) => h('span', { class: 'stat' }, `${label}: `, h('b', null, n[k]))));
  $('claimRows').replaceChildren(...list.map(({ c, m, b, v }) => h('tr', null,
    h('td', { style: `color:${colorOf(m)};font-weight:700` }, m.name, h('span', { class: 't' }, m.org)),
    h('td', null, b.name, h('span', { class: 't' }, c.version && !/not stated/.test(c.version) ? `version ${c.version}` : '')),
    h('td', { class: 'num' }, `${c.claimed.toFixed(1)}%`, h('span', { class: 't', title: c.conditions }, h('a', { href: safeUrl(c.url), target: '_blank', rel: 'noopener' }, 'source'), ` · ${c.conditions.length > 60 ? `${c.conditions.slice(0, 58).replace(/[\s,;·]+\S*$/, '')}…` : c.conditions}`)),
    h('td', { class: 'num' }, `${c.indep.v.toFixed(1)}%`, h('span', { class: 't' }, `${v.margin != null ? `±${v.margin.toFixed(1)}` : 'no margin published'} · ${c.indep.setting} setting${c.indep.sameSetting ? ' (same as lab)' : v.settingsDiffer ? ` ⚠ the lab ran ${c.labSetting}` : ''} · `,
      h('a', { href: safeUrl(b.source.url), target: '_blank', rel: 'noopener' }, b.epochRun ? 'Epoch AI' : b.source.name.replace(/ by .*$/, '').replace(/, via Epoch AI$/, '')))),
    h('td', null, h('span', { class: `verdict-pill ${v.kind}` }, VERDICTS[v.kind]), v.kind === 'match' ? '' : h('span', { class: 't' }, `${v.diff > 0 ? '+' : ''}${v.diff.toFixed(1)} points${v.settingsDiffer ? ', different settings' : ''}`)))));
  $('claimShare').textContent = claimText(n, list.length);
}
function claimText(n, total) {
  return [`🔎 Benchmark Brawl claim check${claimLab === 'all' ? '' : ` · ${claimLab}`}`, `${total} lab claims vs independent tests`,
    `✅ ${n.match} match · 🔺 ${n.lab} lab higher · 🔻 ${n.ind} independent higher${n.unknown ? ` · ❔ ${n.unknown} no margin` : ''}`, `${SITE_URL}#claims${claimLab === 'all' ? '' : `=${encodeURIComponent(claimLab)}`}`].join('\n');
}
$('claimsClose').addEventListener('click', () => openTab('today'));
$('claimLab').addEventListener('change', (e) => openClaims(e.target.value));
$('claimCopy').addEventListener('click', () => { track('share-claims'); copyText($('claimShare').textContent, 'Copied claim check and link'); });

// ---------- views and tabs ----------
const SECTIONS = ['today', 'builder', 'select', 'ready', 'arena', 'result', 'royaleResult', 'tourney', 'claims'];
const VIEW_SECTIONS = { today: ['today'], play: ['builder', 'select', 'ready'], royale: ['builder', 'select', 'ready'], tournament: ['tourney'], claims: ['claims'], arena: ['arena'], result: ['result'], royaleResult: ['royaleResult'] };
let tab = 'today';
function setView(view) {
  for (const id of SECTIONS) $(id).hidden = !VIEW_SECTIONS[view].includes(id);
  document.body.dataset.view = view;
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
  if (view === 'today') startToday(); else stopToday();
}
function openTab(t) {
  tab = t;
  cancelAnimationFrame(raf);
  if (t === 'today') { history.replaceState(null, '', location.pathname + location.search); setView('today'); renderToday(); }
  else if (t === 'play' || t === 'royale') { mode = t === 'royale' ? 'royale' : '1v1'; if (mode === '1v1') picks = picks.slice(0, 2); setView(t); renderAll(); }
  else if (t === 'tournament') { if (bracket?.key === `${classId}|${rounds.join(',')}`) showBracket(); else openTournament(); }
  else if (t === 'claims') openClaims(claimLab);
  scrollTo({ top: 0 });
}
for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => openTab(b.dataset.tab));

// ---------- today: the daily brawl ----------
/** A scheduled brawl, with its fighters looked up; null if a fighter has since left the roster. */
function brawlFromEntry(e) {
  const a = e && byId.get(e.a), b = e && byId.get(e.b);
  return a && b ? { no: e.no, day: e.day, a, b, rounds: e.rounds.filter((id) => roundById.has(id)), featured: e.featured } : null;
}
// today's fight comes from the published schedule, so it never changes during the day; computed only as a fallback
const DAILY = brawlFromEntry(DATA.daily?.find((e) => e.day === NOW.toISOString().slice(0, 10))) ?? dailyBrawl(DATA, NOW);
const DAILY_KEY = 'brawl-daily-v1';
let daily = { days: {} };
try { daily = JSON.parse(localStorage.getItem(DAILY_KEY)) || daily; } catch { /* a private window: nothing saved */ }
const saveDaily = () => { try { localStorage.setItem(DAILY_KEY, JSON.stringify(daily)); } catch { /* fine */ } };
/** Today's saved call and result, only if it was for today's pairing (else it's from a different fight). */
function todayRec(create = false) {
  if (!DAILY) return null;
  const r = daily.days[DAILY.no];
  if (r && r.a === DAILY.a.id && r.b === DAILY.b.id) return r;
  if (!create) return null;
  return (daily.days[DAILY.no] = { a: DAILY.a.id, b: DAILY.b.id, pick: null });
}
/** Played, called, called right, current streak (consecutive brawls called right) and best streak. */
function dailyStats() {
  const recs = Object.entries(daily.days).map(([no, r]) => ({ no: Number(no), ...r })).filter((r) => r.winner).sort((x, y) => x.no - y.no);
  let streak = 0;
  for (let n = DAILY?.no ?? 0; n > 0; n--) { const r = daily.days[n]; if (r?.correct) streak++; else if (n === DAILY?.no && !r?.winner) continue; else break; }
  let best = 0, run = 0, prev = -1;
  for (const r of recs) { run = r.correct ? (prev === r.no - 1 && run > 0 ? run + 1 : 1) : 0; prev = r.no; best = Math.max(best, run); }
  const called = recs.filter((r) => r.pick);
  return { played: recs.length, called: called.length, right: called.filter((r) => r.correct).length, streak, best };
}
function recordDaily(p) {
  const r = todayRec(true);
  if (r.winner) return; // the first watch counts
  r.winner = p.winner >= 0 ? p.fighters[p.winner].id : 'draw';
  r.correct = r.pick ? r.pick === r.winner : null;
  saveDaily();
}
function dailyText(p, rec) {
  const [a, b] = p.fighters, st = dailyStats();
  const row = p.rounds.map((R) => (R.winner == null ? '⬛' : R.winner < 0 ? '🟨' : R.winner === 0 ? '🟩' : '🟥')).join('');
  return [`Benchmark Brawl #${DAILY.no} 🥊`, `${a.name} vs ${b.name}`, row, rec?.pick ? `My call: ${rec.correct ? '✅' : '❌'} · 🔥 ${st.streak}` : 'Watched it 👀', `${SITE_URL}#today=${DAILY.no}`].join('\n');
}
function renderToday() {
  if (!DAILY) { $('callBox').hidden = true; $('doneBox').hidden = true; $('brawlNo').textContent = 'NO BRAWL TODAY'; return; }
  const looks = looksFor([DAILY.a, DAILY.b]), rec = todayRec(), st = dailyStats();
  $('brawlNo').textContent = `BRAWL #${DAILY.no}`;
  $('streakChip').textContent = st.streak ? `🔥 ${st.streak}-day streak` : '🔥 Start a streak';
  [[DAILY.a, 'A', 0], [DAILY.b, 'B', 1]].forEach(([m, k, i]) => {
    $(`tag${k}`).textContent = DAILY.featured ? (i ? 'TOP CONTENDER' : 'NEW CHALLENGER') : (i ? 'BLUE CORNER' : 'RED CORNER');
    $(`tag${k}`).style.color = i ? 'var(--sky)' : 'var(--red)';
    $(`nm${k}`).textContent = m.name; $(`nm${k}`).style.color = looks[i].ui;
    $(`sub${k}`).textContent = `${m.org}${m.eci != null ? ` · ECI ${m.eci.toFixed(0)}` : ''}`;
    const btn = $(`call${k}`);
    btn.textContent = m.name; btn.style.setProperty('--c', looks[i].ui); btn.setAttribute('aria-pressed', String(rec?.pick === m.id));
  });
  $('roundsToday').textContent = `Today's rounds: ${DAILY.rounds.map((id) => roundById.get(id).name).join(' · ')}`;
  $('todayFight').disabled = !rec?.pick;
  $('todayFight').textContent = rec?.pick ? 'FIGHT!' : 'PICK A WINNER';
  const done = !!rec?.winner;
  $('callBox').hidden = done; $('doneBox').hidden = !done;
  if (done) {
    const w = byId.get(rec.winner);
    $('doneLine').textContent = w ? `${w.name.toUpperCase()} WON` : 'IT WAS A DRAW';
    $('doneLine').style.color = w ? colorOf(w) : '';
    $('doneCall').replaceChildren(...callBadge(rec));
  }
  $('stats').replaceChildren(...[[st.played, 'Played'], [st.called ? `${Math.round((100 * st.right) / st.called)}%` : '–', 'Called right'], [st.streak, 'Streak'], [st.best, 'Best']]
    .map(([v, l]) => h('div', null, h('b', null, String(v)), h('span', null, l))));
}
function callToday(k) {
  const m = k ? DAILY.b : DAILY.a, r = todayRec(true);
  if (r.winner) return;
  r.pick = m.id; saveDaily(); sfx.blip(true); renderToday();
}
function fightToday(replay = false) { picks = [DAILY.a.id, DAILY.b.id]; startFight({ daily: DAILY, rounds: DAILY.rounds, replay }); }
$('callA').addEventListener('click', () => callToday(0));
$('callB').addEventListener('click', () => callToday(1));
$('todayFight').addEventListener('click', () => fightToday());
$('justWatch').addEventListener('click', () => { const r = todayRec(true); if (!r.winner) { r.pick = null; saveDaily(); } fightToday(); });
$('doneWatch').addEventListener('click', () => fightToday(true));
$('doneShare').addEventListener('click', () => { track('share-today'); shareOrCopy(dailyText(planFight(DATA, DAILY.a, DAILY.b, DAILY.rounds), todayRec()), 'Copied your brawl'); });
$('doneCard').addEventListener('click', () => { track('card'); shareCard(planFight(DATA, DAILY.a, DAILY.b, DAILY.rounds), looksFor([DAILY.a, DAILY.b]), todayRec(), DAILY); });
// the stage: the two fighters idling under the city lights, and the countdown to the next brawl
let todayRaf = 0, todayTick = 0;
function startToday() {
  stopToday();
  if (!DAILY) return;
  const cv2 = $('todayCv'), phone = matchMedia('(max-width: 760px)').matches, [w, hgt] = phone ? [780, 600] : [1200, 460];
  if (cv2.width !== w) { cv2.width = w; cv2.height = hgt; }
  const c = cv2.getContext('2d'), floor = hgt - (phone ? 150 : 100), s = phone ? 1.25 : 1.3, looks = looksFor([DAILY.a, DAILY.b]);
  const loop = (now) => {
    const t = now / 1000;
    drawArena(arenaFor(`daily|${DAILY.no}`), c, w, hgt, floor, t);
    [DAILY.a, DAILY.b].forEach((m, k) => { c.save(); c.translate(w * (k ? 0.72 : 0.28), floor); c.scale(s, s); drawBot(c, 0, 0, k ? -1 : 1, looks[k], 'idle', t + k); c.restore(); });
    c.font = `400 ${phone ? 40 : 48}px "Press Start 2P", monospace`; c.textAlign = 'center';
    c.fillStyle = '#000'; c.fillText('VS', w / 2 + 5, floor - 120 + 5); c.fillStyle = '#F2B544'; c.fillText('VS', w / 2, floor - 120);
    if (!reduced) todayRaf = requestAnimationFrame(loop);
  };
  todayRaf = requestAnimationFrame(loop);
  const tick = () => { const ms = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + 1) - Date.now(); const s2 = Math.max(0, Math.floor(ms / 1000));
    $('nextBrawl').textContent = ms > 0 ? `Next brawl in ${String(Math.floor(s2 / 3600)).padStart(2, '0')}:${String(Math.floor(s2 / 60) % 60).padStart(2, '0')}:${String(s2 % 60).padStart(2, '0')}` : 'A new brawl is ready: reload'; };
  tick(); todayTick = setInterval(tick, 1000);
}
function stopToday() { cancelAnimationFrame(todayRaf); clearInterval(todayTick); }

// ---------- sharing ----------
/** The phone share sheet when there is one, else the clipboard. */
async function shareOrCopy(text, done) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ text }); return; } catch { /* cancelled: fall through */ } }
  copyText(text, done);
}
/** A 4:5 share card (1080×1350), sized for Instagram and X. */
async function shareCard(p, looks, rec, brawl) {
  const cv2 = document.createElement('canvas'); cv2.width = 1080; cv2.height = 1350;
  const c = cv2.getContext('2d'), floor = 760;
  drawArena(brawl ? arenaFor(`daily|${brawl.no}`) : F?.arena || 'city', c, 1080, 1350, floor, 2);
  c.fillStyle = '#0A0C14'; c.fillRect(0, floor + 3, 1080, 1350 - floor);
  p.fighters.forEach((m, k) => { const pose = p.winner === k ? 'win' : p.winner < 0 ? 'idle' : p.ko ? 'down' : 'hurt'; c.save(); c.translate(k ? 740 : 340, floor); c.scale(1.9, 1.9); drawBot(c, 0, 0, k ? -1 : 1, looks[k], pose, k); c.restore(); });
  const txt2 = (t, x, y, px, col, font = 'arcade') => { c.font = font === 'arcade' ? `400 ${px}px "Press Start 2P", monospace` : `700 ${px}px Inter, sans-serif`; c.textAlign = 'center'; c.fillStyle = '#000'; c.fillText(t, x + 5, y + 5); c.fillStyle = col; c.fillText(t, x, y); };
  const fit = (t, px) => { c.font = `400 ${px}px "Press Start 2P", monospace`; while (c.measureText(t).width > 980 && px > 20) { px -= 2; c.font = `400 ${px}px "Press Start 2P", monospace`; } return px; };
  txt2('BENCHMARK BRAWL', 540, 96, 40, '#FF6B6B');
  if (brawl) txt2(`#${brawl.no}`, 540, 160, 32, '#F2B544');
  const w = p.winner >= 0 ? p.fighters[p.winner] : null, title = w ? `${w.name.toUpperCase()} WINS` : 'A DRAW';
  txt2(title, 540, 880, fit(title, 52), w ? looks[p.winner].ui : '#F3F4F8');
  txt2(`${p.fighters[0].name}  vs  ${p.fighters[1].name}`, 540, 950, 34, '#C9CFDC', 'ui');
  const sq = 70, gap = 16, n = p.rounds.length, x0 = 540 - (n * sq + (n - 1) * gap) / 2;
  p.rounds.forEach((R, i) => { c.fillStyle = R.winner == null ? '#2a2f45' : R.winner < 0 ? '#C9A23A' : looks[R.winner].ui; c.beginPath(); c.roundRect?.(x0 + i * (sq + gap), 1010, sq, sq, 12); c.fill(); });
  if (rec?.pick) txt2(rec.correct ? 'MY CALL: RIGHT' : 'MY CALL: WRONG', 540, 1170, 30, rec.correct ? '#2EC4A6' : '#FF6B6B');
  txt2('Real models · real benchmark scores', 540, 1240, 30, '#9AA3B8', 'ui');
  txt2(SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), 540, 1295, 28, '#F3F4F8', 'ui');
  const blob = await new Promise((r) => cv2.toBlob(r, 'image/png'));
  const file = new File([blob], `benchmark-brawl${brawl ? `-${brawl.no}` : ''}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ files: [file] }); return; } catch { /* fall back to download */ } }
  const url = URL.createObjectURL(file); h('a', { href: url, download: file.name }).click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast(`Saved ${file.name}`);
}

// ---------- start ----------
const claimsHash = location.hash.match(/^#claims(?:=(.+))?$/);
/** The lab in a #claims=… link, if it's one we have claims for. */
function claimLabFromHash(raw) {
  let lab = 'all';
  try { lab = raw ? decodeURIComponent(raw) : 'all'; } catch { /* a malformed link: show all */ }
  return DATA.claims.some((c) => byId.get(c.modelId)?.org === lab) ? lab : 'all';
}
const shared = claimsHash ? false : readHash();
const tabHash = location.hash.match(/^#(today|play|royale|tournament)$/)?.[1];
const pastBrawl = Number(location.hash.match(/^#today=(\d+)$/)?.[1]) || null;
renderAll();
if (claimsHash) { claimLab = claimLabFromHash(claimsHash[1]); openTab('claims'); }
else if (wantTourney) openTab('tournament');
else if (shared && mode === 'royale') {
  openTab('royale');
  toast(`Shared battle royale: ${picks.length} fighters. Press FIGHT!`);
} else if (shared) {
  openTab('play');
  const [a, b] = picks.map((id) => byId.get(id));
  toast(`Shared fight: ${a.name} vs ${b.name}. Press FIGHT!`);
} else if (pastBrawl && pastBrawl !== DAILY?.no) {
  // a link to an earlier daily brawl replays that exact fight
  const old = brawlFromEntry(DATA.daily?.find((e) => e.no === pastBrawl));
  if (old) { picks = [old.a.id, old.b.id]; rounds = old.rounds.length >= MIN_ROUNDS ? old.rounds : rounds; openTab('play'); toast(`Brawl #${old.no}: ${old.a.name} vs ${old.b.name}. Press FIGHT to replay it.`); }
  else { openTab('today'); toast(`Brawl #${pastBrawl} is too old to replay. Here's today's.`); }
} else openTab(tabHash ?? 'today');
