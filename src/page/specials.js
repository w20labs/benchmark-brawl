// Signature moves: one per lab, played in place of the weapon on a model's biggest hit.
// Purely visual: the damage is still exactly what the scores say.

/**
 * A move is { name, len, impact, update?(sp, dt), draw(sp, g, t) }. `impact` is when the hit lands
 * (seconds after the move starts), `len` when the move is over.
 * sp.c is the scene: { ax, ay } where the attacker's raised hand is, { tx, ty } the target's chest,
 * x (attacker centre), floor, s (scale), dir (1 faces right), color, ko (this hit is a knockout), and helpers.
 */
const FONT = (px) => `400 ${Math.round(px)}px "Press Start 2P", monospace`;
const ease = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
const lerp = (a, b, k) => a + (b - a) * k;
const once = (sp, key, fn) => { if (!sp[key]) { sp[key] = true; fn(); } };
function label(g, text, x, y, px, color, align = 'center') {
  g.font = FONT(px); g.textAlign = align;
  g.fillStyle = '#000'; g.fillText(text, x + px * 0.15, y + px * 0.15);
  g.fillStyle = color; g.fillText(text, x, y);
}
function bubble(g, x, y, w, hgt, tailX, rr) {
  rr(g, x, y, w, hgt, 12); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(tailX - 10, y + hgt - 1); g.lineTo(tailX, y + hgt + 16); g.lineTo(tailX + 8, y + hgt - 1); g.fill();
}

