// 萌喵彈射大作戰 — 主程式（Matter.js 物理 + Canvas 繪圖）
(() => {
  const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;

  // ---------- 常數 ----------
  const W = 1920, H = 1080;
  const SX = 300;                       // 彈弓位置
  const REST = { x: SX, y: G - 182 };   // 彈弓皮兜靜止點
  const MAX_PULL = 140, MAX_SPEED = 24, GRAB_R = 150;
  const GRAVITY_STEP = 0.001 * (1000 / 60) * (1000 / 60);
  const STEP_MS = 1000 / 60;

  const CAT = {
    orange: { name: '橘子', r: 24, density: 0.004, img: 'cat_orange', ability: null },
    gray:   { name: '灰灰', r: 22, density: 0.004, img: 'cat_gray', ability: 'split', strong: 'ice' },
    cream:  { name: '奶茶', r: 23, density: 0.004, img: 'cat_cream', ability: 'dash', strong: 'wood' },
    black:  { name: '煤球', r: 25, density: 0.004, img: 'cat_black', ability: 'bomb' },
    white:  { name: '棉花', r: 30, density: 0.005, img: 'cat_white', ability: 'grow', strong: 'stone' },
  };
  const ENEMY = {
    small:  { hp: 8, score: 5000, img: 'enemy_small' },
    helmet: { hp: 40, score: 6000, img: 'enemy_helmet' },
    king:   { hp: 140, score: 20000, img: 'enemy_king' },
  };
  const MAT = {
    wood:  { density: 0.0012, hpPerArea: 0.012, minHp: 14, score: 500, line: '#6b3f17', debris: ['#c98a4b', '#a86a31', '#e2b07a'] },
    stone: { density: 0.004,  hpPerArea: 0.035, minHp: 45, score: 800, line: '#3d434b', debris: ['#8d949c', '#6d747c', '#b3b9bf'] },
    ice:   { density: 0.0009, hpPerArea: 0.005, minHp: 6,  score: 300, line: '#3f8fc4', debris: ['#bfe8ff', '#8fd3ff', '#ffffff'] },
  };

  // ---------- 存檔 ----------
  const SAVE_KEY = 'kittyLauncher.v1';
  let save = { stars: Array(10).fill(0), best: Array(10).fill(0), music: true, sfx: true };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && Array.isArray(s.stars)) save = Object.assign(save, s);
  } catch (e) { /* 無法讀取就用預設值 */ }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
  if (/[?&]unlock/.test(location.search)) save.unlockAll = true;

  // ---------- 載入圖片 ----------
  const IMG = {};
  const imgNames = ['bg', 'tex_wood', 'tex_stone', 'tex_ice', 'cat_orange', 'cat_gray', 'cat_cream', 'cat_black', 'cat_white', 'enemy_small', 'enemy_helmet', 'enemy_king'];
  function loadImages() {
    return Promise.all(imgNames.map(n => new Promise(res => {
      const im = new Image();
      im.onload = () => res(); im.onerror = () => res();
      im.src = 'assets/' + n + (n.startsWith('tex') || n === 'bg' ? '.jpg' : '.png');
      IMG[n] = im;
    })));
  }

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const scale = Math.min(cw / W, ch / H);
    view = { scale, ox: (cw - W * scale) / 2, oy: (ch - H * scale) / 2, dpr };
  }
  window.addEventListener('resize', resize);
  resize();
  const toWorld = (cx, cy) => ({ x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale });

  let patterns = {};
  function makePatterns() {
    for (const m of ['wood', 'stone', 'ice']) {
      const im = IMG['tex_' + m];
      if (!im || !im.naturalWidth) continue;
      const p = ctx.createPattern(im, 'repeat');
      if (p.setTransform) p.setTransform(new DOMMatrix().scale(m === 'stone' ? 0.42 : 0.5));
      patterns[m] = p;
    }
  }

  // ---------- 遊戲狀態 ----------
  let engine = null;
  let levelIdx = 0, level = null;
  let blocks = [], enemies = [], shots = [], particles = [], popups = [];
  const ent = new Map();
  let queue = [], current = null;           // current: 等待發射的小貓
  let state = 'menu';                        // menu | loading | ready | aiming | flying | won | lost
  let paused = false;
  let score = 0, stepCount = 0, graceSteps = 0;
  let pull = { x: 0, y: 0 };
  let trail = [], lastTrail = [];
  let flySteps = 0, quietSteps = 0;
  let winPending = false, winTimer = 0, endShown = false;
  let shake = 0, toRemove = [];
  let blockScoreTotal = 0, enemyScoreTotal = 0;
  let time = 0;
  let runId = 0;                             // 每次載入關卡遞增，讓舊的計時器失效
  const later = (fn, ms) => { const id = runId; setTimeout(() => { if (id === runId) fn(); }, ms); };

  function newEngine() {
    const e = Engine.create({ enableSleeping: true });
    e.gravity.y = 1;
    e.positionIterations = 10;
    e.velocityIterations = 8;
    Events.on(e, 'collisionStart', ev => { for (const p of ev.pairs) handleCollision(p); });
    return e;
  }

  function addEntity(e) { ent.set(e.body.id, e); Composite.add(engine.world, e.body); return e; }

  function loadLevel(i) {
    levelIdx = i; level = LEVELS[i]; runId++;
    engine = newEngine();
    ent.clear(); blocks = []; enemies = []; shots = []; particles = []; popups = []; toRemove = [];
    trail = []; lastTrail = [];
    score = 0; stepCount = 0; graceSteps = 100; winPending = false; endShown = false; shake = 0;
    blockScoreTotal = 0; enemyScoreTotal = 0;

    const ground = Bodies.rectangle(W / 2, G + 150, 5000, 300, { isStatic: true, friction: 0.9, label: 'ground' });
    Composite.add(engine.world, ground);

    const defs = []; level.build(defs);
    for (const d of defs) {
      if (d.type === 'block' || d.type === 'ball') {
        const m = MAT[d.mat];
        const opts = { density: m.density, friction: 0.75, frictionStatic: 1, restitution: 0.05, label: 'block', sleepThreshold: 40 };
        const body = d.type === 'block' ? Bodies.rectangle(d.x, d.y, d.w, d.h, opts) : Bodies.circle(d.x, d.y, d.r, Object.assign(opts, { restitution: 0.15, friction: 0.5 }));
        const area = d.type === 'block' ? d.w * d.h : Math.PI * d.r * d.r;
        const hp = Math.max(m.minHp, area * m.hpPerArea);
        blocks.push(addEntity({ kind: 'block', shape: d.type, mat: d.mat, w: d.w, h: d.h, r: d.r, hp, maxHp: hp, body, seed: Math.random() * 1000 }));
        blockScoreTotal += m.score;
      } else if (d.type === 'enemy') {
        const r = ENEMY_R[d.kind];
        const body = Bodies.circle(d.x, d.y, r, { density: 0.0012, friction: 0.7, frictionStatic: 1, restitution: 0.2, frictionAir: 0.004, label: 'enemy', sleepThreshold: 40 });
        const def = ENEMY[d.kind];
        enemies.push(addEntity({ kind: 'enemy', type: d.kind, r, hp: def.hp, maxHp: def.hp, body, flash: 0, dizzy: 0, blink: Math.random() * 4 }));
        enemyScoreTotal += def.score;
      }
    }
    queue = level.cats.slice();
    current = null;
    loadNextCat(true);
    updateHud();
    showToast(level, i);
    state = 'loading';
  }

  // ---------- 小貓上彈弓 ----------
  function queuePos(i) { return { x: SX - 80 - i * 58, y: G - 20 }; }
  function loadNextCat(instant) {
    if (!queue.length) { current = null; return false; }
    const type = queue.shift();
    const from = queuePos(0);
    current = { type, t: instant ? 1 : 0, from, launched: false };
    state = 'loading';
    return true;
  }

  // ---------- 發射 ----------
  function launch() {
    const def = CAT[current.type];
    const px = REST.x + pull.x, py = REST.y + pull.y;
    const len = Math.hypot(pull.x, pull.y);
    const power = Math.min(len, MAX_PULL) / MAX_PULL;
    const vx = -pull.x / (len || 1) * power * MAX_SPEED, vy = -pull.y / (len || 1) * power * MAX_SPEED;
    const shot = makeShot(current.type, px, py, vx, vy, def.r);
    lastTrail = trail; trail = [];
    shots.forEach(s => s.old = true);
    shots.push(shot);
    current.launched = true;
    current = null;
    state = 'flying'; flySteps = 0; quietSteps = 0;
    Sound.sfx.launch(def.r > 26 ? 0.8 : 1);
  }

  function makeShot(type, x, y, vx, vy, r) {
    const def = CAT[type];
    const body = Bodies.circle(x, y, r, { density: def.density, friction: 0.6, restitution: 0.35, frictionAir: 0.0005, label: 'cat' });
    Body.setVelocity(body, { x: vx, y: vy });
    return addEntity({ kind: 'cat', type, r, body, used: false, hasHit: false, hitSteps: 0, active: true, trailOn: true });
  }

  // ---------- 特殊能力 ----------
  function activateAbility() {
    const s = shots.find(s => s.active && !s.old && !s.used && !s.dead);
    if (!s) return;
    const def = CAT[s.type];
    if (!def.ability) return;
    if (def.ability !== 'bomb' && s.hasHit) return;
    s.used = true;
    const b = s.body, v = b.velocity;
    if (def.ability === 'split') {
      const sp = Math.hypot(v.x, v.y), ang = Math.atan2(v.y, v.x);
      for (const da of [-0.2, 0.2]) {
        const a = ang + da;
        const ox = -Math.sin(ang) * Math.sign(da) * 34, oy = Math.cos(ang) * Math.sign(da) * 34;
        const ns = makeShot('gray', b.position.x + ox, b.position.y + oy, Math.cos(a) * sp, Math.sin(a) * sp, 19);
        ns.used = true; shots.push(ns);
      }
      burst(b.position.x, b.position.y, ['#ffffff', '#cfe3ff', '#9fb8d8'], 14, 5);
      Sound.sfx.split();
    } else if (def.ability === 'dash') {
      const sp = Math.hypot(v.x, v.y) || 1;
      Body.setVelocity(b, { x: v.x / sp * 36, y: v.y / sp * 36 });
      s.dashing = 40;
      burst(b.position.x, b.position.y, ['#fff3b0', '#ffd66b', '#ffffff'], 16, 7);
      Sound.sfx.dash();
    } else if (def.ability === 'bomb') {
      explode(s);
    } else if (def.ability === 'grow') {
      Body.scale(b, 1.75, 1.75);
      s.r *= 1.75;
      Body.setVelocity(b, { x: v.x, y: v.y + 3 });
      burst(b.position.x, b.position.y, ['#ffffff', '#ffe0f0', '#d6f0ff'], 18, 6);
      shake = Math.max(shake, 6);
      Sound.sfx.grow();
    }
  }

  function explode(s) {
    const { x, y } = s.body.position;
    const R = 210;
    for (const e of [...blocks, ...enemies, ...shots]) {
      if (e === s || e.dead) continue;
      const b = e.body;
      const dx = b.position.x - x, dy = b.position.y - y;
      const d = Math.max(1, Math.hypot(dx, dy) - (e.r || Math.max(e.w, e.h) / 3 || 0));
      if (d > R) continue;
      const f = 1 - d / R;
      const k = Math.min(1.6, Math.max(0.25, Math.sqrt(4 / b.mass)));
      Sleeping.set(b, false);
      Body.setVelocity(b, { x: b.velocity.x + dx / (d || 1) * f * 22 * k, y: b.velocity.y + dy / (d || 1) * f * 22 * k - f * 5 * k });
      Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.3 * f);
      if (e.kind === 'block') damage(e, f * 190, null);
      else if (e.kind === 'enemy') damage(e, f * 75, null);
    }
    s.dead = true; toRemove.push(s);
    // 爆炸特效
    particles.push({ type: 'ring', x, y, r: 20, max: 0.45, life: 0.45, R });
    particles.push({ type: 'flash', x, y, life: 0.25, max: 0.25, R: R * 0.8 });
    burst(x, y, ['#ffb347', '#ff6b35', '#ffe066', '#555'], 40, 14);
    for (let i = 0; i < 12; i++) particles.push({ type: 'smoke', x: x + rnd(-40, 40), y: y + rnd(-40, 40), vx: rnd(-2, 2), vy: rnd(-3, -0.5), size: rnd(26, 50), life: rnd(0.7, 1.2), max: 1.2 });
    shake = 22;
    Sound.sfx.explosion();
  }

  // ---------- 碰撞與傷害 ----------
  function handleCollision(p) {
    const a = p.bodyA.parent || p.bodyA, b = p.bodyB.parent || p.bodyB;
    const ea = ent.get(a.id), eb = ent.get(b.id);
    if (!ea && !eb) return;
    for (const [e, other] of [[ea, eb], [eb, ea]]) {
      if (e && e.kind === 'cat' && !e.hasHit) {
        e.hasHit = true;
        if (CAT[e.type].ability === 'bomb' && !e.used) e.fuse = 110;
      }
    }
    const n = p.collision.normal;
    const along = Math.abs((a.velocity.x - b.velocity.x) * n.x + (a.velocity.y - b.velocity.y) * n.y);
    if (along < 1.2) return;
    const ma = a.isStatic ? Infinity : a.mass, mb = b.isStatic ? Infinity : b.mass;
    const mu = isFinite(ma) && isFinite(mb) ? ma * mb / (ma + mb) : (isFinite(ma) ? ma : mb);
    const base = (along - 1.2) * mu * 1.3;

    // 撞擊音效
    const strength = base / 40;
    if (strength > 0.12) {
      for (const e of [ea, eb]) {
        if (e && e.kind === 'block') Sound.sfx.hit(e.mat, strength);
      }
      if ((!ea || !eb) && (a.label === 'ground' || b.label === 'ground')) {
        const e = ea || eb;
        if (e.kind === 'cat') Sound.sfx.hit('ground', strength * 0.8);
      }
      const cat = ea && ea.kind === 'cat' ? ea : (eb && eb.kind === 'cat' ? eb : null);
      if (cat && strength > 0.4 && !cat.meowed) { cat.meowed = true; Sound.sfx.land(); }
    }
    if (stepCount < graceSteps) return;
    if (ea) damage(ea, base * mult(eb, ea), eb);
    if (eb) damage(eb, base * mult(ea, eb), ea);
  }

  function mult(src, target) {
    if (!src || src.kind !== 'cat') return target.kind === 'enemy' ? 1.3 : 1;
    if (target.kind === 'enemy') return 2.2;
    const def = CAT[src.type];
    let m = 1;
    if (def.strong && target.mat === def.strong) m = src.type === 'white' ? 2.2 : 2.6;
    if (src.dashing > 0) m *= 1.4;
    return m;
  }

  function damage(e, amt, src) {
    if (!e || e.dead || e.kind === 'cat' || amt <= 0.5) return;
    e.hp -= amt;
    if (e.kind === 'enemy') {
      e.flash = 0.18;
      if (amt > 2) { e.dizzy = 1.2; if (e.hp > 0) Sound.sfx.enemyHurt(); }
    } else {
      e.flash = 0.1;
    }
    if (e.hp <= 0) destroy(e);
  }

  function destroy(e) {
    if (e.dead) return;
    e.dead = true; toRemove.push(e);
    const { x, y } = e.body.position;
    if (e.kind === 'block') {
      const m = MAT[e.mat];
      addScore(m.score, x, y, '#fff');
      const size = e.shape === 'ball' ? e.r * 2 : Math.max(e.w, e.h);
      burst(x, y, m.debris, Math.min(26, 6 + size / 10), 5, 'chunk');
      Sound.sfx.break(e.mat);
    } else if (e.kind === 'enemy') {
      addScore(ENEMY[e.type].score, x, y - 20, '#b6ff5c', true);
      for (let i = 0; i < 10; i++) particles.push({ type: 'smoke', x: x + rnd(-e.r, e.r), y: y + rnd(-e.r, e.r), vx: rnd(-1.5, 1.5), vy: rnd(-2, 0), size: rnd(18, 34), life: rnd(0.5, 0.9), max: 0.9, color: '#f2ffe0' });
      burst(x, y, ['#9be15d', '#6fbf2e', '#ffffff'], 16, 6);
      Sound.sfx.enemyPop();
      shake = Math.max(shake, 5);
    }
  }

  function addScore(v, x, y, color, big) {
    score += v;
    popups.push({ text: String(v), x, y, life: 1.2, max: 1.2, color, big });
    updateHud();
  }

  // ---------- 粒子 ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(x, y, colors, n, speed, type = 'bit') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rnd(speed * 0.3, speed);
      particles.push({ type, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, size: type === 'chunk' ? rnd(6, 16) : rnd(4, 9), color: colors[i % colors.length], rot: rnd(0, 6), vr: rnd(-0.3, 0.3), life: rnd(0.6, 1.1), max: 1.1 });
    }
  }

  // ---------- 主迴圈 ----------
  function stepGame() {
    stepCount++;
    // 小貓上彈弓動畫
    if (state === 'loading' && current) {
      current.t = Math.min(1, current.t + 1 / 26);
      if (current.t >= 1) state = 'ready';
    }
    Engine.update(engine, STEP_MS);
    for (const e of toRemove) {
      Composite.remove(engine.world, e.body); ent.delete(e.body.id);
      wakeNear(e.body.bounds, 30);   // 支撐物消失：叫醒壓在上面、靠在旁邊的物體
    }
    // 正在移動的物體會叫醒碰到的睡眠物體（例如支架被撞歪、滑開）
    for (const e of [...blocks, ...enemies, ...shots]) {
      const b = e.body;
      if (!b.isSleeping && !e.dead && (b.speed > 0.4 || Math.abs(b.angularVelocity) > 0.01)) wakeNear(b.bounds, 12);
    }
    if (stepCount % 10 === 0) wakeUnsupported();
    if (toRemove.length) {
      blocks = blocks.filter(e => !e.dead); enemies = enemies.filter(e => !e.dead); shots = shots.filter(e => !e.dead);
      toRemove = []; updateHud();
    }

    // 出界判定
    for (const e of [...blocks, ...enemies, ...shots]) {
      const p = e.body.position;
      if (p.x < -300 || p.x > W + 250 || p.y > H + 300) {
        if (e.kind === 'enemy') destroy(e);
        else { e.dead = true; toRemove.push(e); }
      }
    }

    // 圓形物體在地面上的滾動阻力
    for (const e of [...enemies, ...shots]) {
      const b = e.body;
      if (b.position.y > G - e.r - 4) {
        Body.setAngularVelocity(b, b.angularVelocity * 0.97);
        if (e.kind === 'cat' && e.hasHit) Body.setVelocity(b, { x: b.velocity.x * 0.985, y: b.velocity.y });
      }
    }

    // 飛行中的小貓
    for (const s of shots) {
      if (s.dashing > 0) s.dashing--;
      if (s.fuse > 0 && !s.used) { s.fuse--; if (s.fuse === 0) { s.used = true; explode(s); } }
      if (s.hasHit) s.hitSteps++;
      if (!s.old && stepCount % 3 === 0 && s.trailOn) {
        if (s.hitSteps > 8) s.trailOn = false;
        else trail.push({ x: s.body.position.x, y: s.body.position.y, big: trail.length % 4 === 0 });
      }
    }

    // 回合結束判定
    if (state === 'flying') {
      flySteps++;
      const quiet = worldQuiet(0.35);
      quietSteps = quiet ? quietSteps + 1 : 0;
      if ((quietSteps > 35 && flySteps > 60) || flySteps > 60 * 12) endTurn();
    }

    // 勝利判定
    if (!winPending && enemies.length === 0 && (state !== 'won' && state !== 'lost')) {
      winPending = true; winTimer = 0;
    }
    if (winPending && !endShown) {
      winTimer++;
      if ((winTimer > 70 && worldQuiet(0.5)) || winTimer > 60 * 4) finishWin();
    }
  }

  // Matter.js 的睡眠物體不會自己察覺底下的支撐不見了，需要手動叫醒
  function wakeNear(bd, pad) {
    for (const e of [...blocks, ...enemies]) {
      const b = e.body;
      if (!b.isSleeping || e.dead) continue;
      const o = b.bounds;
      if (o.max.x > bd.min.x - pad && o.min.x < bd.max.x + pad && o.max.y > bd.min.y - pad && o.min.y < bd.max.y + pad) Sleeping.set(b, false);
    }
  }

  // 睡眠中的物體如果重心底下已經沒有東西撐著（支架慢慢滑開、倒向一邊），就叫醒讓它掉下來
  function wakeUnsupported() {
    const all = [...blocks, ...enemies, ...shots].filter(e => !e.dead);
    for (const e of all) {
      const b = e.body;
      if (!b.isSleeping) continue;
      const bb = b.bounds;
      if (bb.max.y >= G - 3) continue;            // 放在地面上
      let lo = Infinity, hi = -Infinity;
      for (const o of all) {
        if (o === e) continue;
        const ob = o.body.bounds;
        if (ob.max.x <= bb.min.x + 2 || ob.min.x >= bb.max.x - 2) continue;   // 水平沒有重疊
        if (ob.min.y > bb.max.y + 4 || ob.max.y <= bb.max.y) continue;        // 不是在正下方接觸
        lo = Math.min(lo, ob.min.x); hi = Math.max(hi, ob.max.x);
      }
      if (!(lo <= b.position.x && b.position.x <= hi)) Sleeping.set(b, false);
    }
  }

  function worldQuiet(th) {
    for (const e of [...blocks, ...enemies, ...shots]) {
      const b = e.body;
      if (b.isSleeping) continue;
      if (Math.abs(b.velocity.x) > th || Math.abs(b.velocity.y) > th) return false;
    }
    return true;
  }

  function endTurn() {
    if (winPending || endShown) return;
    // 清除落地的小貓
    for (const s of shots) {
      if (s.dead) continue;
      s.dead = true; toRemove.push(s);
      for (let i = 0; i < 6; i++) particles.push({ type: 'smoke', x: s.body.position.x + rnd(-15, 15), y: s.body.position.y + rnd(-15, 15), vx: rnd(-1, 1), vy: rnd(-1.5, 0), size: rnd(14, 26), life: 0.6, max: 0.6 });
    }
    if (queue.length) loadNextCat(false);
    else {
      state = 'lost';
      later(() => { if (state === 'lost' && !endShown && enemies.length) showEnd(false); }, 900);
    }
  }

  function finishWin() {
    endShown = true;
    state = 'won';
    let remaining = queue.length + (current && !current.launched ? 1 : 0);
    const bonusCats = [];
    if (current && !current.launched) bonusCats.push(REST);
    queue.forEach((_, i) => bonusCats.push(queuePos(i)));
    bonusCats.forEach((p, i) => later(() => {
      addScore(10000, p.x, p.y - 40, '#ffd23f', true);
      burst(p.x, p.y, ['#ffd23f', '#fff'], 14, 5);
      Sound.sfx.bonus();
    }, 350 * (i + 1)));
    later(() => showEnd(true), 350 * (remaining + 1) + 500);
  }

  // ---------- 繪圖 ----------
  function render() {
    const { dpr, scale, ox, oy } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5fbef2'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let sx = 0, sy = 0;
    if (shake > 0) { sx = rnd(-shake, shake); sy = rnd(-shake, shake); }
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sx * scale), dpr * (oy + sy * scale));

    const bg = IMG.bg;
    if (bg.naturalWidth) {
      // 視窗比例不是 16:9 時，以地面為錨點等比放大背景蓋滿畫面（不拉伸邊緣）；
      // 太高的視窗放大有上限，剩下的上下空間用天空色與泥土色補滿
      const ex = ox / scale + 40, ey = oy / scale + 40;
      const k = Math.max(1, (W + ex * 2) / W, Math.min(1.6, (G + ey) / G));
      const bx = W / 2 - W * k / 2, by = G - G * k, bh = H * k;
      if (by > -ey) { ctx.fillStyle = '#11a9fc'; ctx.fillRect(-ex, -ey, W + ex * 2, by + ey + 1); }
      if (by + bh < H + ey) { ctx.fillStyle = '#98582b'; ctx.fillRect(-ex, by + bh - 1, W + ex * 2, H + ey - by - bh + 1); }
      ctx.drawImage(bg, bx, by, W * k, bh);
    }
    if (!engine) return;

    drawTrail(lastTrail, 0.45);
    drawTrail(trail, 0.9);
    drawSlingshotBack();
    drawQueue();

    for (const e of blocks) drawBlock(e);
    for (const e of enemies) drawEnemy(e);
    for (const s of shots) drawCatBody(s);

    drawSlingshotFront();
    if (state === 'aiming') drawAimPreview();
    drawParticles();
    drawPopups();
  }

  function drawTrail(t, alpha) {
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    for (const p of t) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.big ? 6 : 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function woodStroke(x1, y1, x2, y2, w) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4a2a0e'; ctx.lineWidth = w + 8;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#9b6130'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,170,.45)'; ctx.lineWidth = w * 0.28;
    ctx.beginPath(); ctx.moveTo(x1 - w * 0.2, y1); ctx.lineTo(x2 - w * 0.2, y2); ctx.stroke();
  }

  const PRONG_L = { x: SX - 34, y: G - 196 }, PRONG_R = { x: SX + 32, y: G - 192 };
  function pouchPos() {
    if (state === 'aiming') return { x: REST.x + pull.x, y: REST.y + pull.y };
    return REST;
  }
  function drawSlingshotBack() {
    woodStroke(SX, G + 10, SX, G - 105, 26);
    woodStroke(SX, G - 105, PRONG_R.x, PRONG_R.y, 20);
    const p = pouchPos();
    if (current && state !== 'loading') band(PRONG_R, p);
    // 小貓在皮兜上
    if (current) {
      const def = CAT[current.type];
      let x, y, rot = 0;
      if (state === 'loading') {
        const t = current.t, e = t * t * (3 - 2 * t);
        x = current.from.x + (REST.x - current.from.x) * e;
        y = current.from.y + (REST.y - current.from.y) * e - Math.sin(t * Math.PI) * 120;
        rot = t * Math.PI * 2;
      } else { x = p.x; y = p.y; }
      if (state !== 'loading') {
        ctx.fillStyle = '#5a2e12';
        ctx.save(); ctx.translate(p.x, p.y);
        const ang = Math.atan2(REST.y - p.y, REST.x - p.x);
        ctx.rotate(ang);
        roundRect(-def.r - 8, -def.r * 0.75, 18, def.r * 1.5, 6); ctx.fill();
        ctx.restore();
      }
      drawSprite(IMG[def.img], x, y, def.r, rot, current.type === 'cream' ? 1.3 : 1.18, state === 'ready' ? 1 + Math.sin(time * 5) * 0.03 : 1);
    }
  }
  function drawSlingshotFront() {
    const p = pouchPos();
    if (current && state !== 'loading') band(PRONG_L, p);
    else if (!current || state === 'loading') {
      // 空彈弓時皮筋收回
      ctx.strokeStyle = '#5b2c10'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(PRONG_L.x, PRONG_L.y + 6); ctx.quadraticCurveTo(SX, G - 170, PRONG_R.x, PRONG_R.y + 6); ctx.stroke();
    }
    woodStroke(SX, G - 105, PRONG_L.x, PRONG_L.y, 20);
  }
  function band(from, to) {
    ctx.strokeStyle = '#5b2c10'; ctx.lineCap = 'round';
    ctx.lineWidth = state === 'aiming' ? Math.max(5, 11 - Math.hypot(pull.x, pull.y) / 25) : 10;
    ctx.beginPath(); ctx.moveTo(from.x, from.y + 6); ctx.lineTo(to.x, to.y); ctx.stroke();
  }

  function drawQueue() {
    const n = queue.length;
    for (let i = 0; i < n; i++) {
      const def = CAT[queue[i]];
      const p = queuePos(i);
      const hop = Math.max(0, Math.sin(time * 3 + i * 1.3)) * 6;
      const r = def.r * 0.85;
      drawSprite(IMG[def.img], p.x, G - r - hop, r, 0, queue[i] === 'cream' ? 1.3 : 1.18, 1);
    }
  }

  function drawSprite(img, x, y, r, rot, k, squash) {
    if (!img || !img.naturalWidth) { ctx.fillStyle = '#f90'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); return; }
    const s = r * 2 * k;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0);
    if (squash && squash !== 1) ctx.scale(2 - squash, squash);
    ctx.drawImage(img, -s / 2, -s / 2 - r * 0.06, s, s);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawBlock(e) {
    const b = e.body, m = MAT[e.mat];
    ctx.save();
    ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
    if (e.mat === 'ice') ctx.globalAlpha = 0.88;
    ctx.fillStyle = patterns[e.mat] || m.debris[0];
    ctx.strokeStyle = m.line; ctx.lineWidth = 3;
    if (e.shape === 'ball') {
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.beginPath(); ctx.arc(-e.r * 0.3, -e.r * 0.35, e.r * 0.35, 0, Math.PI * 2); ctx.fill();
    } else {
      const w = e.w, h = e.h;
      roundRect(-w / 2, -h / 2, w, h, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, Math.min(5, h * 0.2));
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(-w / 2 + 3, h / 2 - 6, w - 6, 3);
    }
    // 裂痕
    const ratio = e.hp / e.maxHp;
    if (ratio < 0.7) drawCracks(e, ratio < 0.35 ? 2 : 1);
    if (e.flash > 0) {
      ctx.globalAlpha = e.flash * 3; ctx.fillStyle = '#fff';
      if (e.shape === 'ball') { ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
    }
    ctx.restore();
  }

  function drawCracks(e, level) {
    const sw = e.shape === 'ball' ? e.r * 1.4 : e.w, sh = e.shape === 'ball' ? e.r * 1.4 : e.h;
    ctx.strokeStyle = e.mat === 'ice' ? 'rgba(255,255,255,.9)' : 'rgba(40,20,5,.7)';
    ctx.lineWidth = 2;
    let seed = e.seed;
    const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let c = 0; c < level * 2; c++) {
      let x = (r() - 0.5) * sw * 0.8, y = (r() - 0.5) * sh * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let i = 0; i < 3; i++) {
        x += (r() - 0.5) * sw * 0.35; y += (r() - 0.5) * sh * 0.6;
        x = Math.max(-sw / 2, Math.min(sw / 2, x)); y = Math.max(-sh / 2, Math.min(sh / 2, y));
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawEnemy(e) {
    const b = e.body;
    const breathe = 1 + Math.sin(time * 3 + e.blink) * 0.025;
    drawSprite(IMG[ENEMY[e.type].img], b.position.x, b.position.y, e.r, b.angle, e.type === 'king' ? 1.3 : 1.2, breathe);
    ctx.save(); ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
    if (e.hp < e.maxHp * 0.6) {
      // OK 繃
      ctx.save(); ctx.translate(e.r * 0.35, -e.r * 0.45); ctx.rotate(0.6);
      ctx.fillStyle = '#ffe2b8'; ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 2;
      roundRect(-e.r * 0.4, -e.r * 0.12, e.r * 0.8, e.r * 0.24, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8b98a'; ctx.fillRect(-e.r * 0.1, -e.r * 0.1, e.r * 0.2, e.r * 0.2);
      ctx.restore();
    }
    if (e.flash > 0) {
      ctx.globalAlpha = Math.min(0.7, e.flash * 4); ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (e.dizzy > 0) {
      for (let i = 0; i < 3; i++) {
        const a = time * 6 + i * 2.1;
        drawStar(b.position.x + Math.cos(a) * e.r * 0.9, b.position.y - e.r * 1.05 + Math.sin(a) * 6, 7, '#ffe14d');
      }
    }
  }

  function drawStar(x, y, r, color) {
    ctx.fillStyle = color; ctx.strokeStyle = '#6b4a00'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  function drawCatBody(s) {
    const b = s.body;
    if (s.dashing > 0) {
      ctx.strokeStyle = 'rgba(255,240,170,.7)'; ctx.lineWidth = 4;
      const v = b.velocity, sp = Math.hypot(v.x, v.y) || 1;
      for (let i = -1; i <= 1; i++) {
        const px = -v.y / sp * i * s.r * 0.6, py = v.x / sp * i * s.r * 0.6;
        ctx.beginPath(); ctx.moveTo(b.position.x + px - v.x / sp * s.r, b.position.y + py - v.y / sp * s.r);
        ctx.lineTo(b.position.x + px - v.x / sp * (s.r + 50), b.position.y + py - v.y / sp * (s.r + 50)); ctx.stroke();
      }
    }
    // 奶茶的造型朝向飛行方向
    let rot = b.angle;
    if (s.type === 'cream' && !s.hasHit) rot = Math.atan2(b.velocity.y, b.velocity.x);
    drawSprite(IMG[CAT[s.type].img], b.position.x, b.position.y, s.r, rot, s.type === 'cream' ? 1.3 : 1.18, 1);
    if (s.fuse > 0 && !s.used) {
      const blink = Math.floor(s.fuse / 8) % 2;
      if (blink) { ctx.fillStyle = 'rgba(255,60,30,.35)'; ctx.beginPath(); ctx.arc(b.position.x, b.position.y, s.r, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  function aimPreviewSteps() { return levelIdx < 3 ? 80 : levelIdx < 6 ? 50 : 30; }
  function drawAimPreview() {
    const len = Math.hypot(pull.x, pull.y);
    if (len < 15) return;
    const power = Math.min(len, MAX_PULL) / MAX_PULL;
    let vx = -pull.x / len * power * MAX_SPEED, vy = -pull.y / len * power * MAX_SPEED;
    let x = REST.x + pull.x, y = REST.y + pull.y;
    const n = aimPreviewSteps();
    for (let i = 1; i <= n; i++) {
      vx *= 0.9995; vy = vy * 0.9995 + GRAVITY_STEP;
      x += vx; y += vy;
      if (y > G) break;
      if (i % 4 === 0) {
        const a = 1 - i / n;
        ctx.fillStyle = `rgba(255,255,255,${0.35 + a * 0.6})`;
        ctx.strokeStyle = `rgba(60,36,18,${0.5 * a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 3 + a * 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.type === 'bit' || p.type === 'chunk') {
        ctx.save(); ctx.globalAlpha = Math.min(1, a * 1.5); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.type === 'chunk') { ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66); }
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      } else if (p.type === 'smoke') {
        ctx.globalAlpha = a * 0.85; ctx.fillStyle = p.color || '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - a * 0.4), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.type === 'ring') {
        const t = 1 - a;
        ctx.globalAlpha = a; ctx.strokeStyle = '#fff3c0'; ctx.lineWidth = 14 * a + 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 20 + t * p.R, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.type === 'flash') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.R);
        g.addColorStop(0, `rgba(255,250,200,${a})`); g.addColorStop(0.5, `rgba(255,150,40,${a * 0.7})`); g.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.R, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawPopups() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of popups) {
      const a = Math.min(1, p.life / p.max * 2);
      const t = 1 - p.life / p.max;
      const sc = t < 0.15 ? t / 0.15 : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y - t * 60); ctx.scale(sc, sc);
      ctx.font = `800 ${p.big ? 44 : 30}px "Baloo 2", sans-serif`;
      ctx.lineWidth = 7; ctx.strokeStyle = '#3a2412'; ctx.lineJoin = 'round';
      ctx.strokeText(p.text, 0, 0); ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  function updateVisuals(dt) {
    time += dt;
    shake = Math.max(0, shake - dt * 40);
    for (const e of enemies) { e.flash = Math.max(0, e.flash - dt); e.dizzy = Math.max(0, e.dizzy - dt); }
    for (const e of blocks) e.flash = Math.max(0, (e.flash || 0) - dt);
    for (const p of particles) {
      p.life -= dt;
      if (p.type === 'bit' || p.type === 'chunk') { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr; if (p.y > G) { p.y = G; p.vy *= -0.3; p.vx *= 0.7; } }
      else if (p.type === 'smoke') { p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96; }
    }
    particles = particles.filter(p => p.life > 0);
    for (const p of popups) p.life -= dt;
    popups = popups.filter(p => p.life > 0);
  }

  let lastT = performance.now(), acc = 0;
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    if (engine && !paused && state !== 'menu') {
      acc += dt * 1000;
      let n = 0;
      while (acc >= STEP_MS && n < 5) { stepGame(); acc -= STEP_MS; n++; }
      if (n === 5) acc = 0;
      updateVisuals(dt);
    }
    render();
    requestAnimationFrame(tick);
  }

  // ---------- 輸入 ----------
  let pointerId = null;
  canvas.addEventListener('pointerdown', ev => {
    Sound.init();
    if (paused || !engine) return;
    const p = toWorld(ev.clientX, ev.clientY);
    if (state === 'ready' && current && Math.hypot(p.x - REST.x, p.y - REST.y) < GRAB_R) {
      state = 'aiming'; pointerId = ev.pointerId;
      canvas.setPointerCapture(ev.pointerId);
      setPull(p);
      Sound.sfx.stretch();
    } else if (state === 'flying' || (winPending && shots.length)) {
      activateAbility();
    }
  });
  canvas.addEventListener('pointermove', ev => {
    if (state !== 'aiming' || ev.pointerId !== pointerId) return;
    const before = Math.hypot(pull.x, pull.y);
    setPull(toWorld(ev.clientX, ev.clientY));
    if (Math.hypot(pull.x, pull.y) - before > 30) Sound.sfx.stretch();
  });
  const release = ev => {
    if (state !== 'aiming' || ev.pointerId !== pointerId) return;
    pointerId = null;
    if (Math.hypot(pull.x, pull.y) > 22) launch();
    else { state = 'ready'; pull = { x: 0, y: 0 }; }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', ev => { if (state === 'aiming') { state = 'ready'; pull = { x: 0, y: 0 }; } });
  function setPull(p) {
    let dx = p.x - REST.x, dy = p.y - REST.y;
    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL) { dx *= MAX_PULL / len; dy *= MAX_PULL / len; }
    // 不可以拉進地面
    if (REST.y + dy > G - 26) dy = G - 26 - REST.y;
    pull = { x: dx, y: dy };
  }
  window.addEventListener('keydown', ev => {
    if (ev.code === 'Space' && state === 'flying') { ev.preventDefault(); activateAbility(); }
    if (ev.code === 'KeyR' && engine && state !== 'menu') restartLevel();
    if (ev.code === 'Escape' && engine && state !== 'menu') togglePause();
  });

  // ---------- 介面 ----------
  const $ = id => document.getElementById(id);
  const screens = { title: $('screen-title'), levels: $('screen-levels') };
  function showScreen(name) {
    for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
    $('hud').classList.toggle('hidden', name !== null);
  }

  function goTitle() {
    runId++; engine = null; state = 'menu'; paused = false;
    hideModal(); showScreen('title'); Sound.playSong('menu'); Sound.duck(false);
  }
  function goLevels() {
    runId++; engine = null; state = 'menu'; paused = false;
    hideModal(); buildLevelGrid(); showScreen('levels'); Sound.playSong('menu'); Sound.duck(false);
  }
  function startLevel(i) {
    hideModal(); showScreen(null); paused = false;
    loadLevel(i);
    Sound.playSong('game'); Sound.duck(false);
  }
  function restartLevel() { Sound.sfx.click(); startLevel(levelIdx); }

  function unlocked(i) { return save.unlockAll || i === 0 || save.stars[i - 1] > 0; }

  function buildLevelGrid() {
    const grid = $('level-grid'); grid.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const b = document.createElement('button');
      const open = unlocked(i);
      b.className = 'level-card' + (open ? '' : ' locked') + (lv.boss ? ' boss' : '');
      const st = save.stars[i];
      b.innerHTML = `<div class="num">${i + 1}</div><div class="name">${lv.name}</div>` +
        `<div class="mini-stars">${[0, 1, 2].map(k => `<span class="${k < st ? 'on' : ''}">★</span>`).join('')}</div>`;
      b.setAttribute('aria-label', `第 ${i + 1} 關 ${lv.name}${open ? '' : '（未解鎖）'}`);
      b.addEventListener('click', () => {
        if (!open) { Sound.sfx.hit('stone', 0.5); return; }
        Sound.sfx.click(); startLevel(i);
      });
      grid.appendChild(b);
    });
  }

  function updateHud() {
    if (!level) return;
    $('hud-level').textContent = `第 ${levelIdx + 1} 關・${level.name}`;
    $('hud-score').textContent = score.toLocaleString();
    $('hud-enemies').textContent = enemies.length;
  }

  let toastTimer = null;
  function showToast(lv, i) {
    const t = $('toast');
    t.classList.remove('hidden', 'out');
    const catLine = lv.newCat ? `<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:6px"><img src="assets/${CAT[lv.newCat].img}.png" style="width:56px;height:56px" alt=""></div>` : '';
    t.innerHTML = `<div class="t-title">第 ${i + 1} 關：${lv.name}</div>${catLine}<div>${lv.tip[0]}</div><small>${lv.tip[1] || ''}</small>`;
    // 重新觸發動畫
    void t.offsetWidth; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.add('out');
      toastTimer = setTimeout(() => t.classList.add('hidden'), 400);
    }, lv.newCat || i === 0 ? 4200 : 2800);
  }

  function starsFor(sc) {
    const t2 = enemyScoreTotal + blockScoreTotal * 0.25 + 10000;
    const t3 = enemyScoreTotal + blockScoreTotal * 0.45 + 20000;
    return sc >= t3 ? 3 : sc >= t2 ? 2 : 1;
  }

  function showEnd(won) {
    endShown = true;
    Sound.duck(true);
    const m = $('modal');
    m.classList.remove('hidden');
    const starsEl = $('modal-stars');
    const stars = [...starsEl.querySelectorAll('.star')];
    stars.forEach(s => s.classList.remove('on'));
    const btns = $('modal-buttons'); btns.innerHTML = '';
    const mk = (label, cls, fn) => {
      const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label;
      b.addEventListener('click', () => { Sound.sfx.click(); fn(); }); btns.appendChild(b); return b;
    };
    const oldLose = m.querySelector('.lose-cat'); if (oldLose) oldLose.remove();
    if (won) {
      const st = starsFor(score);
      const isBest = score > save.best[levelIdx];
      save.stars[levelIdx] = Math.max(save.stars[levelIdx], st);
      save.best[levelIdx] = Math.max(save.best[levelIdx], score);
      persist();
      $('modal-title').textContent = levelIdx === LEVELS.length - 1 ? '打倒貓大王！全破！' : '過關！';
      starsEl.classList.remove('hidden');
      $('modal-score').textContent = score.toLocaleString();
      $('modal-best').textContent = isBest ? '★ 新紀錄！' : `最高分：${save.best[levelIdx].toLocaleString()}`;
      Sound.sfx.win();
      for (let k = 0; k < st; k++) later(() => { stars[k].classList.add('on'); Sound.sfx.star(k); }, 700 + k * 380);
      mk('選關', 'gray', goLevels);
      mk('重玩', 'green', () => startLevel(levelIdx));
      if (levelIdx < LEVELS.length - 1) mk('下一關 ▶', '', () => startLevel(levelIdx + 1)).focus();
    } else {
      $('modal-title').textContent = '喵嗚…失敗了';
      starsEl.classList.add('hidden');
      const img = document.createElement('img'); img.src = 'assets/enemy_small.png'; img.className = 'lose-cat'; img.alt = '';
      starsEl.after(img);
      $('modal-score').textContent = score.toLocaleString();
      $('modal-best').textContent = `還剩 ${enemies.length} 隻憤怒貓，再試一次！`;
      Sound.sfx.lose();
      mk('選關', 'gray', goLevels);
      mk('再試一次', 'green', () => startLevel(levelIdx)).focus();
    }
  }

  function togglePause() {
    if (endShown) return;
    paused = !paused;
    if (paused) {
      Sound.duck(true);
      const m = $('modal'); m.classList.remove('hidden');
      $('modal-title').textContent = '暫停';
      $('modal-stars').classList.add('hidden');
      const oldLose = m.querySelector('.lose-cat'); if (oldLose) oldLose.remove();
      $('modal-score').textContent = score.toLocaleString();
      $('modal-best').textContent = `第 ${levelIdx + 1} 關・${level.name}`;
      const btns = $('modal-buttons'); btns.innerHTML = '';
      [['選關', 'gray', goLevels], ['重玩', 'green', () => startLevel(levelIdx)], ['繼續', '', togglePause]].forEach(([l, c, f]) => {
        const b = document.createElement('button'); b.className = 'btn ' + c; b.textContent = l;
        b.addEventListener('click', () => { Sound.sfx.click(); f(); }); btns.appendChild(b);
      });
      btns.lastChild.focus();
    } else {
      hideModal(); Sound.duck(false); lastT = performance.now();
    }
  }
  function hideModal() { $('modal').classList.add('hidden'); }

  function syncSoundButtons() {
    $('btn-music').classList.toggle('off', !save.music);
    $('btn-sfx').classList.toggle('off', !save.sfx);
  }

  $('btn-start').addEventListener('click', () => { Sound.init(); Sound.sfx.click(); Sound.sfx.meow(1.3, 0.3); goLevels(); });
  $('btn-levels-back').addEventListener('click', () => { Sound.sfx.click(); goTitle(); });
  $('btn-restart').addEventListener('click', restartLevel);
  $('btn-pause').addEventListener('click', () => { Sound.sfx.click(); togglePause(); });
  $('btn-music').addEventListener('click', () => { save.music = !save.music; Sound.setMusic(save.music); persist(); syncSoundButtons(); });
  $('btn-sfx').addEventListener('click', () => { save.sfx = !save.sfx; Sound.setSfx(save.sfx); persist(); syncSoundButtons(); Sound.sfx.click(); });
  document.addEventListener('pointerdown', () => Sound.init(), { once: true });

  // 測試用介面
  window.__game = {
    get state() { return state; }, get enemies() { return enemies.length; }, get blocks() { return blocks.length; },
    get score() { return score; }, get queue() { return queue.slice(); }, get current() { return current; },
    startLevel, launchAt(dx, dy) { if (state !== 'ready') return false; pull = { x: dx, y: dy }; state = 'aiming'; launch(); return true; },
    ability: activateAbility, stars: starsFor,
    sim(n) { for (let i = 0; i < n; i++) { stepGame(); updateVisuals(1 / 60); } render(); },
    set paused(v) { paused = v; }, get view() { return view; },
    destroyBlocks(pred) { blocks.filter(e => pred(e.body.position, e)).forEach(destroy); },
    get sleeping() { return [...blocks, ...enemies].filter(e => e.body.isSleeping).length; },
    wakeAll() { [...blocks, ...enemies].forEach(e => Sleeping.set(e.body, false)); },
    info() { return { state, enemies: enemies.map(e => [e.type, Math.round(e.body.position.x), Math.round(e.body.position.y), +e.hp.toFixed(1)]), blocks: blocks.length, score, queue: queue.slice(), winPending, endShown }; },
  };

  Sound.setMusic(save.music); Sound.setSfx(save.sfx); syncSoundButtons();
  loadImages().then(() => {
    makePatterns();
    $('loading').classList.add('hidden');
    goTitle();
    requestAnimationFrame(tick);
  });
})();
