// Benchmark Brawl page. The rules live in ../fight.ts and ../league.ts; this file draws and plays them.
import { formatValue, planFight, weaponName } from '../fight.ts';
import { planRoyale, ROYALE_MAX, ROYALE_MIN } from '../royale.ts';
import { drawMove, moveNameFor, startMove, updateMove } from './specials.js';
import { CLASSES, featuredFight, inClass, MAX_ROUNDS, MIN_ROUNDS, newChallengers, PRESETS, runTournament } from '../league.ts';

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
/**
 * x is the centre, y the floor, dir 1 faces right. pose: idle | aim | summon | hurt | down | win. gear: { kind, muzzle }.
 * `look` is a colour, or a look from lookOf(): each lab's robot has its own extras.
 */
function drawBot(g, x, y, dir, look, pose, t, flash = 0, gear = null) {
  const L = typeof look === 'string' ? { kind: 'default', body: look, accent: '#2b3350', size: 1 } : look;
  const K = L.kind, sz = L.size || 1;
  g.save();
  g.translate(x, y); g.scale(dir * sz, sz);
  const bob = pose === 'idle' && !reduced ? Math.sin(t * (sz < 1 ? 7 : 4)) * (sz < 1 ? 3 : 2) : 0;
  const recoil = gear?.muzzle > 0 ? -4 : 0;
  const lean = pose === 'aim' ? 4 + recoil : pose === 'hurt' ? -12 : 0;
  if (pose === 'down') { g.rotate(-Math.PI / 2 * 0.92); g.translate(-20, 30); }
  g.translate(lean, bob);
  const ink = '#0A0C14', body = flash > 0 ? '#ffffff' : L.body, acc = L.accent;
  const edge = () => { if (L.outline && !flash) { g.strokeStyle = 'rgba(201,207,220,.75)'; g.lineWidth = 2; g.stroke(); } };
  // things on its back
  if (K === 'xai' || K === 'zai') {
    const w = reduced ? 0 : Math.sin(t * 5) * 6;
    g.fillStyle = K === 'xai' ? '#3a3f52' : '#0d0f16';
    g.beginPath(); g.moveTo(-24, -110); g.lineTo(-62 + w, -24); g.lineTo(-40 + w * 0.5, -30); g.lineTo(-30, -18); g.lineTo(-6, -110); g.closePath(); g.fill();
    if (K === 'xai') { g.strokeStyle = '#F3F4F8'; g.lineWidth = 1.5; g.stroke(); }
  } else if (K === 'anthropic') {
    g.save(); g.translate(-30, -96); g.rotate(-0.45);
    g.fillStyle = '#F0EEE6'; g.fillRect(-7, -40, 14, 62); g.fillStyle = '#B9A88A'; g.fillRect(-9, -43, 18, 6); g.fillRect(-9, 19, 18, 6);
    g.restore();
  } else if (K === 'nvidia') {
    g.fillStyle = '#23262f'; for (let i = 0; i < 5; i++) g.fillRect(-42, -108 + i * 12, 14, 7);
  } else if (K === 'mistral') {
    const w = reduced ? 0 : Math.sin(t * 6) * 5;
    g.fillStyle = acc; g.beginPath(); g.moveTo(-20, -118); g.quadraticCurveTo(-48, -122 + w, -70, -108 - w); g.lineTo(-66, -100 - w); g.quadraticCurveTo(-44, -110 + w, -20, -108); g.fill();
  }
  // legs
  g.fillStyle = '#2b3350';
  const stride = pose === 'aim' || pose === 'summon' ? 8 : 0;
  g.fillRect(-20 - stride, -44, 14, 44); g.fillRect(6 + stride, -44, 14, 44);
  g.fillStyle = ink; g.fillRect(-24 - stride, -6, 20, 6); g.fillRect(4 + stride, -6, 22, 6);
  // torso
  g.fillStyle = body; roundRect(g, -30, -112, 60, 70, K === 'deepseek' ? 26 : K === 'openai' ? 16 : 10); g.fill(); edge();
  g.fillStyle = 'rgba(0,0,0,.18)'; roundRect(g, -30, -60, 60, 18, 6); g.fill();
  if (K === 'nvidia') {
    g.fillStyle = ink; g.beginPath(); g.arc(0, -86, 12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = body; g.lineWidth = 3; for (let i = 0; i < 4; i++) { const a = (reduced ? 0 : t * 14) + i * Math.PI / 2; g.beginPath(); g.moveTo(0, -86); g.lineTo(Math.cos(a) * 10, -86 + Math.sin(a) * 10); g.stroke(); }
  } else if (K === 'openai') {
    g.fillStyle = flash ? body : acc; g.beginPath(); g.arc(0, -86, 5, 0, Math.PI * 2); g.fill();
  } else { g.fillStyle = ink; g.fillRect(-10, -96, 20, 20); g.fillStyle = body; g.fillRect(-6, -92, 12, 12); }
  if (K === 'google') { for (const [i, c] of ['#EA4335', '#FBBC05', '#34A853'].entries()) { g.fillStyle = c; g.fillRect(-24 + i * 17, -66, 14, 5); } }
  if (K === 'xai') { g.fillStyle = '#3a3f52'; for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * 30, -112); g.lineTo(sx * 40, -128); g.lineTo(sx * 18, -112); g.fill(); } }
  if (K === 'alibaba') { g.fillStyle = '#2b3350'; g.fillRect(24, -72, 16, 6); g.fillRect(-40, -72, 16, 6); g.fillStyle = acc; g.fillRect(38, -75, 8, 12); g.fillRect(-46, -75, 8, 12); }
  // head (MiniMax: a much bigger one)
  g.save();
  if (K === 'minimax') { g.translate(0, -114); g.scale(1.75, 1.75); g.translate(0, 114); }
  if (K === 'thinking') {
    g.fillStyle = body; g.fillRect(-24, -122, 48, 9);
    g.fillStyle = 'rgba(210,228,255,.22)'; g.beginPath(); g.arc(0, -122, 26, Math.PI, 0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(230,240,255,.8)'; g.lineWidth = 2; g.stroke();
    for (const [gx, gy, r, sp] of [[-7, -132, 8, 1], [8, -136, 6, -1.4]]) {
      g.save(); g.translate(gx, gy); g.rotate((reduced ? 0 : t * 2) * sp); g.fillStyle = '#B9A88A';
      g.beginPath(); g.arc(0, 0, r * 0.7, 0, Math.PI * 2); g.fill(); for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.fillRect(-1.5, -r, 3, 4); } g.restore();
    }
    g.fillStyle = '#F3F4F8'; g.fillRect(10, -127, 8, 4);
  } else {
    g.fillStyle = body; roundRect(g, -24, -152, 48, 38, K === 'openai' ? 18 : K === 'deepseek' ? 16 : 9); g.fill(); edge();
    if (K === 'openai') { g.save(); g.shadowColor = acc; g.shadowBlur = 10; g.fillStyle = flash ? '#fff' : acc; g.fillRect(-10, -137, 32, 4); g.restore(); }
    else {
      g.fillStyle = ink; roundRect(g, -16, -142, 38, 12, 5); g.fill();
      g.fillStyle = pose === 'hurt' || pose === 'down' ? '#FF6B6B' : '#F3F4F8'; g.fillRect(6, -139, 10, 6);
    }
    if (K === 'anthropic') { g.strokeStyle = '#2b3350'; g.lineWidth = 2.5; g.beginPath(); g.arc(1, -136, 7.5, 0, Math.PI * 2); g.moveTo(25.5, -136); g.arc(18, -136, 7.5, 0, Math.PI * 2); g.moveTo(8.5, -136); g.lineTo(10.5, -136); g.stroke(); }
    if (K === 'xai') { g.fillStyle = '#05060a'; g.fillRect(-18, -143, 42, 14); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(-12, -141, 7, 3); g.fillRect(8, -141, 7, 3); }
    if (K === 'zai') {
      g.fillStyle = '#05060a'; g.fillRect(-24, -145, 48, 16); g.beginPath(); g.moveTo(-24, -143); g.lineTo(-36, -150); g.lineTo(-34, -136); g.lineTo(-24, -133); g.fill();
      g.fillStyle = '#F3F4F8'; g.fillRect(6, -140, 10, 6);
    }
  }
  // antenna
  g.fillStyle = '#2b3350';
  if (K === 'google') { for (const [ax, c] of [[-9, '#EA4335'], [9, '#34A853']]) { g.fillStyle = '#2b3350'; g.fillRect(ax - 2, -162, 4, 10); g.fillStyle = c; g.beginPath(); g.arc(ax, -164, 4.5, 0, Math.PI * 2); g.fill(); } }
  else if (K === 'deepseek') { g.fillStyle = '#9FD8FF'; for (let i = 0; i < 4; i++) { const p = ((reduced ? 0.3 : t * 1.5) + i / 4) % 1; g.globalAlpha = 1 - p; g.beginPath(); g.arc(Math.sin(i * 2) * 8 * p, -156 - p * 26, 3.5 - p * 1.5, 0, Math.PI * 2); g.fill(); } g.globalAlpha = 1; }
  else if (K === 'moonshot') { g.fillRect(-2, -162, 4, 10); g.fillStyle = acc; g.beginPath(); g.arc(0, -170, 8, -Math.PI / 2, Math.PI / 2); g.arc(-4, -170, 7, Math.PI / 2, -Math.PI / 2, true); g.fill(); }
  else if (K === 'meta') { g.fillStyle = body; roundRect(g, -18, -174, 9, 26, 4); g.fill(); roundRect(g, 9, -174, 9, 26, 4); g.fill(); g.fillStyle = acc; g.fillRect(-15, -168, 3, 14); g.fillRect(12, -168, 3, 14); }
  else if (K !== 'openai' && K !== 'thinking') { g.fillRect(-3, -162, 6, 10); g.fillStyle = K === 'default' ? body : acc === ink ? body : acc; g.beginPath(); g.arc(0, -164, 5, 0, Math.PI * 2); g.fill(); }
  g.restore();
  if (K === 'mistral') { g.fillStyle = acc; g.fillRect(-26, -118, 52, 8); }
  // arms
  g.fillStyle = '#2b3350';
  if (pose === 'aim' && gear?.kind === 'rocket') {
    g.fillRect(8, -132, 34, 12);
    g.fillStyle = '#39402f'; roundRect(g, -40, -158, 124, 26, 6); g.fill();
    g.fillStyle = body; g.fillRect(-10, -158, 10, 26); g.fillRect(54, -158, 6, 26);
    g.fillStyle = '#1b1f17'; g.beginPath(); g.ellipse(84, -145, 6, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5b6448'; g.fillRect(14, -134, 14, 18);
    if (gear.muzzle > 0) { g.fillStyle = 'rgba(255,200,90,.9)'; g.beginPath(); g.moveTo(-40, -158); g.lineTo(-90, -145); g.lineTo(-40, -132); g.fill(); }
  } else if (pose === 'aim') {
    g.fillRect(14, -106, 40, 12);
    g.fillStyle = '#3a3f52'; roundRect(g, 30, -118, 62, 20, 4); g.fill();
    g.fillStyle = '#262a38'; g.fillRect(92, -113, 40, 8); g.fillRect(48, -100, 12, 18); g.fillRect(18, -114, 14, 10);
    g.fillStyle = body; g.fillRect(60, -118, 22, 4);
    if (gear?.muzzle > 0) {
      g.fillStyle = '#FFE066'; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 9 : 22 + Math.random() * 8; g.lineTo(140 + Math.cos(a) * r, -109 + Math.sin(a) * r * 0.6); }
      g.fill();
    }
  } else if (pose === 'summon') {
    g.fillRect(16, -170, 14, 60); g.fillStyle = body; roundRect(g, 12, -186, 24, 24, 6); g.fill(); edge();
    g.fillStyle = gear?.kind === 'laser' ? 'rgba(127,211,240,.55)' : 'rgba(255,120,60,.55)';
    g.beginPath(); g.arc(24, -176, 16 + Math.sin(t * 18) * 5, 0, Math.PI * 2); g.fill();
  } else if (pose === 'win') { g.fillRect(16, -170, 14, 60); g.fillStyle = body; roundRect(g, 12, -186, 24, 24, 6); g.fill(); edge(); }
  else { g.fillRect(20, -104, 30, 13); g.fillStyle = body; roundRect(g, 42, -112, 22, 24, 6); g.fill(); edge(); }
  g.fillStyle = '#2b3350'; g.fillRect(-36, -104, 12, 36);
  g.fillStyle = body; roundRect(g, -40, -74, 20, 20, 6); g.fill(); edge();
  g.restore();
}
function roundRect(g, x, y, w, hgt, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hgt, r); g.arcTo(x + w, y + hgt, x, y + hgt, r); g.arcTo(x, y + hgt, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ---------- state ----------
let rounds = [...DATA.defaultRounds];
let classId = 'all', query = '', sortBy = 'eci';
let picks = [], cursor = 0;
let mode = '1v1'; // or 'royale': 3 to 8 fighters at once
let F = null; // the fight being shown
let bracket = null, fromBracket = false, wantTourney = false;

// ---------- header, featured fight, credits ----------
$('updated').textContent = `Scores updated ${fmtDate(DATA.generatedAt.slice(0, 10))}`;
function renderFeatured() {
  const pair = featuredFight(DATA.models, NOW);
  if (!pair) { $('featured').replaceChildren(); return; }
  const [a, b] = pair, [ca, cb] = fightColors(a, b);
  const champ = DATA.models.indexOf(b) === 0;
  $('featured').replaceChildren(h('div', { class: 'featured' },
    h('div', null, h('div', { class: 'tag' }, 'NEW CHALLENGER'), h('div', { class: 'nm', style: `color:${ca}` }, a.name), h('div', { class: 'sub' }, `${a.org} · released ${fmtDate(a.released)}`)),
    h('div', { class: 'vs' }, 'VS'),
    h('div', { class: 'r' }, h('div', { class: 'tag' }, champ ? 'CHAMPION' : 'TOP CONTENDER'), h('div', { class: 'nm', style: `color:${cb}` }, b.name), h('div', { class: 'sub' }, `${b.org} · highest capability index`)),
    h('button', { type: 'button', class: 'btn go', onclick: () => { mode = '1v1'; picks = [a.id, b.id]; renderAll(); startFight(); } }, 'FIGHT OF THE WEEK')));
}
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
/** The value shown on a card for a round: the first benchmark in the round this model has. */
function cardValue(m, roundId) {
  const r = roundById.get(roundId);
  for (const id of r.benches) {
    const b = benchById.get(id);
    if (b.kind === 'price') { if (m.price) return { label: r.name, text: `$${m.price.blended.toFixed(2)}`, pct: Math.max(4, 100 - Math.log2(m.price.blended / 0.05) * 11) }; }
    else if (m.scores[id]) return { label: r.name, text: m.scores[id].v.toFixed(0), pct: m.scores[id].v };
  }
  return { label: r.name, text: '–', pct: 0 };
}
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
    const cv2 = h('canvas', { width: 88, height: 104, 'aria-hidden': 'true' });
    const card = h('button', { type: 'button', class: `fighter ${i === cursor ? 'cursor' : ''}`, style: `--c:${c}`, 'data-id': m.id, 'data-slot': slot >= 0 ? `P${slot + 1}` : null, 'aria-pressed': String(slot >= 0), onclick: () => { cursor = i; pick(m.id); } },
      h('div', { class: 'top' }, cv2, h('div', null, h('div', { class: 'nm' }, m.name), h('div', { class: 'meta' }, `${m.org} · ${fmtDate(m.released)}`))),
      h('div', { class: 'badges' }, fresh.has(m.id) ? h('span', { class: 'badge new' }, 'NEW') : null, m.open ? h('span', { class: 'badge open' }, 'OPEN WEIGHTS') : null,
        m.price ? h('span', { class: 'badge' }, `$${m.price.blended.toFixed(2)}/M`) : null, m.eci ? h('span', { class: 'badge', title: 'Epoch Capabilities Index' }, `ECI ${m.eci.toFixed(0)}`) : null),
      h('div', { class: 'bars' }, rounds.map((rid) => { const v = cardValue(m, rid); return h('div', null, h('span', null, v.label), h('i', null, h('b', { style: `width:${v.pct}%` })), h('span', null, v.text)); })));
    const g = cv2.getContext('2d'); g.scale(0.42, 0.42); drawBot(g, 100, 236, 1, lookOf(m), slot >= 0 ? 'win' : 'idle', 0);
    return card;
  }));
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
  if (!$('arena').hidden || !$('tourney').hidden || !$('claims').hidden || e.target.closest?.('input, select, textarea')) return;
  if (e.target.closest?.('button, a') && !e.target.closest('.fighter')) return;
  const list = visibleModels(), n = list.length;
  if (!n) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') cursor = (cursor + 1) % n;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') cursor = (cursor + n - 1) % n;
  else if ((e.key === 'Enter' || e.key === ' ') && mode === '1v1' && picks.length === 2 && picks.includes(list[cursor].id)) { e.preventDefault(); return startFight(); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return pick(list[cursor].id); }
  else return;
  e.preventDefault(); renderRoster();
  document.querySelectorAll('.fighter')[cursor]?.focus({ preventScroll: false });
});
function renderMode() {
  $('selectTitle').textContent = mode === 'royale' ? `2 · Choose ${ROYALE_MIN} to ${ROYALE_MAX} fighters` : '2 · Choose two fighters';
  $('modeChips').replaceChildren(...[h('span', { class: 'fine' }, 'Mode:'),
    ...[['1v1', '🥊 1 v 1'], ['royale', `👑 Battle royale (${ROYALE_MIN}–${ROYALE_MAX})`]].map(([id, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(mode === id),
      onclick: () => { if (mode === id) return; mode = id; if (mode === '1v1') picks = picks.slice(0, 2); renderAll(); sfx.blip(true); } }, label)),
    mode === 'royale' ? h('button', { type: 'button', class: 'btn small', id: 'fillTop', title: 'The 8 most capable in this weight class, by Epoch Capabilities Index',
      onclick: () => { picks = DATA.models.filter((m) => inClass(m, classId)).sort((a, b) => (b.eci ?? -1) - (a.eci ?? -1)).slice(0, ROYALE_MAX).map((m) => m.id); renderAll(); sfx.blip(true); } }, 'Fill with the top 8') : null].filter(Boolean)); // replaceChildren would print null
}
function renderAll() { renderBuilder(); renderMode(); renderClassChips(); renderRoster(); writeHash(); }

