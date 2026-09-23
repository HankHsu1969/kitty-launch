// 關卡資料：10 關，由簡單到最難
// 世界座標 1920 x 1080，地面高度 G；x 為中心點，建構函式以「底部」為基準往上疊
const G = 982;
const ENEMY_R = { small: 26, helmet: 30, king: 46 };

function blk(mat, x, bottom, w, h) { return { type: 'block', mat, x, y: bottom - h / 2, w, h }; }
function ball(mat, x, bottom, r) { return { type: 'ball', mat, x, y: bottom - r, r }; }
function foe(kind, x, bottom) { return { type: 'enemy', kind, x, y: bottom - ENEMY_R[kind] - 1 }; }

// 兩根柱子 + 一塊橫板，回傳橫板頂端的 y
function frame(out, cx, bottom, width, height, pillarMat, plankMat = pillarMat, pw = 22, ph = 22) {
  out.push(blk(pillarMat, cx - width / 2 + pw / 2, bottom, pw, height));
  out.push(blk(pillarMat, cx + width / 2 - pw / 2, bottom, pw, height));
  out.push(blk(plankMat, cx, bottom - height, width, ph));
  return bottom - height - ph;
}
// 垂直堆疊方塊，回傳頂端 y
function stack(out, mat, x, bottom, size, count) {
  for (let i = 0; i < count; i++) out.push(blk(mat, x, bottom - i * size, size, size));
  return bottom - count * size;
}

