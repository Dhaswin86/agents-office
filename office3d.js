/* 3D views: one team room (agent page) and the whole office (home), with block-critter workers busy at their jobs.
   Uses Three.js r128 (global THREE). Exposes window.Office3D.mount(host, teamId, state) for one team room and
   Office3D.mountOffice(host, agents, onPick) for the whole office; both return a view
   with view.setState(state), view.attach(host) and view.dispose(). */
(function () {
  const C = {
    orange: 0xd97757, eye: 0x1d1b18, wood: 0x8a5a3b, woodTop: 0xa06b47, woodDark: 0x6e4a31,
    metal: 0xb8bec4, metalDark: 0x8d939a, paper: 0xf4efe4, white: 0xf7f8fa, green: 0x6fbf5f,
    gold: 0xe9b949, goldDark: 0xc99a2e, blue: 0x3b6fd8, dark: 0x3a3f48, card: 0xc4834d, cardLight: 0xd9a066,
  };
  const TEAMS = {
    analyst: { floor: 0x5f9a6b, wall: 0x4d845a, roles: ['brief reader', 'planner', 'question sorter'] },
    finder: { floor: 0x4f7fb5, wall: 0x41699a, roles: ['web searcher', 'doc reader', 'source filer'] },
    builder: { floor: 0xc39a48, wall: 0xa5813a, roles: ['maker', 'coder', 'tester'] },
  };

  function makeKit(track) {
    const mats = {};
    const mat = (c, o) => {
      const k = c + (o ? JSON.stringify(o) : '');
      if (!mats[k]) mats[k] = track(new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0, flatShading: true }, o || {})));
      return mats[k];
    };
    const geo = {};
    const boxGeo = (w, h, d) => { const k = w + ',' + h + ',' + d; return geo[k] || (geo[k] = track(new THREE.BoxGeometry(w, h, d))); };
    // bottom-aligned box: y is the bottom face
    function box(w, h, d, c, x, y, z, parent, o) {
      const m = new THREE.Mesh(boxGeo(w, h, d), typeof c === 'object' ? c : mat(c, o));
      m.position.set(x, y + h / 2, z);
      m.castShadow = true; m.receiveShadow = true;
      if (parent) parent.add(m);
      return m;
    }
    return { mat, box };
  }

  function canvasScreen(track, w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = track(new THREE.CanvasTexture(cv));
    tex.minFilter = THREE.LinearFilter;
    return { cv, ctx: cv.getContext('2d'), tex };
  }

  function bubbleSprite(track, text) {
    const s = canvasScreen(track, 128, 128), x = s.ctx;
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(64, 56, 46, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.moveTo(40, 92); x.lineTo(30, 122); x.lineTo(62, 98); x.fill();
    x.fillStyle = '#d97757'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 64, 58);
    s.tex.needsUpdate = true;
    const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: s.tex, transparent: true })));
    sp.scale.set(0.9, 0.9, 0.9);
    return sp;
  }

  /* ---------- the critter ---------- */
  function critter(K, o) {
    o = o || {};
    const g = new THREE.Group(), legH = 0.4;
    [-0.62, -0.22, 0.22, 0.62].forEach(x => K.box(0.2, legH, 0.3, C.orange, x, 0, 0, g));
    K.box(1.6, 1.2, 1.0, C.orange, 0, legH, 0, g);
    const arm = side => {
      const a = new THREE.Group(); a.position.set(side * 0.8, legH + 0.9, 0);
      K.box(0.4, 0.4, 0.4, C.orange, side * 0.2, -0.4, 0, a); g.add(a); return a;
    };
    const armL = arm(-1), armR = arm(1);
    const eyes = [-0.35, 0.35].map(x => K.box(0.18, 0.2, 0.05, C.eye, x, legH + 0.68, 0.51, g));
    let bulb = null;
    if (o.hat) {
      K.box(1.9, 0.1, 1.3, C.goldDark, 0, legH + 1.2, 0, g);
      K.box(1.3, 0.28, 1.0, C.gold, 0, legH + 1.3, 0, g);
      K.box(0.9, 0.16, 0.8, C.gold, 0, legH + 1.58, 0, g);
    }
    if (o.antenna) {
      K.box(0.08, 0.45, 0.08, C.metalDark, 0, legH + 1.2, 0, g);
      bulb = K.box(0.32, 0.26, 0.32, K.mat(0xffd166, { emissive: 0xffb020, emissiveIntensity: 0.6 }), 0, legH + 1.62, 0, g);
    }
    return { g, armL, armR, eyes, bulb, top: legH + (o.hat ? 1.9 : o.antenna ? 2.0 : 1.4) };
  }

  function desk(K, g) {
    K.box(2.6, 0.8, 1.0, C.wood, 0, 0, 1.0, g);
    K.box(2.8, 0.08, 1.15, C.woodTop, 0, 0.8, 1.0, g);
    K.box(0.9, 0.1, 0.02, C.woodDark, 0, 0.45, 1.51, g);
  }
  const phase = (t, period) => (t % period) / period;
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const easeInOut = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const outBack = x => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const outBounce = x => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  };
  // Pop a mesh in at `from` (with a little overshoot) and shrink it away by `to`, all within one loop p in [0,1]
  function pop(m, p, from, to) {
    const s = p < from || p > to ? 0 : Math.min(outBack(clamp01((p - from) / 0.07)), clamp01((to - p) / 0.05));
    m.visible = s > 0.01; m.scale.setScalar(Math.max(0.001, s));
  }
  const typing = (c, t) => { c.armL.rotation.x = -1.15 + 0.18 * Math.sin(t * 22); c.armR.rotation.x = -1.15 + 0.18 * Math.sin(t * 22 + Math.PI); };

  /* ---------- the nine jobs: each builds into g and returns update(t) ---------- */
  const JOBS = {
    reader(K, g) {
      const c = critter(K); g.add(c.g); desk(K, g);
      K.box(1.2, 0.03, 0.85, C.paper, 0.45, 0.88, 1.0, g);
      const zs = [0.7, 0.85, 1.0, 1.15, 1.3];
      zs.forEach((z, i) => K.box(i === 3 ? 0.5 : 0.75, 0.02, 0.06, 0xc9bfae, 0.4, 0.91, z, g));
      const ticks = zs.map(z => { const m = K.box(0.1, 0.06, 0.1, C.green, 0.92, 0.91, z, g); m.visible = false; return m; });
      const mag = new THREE.Group(); g.add(mag);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 18), K.mat(C.metal, { metalness: 0.3, roughness: 0.4 }));
      ring.rotation.x = Math.PI / 2; ring.castShadow = true; mag.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.19, 18), K.mat(0x9fd3ff, { transparent: true, opacity: 0.5 }));
      lens.rotation.x = -Math.PI / 2; mag.add(lens);
      K.box(0.07, 0.07, 0.4, C.wood, 0.0, -0.03, -0.42, mag);
      c.armR.rotation.x = -1.0;
      return t => {
        // glide from line to line: rest on each, then ease to the next
        const p = phase(t, 6), f = p * 6, i = Math.floor(f), local = f - i;
        const a = zs[Math.min(i, 4)], b = zs[Math.min(i + 1, 4)];
        const z = i >= 5 ? zs[4] + (zs[0] - zs[4]) * easeInOut(local) : a + (b - a) * easeInOut(clamp01((local - 0.6) / 0.4));
        mag.position.set(0.4 + 0.06 * Math.sin(t * 2.4), 1.12 + 0.03 * Math.sin(t * 4.8), z);
        ticks.forEach((m, k) => pop(m, p, (k + 0.7) / 6, 0.97));
        c.armR.rotation.x = -1.0 - 0.08 * Math.sin(t * 3);
        return c;
      };
    },
    planner(K, g) {
      const c = critter(K); c.g.position.x = -0.6; c.g.rotation.y = 0.55; g.add(c.g);
      const b = new THREE.Group(); b.position.set(1.3, 0, 0.4); b.rotation.y = -0.55; g.add(b);
      K.box(0.08, 0.8, 0.08, C.metal, -1.0, 0, 0, b); K.box(0.08, 0.8, 0.08, C.metal, 1.0, 0, 0, b);
      K.box(2.3, 1.5, 0.1, C.metalDark, 0, 0.75, 0, b); K.box(2.15, 1.36, 0.04, C.white, 0, 0.82, 0.06, b);
      const parts = [
        K.box(0.55, 0.32, 0.02, C.blue, -0.62, 1.68, 0.09, b), K.box(0.32, 0.07, 0.02, C.orange, -0.12, 1.8, 0.09, b),
        K.box(0.55, 0.32, 0.02, C.blue, 0.4, 1.68, 0.09, b), K.box(1.5, 0.06, 0.02, 0x8d939a, -0.1, 1.35, 0.09, b),
        K.box(0.9, 0.06, 0.02, 0x8d939a, -0.4, 1.12, 0.09, b),
      ];
      const pen = K.box(0.08, 0.08, 0.3, 0x2a2f38, 0, -0.5, 0.15, c.armR);
      return t => {
        const p = phase(t, 5);
        parts.forEach((m, i) => pop(m, p, (i + 0.5) / 6.5, 0.95));
        c.armR.rotation.z = 1.2 + 0.22 * Math.sin(t * 4);
        c.armR.rotation.y = -0.4 + 0.18 * Math.sin(t * 2);
        return c;
      };
    },
    sorter(K, g) {
      const c = critter(K); c.g.position.x = -0.55; g.add(c.g); desk(K, g);
      K.box(0.7, 0.08, 0.6, C.woodDark, 0.2, 0.88, 1.0, g); K.box(0.7, 0.08, 0.6, C.woodDark, 1.0, 0.88, 1.0, g);
      K.box(0.55, 0.18, 0.45, C.paper, 0.2, 0.96, 1.0, g);
      const pile = K.box(0.55, 0.05, 0.45, C.white, 1.0, 0.96, 1.0, g);
      const fly = K.box(0.55, 0.025, 0.45, C.white, 0.2, 1.16, 1.0, g);
      const q = bubbleSprite(K.track, '?'); q.position.set(-0.55, 2.6, 0); g.add(q);
      return t => {
        const p = easeInOut(phase(t, 1.4));
        fly.position.set(0.2 + 0.8 * p, 1.18 + 0.7 * Math.sin(Math.PI * p), 1.0);
        fly.rotation.z = -0.4 * Math.sin(Math.PI * p);
        const grow = phase(t, 7) * 5, n = Math.floor(grow) + easeInOut(clamp01((grow % 1 - 0.8) / 0.2));
        pile.scale.y = 1 + n * 0.8; pile.position.y = 0.96 + (0.05 * pile.scale.y) / 2;
        const qp = phase(t, 3), on = qp > 0.35 && qp < 0.95;
        q.visible = on; q.scale.setScalar(on ? 0.9 * Math.min(1, (qp - 0.35) * 8) : 0.01);
        c.armR.rotation.x = -0.8 - 0.3 * Math.sin(Math.PI * p);
        return c;
      };
    },
    searcher(K, g) {
      const c = critter(K, { antenna: true }); c.g.position.x = -0.5; g.add(c.g); desk(K, g);
      K.box(1.1, 0.06, 0.4, C.metal, -0.4, 0.88, 1.15, g);
      K.box(0.15, 0.4, 0.15, C.dark, 0.65, 0.88, 1.15, g);
      K.box(1.5, 1.0, 0.1, C.dark, 0.65, 1.25, 1.15, g);
      const scr = canvasScreen(K.track, 256, 160);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.86), K.track(new THREE.MeshBasicMaterial({ map: scr.tex })));
      plane.position.set(0.65, 1.75, 1.21); g.add(plane);
      const q = 'java classes';
      let last = -1;
      return t => {
        typing(c, t);
        if (c.bulb) c.bulb.material.emissiveIntensity = Math.floor(t * 3) % 2 ? 1.4 : 0.3;
        const p = phase(t, 4.5), step = Math.floor(p * 30);
        if (step !== last) {
          last = step;
          const x = scr.ctx; x.fillStyle = '#1e2a38'; x.fillRect(0, 0, 256, 160);
          x.fillStyle = '#e8e4da'; x.fillRect(16, 14, 224, 28);
          x.fillStyle = '#3a3f48'; x.font = 'bold 18px monospace';
          const typed = q.slice(0, Math.min(q.length, Math.floor(p * 40)));
          x.fillText(typed + (step % 2 ? '|' : ''), 24, 34);
          x.fillStyle = '#d97757'; x.fillRect(214, 20, 16, 16);
          const shown = Math.max(0, Math.floor((p - 0.4) * 8));
          for (let i = 0; i < Math.min(3, shown); i++) {
            x.fillStyle = '#d97757'; x.fillRect(16, 60 + i * 30, 14, 12);
            x.fillStyle = i ? '#8fb3ff' : '#e8e4da'; x.fillRect(38, 60 + i * 30, 150 - i * 30, 12);
          }
          scr.tex.needsUpdate = true;
        }
        return c;
      };
    },
    bookworm(K, g) {
      const c = critter(K); c.g.position.set(-0.5, 0, 0.3); g.add(c.g);
      const sh = new THREE.Group(); sh.position.set(1.3, 0, -0.2); g.add(sh);
      K.box(1.5, 2.4, 0.6, C.wood, 0, 0, 0, sh); K.box(1.3, 2.2, 0.05, 0x5a412a, 0, 0.1, 0.26, sh);
      const cols = [0xd97757, 0x8fb3ff, 0xe9b949, 0x7cc79a, 0xc9bfae, 0xb07cc7];
      let pulled = null;
      [0.15, 0.9, 1.65].forEach((y, row) => {
        K.box(1.3, 0.06, 0.5, C.wood, 0, y - 0.06, 0.02, sh);
        for (let i = 0; i < 6; i++) {
          const h = 0.5 + ((i + row) % 3) * 0.08, m = K.box(0.16, h, 0.4, cols[(i + row * 2) % 6], -0.52 + i * 0.2, y, 0.05, sh);
          if (row === 1 && i === 3) pulled = m;
        }
      });
      const book = new THREE.Group(); book.position.set(0, 1.05, 0.75); c.g.add(book);
      const pageL = K.box(0.5, 0.03, 0.6, C.paper, -0.26, 0, 0, book); pageL.rotation.z = 0.25;
      const pageR = K.box(0.5, 0.03, 0.6, C.paper, 0.26, 0, 0, book); pageR.rotation.z = -0.25;
      const flipG = new THREE.Group(); book.add(flipG);
      K.box(0.48, 0.02, 0.56, C.white, 0.25, 0.03, 0, flipG);
      c.armL.rotation.x = -1.2; c.armR.rotation.x = -1.2;
      const base = pulled.position.z;
      return t => {
        const p = phase(t, 3.2);
        pulled.position.z = base + 0.35 * Math.sin(Math.PI * Math.min(1, Math.max(0, (p - 0.1) / 0.6)));
        const fp = phase(t, 1.8), ping = fp < 0.5 ? fp * 2 : 2 - fp * 2;
        flipG.rotation.z = Math.PI * easeInOut(ping);
        return c;
      };
    },
    filer(K, g) {
      const c = critter(K); c.g.position.x = -0.7; g.add(c.g);
      const cab = new THREE.Group(); cab.position.set(1.1, 0, 0.1); g.add(cab);
      K.box(1.2, 2.0, 0.9, 0x6b7686, 0, 0, 0, cab);
      [0.15, 1.35].forEach(y => { K.box(1.05, 0.55, 0.06, 0x7f8a9b, 0, y, 0.46, cab); K.box(0.3, 0.07, 0.06, C.metal, 0, y + 0.24, 0.5, cab); });
      const dr = new THREE.Group(); dr.position.set(0, 0.75, 0.46); cab.add(dr);
      K.box(1.05, 0.55, 0.06, 0x8a95a6, 0, 0, 0, dr); K.box(0.3, 0.07, 0.06, C.metal, 0, 0.24, 0.04, dr);
      K.box(1.0, 0.5, 0.7, 0x4f5866, 0, 0.02, -0.38, dr);
      [-0.3, 0, 0.3].forEach((x, i) => K.box(0.12, 0.12, 0.05, [C.gold, 0x8fb3ff, C.gold][i], x, 0.52, -0.3, dr));
      const folder = K.box(0.55, 0.4, 0.05, C.gold, 0, 0, 0, g);
      return t => {
        const p = phase(t, 2.8);
        const open = easeInOut(clamp01(p / 0.14)) - easeInOut(clamp01((p - 0.62) / 0.18));
        dr.position.z = 0.46 + 0.45 * open;
        const f = easeInOut(clamp01((p - 0.15) / 0.3));
        folder.visible = p < 0.5 || p > 0.85;
        folder.position.set(-0.1 + 1.2 * f, 1.0 + 0.45 * Math.sin(Math.PI * f) - 0.1 * f, 0.6 + 0.4 * f);
        c.armR.rotation.x = -0.9 - 0.4 * Math.sin(Math.PI * f);
        return c;
      };
    },
    maker(K, g) {
      const c = critter(K, { hat: true }); c.g.position.x = -0.8; g.add(c.g);
      const ham = new THREE.Group(); ham.position.set(0.2, -0.3, 0.2); c.armR.add(ham);
      K.box(0.08, 0.7, 0.08, C.wood, 0, 0, 0, ham); K.box(0.4, 0.2, 0.2, C.metal, 0, 0.62, 0, ham, { metalness: 0.4, roughness: 0.4 });
      const spots = [[0.6, 0], [1.25, 0], [0.92, 0.36], [0.6, 0.72], [1.25, 0.72]];
      const blocks = spots.map(([x, y]) => K.box(0.6, 0.34, 0.5, C.cardLight, x + 0.3, y, 0.3, g));
      const sparks = [0, 1, 2].map(i => K.box(0.08, 0.08, 0.08, K.mat(0xffd166, { emissive: 0xffc040, emissiveIntensity: 1.2 }), 0.4 + i * 0.15, 1.15 + (i % 2) * 0.15, 0.55, g));
      return t => {
        // wind up slowly, strike fast, then lift again
        const s = phase(t, 0.75);
        const swing = s < 0.6 ? -1.8 + 0.5 * easeInOut(s / 0.6) : s < 0.72 ? -1.3 + 1.7 * Math.pow((s - 0.6) / 0.12, 2) : 0.4 - 2.2 * easeInOut((s - 0.72) / 0.28);
        c.armR.rotation.x = swing;
        sparks.forEach((m, k) => {
          const life = clamp01((s - 0.72) / 0.18); m.visible = s > 0.72 && s < 0.9;
          m.position.y = 1.15 + (k % 2) * 0.15 + life * 0.35; m.scale.setScalar(Math.max(0.001, 1 - life));
        });
        const p = phase(t, 4.2);
        blocks.forEach((m, i) => {
          const at = i * 0.14, k = clamp01((p - at) / 0.1), out = clamp01((0.9 - p) / 0.05);
          m.visible = p > at && p < 0.9;
          m.position.y = spots[i][1] + 0.17 + (1 - outBounce(k)) * 1.0;
          m.scale.setScalar(Math.max(0.001, out));
        });
        return c;
      };
    },
    coder(K, g) {
      const c = critter(K, { hat: true }); c.g.position.x = -0.55; g.add(c.g); desk(K, g);
      K.box(1.2, 0.05, 0.75, C.metal, 0.35, 0.88, 1.05, g);
      const lid = new THREE.Group(); lid.position.set(0.35, 0.92, 1.4); lid.rotation.x = -0.2; g.add(lid);
      K.box(1.2, 0.8, 0.05, C.dark, 0, 0, 0, lid);
      const scr = canvasScreen(K.track, 256, 160);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.68), K.track(new THREE.MeshBasicMaterial({ map: scr.tex })));
      plane.position.set(0, 0.4, 0.03); lid.add(plane);
      const lines = [['#8fb3ff', 90], ['#e9b949', 120], ['#d97757', 70], ['#8fb3ff', 140], ['#7cc79a', 100]];
      let last = -1;
      return t => {
        typing(c, t);
        const p = phase(t, 4), n = Math.floor(p * 8);
        if (n !== last) {
          last = n;
          const x = scr.ctx; x.fillStyle = '#1e2a38'; x.fillRect(0, 0, 256, 160);
          for (let i = 0; i < Math.min(lines.length, n); i++) { x.fillStyle = lines[i][0]; x.fillRect(18 + (i % 2) * 16, 14 + i * 20, lines[i][1], 10); }
          if (n >= 6) { x.strokeStyle = '#6fbf5f'; x.lineWidth = 9; x.beginPath(); x.moveTo(170, 120); x.lineTo(190, 140); x.lineTo(230, 100); x.stroke(); }
          scr.tex.needsUpdate = true;
        }
        return c;
      };
    },
    tester(K, g) {
      const c = critter(K, { hat: true }); c.g.position.x = -0.8; g.add(c.g);
      const bx = new THREE.Group(); bx.position.set(1.1, 0, 0.3); g.add(bx);
      K.box(1.3, 0.85, 1.0, C.card, 0, 0, 0, bx);
      const flap = side => {
        const f = new THREE.Group(); f.position.set(side * 0.65, 0.85, 0); bx.add(f);
        K.box(0.65, 0.04, 1.0, C.cardLight, -side * 0.325, 0, 0, f); return f;
      };
      const fl = flap(-1), fr = flap(1);
      const tape = K.box(0.25, 0.03, 1.04, C.gold, 0, 0.88, 0, bx);
      const clip = new THREE.Group(); clip.position.set(0, 0.95, 0.72); c.g.add(clip);
      K.box(0.55, 0.7, 0.04, C.wood, 0, 0, 0, clip); K.box(0.45, 0.58, 0.02, C.paper, 0, 0.05, 0.03, clip);
      const ticks = [0.5, 0.3, 0.1].map(y => K.box(0.08, 0.08, 0.02, C.green, -0.14, y, 0.05, clip));
      c.armL.rotation.x = -1.1; c.armR.rotation.x = -1.1;
      return t => {
        const p = phase(t, 4.4);
        const close = easeInOut(clamp01((p - 0.45) / 0.15)) - easeInOut(clamp01((p - 0.92) / 0.08));
        fl.rotation.z = -1.9 * (1 - close); fr.rotation.z = 1.9 * (1 - close);
        const tp = clamp01((p - 0.62) / 0.1);
        tape.visible = p > 0.62 && p < 0.92; tape.scale.set(1, 1, Math.max(0.001, easeInOut(tp)));
        ticks.forEach((m, i) => pop(m, p, 0.1 + i * 0.12, 0.92));
        return c;
      };
    },
  };
  const TEAM_JOBS = { analyst: ['reader', 'planner', 'sorter'], finder: ['searcher', 'bookworm', 'filer'], builder: ['maker', 'coder', 'tester'] };


  /* ---------- one team room (used by both the team page and the whole office) ---------- */
  function buildRoom(K, parent, team, o) {
    o = o || {};
    const T = TEAMS[team] || TEAMS.analyst, room = new THREE.Group();
    room.userData.team = team;
    parent.add(room);
    const wallH = o.low ? 1.1 : 2.6;
    K.box(13, 0.7, 13, T.floor, 0, -0.7, 0, room);
    K.box(13.4, 0.12, 13.4, T.wall, 0, -0.82, 0, room);
    // Four walls (windows on tall ones). A wall fades away while the camera is on its far side.
    const walls = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([nx, nz]) => {
      const g = new THREE.Group(); g.position.set(nx * 6.35, 0, nz * 6.35); g.rotation.y = Math.atan2(nx, nz) + Math.PI; room.add(g);
      const wallMat = K.track(new THREE.MeshStandardMaterial({ color: T.wall, roughness: 0.85, flatShading: true, transparent: true, opacity: 1 }));
      const glassMat = K.track(new THREE.MeshStandardMaterial({ color: 0x9fd3ff, roughness: 0.3, transparent: true, opacity: 0.55 }));
      K.box(13, wallH, 0.3, wallMat, 0, 0, 0, g).castShadow = false;
      if (!o.low) [-2.8, 2.8].forEach(x => { K.box(2.4, 1.2, 0.05, glassMat, x, 1.0, 0.18, g).castShadow = false; });
      return { nx, nz, mats: [[wallMat, 1], [glassMat, 0.55]], fade: 1 };
    });
    const plant = new THREE.Group(); plant.position.set(-5.3, 0, 5.0); room.add(plant);
    K.box(0.6, 0.6, 0.6, 0x6b4e33, 0, 0, 0, plant);
    const leaf = new THREE.Mesh(K.track(new THREE.IcosahedronGeometry(0.55, 0)), K.mat(0x3f8a55)); leaf.position.y = 1.05; leaf.castShadow = true; plant.add(leaf);
    const leaf2 = new THREE.Mesh(K.track(new THREE.IcosahedronGeometry(0.35, 0)), K.mat(0x57a86b)); leaf2.position.set(0.3, 1.5, 0.1); leaf2.castShadow = true; plant.add(leaf2);
    K.box(2.6, 0.05, 1.8, 0xffffff, 0, 0.001, 4.2, room, { transparent: true, opacity: 0.12 });
    // glowing outline for hover / working
    const ringMat = K.track(new THREE.MeshBasicMaterial({ color: 0x6d9cff, transparent: true, opacity: 0 }));
    [[13.8, 0.25, 0, 6.9], [13.8, 0.25, 0, -6.9], [0.25, 13.8, 6.9, 0], [0.25, 13.8, -6.9, 0]].forEach(([w, d, x, z]) => {
      const m = K.box(w, 0.12, d, ringMat, x, -0.7, z, room); m.castShadow = false;
    });
    const spots = [[-3.5, 2.1], [0.2, -0.1], [3.7, -2.5]];
    const workers = TEAM_JOBS[team].map((job, i) => {
      const g = new THREE.Group(); g.position.set(spots[i][0], 0, spots[i][1]); room.add(g);
      return { g, update: JOBS[job](K, g), role: T.roles[i], offset: i * 1.37 };
    });
    let active = true, glow = 0, glowGoal = 0;
    const v = new THREE.Vector3();
    return {
      room, team, workers,
      setActive(a) { active = a; },
      get active() { return active; },
      setGlow(g) { glowGoal = g; },
      update(dt, clockT, camera) {
        workers.forEach(w => {
          const tt = clockT + w.offset, c = w.update(tt);
          const bt = tt % 4, blink = bt > 3.8 ? Math.sin(((bt - 3.8) / 0.2) * Math.PI) : 0;
          const eyeY = !active ? 0.25 : 1 - 0.8 * blink;
          c.eyes.forEach(e => { e.scale.y += (eyeY - e.scale.y) * Math.min(1, dt * 20); });
          c.g.position.y = active ? (Math.sin(tt * 3.2) + 1) * 0.025 : 0;
          w.c = c;
        });
        room.worldToLocal(v.copy(camera.position));
        walls.forEach(w => {
          const outside = v.x * w.nx + v.z * w.nz > 5.5;
          w.fade += ((outside ? 0.08 : 1) - w.fade) * (1 - Math.exp(-dt * 6));
          w.mats.forEach(([m, base]) => { m.opacity = base * w.fade; m.depthWrite = w.fade > 0.9; });
        });
        glow += (glowGoal - glow) * (1 - Math.exp(-dt * 8));
        ringMat.opacity = glow;
      },
    };
  }

  /* ---------- shared viewer: renderer, lights, smooth 360° orbit, buttons, loop ---------- */
  function createViewer(host, opts) {
    const owned = [];
    const track = o => { owned.push(o); return o; };
    const K = Object.assign(makeKit(track), { track });

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement; canvas.className = 's3-canvas';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f3a, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    const S = opts.shadowSize || 10;
    sun.position.set(S * 0.8, S * 1.4, S * 0.9); sun.castShadow = true;
    sun.shadow.mapSize.set(opts.shadowMap || 1024, opts.shadowMap || 1024);
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: S * 4 });
    scene.add(sun);

    if (opts.background) { scene.background = new THREE.Color(opts.background); scene.fog = new THREE.Fog(opts.background, opts.fog[0], opts.fog[1]); }
    const built = opts.build(K, scene);

    // 360° orbit: `goal` is where the user wants to be, `cam` eases towards it every frame.
    const home = opts.home, lim = opts.limits;
    const cam = Object.assign({}, home), goal = Object.assign({}, home), target = new THREE.Vector3(...opts.target);
    let auto = false, drag = null, vel = 0, idle = 0, lastX = 0, lastT = 0, travelled = 0;
    function updateCam(dt) {
      if (!drag) {
        goal.theta += vel * dt; vel *= Math.exp(-dt * 2.8);
        idle += dt;
        goal.theta += (auto && idle > 2.5 ? (opts.spin || 0.18) * Math.min(1, (idle - 2.5) / 1.5) : 0) * dt;
      }
      goal.phi = Math.min(lim.phi[1], Math.max(lim.phi[0], goal.phi)); goal.r = Math.min(lim.r[1], Math.max(lim.r[0], goal.r));
      const k = 1 - Math.exp(-dt * (drag ? 14 : 5));
      cam.theta += (goal.theta - cam.theta) * k; cam.phi += (goal.phi - cam.phi) * k; cam.r += (goal.r - cam.r) * k;
      camera.position.set(target.x + cam.r * Math.sin(cam.phi) * Math.sin(cam.theta), target.y + cam.r * Math.cos(cam.phi), target.z + cam.r * Math.sin(cam.phi) * Math.cos(cam.theta));
      camera.lookAt(target);
    }
    const ndc = new THREE.Vector2(), ray = new THREE.Raycaster();
    function pickAt(e) {
      if (!opts.pickables) return null;
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(opts.pickables(built), true)[0];
      let o = hit && hit.object;
      while (o && !o.userData.team) o = o.parent;
      return o ? o.userData.team : null;
    }
    const onDown = e => {
      drag = { x: e.clientX, y: e.clientY, t: goal.theta, p: goal.phi }; vel = 0; idle = 0; travelled = 0; touchedAt = performance.now();
      lastX = e.clientX; lastT = performance.now();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      canvas.classList.add('grab');
    };
    const onMove = e => {
      if (!drag) {
        if (opts.onHover) { const t = pickAt(e); canvas.style.cursor = t ? 'pointer' : ''; opts.onHover(t, built); }
        return;
      }
      travelled = Math.max(travelled, Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y));
      goal.theta = drag.t - (e.clientX - drag.x) * 0.008; goal.phi = drag.p - (e.clientY - drag.y) * 0.006;
      const now = performance.now(), dtm = Math.max(1, now - lastT);
      vel = vel * 0.6 + (-(e.clientX - lastX) * 0.008 / (dtm / 1000)) * 0.4; lastX = e.clientX; lastT = now;
    };
    const onUp = e => {
      if (!drag) return;
      if (performance.now() - lastT > 80) vel = 0;
      vel = Math.max(-2.5, Math.min(2.5, vel));
      const click = travelled < 6;
      drag = null; idle = 0; canvas.classList.remove('grab');
      if (click) { vel = 0; const t = pickAt(e); if (t && opts.onPick) opts.onPick(t); }
    };
    // A plain scroll still scrolls the page; zoom with pinch / ⌘ or Ctrl + scroll, or right after touching the view.
    let touchedAt = -1e9;
    const onWheel = e => {
      if (!(e.ctrlKey || e.metaKey || performance.now() - touchedAt < 4000)) return;
      e.preventDefault(); touchedAt = performance.now();
      goal.r *= Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * (e.ctrlKey ? 0.01 : 0.002)))); idle = 0;
    };
    const onLeave = () => { if (opts.onHover) opts.onHover(null, built); canvas.style.cursor = ''; };
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    let hostEl = null, ro = null, labels = [];
    function size() {
      if (!hostEl) return;
      const w = hostEl.clientWidth || 600, h = hostEl.clientHeight || 420;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      // widen the lens on tall/narrow screens so the whole scene still fits
      const base = opts.fov || 38;
      camera.fov = camera.aspect < 1.4 ? Math.min(70, base * Math.pow(1.4 / camera.aspect, 0.7)) : base;
      camera.updateProjectionMatrix();
    }
    function attach(h) {
      hostEl = h; h.prepend(canvas);
      labels = opts.labels ? opts.labels(h, built) : [];
      const btns = h.querySelector('.s3-ui');
      if (btns) {
        const spinBtn = btns.querySelector('[data-3d=spin]');
        if (spinBtn) spinBtn.classList.toggle('on', auto);
        btns.onclick = e => {
          const b = e.target.closest('[data-3d]'); if (!b) return;
          const what = b.dataset['3d'];
          if (what === 'reset') {
            const turns = Math.round((goal.theta - home.theta) / (Math.PI * 2));
            Object.assign(goal, home, { theta: home.theta + turns * Math.PI * 2 }); vel = 0; idle = 0;
          }
          if (what === 'spin') { auto = !auto; idle = 3; }
          if (what === 'in') goal.r /= 1.2;
          if (what === 'out') goal.r *= 1.2;
          if (spinBtn) spinBtn.classList.toggle('on', auto);
        };
      }
      if (ro) ro.disconnect();
      ro = new ResizeObserver(size); ro.observe(h); size();
    }

    let clockT = 0, last = performance.now(), raf = 0, alive = true;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const v = new THREE.Vector3();
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!reduce) clockT += dt;
      updateCam(dt);
      opts.update(built, dt, clockT, camera);
      if (hostEl) labels.forEach(l => {
        l.at(v); v.project(camera);
        const behind = v.z > 1;
        l.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * hostEl.clientWidth}px, ${(-v.y * 0.5 + 0.5) * hostEl.clientHeight}px) translate(-50%, -100%)`;
        l.el.style.visibility = behind ? 'hidden' : '';
      });
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    attach(host);
    raf = requestAnimationFrame(frame);
    return {
      built, attach,
      get view() { return { theta: +cam.theta.toFixed(3), r: +cam.r.toFixed(2), auto }; },
      // screen position (px, relative to the canvas) of a world point, for tests and overlays
      screenOf(x, y, z) { const p = new THREE.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect(); return [r.left + (p.x * 0.5 + 0.5) * r.width, r.top + (-p.y * 0.5 + 0.5) * r.height]; },
      dispose() {
        alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect();
        scene.traverse(o => { if (o.geometry && !owned.includes(o.geometry)) o.geometry.dispose(); });
        owned.forEach(o => o.dispose && o.dispose());
        renderer.dispose(); canvas.remove();
      },
    };
  }

  /* ---------- a team page: one room up close ---------- */
  function mount(host, team, state) {
    let roomRef = null;
    const view = createViewer(host, {
      home: { theta: 0.5, phi: 1.0, r: 16.5 }, limits: { phi: [0.22, 1.5], r: [8, 34] }, target: [0, 0.6, 0],
      build(K, scene) { roomRef = buildRoom(K, scene, team); roomRef.setActive(state !== 'waiting' && state !== 'skipped'); return roomRef; },
      update(room, dt, t, camera) { room.update(dt, t, camera); room.labels && room.labels.forEach(l => l.classList.toggle('sleep', !room.active)); },
      labels(h, room) {
        const box = h.querySelector('.s3-labels'); if (!box) return [];
        box.innerHTML = room.workers.map(w => `<span class="s3-tag"><b>${w.role}</b><i class="zz">z Z</i></span>`).join('');
        room.labels = [...box.children];
        return room.workers.map((w, i) => ({ el: room.labels[i], at: v => { v.set(0, (w.c ? w.c.top : 1.6) + 0.5, 0); w.g.localToWorld(v); } }));
      },
    });
    return Object.assign(view, {
      team,
      setState(s) { roomRef.setActive(s !== 'waiting' && s !== 'skipped'); },
    });
  }

  /* ---------- the whole office: three rooms around The Brain ---------- */
  const OFFICE_SPOTS = { analyst: [-11, -7], finder: [11, -7], builder: [0, 11] };
  function mountOffice(host, agents, onPick) {
    let hovered = null;
    const view = createViewer(host, {
      home: { theta: 0.35, phi: 0.9, r: 68 }, limits: { phi: [0.25, 1.42], r: [24, 130] }, fov: 30, target: [0, 0, 1.5],
      shadowSize: 30, shadowMap: 2048, spin: 0.12, background: 0x0f1628, fog: [95, 190],
      build(K, scene) {
        const ground = K.box(400, 0.2, 400, 0x16203a, 0, -1.05, 0, scene); ground.castShadow = false;
        // The Brain hub
        const hub = new THREE.Group(); scene.add(hub);
        K.box(8, 0.6, 8, 0x2f3a52, 0, -0.75, 0, hub); K.box(8.3, 0.12, 8.3, 0x253049, 0, -0.85, 0, hub);
        const nodeMat = K.track(new THREE.MeshStandardMaterial({ color: 0x6d9cff, emissive: 0x3b6fd8, emissiveIntensity: 0.9 }));
        const pts = [[-2, -1.2], [1.2, -2], [2.4, 0.4], [-0.4, 1.8], [-2.6, 1.2], [0.6, -0.2], [1.8, 2.2]];
        const nodes = pts.map(([x, z]) => {
          const m = new THREE.Mesh(K.track(new THREE.SphereGeometry(0.28, 12, 10)), nodeMat); m.position.set(x, 0.5, z); hub.add(m); return m;
        });
        const lineGeo = K.track(new THREE.BufferGeometry());
        const seg = [];
        pts.forEach((a, i) => pts.slice(i + 1).forEach(b => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 3.6) seg.push(a[0], 0.5, a[1], b[0], 0.5, b[1]); }));
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
        const lineMat = K.track(new THREE.LineBasicMaterial({ color: 0x8fb3ff, transparent: true, opacity: 0.6 }));
        hub.add(new THREE.LineSegments(lineGeo, lineMat));
        // rooms + roads
        const rooms = {}, roads = {};
        Object.entries(OFFICE_SPOTS).forEach(([team, [x, z]]) => {
          const r = buildRoom(K, scene, team, { low: true }); r.room.position.set(x, 0, z); rooms[team] = r;
          const len = Math.hypot(x, z), ang = Math.atan2(x, z);
          const road = new THREE.Group(); road.rotation.y = ang; scene.add(road);
          const from = 4.2, to = len - 6.6, mid = (from + to) / 2;
          K.box(2.4, 0.1, to - from, 0x2a3550, 0, -0.75, mid, road).castShadow = false;
          for (let d = from + 0.6; d < to - 0.3; d += 1.2) K.box(0.14, 0.02, 0.6, 0x4a5c84, 0, -0.64, d, road).castShadow = false;
          const pmat = K.track(new THREE.MeshStandardMaterial({ color: 0x8fb3ff, emissive: 0x6d9cff, emissiveIntensity: 1.4 }));
          const packet = new THREE.Mesh(K.track(new THREE.SphereGeometry(0.35, 14, 10)), pmat); road.add(packet); packet.visible = false;
          roads[team] = { packet, from, to };
        });
        return { rooms, roads, nodes, nodeMat, lineMat, states: {} };
      },
      pickables: b => Object.values(b.rooms).map(r => r.room),
      onPick,
      onHover(team, b) {
        hovered = team;
        Object.values(b.rooms).forEach(r => r.setGlow(r.team === team ? 0.95 : b.states[r.team] === 'running' ? 0.55 : 0));
        document.querySelectorAll('#office3d .s3-room').forEach(el => el.classList.toggle('hot', el.dataset.go === team));
      },
      update(b, dt, t, camera) {
        Object.values(b.rooms).forEach(r => r.update(dt, t, camera));
        const running = Object.entries(b.states).filter(([, s]) => s === 'running').map(([k]) => k);
        Object.entries(b.roads).forEach(([team, rd]) => {
          const on = b.states[team] === 'running';
          rd.packet.visible = on;
          if (on) { const p = (t * 0.45) % 1, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; rd.packet.position.set(0, -0.2 + 0.25 * Math.sin(p * Math.PI), rd.from + (rd.to - rd.from) * e); }
        });
        const pulse = running.length ? 0.7 + 0.6 * Math.sin(t * 4) : 0.6;
        b.nodeMat.emissiveIntensity = pulse; b.lineMat.opacity = running.length ? 0.45 + 0.35 * Math.sin(t * 4) : 0.45;
        b.nodes.forEach((n, i) => { n.position.y = 0.5 + 0.08 * Math.sin(t * 2 + i); });
      },
      labels(h, b) {
        const box = h.querySelector('.s3-labels'); if (!box) return [];
        const out = [...box.querySelectorAll('.s3-room')].map(el => {
          const r = b.rooms[el.dataset.go]; if (!r) return null;
          el.onmouseenter = () => this_hover(el.dataset.go);
          el.onmouseleave = () => this_hover(null);
          return { el, at: v => { v.set(0, 6.5, 0); r.room.localToWorld(v); } };
        }).filter(Boolean);
        const brain = box.querySelector('.s3-brain');
        if (brain) out.push({ el: brain, at: v => v.set(0, 2.4, 0) });
        return out;
      },
    });
    function this_hover(team) {
      Object.values(view.built.rooms).forEach(r => r.setGlow(r.team === team ? 0.95 : view.built.states[r.team] === 'running' ? 0.55 : 0));
    }
    function setAgents(list) {
      list.forEach(a => {
        view.built.states[a.id] = a.state;
        const r = view.built.rooms[a.id]; if (!r) return;
        r.setActive(a.state !== 'waiting' && a.state !== 'skipped');
        r.setGlow(hovered === a.id ? 0.95 : a.state === 'running' ? 0.55 : 0);
      });
    }
    setAgents(agents);
    return Object.assign(view, { kind: 'office', setAgents });
  }

  window.Office3D = { mount, mountOffice };
})();