// ---------- links: #a=<id>&b=<id>&r=coding,math ----------
function royaleHash(ids, rs) { return `#m=royale&f=${ids.map(encodeURIComponent).join(',')}&r=${rs.join(',')}`; }
function hashFor(a, b, rs) { return `#a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&r=${rs.join(',')}`; }
const classPart = () => (classId === 'all' ? '' : `&c=${classId}`);
function writeHash() { const h2 = mode === 'royale' ? royaleHash(picks, rounds) + classPart() : picks.length === 2 ? hashFor(picks[0], picks[1], rounds) + classPart() : `#r=${rounds.join(',')}${classPart()}`; history.replaceState(null, '', h2); }
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const rs = (p.get('r') || '').split(',').filter((r) => roundById.has(r));
  if (rs.length >= MIN_ROUNDS) rounds = [...new Set(rs)].slice(0, MAX_ROUNDS);
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
  const plan = planFight(DATA, a, b, rounds);
  F = { plan, colors: fightColors(a, b), looks: looksFor([a, b]), i: 0, phase: 0, t: 0, x: [300, 660], pose: ['idle', 'idle'], flash: [0, 0], shake: 0, white: 0, sparks: [], floats: [], booms: [], fx: null, hp: [100, 100], over: false, recording: !!opts.recording, onDone: opts.onDone || null, special: bigHits(plan) };
  for (const id of ['builder', 'select', 'ready', 'result', 'tourney', 'featured', 'royaleResult']) $(id).hidden = true;
  $('arena').hidden = false;
  $('arena').classList.remove('royale');
  $('arenaNote').textContent = 'Damage = 2 × score gap · bigger gap, bigger weapon · within the margin of error = tie';
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
  writeHashFight();
  if (!F.recording) track(`fight/${a.id}-vs-${b.id}`);
  $('arena').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  enterPhase();
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function writeHashFight() { history.replaceState(null, '', hashFor(F.plan.fighters[0].id, F.plan.fighters[1].id, rounds)); }
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
function resultLine(R) {
  const [a, b] = F.plan.fighters;
  if (R.winner == null) return 'No shared benchmark for this round. No damage.';
  if (R.tie === 'margin') return `Within the margin of error (±${R.margin}). Bullets collide, no damage.`;
  if (R.tie === 'price') return 'Prices within 15% of each other. Crossfire, no damage.';
  if (R.winner === -1) return 'Dead even. Crossfire, no damage.';
  const w = R.winner === 0 ? a : b;
  const by = R.bench.kind === 'price' ? `${(Math.max(...R.values) / Math.min(...R.values)).toFixed(1)}× cheaper` : `by ${R.points} point${R.points === 1 ? '' : 's'}`;
  return `${F.special?.[R.winner] === F.plan.rounds.indexOf(R) ? moveNameFor(w.org) : weaponName(R.weapon)}! ${w.name} ${by}${R.bench.kind === 'score' && R.margin == null ? ' (no margin published)' : ''} → −${R.dmg} HP`;
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
  else if (w >= 0) { banner(`${p.fighters[w].name.toUpperCase()} WINS`, 'On points: more HP left after the last round'); sfx.win(); }
  else banner('DRAW', 'Same HP after the last round');
}
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  if (F && !$('arena').hidden) { if (F.royale) { stepRoyale(dt); drawRoyale(now / 1000); } else { step(dt); draw(now / 1000); } }
  raf = requestAnimationFrame(frame);
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
  const attackLen = F.fx?.kind === 'special' ? F.fx.sp.len : R.weapon === 'mg' || R.weapon === 'tie' ? 1.5 : R.weapon === 'rocket' ? 1.7 : 2.25;
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
function startFx(R) {
  const w = R.winner, kind = R.weapon;
  const fx = { kind, t: 0, shots: [], rockets: [], meteors: [], hits: 0, landed: 0, fired: 0, nextShot: 0.25, muzzle: [0, 0], title: weaponName(kind), titleC: w >= 0 ? F.colors[w] : '#F3F4F8' };
  if (kind === 'tie') { F.pose = ['aim', 'aim']; fx.toFire = 7; return fx; }
  if (F.special[w] === F.i) {
    const l = 1 - w, m = F.plan.fighters[w];
    F.pose[w] = 'summon';
    Object.assign(fx, { kind: 'special', hits: 1, title: moveNameFor(m.org) });
    fx.sp = startMove(m.org, { ...moveKit(), ax: F.x[w] + dirOf(w) * 24, ay: FLOOR - 176, x: F.x[w], tx: F.x[l], ty: FLOOR - 100, floor: FLOOR, s: 1, dir: dirOf(w), color: F.colors[w], look: F.looks[w], ko: R.hpAfter[l] === 0,
      land: () => landHit(fx, R, F.x[l], FLOOR - 100, 'big') });
    return fx;
  }
  F.pose[w] = kind === 'meteor' || kind === 'laser' ? 'summon' : 'aim';
  fx.hits = kind === 'mg' ? 10 : kind === 'rocket' ? (R.points >= 7 ? 2 : 1) : kind === 'meteor' ? 6 : 1;
  fx.toFire = fx.hits;
  if (kind === 'meteor') sfx.rumble();
  if (kind === 'laser') { sfx.lock(); setTimeout(() => sfx.charge(), 250); }
  return fx;
}
function landHit(fx, R, x, y, size) {
  const l = 1 - R.winner;
  fx.landed++;
  const dealt = Math.round(R.dmg * fx.landed / fx.hits);
  F.hp[l] = fx.landed >= fx.hits ? R.hpAfter[l] : Math.max(0, R.hpBefore[l] - dealt);
  setHp(false);
  F.pose[l] = 'hurt'; F.flash[l] = 0.12;
  F.shake = reduced ? 0 : Math.max(F.shake, size === 'big' ? 18 : size === 'mid' ? 10 : 4);
  if (size !== 'small') explode(x, y, size === 'big', fx.kind === 'laser' ? 0.85 : undefined);
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
  if (fx.kind === 'mg' || fx.kind === 'tie') {
    const shooters = fx.kind === 'tie' ? [0, 1] : [w];
    if (fx.fired < fx.toFire && fx.t >= fx.nextShot) {
      for (const k of shooters) {
        fx.shots.push({ k, x: F.x[k] + dirOf(k) * 132, y: FLOOR - 109 + (Math.random() - 0.5) * 6, vx: dirOf(k) * 1700 });
        fx.muzzle[k] = 0.05;
        if (k === shooters[0]) { sfx.shot(); sfx.casing(); }
        F.sparks.push({ kind: 'spark', x: F.x[k] - dirOf(k) * 10, y: FLOOR - 112, vx: -dirOf(k) * (60 + Math.random() * 80), vy: -220 - Math.random() * 120, life: 0.5, c: '#E8C66A' });
      }
      fx.fired++; fx.nextShot += 0.075;
    }
    for (const b of fx.shots) b.x += b.vx * dt;
    if (fx.kind === 'tie') {
      const mid = (F.x[0] + F.x[1]) / 2;
      fx.shots = fx.shots.filter((b) => { if ((b.vx > 0 && b.x < mid) || (b.vx < 0 && b.x > mid)) return true; if (b.k === 0) { burstSparks(mid, b.y, 5, '#FFE066'); sfx.clink(); } return false; });
    } else {
      fx.shots = fx.shots.filter((b) => {
        const hitX = F.x[l] - dirOf(w) * 26;
        if ((b.vx > 0 && b.x < hitX) || (b.vx < 0 && b.x > hitX)) return true;
        landHit(fx, R, hitX, b.y, 'small'); if (Math.random() < 0.4) sfx.ricochet(); return false;
      });
    }
  } else if (fx.kind === 'rocket') {
    if (fx.fired < fx.toFire && fx.t >= 0.3 + fx.fired * 0.35) {
      const x0 = F.x[w] + dirOf(w) * 84, y0 = FLOOR - 145;
      fx.rockets.push({ x0, y0, x1: F.x[l], y1: FLOOR - 100, t: 0, dur: 0.55 });
      fx.muzzle[w] = 0.12; fx.fired++; sfx.launch();
      for (let i = 0; i < 6; i++) F.sparks.push({ kind: 'smoke', x: F.x[w] - dirOf(w) * 50, y: y0, vx: -dirOf(w) * (40 + Math.random() * 80), vy: -20 - Math.random() * 30, r: 10, life: 0.9, c: '#4a4f63' });
    }
    fx.rockets = fx.rockets.filter((r) => {
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.x = r.x0 + (r.x1 - r.x0) * k; r.y = r.y0 + (r.y1 - r.y0) * k - Math.sin(k * Math.PI) * 70;
      r.a = Math.atan2((r.y1 - r.y0) - Math.cos(k * Math.PI) * Math.PI * 70, r.x1 - r.x0);
      if (!reduced) F.sparks.push({ kind: 'smoke', x: r.x - Math.cos(r.a) * 26, y: r.y - Math.sin(r.a) * 26, vx: (Math.random() - 0.5) * 20, vy: -10, r: 6, life: 0.6, c: '#5a5f73' });
      if (k < 1) return true;
      landHit(fx, R, r.x1, r.y1, fx.toFire > 1 ? 'mid' : 'big'); return false;
    });
  } else if (fx.kind === 'meteor') {
    if (fx.fired < fx.toFire && fx.t >= 0.4 + fx.fired * 0.2) {
      const tx = F.x[l] + (Math.random() - 0.5) * 70, ty = FLOOR - 40 - Math.random() * 90;
      const m = { x: tx - dirOf(w) * (220 + Math.random() * 120), y: -40, tx, ty, r: 12 + Math.random() * 10 }; // in from the winner's side
      const d = Math.hypot(m.tx - m.x, m.ty - m.y); m.vx = (m.tx - m.x) / d * 900; m.vy = (m.ty - m.y) / d * 900;
      fx.meteors.push(m); fx.fired++; sfx.whistle();
    }
    fx.meteors = fx.meteors.filter((m) => {
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (!reduced) F.sparks.push({ kind: 'fire', x: m.x, y: m.y, vx: -m.vx * 0.05, vy: -m.vy * 0.05, r: m.r * 0.8, life: 0.25, c: Math.random() < 0.5 ? '#FFA94D' : '#FF6B6B' });
      if (m.y < m.ty) return true;
      landHit(fx, R, m.tx, m.ty, fx.landed === fx.hits - 1 ? 'big' : 'mid'); return false;
    });
  } else if (fx.kind === 'laser') {
    if (fx.fired === 0 && fx.t >= 1.15) { fx.fired = 1; fx.beamT = 0; sfx.zap(); landHit(fx, R, F.x[l], FLOOR - 90, 'big'); }
    if (fx.beamT != null) fx.beamT += dt;
  }
}
function drawFx(fx, t) {
  if (!fx) return;
  if (fx.t < 1.1) drawTitle(fx.title, fx.titleC, Math.min(1, fx.t * 6) * Math.min(1, (1.1 - fx.t) * 3), 1 + Math.max(0, 0.25 - fx.t) * 2);
  if (fx.kind === 'special') drawMove(fx.sp, g, t);
  for (const b of fx.shots) {
    g.save(); g.shadowColor = '#FFE066'; g.shadowBlur = 10; g.strokeStyle = '#FFF3B0'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - Math.sign(b.vx) * 26, b.y); g.stroke(); g.restore();
  }
  for (const r of fx.rockets) {
    g.save(); g.translate(r.x, r.y); g.rotate(r.a);
    g.fillStyle = '#FFA94D'; g.beginPath(); g.moveTo(-18, -5); g.lineTo(-34 - Math.random() * 12, 0); g.lineTo(-18, 5); g.fill();
    g.fillStyle = '#d9dde8'; roundRect(g, -18, -6, 30, 12, 4); g.fill();
    g.fillStyle = '#FF6B6B'; g.beginPath(); g.moveTo(12, -6); g.lineTo(22, 0); g.lineTo(12, 6); g.fill();
    g.fillStyle = '#7a8094'; g.fillRect(-18, -10, 8, 4); g.fillRect(-18, 6, 8, 4);
    g.restore();
  }
  for (const m of fx.meteors) {
    g.save(); g.shadowColor = '#FF8A3D'; g.shadowBlur = 24;
    g.fillStyle = '#7a3b22'; g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFB36B'; g.beginPath(); g.arc(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.45, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  if (fx.kind === 'laser') {
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
  drawBackdrop(t, F.fx);
  for (const k of [0, 1]) {
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.ellipse(F.x[k], FLOOR + 6, 46, 9, 0, 0, Math.PI * 2); g.fill();
    drawBot(g, F.x[k], FLOOR, k === 0 ? 1 : -1, F.looks[k], F.pose[k], t + k, F.flash[k], F.fx ? { kind: F.fx.kind === 'tie' ? 'mg' : F.fx.kind, muzzle: F.fx.muzzle[k] } : null);
  }
  drawSmoke();
  drawFx(F.fx, t);
  drawParticles();
  if (F.recording) drawClipOverlay(t);
}
/** Sky, city, floor; darkened for meteors and laser lock-ons. Leaves the screen-shake transform on. */
function drawBackdrop(t, fx) {
  const sx = F.shake ? (Math.random() - 0.5) * F.shake : 0, sy = F.shake ? (Math.random() - 0.5) * F.shake : 0;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0d1022'); sky.addColorStop(1, '#170d1a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.translate(sx, sy);
  for (let i = 0; i < 12; i++) {
    const x = i * 84 - 10, top = 120 + (i % 3) * 16;
    g.fillStyle = '#12162a'; g.fillRect(x, top, 64, FLOOR - top);
    for (let j = 0; j < 9; j++) {
      const on = (Math.sin(t * (1.3 + (i * 7 + j) % 5) + i * j) > 0.2) && !reduced || (i + j) % 3 === 0;
      g.fillStyle = on ? ((i + j) % 4 === 0 ? '#D4F25C' : '#7FD3F0') : '#1d2440';
      g.fillRect(x + 8 + (j % 3) * 18, top + 14 + Math.floor(j / 3) * 26, 8, 4);
    }
  }
  g.fillStyle = 'rgba(10,12,20,.55)'; g.fillRect(0, 0, W, H);
  if (fx?.kind === 'meteor') { g.fillStyle = `rgba(120,30,20,${Math.min(0.45, fx.t * 0.6)})`; g.fillRect(0, 0, W, FLOOR); }
  if (fx?.kind === 'laser' && fx.t < 1.15) { g.fillStyle = `rgba(0,0,0,${Math.min(0.45, F.fx.t * 0.5)})`; g.fillRect(0, 0, W, H); }
  const fl = g.createLinearGradient(0, FLOOR, 0, H); fl.addColorStop(0, '#2a2140'); fl.addColorStop(1, '#0a0c14');
  g.fillStyle = fl; g.fillRect(0, FLOOR, W, H - FLOOR);
  g.fillStyle = '#FF6B6B'; g.fillRect(0, FLOOR, W, 3);
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
  return `${p.fighters[p.winner].name} wins ${p.ko ? 'by K.O.' : 'on points'} · ${p.roundsWon[p.winner]}–${p.roundsWon[1 - p.winner]} in rounds`;
}