const LEVELS = [
  // 1 ────────────────────────────────
  {
    name: '你好，喵星人',
    cats: ['orange', 'orange', 'orange'],
    tip: ['拖曳彈弓上的小貓，放開就發射！', '擊倒所有憤怒貓就過關'],
    build(o) {
      const t = frame(o, 1350, G, 180, 100, 'wood');
      o.push(foe('small', 1350, t));
      o.push(foe('small', 1350, G));
      o.push(blk('wood', 1520, G, 50, 50));
    },
  },
  // 2 ────────────────────────────────
  {
    name: '冰冰涼涼',
    cats: ['orange', 'orange', 'orange', 'orange'],
    tip: ['冰塊一撞就碎！', '從高處掉下來的憤怒貓也會被打敗'],
    build(o) {
      const t1 = frame(o, 1200, G, 160, 100, 'wood');
      o.push(foe('small', 1200, t1));
      const t2 = frame(o, 1480, G, 170, 110, 'ice');
      o.push(foe('small', 1480, G));
      o.push(foe('small', 1480, t2));
      stack(o, 'ice', 1650, G, 50, 2);
    },
  },
  // 3 ────────────────────────────────
  {
    name: '分身術',
    cats: ['gray', 'gray', 'orange', 'gray'],
    newCat: 'gray',
    tip: ['新夥伴「灰灰」：飛行中點一下畫面，分身成三隻！', '灰灰撞冰塊特別有效'],
    build(o) {
      for (const x of [1180, 1420, 1660]) {
        const t = frame(o, x, G, 140, 120, 'ice');
        o.push(foe('small', x, t));
      }
      stack(o, 'ice', 1300, G, 50, 2);
      stack(o, 'ice', 1540, G, 50, 2);
    },
  },
  // 4 ────────────────────────────────
  {
    name: '衝刺吧奶茶',
    cats: ['cream', 'cream', 'orange', 'cream'],
    newCat: 'cream',
    tip: ['新夥伴「奶茶」：飛行中點一下，高速衝刺！', '奶茶最會撞碎木頭'],
    build(o) {
      o.push(blk('wood', 1230, G, 30, 170));
      o.push(blk('wood', 1230, G - 170, 90, 22));
      const t1 = frame(o, 1450, G, 220, 120, 'wood');
      o.push(foe('small', 1450, G));
      const t2 = frame(o, 1450, t1, 180, 110, 'wood');
      o.push(foe('small', 1450, t2));
      const s = stack(o, 'wood', 1680, G, 60, 2);
      o.push(foe('small', 1680, s));
    },
  },
  // 5 ────────────────────────────────
  {
    name: '石頭城牆',
    cats: ['black', 'orange', 'cream', 'black'],
    newCat: 'black',
    tip: ['新夥伴「煤球」：點一下就爆炸！', '戴頭盔的憤怒貓比較耐打喔'],
    build(o) {
      stack(o, 'stone', 1180, G, 60, 3);
      const t = frame(o, 1420, G, 200, 110, 'wood');
      o.push(foe('helmet', 1420, G));
      o.push(foe('small', 1420, t));
      stack(o, 'stone', 1620, G, 60, 2);
      o.push(foe('small', 1720, G));
    },
  },
  // 6 ────────────────────────────────
  {
    name: '三層高塔',
    cats: ['orange', 'gray', 'cream', 'black'],
    tip: ['高塔越高，倒下來越痛！', '瞄準結構的弱點'],
    build(o) {
      const t1 = frame(o, 1450, G, 240, 120, 'stone', 'wood', 26, 22);
      o.push(foe('helmet', 1450, G));
      const t2 = frame(o, 1450, t1, 200, 110, 'wood');
      o.push(foe('small', 1450, t1));
      const t3 = frame(o, 1450, t2, 160, 100, 'ice');
      o.push(foe('small', 1450, t2));
      o.push(foe('small', 1450, t3));
      stack(o, 'ice', 1250, G, 50, 3);
      stack(o, 'wood', 1660, G, 50, 2);
    },
  },
  // 7 ────────────────────────────────
  {
    name: '冰雪宮殿',
    cats: ['gray', 'white', 'orange'],
    newCat: 'white',
    tip: ['新夥伴「棉花」：點一下變成巨大胖貓！', '又重又大，石頭也擋不住'],
    build(o) {
      const xs = [1260, 1450, 1640];
      const tops = xs.map(x => frame(o, x, G, 180, 110, 'ice', 'ice', 24, 24));
      o.push(foe('small', 1260, G));
      o.push(foe('small', 1450, G));
      o.push(foe('small', 1640, G));
      o.push(ball('stone', 1260, tops[0], 30));
      o.push(ball('stone', 1640, tops[2], 30));
      const t = frame(o, 1450, tops[1], 160, 100, 'ice', 'wood');
      o.push(foe('helmet', 1450, t));
    },
  },
  // 8 ────────────────────────────────
  {
    name: '雙子塔',
    cats: ['white', 'black', 'cream', 'orange'],
    tip: ['兩座塔中間有橋', '打斷橋墩，讓上面的憤怒貓摔下來！'],
    build(o) {
      for (const [x, k1, k2] of [[1250, 'small', 'small'], [1650, 'helmet', 'small']]) {
        const a = frame(o, x, G, 170, 110, 'stone', 'stone', 26, 24);
        o.push(foe(k1, x, G));
        const b = frame(o, x, a, 160, 100, 'wood');
        o.push(foe(k2, x, a));
        frame(o, x, b, 150, 90, 'ice', 'ice');
      }
      const top = G - 134 - 122 - 112;
      o.push(blk('wood', 1450, top, 560, 22));
      o.push(foe('helmet', 1450, top - 22));
      o.push(foe('small', 1330, top - 22));
    },
  },
  // 9 ────────────────────────────────
  {
    name: '石頭金字塔',
    cats: ['black', 'white', 'cream', 'gray'],
    tip: ['堅固的石頭金字塔', '善用煤球的爆炸和棉花的重量'],
    build(o) {
      const l1 = [1260, 1450, 1640].map(x => frame(o, x, G, 170, 100, 'stone', 'stone', 26, 24))[0];
      o.push(foe('helmet', 1260, G));
      o.push(foe('small', 1450, G));
      o.push(foe('helmet', 1640, G));
      const l2 = [1355, 1545].map(x => frame(o, x, l1, 170, 90, 'wood', 'stone', 22, 24))[0];
      o.push(foe('small', 1355, l1));
      o.push(foe('small', 1545, l1));
      const l3 = frame(o, 1450, l2, 170, 90, 'ice', 'wood');
      o.push(foe('helmet', 1450, l2));
      o.push(foe('small', 1450, l3));
    },
  },
  // 10 ───────────────────────────────
  {
    name: '貓大王的城堡',
    cats: ['white', 'black', 'gray', 'cream', 'black'],
    boss: true,
    tip: ['最終決戰！', '打倒戴皇冠的貓大王！'],
    build(o) {
      stack(o, 'stone', 1130, G, 60, 4);
      o.push(blk('ice', 1130, G - 240, 60, 40));
      const l1 = [1320, 1500, 1680].map(x => frame(o, x, G, 170, 110, 'stone', 'stone', 26, 24))[0];
      o.push(foe('helmet', 1320, G));
      o.push(foe('helmet', 1500, G));
      o.push(foe('small', 1680, G));
      const l2 = [1410, 1590].map(x => frame(o, x, l1, 170, 100, 'wood', 'stone', 24, 24))[0];
      o.push(foe('helmet', 1410, l1));
      o.push(foe('small', 1590, l1));
      const l3 = frame(o, 1500, l2, 190, 110, 'stone', 'stone', 26, 26);
      o.push(foe('small', 1500, l2));
      o.push(blk('ice', 1425, l3, 40, 40));
      o.push(blk('ice', 1575, l3, 40, 40));
      o.push(foe('king', 1500, l3));
    },
  },
];
