/* Motion Prompt · pack "lp" · MIT License (c) 2026 Shohei Ohtaki · https://github.com/showheyohtaki/motion-prompt */
MotionPrompt.pack('lp', function () {
  // @kit



  const CW = 539, CH = 208;
  const CYC = 4.8;
  const C = {
    desk: '#E7EAF0', win: '#FFFFFF', bar: '#F3F5F8', rule: '#E2E6ED', ink: '#1C2333', sub: '#7D879B',
    faint: '#DCE1EA', soft: '#F3F5F9', skel: '#E4E8EF', acc: '#FF5A2C', accL: '#FFE5DB', blue: '#3B64E8', blueL: '#E1E8FF'
  };
  const JP = 'system-ui, "PingFang TC", "Microsoft JhengHei", sans-serif';
  const EN = '"Avenir Next", "Helvetica Neue", system-ui, sans-serif';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const eIOs = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const eOut = x => 1 - Math.pow(1 - x, 3);
  const eIn = x => x * x * x;
  const mod = (a, n) => ((a % n) + n) % n;

  const eEl = x => x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x - 0.075) * 2 * Math.PI / 0.3) + 1;
  function rr(k, x, y, w, h, r) { k.beginPath(); k.roundRect(x, y, w, h, r); }
  function txt(k, s, x, y, font, col, align = 'left', base = 'alphabetic', ls = '0px') {
    k.font = font; k.fillStyle = col; k.textAlign = align; k.textBaseline = base; k.letterSpacing = ls; k.fillText(s, x, y); k.letterSpacing = '0px';
  }

  function steps(keys, u) {
    u = mod(u, CYC);
    if (u <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (u < keys[i][0]) { const [t0, a] = keys[i - 1], [t1, b] = keys[i]; return lerp(a, b, eIO((u - t0) / (t1 - t0))); }
    return keys[keys.length - 1][1];
  }

  function path(keys, u) {
    u = mod(u, CYC);
    if (u <= keys[0][0]) return [keys[0][1], keys[0][2]];
    for (let i = 1; i < keys.length; i++) if (u < keys[i][0]) { const a = keys[i - 1], b = keys[i], f = eIO((u - a[0]) / (b[0] - a[0])); return [lerp(a[1], b[1], f), lerp(a[2], b[2], f)]; }
    const l = keys[keys.length - 1]; return [l[1], l[2]];
  }

  function trans(on, u, dur, ease = eOut) {
    const s = on(u);
    for (let i = 0, t = u; i < 600; i++, t -= 1 / 120) if (on(t - 1 / 120) !== s) { const q = ease(P(u, t, t + dur)); return s ? q : 1 - q; }
    return s ? 1 : 0;
  }

  const WIN = { x: 14, y: 8, w: 511, h: 192, r: 10, bar: 24 };
  const VW = WIN.w, VH = WIN.h - WIN.bar;
  function frame(k, url = 'example.com') {
    k.fillStyle = C.desk; k.fillRect(0, 0, CW, CH);
    k.save(); k.shadowColor = 'rgba(28,35,51,.16)'; k.shadowBlur = 16; k.shadowOffsetY = 4;
    k.fillStyle = C.win; rr(k, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r); k.fill(); k.restore();
    k.save(); rr(k, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r); k.clip();
    k.fillStyle = C.bar; k.fillRect(WIN.x, WIN.y, WIN.w, WIN.bar); k.fillStyle = C.rule; k.fillRect(WIN.x, WIN.y + WIN.bar - 1, WIN.w, 1); k.restore();
    for (let i = 0; i < 3; i++) { k.fillStyle = '#CDD3DD'; k.beginPath(); k.arc(WIN.x + 15 + i * 12, WIN.y + 12, 3.6, 0, 7); k.fill(); }
    k.fillStyle = '#E6E9EF'; rr(k, WIN.x + WIN.w / 2 - 110, WIN.y + 5, 220, 14, 7); k.fill();
    txt(k, url, WIN.x + WIN.w / 2, WIN.y + 12.5, `500 9.5px ${EN}`, C.sub, 'center', 'middle');
  }
  function view(k, fn) {
    k.save(); rr(k, WIN.x, WIN.y + WIN.bar, VW, VH, [0, 0, WIN.r, WIN.r]); k.clip(); k.translate(WIN.x, WIN.y + WIN.bar);
    k.fillStyle = '#fff'; k.fillRect(0, 0, VW, VH); fn(); k.restore();
  }

  function sbar(k, pos, ratio = 0.42) { const th = (VH - 8) * ratio; k.fillStyle = 'rgba(28,35,51,.38)'; rr(k, VW - 9, 4 + (VH - 8 - th) * clamp(pos), 5, th, 2.5); k.fill(); }

  function bars(k, x, y, w, n, col = C.faint, hh = 6, gap = 11, last = 0.62) {
    k.fillStyle = col; for (let i = 0; i < n; i++) { rr(k, x, y + i * gap, i === n - 1 && n > 1 ? w * last : w, hh, hh / 2); k.fill(); }
  }

  const PICS = [
    { sky: ['#A9C0FF', '#E4EBFF'], sun: '#FF5A2C', sx: .74, sy: .32, m1: '#7D9AF4', m2: '#4B6BDB' },
    { sky: ['#FFC7B2', '#FFEDE5'], sun: '#FFFFFF', sx: .28, sy: .34, m1: '#F4977A', m2: '#DD5F3B' },
    { sky: ['#3A4884', '#7484CC'], sun: '#FFE5DB', sx: .6, sy: .3, m1: '#2B3770', m2: '#1C2349' }
  ];
  const M1 = [[0, .62], [.22, .4], [.42, .56], [.66, .3], [.86, .5], [1, .42]], M2 = [[0, .8], [.28, .6], [.5, .76], [.76, .58], [1, .74]];
  function mount(k, w, h, pts, col, flip) { k.fillStyle = col; k.beginPath(); k.moveTo(flip ? w : 0, h + 1); pts.forEach(([a, b]) => k.lineTo((flip ? 1 - a : a) * w, b * h)); k.lineTo(flip ? 0 : w, h + 1); k.closePath(); k.fill(); }
  function pic(k, x, y, w, h, v = 0, r = 6, z = 1) {
    const p = PICS[v % PICS.length];
    k.save(); rr(k, x, y, w, h, r); k.clip();
    k.translate(x + w / 2, y + h / 2); k.scale(z, z); k.translate(-w / 2, -h / 2);
    const g = k.createLinearGradient(0, 0, 0, h); g.addColorStop(0, p.sky[0]); g.addColorStop(1, p.sky[1]); k.fillStyle = g; k.fillRect(-1, -1, w + 2, h + 2);
    k.fillStyle = p.sun; k.beginPath(); k.arc(w * p.sx, h * p.sy, Math.min(w, h) * 0.13, 0, 7); k.fill();
    mount(k, w, h, M1, p.m1, v % 2); mount(k, w, h, M2, p.m2, (v + 1) % 2);
    k.restore();
  }
  function btn(k, x, y, w, h, label, col = C.acc, tcol = '#fff', fs = 12) {
    k.fillStyle = col; rr(k, x, y, w, h, h / 2); k.fill(); txt(k, label, x + w / 2, y + h / 2 + 0.5, `700 ${fs}px ${JP}`, tcol, 'center', 'middle');
  }
  function logo(k, x, y, col = C.ink) { k.fillStyle = C.acc; rr(k, x, y - 7, 14, 14, 4); k.fill(); txt(k, 'SAMPLE', x + 20, y + 0.5, `800 12px ${EN}`, col, 'left', 'middle', '1px'); }

  const NAVX = [300, 346, 392];
  function header(k, y, active = -1) {
    k.fillStyle = '#fff'; k.fillRect(0, y, VW, 34); k.fillStyle = C.rule; k.fillRect(0, y + 33, VW, 1);
    logo(k, 18, y + 17);
    ["Features", "Pricing", 'FAQ'].forEach((s, i) => txt(k, s, NAVX[i], y + 17.5, `600 12px ${JP}`, active === i ? C.acc : C.ink, 'left', 'middle'));
    btn(k, 428, y + 7, 70, 20, "Try free", C.acc, '#fff', 10.5);
  }

  function cursor(k, x, y, press = 0) {
    const s = 1.2 * (1 - 0.12 * press);
    k.save(); k.translate(x, y); k.scale(s, s); k.beginPath();
    [[0, 0], [0, 16.5], [4.2, 12.6], [7, 19], [9.8, 17.8], [7.1, 11.6], [12.6, 11.6]].forEach(([a, b], i) => i ? k.lineTo(a, b) : k.moveTo(a, b));
    k.closePath(); k.lineJoin = 'round'; k.lineWidth = 1.6; k.strokeStyle = '#fff'; k.fillStyle = C.ink; k.fill(); k.stroke(); k.restore();
  }

  function click(k, x, y, u, times) {
    let press = 0;
    for (const tc of times) {
      const d = mod(u - tc + 0.1, CYC) - 0.1;
      if (d > -0.1 && d < 0.12) press = Math.max(press, 1 - Math.abs(d - 0.01) / 0.11);
      if (d >= 0 && d < 0.35) { const q = d / 0.35; k.strokeStyle = `rgba(28,35,51,${0.45 * (1 - q)})`; k.lineWidth = 2; k.beginPath(); k.arc(x, y, 5 + 13 * eOut(q), 0, 7); k.stroke(); }
    }
    cursor(k, x, y, clamp(press));
  }

  function spinner(k, x, y, r, u, col = C.acc) {
    const a = u / 0.8 * Math.PI * 2;
    k.lineCap = 'round'; k.lineWidth = r * 0.28; k.strokeStyle = C.faint; k.beginPath(); k.arc(x, y, r, 0, 7); k.stroke();
    k.strokeStyle = col; k.beginPath(); k.arc(x, y, r, a, a + Math.PI * 0.6); k.stroke(); k.lineCap = 'butt';
  }

  function enteredAt(sy, top, line, u) {
    const dt = 1 / 120, y = t => top - sy(t);
    if (y(u) >= VH) return null;
    for (let t = u; t > u - CYC; t -= dt) {
      const a = y(t), b = y(t - dt);
      if (a >= VH) return null;
      if (a < line && b >= line) return t - dt + dt * (b - line) / (b - a);
    }
    return y(u) < line ? -1e9 : null;
  }
  const CELLS = [];

  // @element 01

  CELLS[0] = (k, w, h, u) => {
    frame(k);
    const s = steps([[0.3, 0], [1.9, 1], [2.9, 1], [4.3, 0]], u), y = s * 120;
    view(k, () => {
      const g = k.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, '#9DB6FB'); g.addColorStop(1, '#E6ECFF');
      k.save(); k.translate(0, -y * 0.15);
      k.fillStyle = g; k.fillRect(0, 0, VW, 260); k.fillStyle = C.acc; k.beginPath(); k.arc(392, 54, 25, 0, 7); k.fill(); k.restore();
      k.save(); k.translate(0, -y * 0.4); mount(k, VW, 190, M1, '#7D9AF4', 0); k.restore();
      k.save(); k.translate(0, -y * 0.7); mount(k, VW, 205, M2, '#4B6BDB', 1); k.restore();
      k.save(); k.translate(0, -y);
      txt(k, "Into the mountains.", 34, 64, `800 28px ${JP}`, '#fff', 'left', 'alphabetic', '1px');
      bars(k, 34, 78, 160, 2, 'rgba(255,255,255,.85)');
      btn(k, 34, 106, 92, 26, "Book now");
      k.fillStyle = '#fff'; k.fillRect(0, VH, VW, 200);
      txt(k, "Popular courses", 34, VH + 34, `800 16px ${JP}`, C.ink);
      for (let i = 0; i < 3; i++) { pic(k, 34 + i * 152, VH + 50, 136, 58, i, 6); bars(k, 34 + i * 152, VH + 116, 110, 1, C.faint); }
      k.restore();
      sbar(k, s * 0.35, 0.4);
    });
  };

  // @element 02

  CELLS[1] = (k, w, h, u) => {
    frame(k);
    const SY = t => steps([[0.35, 0], [1.0, 95], [1.5, 95], [2.1, 200], [3.2, 200], [4.4, 0]], t), y = SY(u);
    const LINE = VH * 0.85, DUR = 0.7, RISE = 28;
    view(k, () => {
      k.save(); k.translate(0, -y);
      txt(k, "Live a little lighter.", 34, 52, `800 24px ${JP}`, C.ink); bars(k, 34, 68, 190, 3); btn(k, 34, 108, 96, 26, "Learn more");
      pic(k, 286, 18, 196, 110, 0, 8);
      const items = [
        [172, () => txt(k, "3 reasons to choose us", VW / 2, 172 + 20, `800 18px ${JP}`, C.ink, 'center')],
        [206, () => { for (let i = 0; i < 3; i++) { const x = 34 + i * 152; k.fillStyle = C.soft; rr(k, x, 206, 136, 106, 8); k.fill(); pic(k, x + 8, 214, 120, 56, i, 5); bars(k, x + 10, 280, 112, 2, '#CBD2DE'); } }],
        [334, () => bars(k, 110, 334, 290, 3, C.faint, 7, 13)]
      ];
      for (const [top, draw] of items) {
        const t0 = enteredAt(SY, top, LINE, u); if (t0 === null) continue;
        const q = eOut(P(u, t0, t0 + DUR));
        k.save(); k.globalAlpha = q; k.translate(0, RISE * (1 - q)); draw(); k.restore();
      }
      k.restore();
      sbar(k, y / 200, 0.5);
    });
  };

  // @element 03

  CELLS[2] = (k, w, h, u) => {
    frame(k);
    const y = steps([[0.4, 0], [1.3, 110], [1.9, 110], [2.8, 250], [3.4, 250], [4.4, 0]], u);
    const STRIP = 22;
    view(k, () => {
      k.save(); k.translate(0, -y);
      pic(k, 24, 70, 214, 112, 0, 8);
      txt(k, "A fresh start,", 262, 104, `800 22px ${JP}`, C.ink); bars(k, 262, 120, 210, 3); btn(k, 262, 160, 100, 26, "Learn more");
      k.fillStyle = C.soft; k.fillRect(0, 212, VW, 240);
      txt(k, "Features", VW / 2, 246, `800 18px ${JP}`, C.ink, 'center');
      for (let i = 0; i < 3; i++) { const x = 34 + i * 152; k.fillStyle = '#fff'; rr(k, x, 262, 136, 120, 8); k.fill(); pic(k, x + 8, 270, 120, 58, i, 5); bars(k, x + 10, 340, 110, 3, C.faint, 6, 11); }
      k.fillStyle = C.ink; k.fillRect(0, 0, VW, STRIP);
      txt(k, "Limited-time offer", VW / 2, STRIP / 2 + 0.5, `600 11px ${JP}`, '#fff', 'center', 'middle');
      k.restore();
      const hy = Math.max(STRIP - y, 0), sh = clamp((y - STRIP) / 24);
      if (sh > 0) { const g = k.createLinearGradient(0, hy + 34, 0, hy + 46); g.addColorStop(0, `rgba(28,35,51,${0.16 * sh})`); g.addColorStop(1, 'rgba(28,35,51,0)'); k.fillStyle = g; k.fillRect(0, hy + 34, VW, 12); }
      header(k, hy);
      sbar(k, y / 250, 0.42);
    });
  };

  // @element 04

  CELLS[3] = (k, w, h, u) => {
    frame(k);
    const y = steps([[0.3, 0], [3.0, 500], [3.5, 500], [4.5, 0]], u);
    const PIN0 = 110, PD = 300;
    const top = y < PIN0 ? PIN0 - y : y < PIN0 + PD ? 0 : PIN0 + PD - y, p = clamp((y - PIN0) / PD);

    const f = eIO(P(p, 1 / 3 - 0.07, 1 / 3 + 0.07)) + eIO(P(p, 2 / 3 - 0.07, 2 / 3 + 0.07));
    view(k, () => {
      txt(k, "Done in 3 steps", 34, 56 - y, `800 22px ${JP}`, C.ink); bars(k, 34, 72 - y, 240, 2);
      k.save(); k.translate(0, top);
      k.fillStyle = C.ink; k.fillRect(0, 0, VW, VH);

      txt(k, "STEP", 34, 40, `700 12px ${EN}`, 'rgba(255,255,255,.6)', 'left', 'alphabetic', '2px');
      k.save(); k.beginPath(); k.rect(30, 46, 120, 52); k.clip();
      for (let i = 0; i < 3; i++) txt(k, '0' + (i + 1), 32, 90 + (i - f) * 52, `800 46px ${EN}`, '#fff');
      k.restore();
      bars(k, 34, 110, 150, 3, 'rgba(255,255,255,.28)');

      k.fillStyle = 'rgba(255,255,255,.16)'; rr(k, 232, 22, 4, 124, 2); k.fill();
      k.fillStyle = C.acc; rr(k, 232, 22, 4, 124 * p, 2); k.fill();

      k.save(); rr(k, 256, 22, 226, 124, 8); k.clip();
      for (let i = 0; i < 3; i++) pic(k, 256, 22 + (i - f) * 124, 226, 124, i, 0);
      k.restore();
      k.fillStyle = '#fff'; k.fillRect(0, VH, VW, 200); bars(k, 34, VH + 30, 300, 3);
      k.restore();
      sbar(k, y / 500, 0.3);
    });
  };

  // @element 05

  CELLS[4] = (k, w, h, u) => {
    frame(k);
    const y = steps([[0.3, 0], [3.0, 420], [3.5, 420], [4.5, 0]], u);
    const PIN0 = 40, PD = 380, N = 4, PWD = 200, GAP = 20;
    const top = y < PIN0 ? PIN0 - y : 0, p = clamp((y - PIN0) / PD);
    const travel = 34 * 2 + N * PWD + (N - 1) * GAP - VW;
    view(k, () => {
      txt(k, "WORKS", 34, 30 - y, `800 20px ${EN}`, C.ink, 'left', 'alphabetic', '2px');
      k.save(); k.translate(0, top);
      k.fillStyle = C.soft; k.fillRect(0, 0, VW, VH + 40);
      for (let i = 0; i < N; i++) {
        const x = 34 + i * (PWD + GAP) - p * travel;
        pic(k, x, 18, PWD, 112, i % 3, 8);
        txt(k, '0' + (i + 1), x + 14, 118, `800 22px ${EN}`, '#fff');
        bars(k, x, 140, 120, 1, '#CBD2DE');
      }
      k.restore();
      sbar(k, y / 420, 0.36);
    });
  };

  // @element 06

  CELLS[5] = (k, w, h, u) => {
    frame(k);
    const T = CYC / 2, lu = mod(u, T), dir = u < T ? 1 : -1, from = u < T ? 0 : VH, DRIFT = 34;
    const y = from + dir * (DRIFT * eOut(P(lu, 0.45, 0.85)) + (VH - DRIFT) * eOut(P(lu, 0.9, 1.5)));
    view(k, () => {
      k.save(); k.translate(0, -y);
      for (let i = 0; i < 2; i++) {
        const y0 = i * VH, dark = i === 1;
        k.fillStyle = dark ? C.ink : C.blueL; k.fillRect(0, y0, VW, VH);
        txt(k, '0' + (i + 1), 34, y0 + 70, `800 46px ${EN}`, C.acc);
        txt(k, dark ? "Try it" : "Get discovered", 34, y0 + 102, `800 18px ${JP}`, dark ? '#fff' : C.ink);
        bars(k, 34, y0 + 118, 170, 2, dark ? 'rgba(255,255,255,.3)' : '#C3CDEA');
        pic(k, 262, y0 + 24, 220, 120, dark ? 2 : 0, 8);
      }
      k.restore();
      sbar(k, y / VH, 0.5);
    });
  };

  // @element 07

  CELLS[6] = (k, w, h, u) => {
    frame(k);
    const MAX = 430;
    const y = steps([[0.3, 0], [0.75, 110], [1.15, 110], [1.6, 220], [2.0, 220], [2.45, 330], [2.85, 330], [3.3, MAX], [3.75, MAX], [4.55, 0]], u);
    view(k, () => {
      k.save(); k.translate(0, -y);
      txt(k, "Your first website", 70, 44, `800 20px ${JP}`, C.ink); bars(k, 70, 56, 120, 1, C.faint, 5);
      pic(k, 70, 74, 371, 112, 0, 8);
      for (let b = 0; b < 4; b++) { const y0 = 204 + b * 82; k.fillStyle = C.ink; rr(k, 70, y0, 140, 9, 4.5); k.fill(); bars(k, 70, y0 + 22, 371, 4, C.faint, 6, 12); }
      k.restore();
      k.fillStyle = C.faint; k.fillRect(0, 0, VW, 6);
      k.fillStyle = C.acc; k.fillRect(0, 0, VW * (y / MAX), 6);
      sbar(k, y / MAX, 0.3);
    });
  };

  // @element 08

  CELLS[7] = (k, w, h, u) => {
    frame(k);
    const SY = t => steps([[0.35, 0], [1.0, 90], [1.6, 90], [2.2, 180], [3.3, 180], [4.4, 0]], t), y = SY(u);
    const LINE = VH * 0.8, DUR = 0.8, MARK = '#FFE36B', F = `800 20px ${JP}`;
    const rows = [[190, ["Make everyday meals ", "in just 10 minutes", "."]], [290, ["Beginner-friendly ", "reliable recipes", "."]]];
    view(k, () => {
      k.save(); k.translate(0, -y);
      txt(k, "Made for busy people", 70, 50, `700 14px ${JP}`, C.sub); txt(k, "A new kitchen helper", 70, 80, `800 24px ${JP}`, C.ink);
      bars(k, 70, 96, 330, 4, C.faint, 6, 12, 0.8);
      for (const [base, parts] of rows) {
        k.font = F; const ws = parts.map(s => k.measureText(s).width); let x = (VW - ws.reduce((a, b) => a + b, 0)) / 2;
        const t0 = enteredAt(SY, base - 20, LINE, u), q = t0 === null ? 0 : eOut(P(u, t0, t0 + DUR));
        if (q > 0) { k.fillStyle = MARK; k.fillRect(x + ws[0], base - 8, ws[1] * q, 11); }
        parts.forEach((s, i) => { txt(k, s, x, base, F, i === 1 ? C.ink : '#4A5368'); x += ws[i]; });
        bars(k, 110, base + 22, 291, 2, C.faint, 6, 12, 0.7);
      }
      k.restore();
      sbar(k, y / 180, 0.5);
    });
  };

  // @element 09

  CELLS[8] = (k, w, h, u) => {
    frame(k);
    const CX = [26, 192, 358], CY = 18, CWD = 146, CHT = 128, LIFT = 10;
    const cur = t => path([[0, 70, 160], [0.45, 96, 78], [1.4, 110, 86], [1.62, 262, 80], [2.5, 276, 88], [2.72, 428, 80], [3.6, 440, 88], [4.0, 470, 160], [4.8, 70, 160]], t);
    view(k, () => {
      k.fillStyle = C.soft; k.fillRect(0, 0, VW, VH);
      for (let i = 0; i < 3; i++) {
        const inside = t => { const [x, y] = cur(t); return x > CX[i] && x < CX[i] + CWD && y > CY && y < CY + CHT; };
        const q = trans(inside, u, 0.3), x = CX[i], y = CY - LIFT * q;
        k.save(); k.shadowColor = `rgba(28,35,51,${0.08 + 0.14 * q})`; k.shadowBlur = 6 + 16 * q; k.shadowOffsetY = 2 + 10 * q;
        k.fillStyle = '#fff'; rr(k, x, y, CWD, CHT, 10); k.fill(); k.restore();
        pic(k, x + 8, y + 8, CWD - 16, 66, i, 6);
        txt(k, ["Mountain lodge", "Seaside lodge", "Starlight lodge"][i], x + 12, y + 96, `800 13px ${JP}`, C.ink); bars(k, x + 12, y + 106, 100, 1);
      }
      const [cx, cy] = cur(u); cursor(k, cx, cy);
    });
  };

  // @element 10

  CELLS[9] = (k, w, h, u) => {
    frame(k);
    const FX = [22, 267], FY = 16, FW = 222, FH = 118, ZOOM = 0.15;
    const cur = t => path([[0, 60, 160], [0.5, 120, 70], [1.8, 140, 84], [2.2, 370, 70], [3.4, 390, 84], [3.9, 470, 160], [4.8, 60, 160]], t);
    view(k, () => {
      for (let i = 0; i < 2; i++) {
        const inside = t => { const [x, y] = cur(t); return x > FX[i] && x < FX[i] + FW && y > FY && y < FY + FH; };
        const q = trans(inside, u, 0.5);
        pic(k, FX[i], FY, FW, FH, i, 8, 1 + ZOOM * q);
        txt(k, ["Summer cabin", "Seaside cafe"][i], FX[i], FY + FH + 20, `800 13px ${JP}`, C.ink); bars(k, FX[i], FY + FH + 28, 150, 1);
      }
      const [cx, cy] = cur(u); cursor(k, cx, cy);
    });
  };

  // @element 11

  CELLS[10] = (k, w, h, u) => {
    frame(k);
    const cur = t => [255 + 175 * Math.sin(2 * Math.PI * t / CYC), 86 + 46 * Math.sin(4 * Math.PI * t / CYC)];

    let t = u - 2, [fx, fy] = cur(t);
    for (let i = 0; i < 120; i++) { t += 1 / 60; const [tx, ty] = cur(t); fx += (tx - fx) * 0.12; fy += (ty - fy) * 0.12; }
    view(k, () => {
      txt(k, 'CREATIVE STUDIO', VW / 2, 74, `800 34px ${EN}`, C.ink, 'center', 'alphabetic', '3px');
      bars(k, VW / 2 - 120, 96, 240, 2, C.faint, 6, 12, 0.7);
      btn(k, VW / 2 - 50, 128, 100, 24, "View work", C.ink);
      k.fillStyle = C.acc; k.globalAlpha = 0.88; k.beginPath(); k.arc(fx, fy, 17, 0, 7); k.fill(); k.globalAlpha = 1;
      const [cx, cy] = cur(u); cursor(k, cx, cy);
    });
  };

  // @element 12

  CELLS[11] = (k, w, h, u) => {
    frame(k);
    const BX = VW / 2, BY = 84, R = 110, PULL = 0.35;
    const cur = t => path([[0, -20, 130], [0.9, 170, 104], [1.5, 300, 62], [2.1, 318, 110], [2.7, 205, 66], [3.1, 250, 92], [3.6, 545, 120], [4.8, 545, 120]], t);
    const inside = t => { const [x, y] = cur(t); return Math.hypot(x - BX, y - BY) < R; };

    const pull = t => {
      let t0 = t; for (let i = 0; i < 600 && inside(t0 - 1 / 120); i++) t0 -= 1 / 120;
      let ox = 0, oy = 0; for (let s = t0; s <= t; s += 1 / 60) { const [x, y] = cur(s); ox += ((x - BX) * PULL - ox) * 0.18; oy += ((y - BY) * PULL - oy) * 0.18; }
      return [ox, oy];
    };
    let ox = 0, oy = 0;
    if (inside(u)) [ox, oy] = pull(u);
    else {
      let t1 = u; for (let i = 0; i < 600 && !inside(t1); i++) t1 -= 1 / 120;
      if (inside(t1)) { const [lx, ly] = pull(t1), e = 1 - eEl(P(u, t1, t1 + 1.1)); ox = lx * e; oy = ly * e; }
    }
    view(k, () => {
      k.fillStyle = C.soft; k.fillRect(0, 0, VW, VH);
      k.save(); k.translate(BX + ox, BY + oy);
      k.shadowColor = 'rgba(255,90,44,.35)'; k.shadowBlur = 16; k.shadowOffsetY = 6;
      k.fillStyle = C.acc; rr(k, -84, -26, 168, 52, 26); k.fill(); k.shadowColor = 'transparent';
      txt(k, "Contact", 0, 1, `800 16px ${JP}`, '#fff', 'center', 'middle');
      k.restore();
      const [cx, cy] = cur(u); cursor(k, cx, cy);
    });
  };

  // @element 13

  CELLS[12] = (k, w, h, u) => {
    frame(k);
    const B = { x: 115, y: 78, w: 280, h: 56 }, TAPS = [[0.7, 165, 110], [2.9, 345, 100]], DUR = 0.6;
    const [cx, cy] = path([[0, 430, 160], [0.55, 165, 110], [1.6, 165, 110], [2.7, 345, 100], [3.6, 345, 100], [4.4, 430, 160], [4.8, 430, 160]], u);
    view(k, () => {
      k.fillStyle = C.soft; k.fillRect(0, 0, VW, VH);
      txt(k, "Sign up", VW / 2, 38, `800 18px ${JP}`, C.ink, 'center'); bars(k, VW / 2 - 110, 50, 220, 1, C.faint, 6, 11, 1);
      k.save(); k.shadowColor = 'rgba(28,35,51,.18)'; k.shadowBlur = 8; k.shadowOffsetY = 3; k.fillStyle = C.acc; rr(k, B.x, B.y, B.w, B.h, 10); k.fill(); k.restore();
      k.save(); rr(k, B.x, B.y, B.w, B.h, 10); k.clip();
      for (const [tc, px, py] of TAPS) {
        const d = u - tc; if (d < 0 || d > 0.8) continue;
        const Rm = Math.max(Math.hypot(px - B.x, py - B.y), Math.hypot(px - B.x - B.w, py - B.y), Math.hypot(px - B.x, py - B.y - B.h), Math.hypot(px - B.x - B.w, py - B.y - B.h));
        k.fillStyle = `rgba(255,255,255,${0.4 * (1 - P(d, 0.3, 0.8))})`; k.beginPath(); k.arc(px, py, Rm * eOut(P(d, 0, DUR)), 0, 7); k.fill();
      }
      k.restore();
      txt(k, "Submit", VW / 2, B.y + B.h / 2 + 1, `800 17px ${JP}`, '#fff', 'center', 'middle');
      click(k, cx, cy, u, TAPS.map(a => a[0]));
    });
  };

  // @element 14

  CELLS[13] = (k, w, h, u) => {
    frame(k);
    const LINKS = ["Services", "Our work", "About us"], F = `800 20px ${JP}`, GAP = 56, LY = 84, DUR = 0.3;
    const cur = t => path([[0, 120, 150], [0.45, 170, 80], [1.3, 186, 84], [1.55, 268, 80], [2.4, 282, 84], [2.65, 372, 80], [3.5, 390, 84], [3.95, 430, 150], [4.8, 120, 150]], t);
    view(k, () => {
      logo(k, 22, 28); bars(k, 90, 132, 331, 2, C.faint, 6, 12, 0.6);
      k.font = F; const ws = LINKS.map(s => k.measureText(s).width); let x = (VW - ws.reduce((a, b) => a + b, 0) - GAP * (LINKS.length - 1)) / 2;
      LINKS.forEach((s, i) => {
        const x0 = x, x1 = x + ws[i], inside = t => { const [a, b] = cur(t); return a > x0 - 6 && a < x1 + 6 && b > LY - 22 && b < LY + 14; };
        txt(k, s, x0, LY, F, C.ink);

        const on = inside(u); let tc = null; for (let j = 0, t = u; j < 600; j++, t -= 1 / 120) if (inside(t - 1 / 120) !== on) { tc = t; break; }
        if (tc !== null) {
          const q = eOut(P(u, tc, tc + DUR)), a = on ? 0 : q, b = on ? q : 1;
          if (b > a) { k.fillStyle = C.acc; k.fillRect(x0 + ws[i] * a, LY + 8, ws[i] * (b - a), 3); }
        }
        x += ws[i] + GAP;
      });
      const [cx, cy] = cur(u); cursor(k, cx, cy);
    });
  };

  // @element 15

  CELLS[14] = (k, w, h, u) => {
    frame(k);
    const F = { x: 76, y: 14, w: 359, h: 140 };
    const pos = steps([[0.75, 0.5], [1.55, 0.2], [2.65, 0.82], [3.55, 0.5]], u), hx = F.x + F.w * pos, hy = F.y + F.h / 2;
    const drag = u > 0.68 && u < 3.62;
    const [cx, cy] = u < 0.7 ? path([[0, 430, 160], [0.62, hx, hy + 4]], u) : drag ? [hx, hy + 4] : path([[3.6, hx, hy + 4], [4.3, 430, 160], [4.8, 430, 160]], u);
    view(k, () => {
      k.fillStyle = C.soft; k.fillRect(0, 0, VW, VH);
      pic(k, F.x, F.y, F.w, F.h, 1, 10);
      k.save(); k.beginPath(); k.rect(F.x, F.y, hx - F.x, F.h); k.clip();
      pic(k, F.x, F.y, F.w, F.h, 1, 10);
      k.globalCompositeOperation = 'saturation'; k.fillStyle = '#888'; k.fillRect(F.x, F.y, F.w, F.h);
      k.globalCompositeOperation = 'source-over'; k.fillStyle = 'rgba(28,35,51,.18)'; k.fillRect(F.x, F.y, F.w, F.h);
      k.restore();
      const tag = (s, x, al) => { k.font = `800 11px ${EN}`; const tw = k.measureText(s).width + 16; const bx = al ? x - tw : x; k.fillStyle = 'rgba(28,35,51,.55)'; rr(k, bx, F.y + 10, tw, 20, 10); k.fill(); txt(k, s, bx + tw / 2, F.y + 20.5, `800 11px ${EN}`, '#fff', 'center', 'middle', '1px'); };
      k.save(); rr(k, F.x, F.y, F.w, F.h, 10); k.clip(); tag("BEFORE", F.x + 10, false); tag("AFTER", F.x + F.w - 10, true); k.restore();
      k.fillStyle = '#fff'; k.fillRect(hx - 1.5, F.y, 3, F.h);
      k.save(); k.shadowColor = 'rgba(28,35,51,.3)'; k.shadowBlur = 8; k.shadowOffsetY = 2; k.fillStyle = '#fff'; k.beginPath(); k.arc(hx, hy, 17, 0, 7); k.fill(); k.restore();
      k.fillStyle = C.ink; k.beginPath(); k.moveTo(hx - 4, hy - 6); k.lineTo(hx - 11, hy); k.lineTo(hx - 4, hy + 6); k.closePath(); k.moveTo(hx + 4, hy - 6); k.lineTo(hx + 11, hy); k.lineTo(hx + 4, hy + 6); k.closePath(); k.fill();
      cursor(k, cx, cy, drag ? 1 : 0);
    });
  };

  // @element 16

  CELLS[15] = (k, w, h, u) => {
    frame(k);
    const OX = WIN.x, OY = WIN.y + WIN.bar;
    const [cx, cy] = path([[0, 440, 150], [0.7, 300, 120], [1.25, 360, -18], [1.9, 372, -20], [2.6, 366, 38], [3.3, 366, 38], [4.4, 440, 150], [4.8, 440, 150]], u);
    const CLOSE = 2.9;
    let TRIG = 0.7; while (TRIG < 1.3 && path([[0.7, 300, 120], [1.25, 360, -18]], TRIG)[1] >= 0) TRIG += 1 / 240;
    const m = eOut(P(u, TRIG + 0.05, TRIG + 0.45)) * (1 - P(u, CLOSE + 0.03, CLOSE + 0.25));
    const D = { x: 125.5, y: 18, w: 260, h: 132 };
    view(k, () => {
      header(k, 0);
      pic(k, 24, 46, 222, 110, 0, 8); txt(k, "Getting started", 264, 82, `800 19px ${JP}`, C.ink); bars(k, 264, 96, 210, 3); btn(k, 264, 132, 100, 24, "Sign up");
      if (m > 0) {
        k.fillStyle = `rgba(28,35,51,${0.5 * m})`; k.fillRect(0, 0, VW, VH);
        k.save(); k.globalAlpha = m; k.translate(D.x + D.w / 2, D.y + D.h / 2); const s = 0.9 + 0.1 * m; k.scale(s, s); k.translate(-D.w / 2, -D.h / 2);
        k.fillStyle = '#fff'; rr(k, 0, 0, D.w, D.h, 12); k.fill();
        txt(k, "Wait!", D.w / 2, 34, `800 17px ${JP}`, C.ink, 'center');
        txt(k, "First visit: 10% OFF", D.w / 2, 60, `800 15px ${JP}`, C.acc, 'center');
        btn(k, D.w / 2 - 75, 80, 150, 30, "Get coupon", C.acc, '#fff', 12);
        k.strokeStyle = C.sub; k.lineWidth = 2; k.lineCap = 'round'; k.beginPath(); k.moveTo(D.w - 26, 14); k.lineTo(D.w - 14, 26); k.moveTo(D.w - 14, 14); k.lineTo(D.w - 26, 26); k.stroke();
        k.restore();
      }
    });

    k.save(); k.beginPath(); k.rect(0, 0, CW, CH); k.clip(); k.translate(OX, OY); click(k, cx, cy, u, [CLOSE]); k.restore();
  };

  // @element 17

  CELLS[16] = (k, w, h, u) => {
    frame(k);
    const n = Math.round(100 * eOut(P(u, 0.25, 2.1)));
    const cy = u < 4.25 ? -VH * eIO(P(u, 2.3, 2.85)) : -VH * (1 - eIO(P(u, 4.25, 4.75)));
    const show = eOut(P(u, 2.35, 2.95));
    view(k, () => {
      header(k, 0);
      k.save(); k.globalAlpha = show; k.translate(0, 14 * (1 - show));
      txt(k, "Welcome.", 34, 82, `800 26px ${JP}`, C.ink); bars(k, 34, 98, 200, 3); btn(k, 34, 136, 96, 24, "Start");
      pic(k, 270, 46, 214, 112, 0, 8); k.restore();
      if (cy > -VH) {
        k.save(); k.translate(0, cy); k.fillStyle = C.ink; k.fillRect(0, 0, VW, VH);
        logo(k, VW / 2 - 40, 56, '#fff');
        txt(k, (u >= 4.25 ? 0 : n) + '%', VW / 2, 98, `800 28px ${EN}`, '#fff', 'center', 'middle');
        k.fillStyle = 'rgba(255,255,255,.15)'; rr(k, VW / 2 - 90, 122, 180, 4, 2); k.fill();
        k.fillStyle = C.acc; rr(k, VW / 2 - 90, 122, 180 * (u >= 4.25 ? 0 : n / 100), 4, 2); k.fill();
        k.restore();
      }
    });
  };

  // @element 18

  CELLS[17] = (k, w, h, u) => {
    frame(k);
    const SY = t => steps([[0.35, 0], [1.1, 110], [1.7, 110], [2.5, 225], [3.5, 225], [4.5, 0]], t), y = SY(u);
    const COLX = [15, 180, 345], IW = 151, IH = 92, ROWS = [12, 168, 276], WAIT = 0.45, FADE = 0.35;
    view(k, () => {
      k.save(); k.translate(0, -y);
      txt(k, "Gallery", 15, 140, `800 18px ${JP}`, C.ink); bars(k, 120, 128, 200, 1);
      ROWS.forEach((top, r) => COLX.forEach((x, c) => {
        const t0 = r === 0 ? -1e9 : enteredAt(SY, top, VH, u), age = t0 === null ? -1 : u - t0 - c * 0.12;
        k.fillStyle = C.skel; rr(k, x, top, IW, IH, 6); k.fill();
        if (age < WAIT + FADE) {
          k.save(); k.translate(x + IW / 2, top + IH / 2); k.strokeStyle = '#B9C1CF'; k.lineWidth = 2; k.lineJoin = 'round';
          if (age >= 0 && age < WAIT) spinner(k, 0, 0, 11, u, C.blue);
          else { rr(k, -15, -11, 30, 22, 3); k.stroke(); k.beginPath(); k.moveTo(-11, 7); k.lineTo(-3, -1); k.lineTo(3, 5); k.lineTo(7, 1); k.lineTo(11, 6); k.stroke(); }
          k.restore();
        }
        if (age >= WAIT) { k.save(); k.globalAlpha = eOut(P(age, WAIT, WAIT + FADE)); pic(k, x, top, IW, IH, (r + c) % 3, 6); k.restore(); }
      }));
      k.restore();
      sbar(k, y / 225, 0.45);
    });
  };

  // @element 19

  CELLS[18] = (k, w, h, u) => {
    frame(k);

    const PITCH = 52, BATCH = 3, L0 = 6, TL = 2.6;
    const y = steps([[0.25, 38], [0.85, 116], [1.15, 116], [1.75, 194], [4.8, 194]], u);
    const n = u < TL ? L0 : L0 + BATCH, end = 10 + n * PITCH;
    view(k, () => {
      k.fillStyle = C.soft; k.fillRect(0, 0, VW, VH);
      k.save(); k.translate(0, -y);
      for (let i = 0; i < n; i++) {
        const top = 10 + i * PITCH, v = i % 3, fresh = i >= L0 ? eOut(P(u, TL, TL + 0.35)) : 1;
        if (top - y > VH || top + 44 - y < 0) continue;
        k.save(); k.globalAlpha = fresh; k.translate(0, 10 * (1 - fresh));
        k.fillStyle = '#fff'; rr(k, 90, top, 331, 44, 8); k.fill(); pic(k, 98, top + 6, 48, 32, v, 5);
        bars(k, 158, top + 12, [180, 140, 200][v], 1, C.ink, 7); bars(k, 158, top + 26, [120, 150, 100][v], 1, C.faint, 6);
        k.restore();
      }
      spinner(k, VW / 2, end + 18, 10, u);
      k.restore();
    });
  };

  // @element 20

  CELLS[19] = (k, w, h, u) => {
    frame(k, u >= 1.3 && u < 3.5 ? 'example.com/works/02' : 'example.com/works');
    const CLK = [0.8, 3.0];
    const cover = t0 => eIO(P(u, t0, t0 + 0.4)), uncover = t0 => eIO(P(u, t0, t0 + 0.45));

    const xs = u < 1.4 ? -VW * (1 - cover(0.9)) : u < 3.1 ? VW * uncover(1.4) : u < 3.6 ? -VW * (1 - cover(3.1)) : VW * uncover(3.6);
    const pageB = u >= 1.3 && u < 3.5;
    const [cx, cy] = path([[0, 420, 150], [0.65, 255, 100], [2.6, 255, 100], [2.85, 46, 50], [3.3, 46, 50], [4.6, 420, 150], [4.8, 420, 150]], u);
    view(k, () => {
      header(k, 0);
      if (!pageB) {
        txt(k, "WORKS", 34, 62, `800 18px ${EN}`, C.ink, 'left', 'alphabetic', '2px');
        for (let i = 0; i < 3; i++) { const x = 34 + i * 152; pic(k, x, 74, 136, 60, i, 6); bars(k, x, 142, 100, 1, C.ink, 7); }
      } else {
        txt(k, "← Back to list", 34, 55, `700 12px ${JP}`, C.sub, 'left', 'middle');
        pic(k, 34, 68, 240, 90, 1, 8);
        txt(k, "Project 02", 296, 96, `800 22px ${EN}`, C.ink); bars(k, 296, 110, 180, 3);
      }
      if (xs > -VW && xs < VW) { k.fillStyle = C.acc; k.fillRect(xs, 0, VW, VH); logo(k, xs + VW / 2 - 40, VH / 2, '#fff'); }
      click(k, cx, cy, u, CLK);
    });
  };

  // @element 21

  CELLS[20] = (k, w, h, u) => {
    frame(k);
    const TO = 296;
    const y = TO * eIO(P(u, 0.95, 2.0)) * (1 - eIO(P(u, 3.15, 4.2)));
    const [cx, cy] = path([[0, 380, 132], [0.75, 360, 18], [1.0, 360, 18], [2.9, 478, 140], [3.25, 478, 140], [4.8, 380, 132]], u);
    view(k, () => {
      k.save(); k.translate(0, -y);
      pic(k, 24, 46, 222, 110, 0, 8); txt(k, "The right tools.", 264, 84, `800 19px ${JP}`, C.ink); bars(k, 264, 98, 210, 3);
      k.fillStyle = C.soft; k.fillRect(0, 170, VW, 160);
      txt(k, "Features", VW / 2, 206, `800 17px ${JP}`, C.ink, 'center');
      for (let i = 0; i < 3; i++) { const x = 100 + i * 155; k.fillStyle = C.blueL; k.beginPath(); k.arc(x, 252, 24, 0, 7); k.fill(); bars(k, x - 46, 288, 92, 2); }
      txt(k, "Pricing", VW / 2, 370, `800 17px ${JP}`, C.ink, 'center');
      ['¥0', '¥980', '¥2,980'].forEach((s, i) => {
        const x = 50 + i * 143, hi = i === 1; k.fillStyle = '#fff'; rr(k, x, 388, 125, 96, 8); k.fill();
        k.lineWidth = hi ? 2.5 : 1.5; k.strokeStyle = hi ? C.acc : C.faint; k.stroke();
        txt(k, s, x + 62.5, 428, `800 20px ${EN}`, hi ? C.acc : C.ink, 'center'); bars(k, x + 22, 444, 81, 2);
      });
      k.restore();
      header(k, 0, y > 250 ? 1 : -1);
      const tb = clamp((y - 60) / 40);
      if (tb > 0) { k.globalAlpha = tb; k.fillStyle = C.ink; k.beginPath(); k.arc(478, 140, 15, 0, 7); k.fill(); k.strokeStyle = '#fff'; k.lineWidth = 2.4; k.lineCap = 'round'; k.lineJoin = 'round'; k.beginPath(); k.moveTo(472, 143); k.lineTo(478, 136.5); k.lineTo(484, 143); k.stroke(); k.globalAlpha = 1; }
      sbar(k, y / TO * 0.7, 0.36);
      click(k, cx, cy, u, [0.9, 3.1]);
    });
  };

  // @element 22

  CELLS[21] = (k, w, h, u) => {
    frame(k);
    const WORDS = ['WEB DESIGN', 'BRANDING', 'MOTION', 'UI/UX'], F = `800 30px ${EN}`, GAPW = 64;
    view(k, () => {
      bars(k, 34, 20, 180, 1, C.ink, 10); bars(k, 34, 38, 300, 1);
      k.fillStyle = C.ink; k.fillRect(0, 58, VW, 58);
      k.font = F; k.letterSpacing = '1px'; const ws = WORDS.map(s => k.measureText(s).width); k.letterSpacing = '0px';
      const unit = ws.reduce((a, b) => a + b + GAPW, 0);
      let x = -mod(u / CYC, 1) * unit;
      for (let rep = 0; x < VW; rep++) WORDS.forEach((s, i) => {
        txt(k, s, x, 88, F, '#fff', 'left', 'middle', '1px');
        k.fillStyle = C.acc; k.beginPath(); k.arc(x + ws[i] + GAPW / 2, 88, 6, 0, 7); k.fill();
        x += ws[i] + GAPW;
      });
      for (let i = 0; i < 3; i++) { k.fillStyle = C.soft; rr(k, 34 + i * 152, 130, 136, 30, 6); k.fill(); bars(k, 46 + i * 152, 142, 90, 1, C.faint); }
    });
  };

  // @element 23

  CELLS[22] = (k, w, h, u) => {
    frame(k);
    const a = 2 * Math.PI * u / CYC;
    const BLOBS = [[C.acc, 150, 60, 230, 70, 30, 0], ['#FFB08F', 380, 40, 210, 60, 40, 2.1], [C.blue, 330, 150, 240, 80, 30, 4.2], ['#9DB6FB', 90, 170, 200, 50, 35, 1.0]];
    view(k, () => {
      k.fillStyle = '#FFF1EB'; k.fillRect(0, 0, VW, VH);
      for (const [col, x0, y0, r, ax, ay, ph] of BLOBS) {
        const x = x0 + ax * Math.cos(a + ph), y = y0 + ay * Math.sin(a + ph);
        const g = k.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
        k.globalAlpha = 0.85; k.fillStyle = g; k.fillRect(0, 0, VW, VH); k.globalAlpha = 1;
      }
      txt(k, 'Hello, Future.', 40, 82, `800 34px ${EN}`, '#fff', 'left', 'alphabetic', '1px');
      bars(k, 40, 100, 200, 2, 'rgba(255,255,255,.8)', 6, 12, 0.6);
      btn(k, 40, 128, 104, 26, "Start", '#fff', C.ink);
    });
  };

  // @element 24

  CELLS[23] = (k, w, h, u) => {
    frame(k);
    const bob = (T, A, ph) => -A * Math.sin(2 * Math.PI * u / T + ph);
    const y1 = bob(2.4, 8, 0), y2 = bob(1.6, 6, 1.2), y3 = bob(2.4, 6, 2.4);
    view(k, () => {
      k.fillStyle = C.soft; k.fillRect(0, 0, VW, VH);
      txt(k, "With this app,", 34, 62, `800 24px ${JP}`, C.ink); txt(k, "Travel lighter.", 34, 94, `800 24px ${JP}`, C.ink);
      bars(k, 34, 108, 170, 2); btn(k, 34, 134, 112, 24, "Download");

      const sh = 1 + y1 / 40;
      k.fillStyle = `rgba(28,35,51,${0.16 * sh})`; k.beginPath(); k.ellipse(352, 160, 54 * sh, 6 * sh, 0, 0, 7); k.fill();

      k.save(); k.translate(0, y1);
      k.fillStyle = C.ink; rr(k, 306, 18, 92, 132, 16); k.fill(); k.fillStyle = '#fff'; rr(k, 312, 24, 80, 120, 11); k.fill();
      pic(k, 318, 32, 68, 52, 0, 6); bars(k, 318, 92, 68, 3, C.faint, 5, 10);
      k.restore();

      k.save(); k.translate(0, y2); k.shadowColor = 'rgba(28,35,51,.18)'; k.shadowBlur = 10; k.shadowOffsetY = 4;
      k.fillStyle = C.acc; k.beginPath(); k.arc(268, 54, 20, 0, 7); k.fill(); k.shadowColor = 'transparent';
      k.fillStyle = '#fff'; k.beginPath(); k.moveTo(268, 62); k.bezierCurveTo(254, 53, 260, 41, 268, 48); k.bezierCurveTo(276, 41, 282, 53, 268, 62); k.fill(); k.restore();
      k.save(); k.translate(0, y3); k.shadowColor = 'rgba(28,35,51,.16)'; k.shadowBlur = 10; k.shadowOffsetY = 4;
      k.fillStyle = '#fff'; rr(k, 410, 92, 76, 30, 15); k.fill(); k.shadowColor = 'transparent';
      txt(k, '★ 4.8', 448, 108, `800 13px ${EN}`, C.acc, 'center', 'middle'); k.restore();
    });
  };
  // @end
  return { width: CW, height: CH, cycle: CYC, cells: CELLS, fonts: [] };
});