// ---------- result ----------
function shareText(plan = F.plan) {
  const [a, b] = plan.fighters;
  const row = plan.rounds.map((R) => (R.winner == null ? '⬛' : R.winner < 0 ? '🟨' : R.winner === 0 ? '🟩' : '🟥')).join('');
  const how = plan.winner < 0 ? 'Draw' : `${plan.fighters[plan.winner].name} wins ${plan.ko ? 'by K.O.' : 'on points'} (${plan.hp[plan.winner]} HP left)`;
  return [`🥊 Benchmark Brawl`, `${a.name} vs ${b.name} · ${plan.roundsWon[0]}–${plan.roundsWon[1]}`, row, how, `${SITE_URL}${hashFor(a.id, b.id, rounds)}`].join('\n');
}
function showResult() {
  const p = F.plan, [a, b] = p.fighters;
  for (const id of ['arena', 'tourney']) $(id).hidden = true;
  $('result').hidden = false;
  $('verdict').style.setProperty('--c', p.winner >= 0 ? F.colors[p.winner] : '#F3F4F8');
  const upset = p.winner >= 0 && p.roundsWon[p.winner] < p.roundsWon[1 - p.winner];
  $('verdict').replaceChildren(...(p.winner >= 0 ? [h('b', null, p.fighters[p.winner].name), ` wins ${p.ko ? 'by K.O.' : 'on points'}`] : ['A draw']),
    upset ? h('div', { class: 'fine', style: 'margin-top:8px;font-family:var(--ui)' }, `Upset: it won fewer rounds (${p.roundsWon[p.winner]} to ${p.roundsWon[1 - p.winner]}) but by much bigger margins.`) : '');
  $('th1').textContent = a.name; $('th1').style.color = F.colors[0];
  $('th2').textContent = b.name; $('th2').style.color = F.colors[1];
  $('rows').replaceChildren(...p.rounds.map((R) => h('tr', null,
    h('td', null, R.round.name, h('span', { class: 't' }, R.parts
      ? ['Average of ', ...R.parts.flatMap((p, i) => [i ? ' + ' : '', h('a', { href: p.bench.source.url, target: '_blank', rel: 'noopener' }, p.bench.name)])]
      : R.bench ? [h('a', { href: R.bench.source.url, target: '_blank', rel: 'noopener' }, R.bench.name), ` · ${R.bench.source.name}`] : 'No benchmark in common')),
    ...[0, 1].map((k) => {
      const m = p.fighters[k], s = R.bench && R.bench.kind === 'score' ? m.scores[R.bench.id] : null;
      return h('td', { class: `num ${R.winner === k ? 'win' : ''}`, style: `--c:${F.colors[k]}` },
        s?.log ? h('a', { href: s.log, target: '_blank', rel: 'noopener', title: 'Epoch AI run logs', style: 'color:inherit' }, formatValue(R.bench, R.values[k])) : formatValue(R.bench, R.values[k]),
        R.winner === k ? ' ✓' : '',
        R.parts ? h('span', { class: 't' }, R.parts.map((pt) => `${pt.bench.name} ${pt.values[k].toFixed(1)}`).join(' · '))
          : s ? h('span', { class: 't' }, `${s.setting} setting · ${s.se != null ? `±${(1.96 * s.se).toFixed(1)}` : 'no margin published'}`) : R.bench?.kind === 'price' ? h('span', { class: 't' }, 'per M tokens') : '');
    }),
    h('td', { class: 'num' }, R.winner == null ? 'skipped' : R.winner < 0 ? (R.tie === 'margin' ? 'tie (margin)' : 'tie') : `−${R.dmg} HP`))));
  $('share').textContent = shareText();
  $('backToBracket').hidden = !fromBracket;
  $('result').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
function backHome() {
  cancelAnimationFrame(raf);
  for (const id of ['arena', 'result', 'tourney', 'royaleResult', 'claims']) $(id).hidden = true;
  for (const id of ['builder', 'select', 'ready', 'featured']) $(id).hidden = false;
  fromBracket = false;
  renderAll();
  $('select').scrollIntoView({ block: 'start' });
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
$('rematch').addEventListener('click', () => startFight());
$('again').addEventListener('click', backHome);
$('copy').addEventListener('click', () => { track('share'); copyText(shareText(), 'Copied result and link'); });
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
  startFight({ recording: true, onDone: () => rec.state !== 'inactive' && rec.stop() });
  await done;
  if (recDest) { try { master?.disconnect(recDest); } catch { /* fine */ } recDest = null; }
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
$('tourneyBtn').addEventListener('click', openTournament);
$('tourneyClose').addEventListener('click', backHome);
$('backToBracket').addEventListener('click', () => { $('result').hidden = true; showBracket(); });
function openTournament() {
  const pool = DATA.models.filter((m) => inClass(m, classId));
  bracket = runTournament(DATA, pool, rounds);
  if (!bracket) return toast('A tournament needs at least 8 fighters in this weight class');
  track(`tournament/${classId}`);
  sfx.bell();
  showBracket();
}
function showBracket() {
  const cls = CLASSES.find((c) => c.id === classId).name;
  for (const id of ['builder', 'select', 'ready', 'featured', 'arena', 'result']) $(id).hidden = true;
  $('tourney').hidden = false;
  $('tourneyTitle').textContent = `Tournament · ${cls} · ${rounds.map((r) => roundById.get(r).name).join(', ')}`;
  const champ = bracket.champion;
  $('champ').style.setProperty('--c', colorOf(champ));
  $('champ').replaceChildren('🏆 Champion: ', h('b', null, champ.name));
  const titles = ['Quarterfinals', 'Semifinals', 'Final'];
  $('bracket').replaceChildren(...bracket.rounds.map((ms, ri) => h('div', { class: 'bcol' }, h('h3', null, titles[ri]), ...ms.map((m) => {
    const side = (x, k) => h('div', { class: `p ${m.winner === x ? 'w' : ''}`, style: `--c:${colorOf(x)}` }, h('span', { class: 'n' }, `${bracket.seeds.indexOf(x) + 1}. ${x.name}`), h('span', { class: 'hp2' }, `${m.fight.hp[k]} HP`));
    return h('button', { type: 'button', class: 'match', title: 'Watch this fight', onclick: () => { picks = [m.a.id, m.b.id]; fromBracket = true; startFight(); } },
      side(m.a, 0), side(m.b, 1), h('span', { class: 'note2' }, m.tiebreak ? 'Draw: higher seed advances' : m.fight.ko ? 'K.O.' : `On points · ${m.fight.roundsWon[0]}–${m.fight.roundsWon[1]}`));
  }))));
  $('tshare').textContent = tournamentText();
  $('tourney').scrollIntoView({ block: 'start' });
}
function tournamentText() {
  const fin = bracket.rounds.at(-1)[0], loser = fin.winner === fin.a ? fin.b : fin.a;
  const semis = bracket.rounds[1].map((m) => (m.winner === m.a ? m.b : m.a).name);
  return [`🏆 Benchmark Brawl tournament · ${CLASSES.find((c) => c.id === classId).name}`, `Champion: ${bracket.champion.name}`, `Final: beat ${loser.name}`, `Semifinalists: ${semis.join(', ')}`, `${SITE_URL}#t=1&r=${rounds.join(',')}${classPart()}`].join('\n');
}
$('watchFinal').addEventListener('click', () => { const f = bracket.rounds.at(-1)[0]; picks = [f.a.id, f.b.id]; fromBracket = true; startFight(); });
$('tcopy').addEventListener('click', () => { track('share-bracket'); copyText(tournamentText(), 'Copied bracket and link'); });

// ---------- battle royale ----------
const R_PHASES = [['banner', 1.2], ['reveal', 1.0], ['attack', 0], ['after', 1.0]];
const R_NO_DATA = [['banner', 1.0], ['after', 0.6]];
/** Distinct colours for up to 8 fighters: lab colour first, the next free one if taken. */

function startRoyale() {
  const ms = picks.map((id) => byId.get(id)).filter(Boolean);
  if (ms.length < ROYALE_MIN) return;
  const plan = planRoyale(DATA, ms, rounds), n = ms.length;
  const gap = (W - 80) / n;
  const looks = looksFor(ms);
  F = { royale: true, plan, n, looks, colors: looks.map((l) => l.ui), x: ms.map((_, i) => 40 + gap * (i + 0.5)), s: n >= 6 ? 0.6 : n >= 4 ? 0.74 : 0.9, gap,
    pose: ms.map(() => 'idle'), flash: ms.map(() => 0), dodge: ms.map(() => 0), hp: ms.map(() => 100), shown: ms.map(() => null),
    i: 0, phase: 0, t: 0, sparks: [], floats: [], booms: [], shots: [], fx: null, shake: 0, white: 0, over: false, done: false, moveTitle: null,
    // per fighter, its biggest hit as leader: where its signature move plays
    special: ms.map((_, k) => { let best = null, d = 0; plan.rounds.forEach((R, i) => { if (R.leader === k) for (const x of R.hits) if (x.dmg > d) { d = x.dmg; best = { i, target: x.target }; } }); return best; }) };
  for (const id of ['builder', 'select', 'ready', 'result', 'tourney', 'featured', 'royaleResult']) $(id).hidden = true;
  $('arena').hidden = false; $('arena').classList.add('royale'); $('rec').hidden = true;
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
  F.fx.title = top ? `${weaponName(top)}${real.filter((w) => w === top).length > 1 ? ` ×${real.filter((w) => w === top).length}` : ''}` : 'ALL DODGE!';
  F.fx.titleC = F.colors[L];
  if (top === 'meteor') sfx.rumble();
  if (top === 'laser') sfx.lock();
}
const orbOf = (k) => ({ x: F.x[k] + (F.x[k] < W / 2 ? 1 : -1) * 24 * F.s, y: FLOOR - 24 * F.s - 176 * F.s });
const chestOf = (k) => ({ x: F.x[k], y: FLOOR - 90 * F.s });
function rLand(R, hit, last, size) {
  const k = hit.target;
  if (!last) { burstSparks(chestOf(k).x, chestOf(k).y, 4, '#FFE066'); return; }
  F.hp[k] = R.hpAfter[k];
  F.flash[k] = 0.15; F.pose[k] = F.hp[k] === 0 ? 'down' : 'hurt';
  F.shake = reduced ? 0 : Math.max(F.shake, size === 'big' ? 14 : size === 'mid' ? 8 : 4);
  if (size !== 'small') explode(chestOf(k).x, chestOf(k).y, size === 'big', size === 'big' ? 0.25 : 0);
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
  const w = hit.weapon;
  if (w === 'mg') {
    for (let b = 0; b < 4; b++) F.shots.push({ kind: 'bullet', delay: b * 0.07, x: o.x, y: o.y, tx: c.x, ty: c.y + (Math.random() - 0.5) * 20, v: 1700, onLand: () => rLand(R, hit, b === 3, 'small') });
    sfx.shot(); setTimeout(() => sfx.shot(), 90); sfx.casing();
  } else if (w === 'rocket') {
    F.shots.push({ kind: 'rocket', x0: o.x, y0: o.y, x1: c.x, y1: c.y, t: 0, dur: 0.6, onLand: () => rLand(R, hit, true, 'mid') });
    sfx.launch();
  } else if (w === 'meteor') {
    for (let b = 0; b < 3; b++) { const tx = c.x + (Math.random() - 0.5) * 40, ty = c.y + (Math.random() - 0.5) * 30; F.shots.push({ kind: 'meteor', delay: b * 0.16, x: tx - 160 + Math.random() * 320, y: -30, tx, ty, v: 950, r: 9 + Math.random() * 7, onLand: () => rLand(R, hit, b === 2, b === 2 ? 'big' : 'mid') }); }
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
    if (s.kind === 'bullet' || s.kind === 'meteor') {
      const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy), st = s.v * dt;
      if (s.kind === 'meteor' && !reduced) F.sparks.push({ kind: 'fire', x: s.x, y: s.y, vx: 0, vy: -20, r: s.r * 0.8, life: 0.22, c: Math.random() < 0.5 ? '#FFA94D' : '#FF6B6B' });
      s.a = Math.atan2(dy, dx);
      if (d <= st) { s.done = true; s.onLand(); } else { s.x += dx / d * st; s.y += dy / d * st; }
    } else if (s.kind === 'rocket') {
      s.t += dt; const k = Math.min(1, s.t / s.dur);
      s.x = s.x0 + (s.x1 - s.x0) * k; s.y = s.y0 + (s.y1 - s.y0) * k - Math.sin(k * Math.PI) * 80;
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
    if (s.kind === 'bullet') { g.save(); g.shadowColor = '#FFE066'; g.shadowBlur = 10; g.strokeStyle = '#FFF3B0'; g.lineWidth = 3; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(s.a || 0) * 22, s.y - Math.sin(s.a || 0) * 22); g.stroke(); g.restore(); }
    else if (s.kind === 'rocket') { g.save(); g.translate(s.x, s.y); g.fillStyle = '#d9dde8'; roundRect(g, -12, -5, 24, 10, 4); g.fill(); g.fillStyle = '#FF6B6B'; g.beginPath(); g.arc(12, 0, 5, 0, Math.PI * 2); g.fill(); g.restore(); }
    else if (s.kind === 'meteor') { g.save(); g.shadowColor = '#FF8A3D'; g.shadowBlur = 20; g.fillStyle = '#7a3b22'; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill(); g.fillStyle = '#FFB36B'; g.beginPath(); g.arc(s.x - s.r * 0.3, s.y - s.r * 0.3, s.r * 0.45, 0, Math.PI * 2); g.fill(); g.restore(); }
    else if (s.kind === 'move') drawMove(s.sp, g, t);
    else if (s.kind === 'beam') { const k = s.t / 0.6, wd = 44 * (1 - k * 0.6); g.save(); g.globalAlpha = 1 - k * 0.8; const gr = g.createLinearGradient(s.x - wd, 0, s.x + wd, 0); gr.addColorStop(0, 'rgba(127,211,240,0)'); gr.addColorStop(0.5, '#7FD3F0'); gr.addColorStop(1, 'rgba(127,211,240,0)'); g.fillStyle = gr; g.fillRect(s.x - wd, 0, wd * 2, FLOOR + 10); g.fillStyle = '#fff'; g.fillRect(s.x - wd * 0.18, 0, wd * 0.36, FLOOR + 10); g.restore(); }
  }
  if (F.moveTitle && F.moveTitle.t < 1.5) drawTitle(F.moveTitle.text, F.moveTitle.c, Math.min(1, F.moveTitle.t * 6) * Math.min(1, (1.5 - F.moveTitle.t) * 3), 1, 70);
  else if (F.fx?.title && F.fx.t < 1.2) drawTitle(F.fx.title, F.fx.titleC, Math.min(1, F.fx.t * 6) * Math.min(1, (1.2 - F.fx.t) * 3), 1, 70);
  drawParticles();
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
  $('arena').hidden = true; $('royaleResult').hidden = false;
  const w = p.winner >= 0 ? p.fighters[p.winner] : null;
  $('rverdict').style.setProperty('--c', w ? F.colors[p.winner] : '#F3F4F8');
  $('rverdict').replaceChildren(...(w ? ['👑 ', h('b', null, w.name), ' wins the royale'] : ['👑 A shared crown']));
  $('rhead').replaceChildren(h('th', null, '#'), h('th', null, 'Fighter'), ...p.rounds.map((R) => h('th', null, R.round.name, R.bench ? h('span', { class: 't' }, h('a', { href: R.bench.source.url, target: '_blank', rel: 'noopener' }, R.bench.name)) : h('span', { class: 't' }, 'skipped'))), h('th', null, 'HP'));
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
const VERDICTS = { match: '✅ Matches', lab: '🔺 Lab higher', ind: '🔻 Independent higher' };
function verdictOf(c) {
  const margin = c.indep.se != null ? 1.96 * c.indep.se : 1, diff = c.claimed - c.indep.v;
  return { margin, diff, kind: Math.abs(diff) <= margin ? 'match' : diff > 0 ? 'lab' : 'ind' };
}
let claimLab = 'all';
function openClaims(lab = 'all') {
  claimLab = lab;
  for (const id of ['builder', 'select', 'ready', 'featured', 'arena', 'result', 'royaleResult', 'tourney']) $(id).hidden = true;
  $('claims').hidden = false;
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
  const n = { match: 0, lab: 0, ind: 0 }; for (const x of list) n[x.v.kind]++;
  $('claimSummary').replaceChildren(h('span', { class: 'stat' }, h('b', null, list.length), ' claims checked'),
    ...Object.entries(VERDICTS).map(([k, label]) => h('span', { class: 'stat' }, `${label}: `, h('b', null, n[k]))));
  $('claimRows').replaceChildren(...list.map(({ c, m, b, v }) => h('tr', null,
    h('td', { style: `color:${colorOf(m)};font-weight:700` }, m.name, h('span', { class: 't' }, m.org)),
    h('td', null, b.name, h('span', { class: 't' }, c.version && !/not stated/.test(c.version) ? `version ${c.version}` : '')),
    h('td', { class: 'num' }, `${c.claimed.toFixed(1)}%`, h('span', { class: 't', title: c.conditions }, h('a', { href: c.url, target: '_blank', rel: 'noopener' }, 'source'), ` · ${c.conditions.length > 60 ? `${c.conditions.slice(0, 58).replace(/[\s,;·]+\S*$/, '')}…` : c.conditions}`)),
    h('td', { class: 'num' }, `${c.indep.v.toFixed(1)}%`, h('span', { class: 't' }, `±${v.margin.toFixed(1)} · ${c.indep.setting} setting${c.indep.sameSetting ? ' (same as lab)' : ''} · `,
      h('a', { href: b.source.url, target: '_blank', rel: 'noopener' }, b.epochRun ? 'Epoch AI' : b.source.name.replace(/ by .*$/, '').replace(/, via Epoch AI$/, '')))),
    h('td', null, h('span', { class: `verdict-pill ${v.kind}` }, VERDICTS[v.kind]), v.kind === 'match' ? '' : h('span', { class: 't' }, `${v.diff > 0 ? '+' : ''}${v.diff.toFixed(1)} points`)))));
  $('claimShare').textContent = claimText(n, list.length);
}
function claimText(n, total) {
  return [`🔎 Benchmark Brawl claim check${claimLab === 'all' ? '' : ` · ${claimLab}`}`, `${total} lab claims vs independent tests`,
    `✅ ${n.match} match · 🔺 ${n.lab} lab higher · 🔻 ${n.ind} independent higher`, `${SITE_URL}#claims${claimLab === 'all' ? '' : `=${encodeURIComponent(claimLab)}`}`].join('\n');
}
$('claimsBtn').addEventListener('click', () => openClaims());
$('claimsClose').addEventListener('click', backHome);
$('claimLab').addEventListener('change', (e) => openClaims(e.target.value));
$('claimCopy').addEventListener('click', () => { track('share-claims'); copyText($('claimShare').textContent, 'Copied claim check and link'); });

// ---------- start ----------
const claimsHash = location.hash.match(/^#claims(?:=(.+))?$/);
const shared = claimsHash ? false : readHash();
renderFeatured();
renderAll();
if (claimsHash) openClaims(claimsHash[1] ? decodeURIComponent(claimsHash[1]) : 'all');
else if (wantTourney) openTournament();
else if (shared && mode === 'royale') {
  toast(`Shared battle royale: ${picks.length} fighters. Press FIGHT!`);
  $('ready').scrollIntoView({ block: 'end' });
} else if (shared) {
  const [a, b] = picks.map((id) => byId.get(id));
  toast(`Shared fight: ${a.name} vs ${b.name}. Press FIGHT!`);
  $('ready').scrollIntoView({ block: 'end' });
}