const MOVES = {
  // xAI: poses, shades drop, golden aura; the shockwave lands mid-pose. On a K.O., RATIO.
  aura: {
    name: 'AURA FARMING', len: 2.6, impact: 1.75,
    update(sp) {
      const { c } = sp;
      once(sp, 'snd', () => { [523, 659, 784, 1047, 1319].forEach((f, i) => c.tone(f, { at: i * 0.09, dur: 0.5, type: 'sine', vol: 0.18 })); });
      if (sp.t > 1.45) once(sp, 'wave', () => c.sfx.charge());
    },
    draw(sp, g, t) {
      const { c } = sp, k = sp.t;
      // aura rings around the poser
      for (let i = 0; i < 4; i++) {
        const p = ((k * 0.9 + i / 4) % 1);
        g.save(); g.globalAlpha = (1 - p) * 0.7; g.strokeStyle = i % 2 ? '#FFE066' : '#FFF6C8'; g.lineWidth = 6 * c.s;
        g.beginPath(); g.ellipse(c.x, c.floor - 90 * c.s, (50 + p * 90) * c.s, (100 + p * 70) * c.s, 0, 0, Math.PI * 2); g.stroke(); g.restore();
      }
      for (let i = 0; i < 6; i++) { const a = t * 2 + i; label(g, '✦', c.x + Math.cos(a) * 70 * c.s, c.floor - 100 * c.s + Math.sin(a * 1.3) * 80 * c.s, 14 * c.s, '#FFE066'); }
      // shades drop onto the visor
      const sy = lerp(c.floor - 320 * c.s, c.floor - 141 * c.s, ease(k / 0.5)), sx = c.x + c.dir * 3 * c.s;
      g.fillStyle = '#05060a'; g.fillRect(sx - 24 * c.s, sy, 48 * c.s, 5 * c.s);
      g.fillRect(sx - 22 * c.s, sy, 18 * c.s, 11 * c.s); g.fillRect(sx + 4 * c.s, sy, 18 * c.s, 11 * c.s);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(sx - 19 * c.s, sy + 2 * c.s, 5 * c.s, 2 * c.s); g.fillRect(sx + 7 * c.s, sy + 2 * c.s, 5 * c.s, 2 * c.s);
      // golden shockwave travels to the target
      if (k > 1.4 && k < 1.9) {
        const p = ease((k - 1.4) / 0.35), x = lerp(c.x, c.tx, p);
        g.save(); g.globalAlpha = 0.9; g.strokeStyle = '#FFE066'; g.lineWidth = 10 * c.s; g.shadowColor = '#FFE066'; g.shadowBlur = 24;
        g.beginPath(); g.arc(x, c.ty, 40 * c.s, -Math.PI / 2, Math.PI / 2, c.dir < 0); g.stroke(); g.restore();
      }
      if (c.ko && k > 1.75) {
        const p = ease((k - 1.75) / 0.25);
        label(g, 'RATIO', c.tx, lerp(-20, c.floor - 10, p), 40 * Math.max(0.7, c.s), '#F3F4F8');
      }
    },
  },

  // Anthropic: a very polite apology, which is then thrown at the target.
  apology: {
    name: 'I APOLOGIZE FOR THE CONFUSION', len: 2.6, impact: 2.05,
    update(sp) {
      const n = Math.floor(Math.min(1, sp.t / 1.1) * 40);
      if (n !== sp.n && n % 3 === 0) sp.c.tone(1200 + Math.random() * 300, { dur: 0.025, vol: 0.06 });
      sp.n = n;
      if (sp.t > 1.55) once(sp, 'throw', () => sp.c.sfx.launch());
    },
    draw(sp, g) {
      const { c } = sp, k = sp.t, text = 'I apologize for the confusion.';
      const w = 250 * Math.max(0.75, c.s), hgt = 52;
      let x = c.ax - w / 2, y = c.ay - hgt - 40;
      if (k > 1.55) { const p = ease((k - 1.55) / 0.5); x = lerp(x, c.tx - w / 2, p); y = lerp(y, c.ty - hgt / 2, p) - Math.sin(p * Math.PI) * 80; }
      x = Math.max(6, Math.min(960 - w - 6, x));
      g.save(); g.fillStyle = '#F7F1E8'; g.strokeStyle = '#2b3350'; g.lineWidth = 3;
      bubble(g, x, y, w, hgt, Math.max(x + 20, Math.min(x + w - 20, c.ax)), c.roundRect);
      g.fillStyle = '#2b3350'; g.font = '600 15px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText(text.slice(0, Math.floor(Math.min(1, k / 1.1) * text.length)), x + 12, y + 22);
      if (k > 1.15) { g.font = '700 13px Inter, sans-serif'; g.fillStyle = '#c0392b'; g.fillText('Anyway:', x + 12, y + 42); }
      g.restore();
    },
  },

  // OpenAI: a downpour of em dashes, and "delve" floats up.
  emdash: {
    name: 'EM DASH BARRAGE', len: 2.3, impact: 1.6,
    update(sp, dt) {
      const { c } = sp;
      sp.dashes ??= [];
      if (sp.t < 1.35 && Math.random() < dt * 22) {
        sp.dashes.push({ x: c.tx + (Math.random() - 0.5) * 120 * c.s, y: -20, vy: 700 + Math.random() * 300 });
        c.sfx.shot();
      }
      for (const d of sp.dashes) { d.y += d.vy * dt; if (!d.hit && d.y > c.ty) { d.hit = true; c.burstSparks(d.x, c.ty, 3, '#F3F4F8'); } }
      sp.dashes = sp.dashes.filter((d) => d.y < c.floor + 20);
      if (sp.t > 0.6) once(sp, 'delve', () => c.floats.push({ x: c.tx + 60 * c.s, y: c.ty - 40, text: 'delve', c: '#9BE36D', life: 1.6, size: 16 }));
      if (sp.t > 1.0) once(sp, 'tapestry', () => c.floats.push({ x: c.tx - 60 * c.s, y: c.ty - 10, text: 'tapestry', c: '#B79CF2', life: 1.4, size: 12 }));
    },
    draw(sp, g) {
      const w = 46 * Math.max(0.7, sp.c.s);
      for (const d of sp.dashes || []) { g.fillStyle = '#000'; g.fillRect(d.x - w / 2 + 3, d.y + 3, w, 7); g.fillStyle = '#F3F4F8'; g.fillRect(d.x - w / 2, d.y, w, 7); }
    },
  },

  // Google: a two-million-token window opens and the whole library falls out.
  library: {
    name: 'TWO MILLION TOKENS', len: 2.5, impact: 1.85,
    update(sp, dt) {
      const { c } = sp;
      sp.books ??= [];
      if (sp.t > 0.55 && sp.t < 1.7 && Math.random() < dt * 30) {
        sp.books.push({ x: c.tx + (Math.random() - 0.5) * 100 * c.s, y: 60, vx: (Math.random() - 0.5) * 60, vy: 100, r: Math.random() * 6, vr: (Math.random() - 0.5) * 8, col: ['#F28DB2', '#7FD3F0', '#F2B544', '#9BE36D', '#B79CF2'][Math.floor(Math.random() * 5)] });
      }
      for (const b of sp.books) { b.vy += 1400 * dt; b.x += b.vx * dt; b.y = Math.min(c.floor - 6, b.y + b.vy * dt); b.r += b.vr * dt; if (!b.thud && b.y >= c.floor - 6) { b.thud = true; b.vr = 0; if (Math.random() < 0.3) c.sfx.clink(); } }
      if (sp.t > 0.5) once(sp, 'open', () => c.tone(220, { to: 660, dur: 0.4, type: 'triangle', vol: 0.2 }));
    },
    draw(sp, g) {
      const { c } = sp, k = ease(sp.t / 0.5), w = 170 * k, hgt = 66 * k, x = c.tx - w / 2, y = 36;
      if (k > 0.05 && sp.t < 2.2) {
        g.save(); g.globalAlpha = sp.t > 1.9 ? Math.max(0, 1 - (sp.t - 1.9) / 0.3) : 1;
        g.fillStyle = '#e9edf5'; c.roundRect(g, x, y, w, hgt, 6); g.fill();
        g.fillStyle = '#2b3350'; g.fillRect(x, y, w, 14 * k);
        for (const [i, col] of ['#FF6B6B', '#F2B544', '#9BE36D'].entries()) { g.fillStyle = col; g.beginPath(); g.arc(x + 10 + i * 12, y + 7 * k, 3.5 * k, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = '#0A0C14'; g.fillRect(x + 8, y + 20 * k, w - 16, hgt - 28 * k);
        if (k > 0.9) { g.font = '700 11px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillStyle = '#7FD3F0'; g.fillText('2,000,000 tokens', c.tx, y + 46); }
        g.restore();
      }
      for (const b of sp.books || []) { g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.col; g.fillRect(-12 * c.s - 4, -8 * c.s - 2, 24 * c.s + 8, 16 * c.s + 4); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(-12 * c.s - 4, -2, 24 * c.s + 8, 3); g.restore(); }
    },
  },

  // DeepSeek: a giant 95% OFF tag slaps on; coins everywhere.
  sale: {
    name: 'CLEARANCE SALE', len: 2.2, impact: 1.0,
    update(sp, dt) {
      const { c } = sp;
      sp.coins ??= [];
      once(sp, 'snd', () => c.sfx.whistle());
      if (sp.t > 1.0) once(sp, 'slap', () => { for (let i = 0; i < 26; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, v = 250 + Math.random() * 350; sp.coins.push({ x: c.tx, y: c.ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v }); } [1568, 2093, 2637].forEach((f, i) => c.tone(f, { at: i * 0.07, dur: 0.12, type: 'triangle', vol: 0.18 })); });
      for (const o of sp.coins) { o.vy += 1300 * dt; o.x += o.vx * dt; o.y = Math.min(c.floor - 4, o.y + o.vy * dt); }
    },
    draw(sp, g, t) {
      const { c } = sp, p = ease(sp.t / 1.0);
      const x = lerp(c.ax, c.tx, p), y = lerp(c.ay, c.ty - 30 * c.s, p) - Math.sin(p * Math.PI) * 90, rot = sp.t < 1 ? sp.t * 14 : -0.2;
      g.save(); g.translate(x, y); g.rotate(rot); const sc = Math.max(0.8, c.s);
      g.fillStyle = '#FF6B6B'; g.beginPath(); g.moveTo(-70 * sc, -30 * sc); g.lineTo(50 * sc, -30 * sc); g.lineTo(76 * sc, 0); g.lineTo(50 * sc, 30 * sc); g.lineTo(-70 * sc, 30 * sc); g.closePath(); g.fill();
      g.fillStyle = '#0A0C14'; g.beginPath(); g.arc(52 * sc, 0, 6 * sc, 0, Math.PI * 2); g.fill();
      label(g, '95% OFF', -10 * sc, 8 * sc, 15 * sc, '#FFF6C8');
      g.restore();
      for (const o of sp.coins || []) { g.fillStyle = '#F2B544'; g.beginPath(); g.ellipse(o.x, o.y, 6, 6 * Math.abs(Math.sin(t * 10 + o.vx)), 0, 0, Math.PI * 2); g.fill(); }
    },
  },

  // Alibaba: release day. Fourteen model sizes stampede across the arena.
  release: {
    name: 'RELEASE DAY', len: 2.6, impact: 1.5,
    update(sp) {
      if (Math.floor(sp.t * 12) !== sp.step && sp.t < 2.2) { sp.step = Math.floor(sp.t * 12); sp.c.tone(180 + (sp.step % 3) * 40, { dur: 0.04, type: 'square', vol: 0.12 }); }
    },
    draw(sp, g, t) {
      const { c } = sp, sizes = ['0.5B', '1.8B', '4B', '7B', '14B', '32B', '72B', '110B', '235B', '480B', '1T', 'VL', 'Coder', 'Omni'];
      const from = c.x, to = c.tx + c.dir * 600;
      sizes.forEach((nm, i) => {
        const p = (sp.t - i * 0.09) / 1.8; if (p <= 0 || p >= 1) return;
        const x = lerp(from, to, p), sc = (0.16 + (i % 5) * 0.025) * Math.max(0.7, c.s) * 1.4, y = c.floor - (i % 3) * 6;
        g.save(); g.translate(x, y + Math.abs(Math.sin(t * 18 + i)) * -6); g.scale(sc, sc); c.drawBot(g, 0, 0, c.dir, i % 2 ? (c.look || c.color) : '#F2B544', 'aim', t + i); g.restore();
        g.font = '700 10px "JetBrains Mono", monospace'; g.textAlign = 'center'; g.fillStyle = '#F3F4F8'; g.fillText(nm, x, y - 200 * sc - 4);
      });
    },
  },

  // Moonshot: launches the moon itself.
  moon: {
    name: 'MOONSHOT', len: 2.6, impact: 2.0,
    update(sp) { once(sp, 'go', () => sp.c.sfx.launch()); if (sp.t > 1.2) once(sp, 'fall', () => sp.c.sfx.whistle()); },
    draw(sp, g) {
      const { c } = sp;
      if (sp.t < 0.9) { const p = ease(sp.t / 0.9); g.save(); g.strokeStyle = 'rgba(255,169,77,.8)'; g.lineWidth = 6; g.setLineDash([12, 10]); g.beginPath(); g.moveTo(c.ax, c.ay); g.lineTo(c.ax, lerp(c.ay, -40, p)); g.stroke(); g.restore(); }
      if (sp.t > 0.8 && sp.t < 2.1) {
        const p = ease((sp.t - 0.8) / 1.2), r = lerp(20, 90, p) * Math.max(0.6, c.s);
        const x = lerp(c.tx + c.dir * 200, c.tx, p), y = lerp(-r, c.ty - r * 0.4, p * p);
        g.save(); g.shadowColor = '#FFF6C8'; g.shadowBlur = 40; g.fillStyle = '#e8e4d6'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
        g.fillStyle = '#bdb8a6'; for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.4, 0.12], [0.35, -0.35, 0.1]]) { g.beginPath(); g.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2); g.fill(); }
      }
    },
  },

  // Mistral: the cold north wind, literally.
  wind: {
    name: 'MISTRAL', len: 2.0, impact: 1.05,
    update(sp, dt) {
      const { c } = sp;
      once(sp, 'snd', () => c.noise({ dur: 1.4, vol: 0.9, freq: 300, to: 2400, type: 'bandpass' }));
      sp.leaves ??= Array.from({ length: 16 }, () => ({ x: c.x, y: c.floor - Math.random() * 220 * c.s, v: 500 + Math.random() * 500, r: Math.random() * 6 }));
      for (const l of sp.leaves) { l.x += c.dir * l.v * dt; l.y += Math.sin(sp.t * 8 + l.v) * 2; l.r += dt * 8; }
    },
    draw(sp, g) {
      const { c } = sp;
      g.save(); g.strokeStyle = 'rgba(190,225,255,.55)'; g.lineWidth = 3;
      for (let i = 0; i < 9; i++) { const p = (sp.t * 1.6 + i / 9) % 1, x = lerp(c.x, c.tx + c.dir * 120, p), y = c.floor - (30 + i * 22) * c.s; g.beginPath(); g.moveTo(x - c.dir * 90, y); g.quadraticCurveTo(x - c.dir * 30, y - 12, x, y); g.stroke(); }
      g.restore();
      for (const l of sp.leaves || []) { g.save(); g.translate(l.x, l.y); g.rotate(l.r); g.fillStyle = '#9BE36D'; g.beginPath(); g.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
    },
  },

  // Meta: a llama appears and spits.
  llama: {
    name: 'LLAMA SPIT', len: 1.9, impact: 1.05,
    update(sp) { if (sp.t > 0.5) once(sp, 'ptoo', () => { sp.c.noise({ dur: 0.18, vol: 1.2, freq: 1800, to: 400 }); sp.c.tone(300, { to: 120, dur: 0.15, type: 'sine', vol: 0.3 }); }); if (sp.t > 1.05) once(sp, 'splat', () => { sp.c.noise({ dur: 0.25, vol: 1, freq: 700 }); sp.c.burstSparks(sp.c.tx, sp.c.ty - 40 * sp.c.s, 14, '#B6F0A0'); }); },
    draw(sp, g) {
      const { c } = sp, up = ease(sp.t / 0.4), lx = c.x - c.dir * 30 * c.s, ly = c.floor - lerp(0, 150, up) * Math.max(0.7, c.s);
      if (sp.t < 1.7) {
        g.save(); g.translate(lx, ly); g.scale(c.dir * Math.max(0.7, c.s), Math.max(0.7, c.s));
        g.fillStyle = '#EDE3D1'; g.fillRect(-10, -10, 22, 70); c.roundRect(g, -14, -40, 44, 32, 10); g.fill();
        g.fillRect(-8, -56, 7, 20); g.fillRect(4, -56, 7, 20);
        g.fillStyle = '#0A0C14'; g.fillRect(10, -32, 5, 5); g.fillStyle = '#c9b89a'; g.fillRect(22, -20, 8, 6);
        g.restore();
      }
      if (sp.t > 0.5 && sp.t < 1.05) {
        const p = (sp.t - 0.5) / 0.55, sx = lerp(lx + c.dir * 30 * c.s, c.tx, p), sy = lerp(ly - 22 * c.s, c.ty - 40 * c.s, p) - Math.sin(p * Math.PI) * 60;
        g.fillStyle = '#B6F0A0'; g.beginPath(); g.arc(sx, sy, 7, 0, Math.PI * 2); g.fill();
      }
    },
  },

  // Z.ai: a giant Z, carved in three strokes.
  zorro: {
    name: 'ZORRO SLASH', len: 1.9, impact: 1.05,
    update(sp) { [0.2, 0.5, 0.8].forEach((at, i) => { if (sp.t > at) once(sp, `s${i}`, () => sp.c.noise({ dur: 0.16, vol: 1, freq: 6000, to: 900, type: 'highpass' })); }); },
    draw(sp, g) {
      const { c } = sp, s = Math.max(0.7, c.s), x0 = c.tx - 70 * s, x1 = c.tx + 70 * s, y0 = c.ty - 90 * s, y1 = c.ty + 50 * s;
      const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
      const n = Math.min(3, sp.t / 0.3 - 0.66);
      if (n <= 0 || sp.t > 1.8) return;
      g.save(); g.globalAlpha = sp.t > 1.4 ? 1 - (sp.t - 1.4) / 0.4 : 1;
      g.strokeStyle = '#F3F4F8'; g.shadowColor = c.color; g.shadowBlur = 18; g.lineWidth = 9 * s; g.lineCap = 'round';
      g.beginPath(); g.moveTo(...pts[0]);
      for (let i = 1; i <= 3; i++) { const k = Math.min(1, Math.max(0, n - (i - 1))); if (k <= 0) break; g.lineTo(lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)); }
      g.stroke(); g.restore();
    },
  },

  // Thinking Machines: thinks for 7.5 million years, then throws 42.
  thought: {
    name: 'DEEP THOUGHT', len: 2.7, impact: 2.15,
    update(sp) {
      const b = Math.floor(sp.t * 4); if (b !== sp.b && sp.t < 1.6) { sp.b = b; sp.c.tone(440 + (b % 4) * 110, { dur: 0.06, type: 'sine', vol: 0.12 }); }
      if (sp.t > 1.7) once(sp, 'go', () => sp.c.sfx.launch());
    },
    draw(sp, g) {
      const { c } = sp, w = 210, hgt = 54, x = Math.max(6, Math.min(960 - w - 6, c.ax - w / 2)), y = c.ay - hgt - 44;
      if (sp.t < 1.75) {
        g.save(); g.fillStyle = '#F7F1E8'; g.strokeStyle = '#2b3350'; g.lineWidth = 3;
        c.roundRect(g, x, y, w, hgt, 18); g.fill(); g.stroke();
        for (const [dx, r] of [[0, 7], [-8, 4]]) { g.beginPath(); g.arc(c.ax + dx, y + hgt + 12 + (r === 4 ? 12 : 0), r, 0, Math.PI * 2); g.fill(); g.stroke(); }
        const yrs = Math.min(7.5, sp.t * 5).toFixed(1);
        g.fillStyle = '#2b3350'; g.font = '600 13px Inter, sans-serif'; g.textAlign = 'center';
        g.fillText(`Thinking${'.'.repeat(1 + Math.floor(sp.t * 4) % 3)}`, x + w / 2, y + 22);
        g.font = '700 12px "JetBrains Mono", monospace'; g.fillText(`${yrs} million years`, x + w / 2, y + 42);
        g.restore();
      }
      if (sp.t > 1.4) {
        const p = ease((sp.t - 1.7) / 0.45), sz = lerp(46, 34, p) * Math.max(0.7, c.s);
        label(g, '42', lerp(c.ax, c.tx, Math.max(0, p)), lerp(y + 30, c.ty, Math.max(0, p)), sz, c.color);
      }
    },
  },

  // MiniMax: tiny, then MAX. A giant version of the attacker stomps down.
  minimax: {
    name: 'MINI → MAX', len: 2.4, impact: 1.6,
    update(sp) { if (sp.t > 0.3) once(sp, 'grow', () => sp.c.tone(110, { to: 55, dur: 1.1, type: 'sawtooth', vol: 0.2 })); },
    draw(sp, g, t) {
      const { c } = sp;
      if (sp.t < 0.3 || sp.t > 2.2) return;
      const grow = ease((sp.t - 0.3) / 0.8), sc = lerp(0.2, 2.1, grow) * Math.max(0.6, c.s);
      const fall = sp.t < 1.25 ? 0 : ease((sp.t - 1.25) / 0.35);
      const x = c.tx, y = lerp(c.floor - 250 * Math.max(0.6, c.s), c.floor + 40, fall);
      g.save(); g.globalAlpha = sp.t > 1.9 ? 1 - (sp.t - 1.9) / 0.3 : 0.9; g.translate(x, y); g.scale(sc, sc); c.drawBot(g, 0, 0, -c.dir, c.look || c.color, 'win', t); g.restore();
    },
  },

  // Nvidia: a GPU falls from the sky. It is sold out.
  gpu: {
    name: 'GPU DROP', len: 2.2, impact: 1.25,
    update(sp) { once(sp, 'w', () => sp.c.sfx.whistle()); if (sp.t > 1.35) once(sp, 'stamp', () => sp.c.tone(90, { dur: 0.2, type: 'square', vol: 0.3 })); },
    draw(sp, g, t) {
      const { c } = sp, s = Math.max(0.7, c.s), p = Math.min(1, (sp.t / 1.25) ** 2);
      const w = 190 * s, hgt = 70 * s, x = c.tx - w / 2, y = lerp(-hgt - 10, c.ty - hgt / 2 - 40 * s, p);
      g.save(); g.fillStyle = '#1b1f2b'; c.roundRect(g, x, y, w, hgt, 8); g.fill();
      g.fillStyle = '#76B900'; g.fillRect(x, y + hgt - 8 * s, w, 8 * s);
      g.fillStyle = '#c9a227'; g.fillRect(x + 20 * s, y + hgt, w - 40 * s, 7 * s);
      for (const fx of [0.28, 0.72]) {
        const cx = x + w * fx, cy = y + hgt / 2 - 3 * s; g.fillStyle = '#2b3350'; g.beginPath(); g.arc(cx, cy, 24 * s, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#7a8094'; g.lineWidth = 3 * s; for (let i = 0; i < 5; i++) { const a = t * 20 + i * 1.256; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 20 * s, cy + Math.sin(a) * 20 * s); g.stroke(); }
      }
      if (sp.t > 1.35) { g.translate(c.tx, y + hgt / 2); g.rotate(-0.18); g.strokeStyle = '#FF6B6B'; g.lineWidth = 4; g.strokeRect(-82 * s, -18 * s, 164 * s, 36 * s); label(g, 'SOLD OUT', 0, 8 * s, 18 * s, '#FF6B6B'); }
      g.restore();
    },
  },

  // Anyone else: confidently summons an opponent that does not exist.
  hallucination: {
    name: 'HALLUCINATION', len: 2.5, impact: 1.85,
    update(sp) { once(sp, 'snd', () => sp.c.tone(330, { to: 990, dur: 0.9, type: 'sine', vol: 0.16 })); },
    draw(sp, g, t) {
      const { c } = sp, s = Math.max(0.6, c.s);
      const appear = ease(sp.t / 0.5), charge = sp.t < 1.3 ? 0 : ease((sp.t - 1.3) / 0.5);
      const x = lerp(c.tx + c.dir * 120 * s, c.tx, charge);
      if (sp.t > 2.1) return;
      g.save(); g.globalAlpha = 0.55 * appear * (1 - charge * 0.6) + Math.sin(t * 30) * 0.08;
      g.translate(x, c.floor); g.scale(s, s); c.drawBot(g, 0, 0, -c.dir, '#B79CF2', 'aim', t); g.restore();
      if (sp.t < 1.4) { g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#C9CFDC'; g.fillText('Source: trust me', x, c.floor - 200 * s); }
    },
  },
};

/** The move for a lab. Labs not listed get Hallucination. */
const BY_LAB = {
  xAI: 'aura', Anthropic: 'apology', OpenAI: 'emdash', 'Google DeepMind': 'library', Google: 'library', DeepSeek: 'sale',
  Alibaba: 'release', Moonshot: 'moon', 'Mistral AI': 'wind', Mistral: 'wind', Meta: 'llama', 'Meta AI': 'llama',
  'Z.ai (Zhipu AI)': 'zorro', 'Zhipu AI': 'zorro', 'Thinking Machines': 'thought', MiniMax: 'minimax', Nvidia: 'gpu', NVIDIA: 'gpu',
};
export const moveIdFor = (org) => BY_LAB[org] || 'hallucination';
export const moveNameFor = (org) => MOVES[moveIdFor(org)].name;

/** Starts a move. `c` is the scene (see top); c.land() is called once at impact. */
export function startMove(org, c) {
  const def = MOVES[moveIdFor(org)];
  return { id: moveIdFor(org), name: def.name, len: def.len, impact: def.impact, def, c, t: 0, landed: false };
}
export function updateMove(sp, dt) {
  sp.t += dt;
  sp.def.update?.(sp, dt);
  if (!sp.landed && sp.t >= sp.impact) { sp.landed = true; sp.c.land(); }
  return sp.t >= sp.len;
}
export function drawMove(sp, g, t) { sp.def.draw(sp, g, t); }
