// 萌喵彈射大作戰 — 音效與音樂（全部以 Web Audio 即時合成，不需外部音檔）
const Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, noiseBuf;
  let musicOn = true, sfxOn = true;
  const lastPlayed = {};

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.3 : 0; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.85 : 0; sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (pendingSong) playSong(pendingSong);
  }

  const ready = () => ctx && ctx.state !== 'closed';
  // 同類音效節流，避免碰撞連發時爆音
  function throttle(key, ms) {
    const now = performance.now();
    if (lastPlayed[key] && now - lastPlayed[key] < ms) return false;
    lastPlayed[key] = now; return true;
  }

  // ---------- 基本合成元件 ----------
  function tone({ f, f2, type = 'sine', t = 0, at, dur = 0.2, vol = 0.3, attack = 0.005, bus, filter, curve = 'exp' }) {
    if (!ready()) return;
    const now = at !== undefined ? at : ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(f2, now + dur);
      else o.frequency.linearRampToValueAtTime(f2, now + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    let node = o;
    if (filter) {
      const fl = ctx.createBiquadFilter(); fl.type = filter.type; fl.frequency.value = filter.f; fl.Q.value = filter.q || 1;
      o.connect(fl); node = fl;
    }
    node.connect(g); g.connect(bus || sfxBus);
    o.start(now); o.stop(now + dur + 0.05);
  }

  function noise({ t = 0, at, dur = 0.2, vol = 0.3, type = 'bandpass', f = 1000, f2, q = 1, attack = 0.004, bus }) {
    if (!ready()) return;
    const now = at !== undefined ? at : ctx.currentTime + t;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, now);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(fl); fl.connect(g); g.connect(bus || sfxBus);
    s.start(now, Math.random() * 1.5); s.stop(now + dur + 0.05);
  }

  // 可愛的「喵～」：鋸齒波 + 兩組共振峰濾波 + 顫音
  function meow(p = 1, vol = 0.3, t = 0, dur = 0.45) {
    if (!ready()) return;
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(480 * p, now);
    o.frequency.linearRampToValueAtTime(820 * p, now + dur * 0.28);
    o.frequency.linearRampToValueAtTime(560 * p, now + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
    const lg = ctx.createGain(); lg.gain.value = 14 * p;
    lfo.connect(lg); lg.connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
    f1.frequency.setValueAtTime(700, now);
    f1.frequency.linearRampToValueAtTime(1800, now + dur * 0.3);
    f1.frequency.linearRampToValueAtTime(900, now + dur);
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.value = 2800;
    const f2g = ctx.createGain(); f2g.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.05);
    g.gain.setValueAtTime(vol, now + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(f1); f1.connect(g);
    o.connect(f2); f2.connect(f2g); f2g.connect(g);
    g.connect(sfxBus);
    o.start(now); lfo.start(now); o.stop(now + dur + 0.05); lfo.stop(now + dur + 0.05);
  }

  // 憤怒貓的低吼「嘶～」
  function hiss(vol = 0.25, t = 0) {
    noise({ t, dur: 0.35, vol, type: 'highpass', f: 3500, q: 0.7, attack: 0.02 });
    tone({ t, f: 180, f2: 120, type: 'sawtooth', dur: 0.3, vol: vol * 0.5, filter: { type: 'lowpass', f: 700 } });
  }

  // ---------- 遊戲音效 ----------
  const sfx = {
    click() { tone({ f: 880, f2: 1320, dur: 0.08, vol: 0.2, type: 'triangle' }); },
    stretch() {
      if (!throttle('stretch', 250)) return;
      tone({ f: 260, f2: 620, type: 'triangle', dur: 0.28, vol: 0.18, curve: 'lin' });
    },
    launch(p = 1) {
      noise({ dur: 0.4, vol: 0.35, f: 500, f2: 2600, q: 1.2 });
      tone({ f: 200, f2: 90, dur: 0.15, vol: 0.3, type: 'sine' });
      meow(1.25 * p, 0.28, 0.03, 0.5);
    },
    hit(mat, strength) {
      const v = Math.min(1, strength);
      if (!throttle('hit-' + mat, 70)) return;
      if (mat === 'wood') {
        tone({ f: 240, f2: 140, type: 'triangle', dur: 0.14, vol: 0.35 * v });
        noise({ dur: 0.08, vol: 0.25 * v, f: 1100, q: 2 });
      } else if (mat === 'stone') {
        tone({ f: 120, f2: 55, type: 'sine', dur: 0.22, vol: 0.5 * v });
        noise({ dur: 0.12, vol: 0.25 * v, type: 'lowpass', f: 600 });
      } else if (mat === 'ice') {
        tone({ f: 2300 + Math.random() * 600, type: 'sine', dur: 0.12, vol: 0.18 * v });
        tone({ f: 3400, type: 'sine', dur: 0.08, vol: 0.1 * v, t: 0.02 });
      } else if (mat === 'ground') {
        tone({ f: 110, f2: 60, type: 'sine', dur: 0.16, vol: 0.35 * v });
        noise({ dur: 0.1, vol: 0.18 * v, type: 'lowpass', f: 400 });
      }
    },
    break(mat) {
      if (!throttle('break-' + mat, 60)) return;
      if (mat === 'wood') {
        noise({ dur: 0.3, vol: 0.4, f: 800, q: 1.5 });
        for (let i = 0; i < 4; i++) noise({ t: i * 0.035 + Math.random() * 0.02, dur: 0.04, vol: 0.3, f: 1800 + Math.random() * 1200, q: 3 });
        tone({ f: 180, f2: 80, type: 'triangle', dur: 0.25, vol: 0.3 });
      } else if (mat === 'stone') {
        noise({ dur: 0.5, vol: 0.55, type: 'lowpass', f: 1400, f2: 250 });
        tone({ f: 90, f2: 38, type: 'sine', dur: 0.45, vol: 0.5 });
      } else if (mat === 'ice') {
        for (let i = 0; i < 7; i++) tone({ t: i * 0.03 + Math.random() * 0.03, f: 1800 + Math.random() * 2600, type: 'triangle', dur: 0.18, vol: 0.12 });
        noise({ dur: 0.25, vol: 0.25, type: 'highpass', f: 5000 });
      }
    },
    enemyHurt() {
      if (!throttle('ehurt', 160)) return;
      tone({ f: 330, f2: 210, type: 'sawtooth', dur: 0.2, vol: 0.18, filter: { type: 'lowpass', f: 1200 } });
    },
    enemyPop() {
      if (!throttle('epop', 50)) return;
      tone({ f: 500, f2: 1400, type: 'sine', dur: 0.12, vol: 0.4 });
      noise({ dur: 0.3, vol: 0.3, f: 1500, f2: 400, q: 0.8 });
      hiss(0.16, 0.05);
      tone({ t: 0.12, f: 1568, type: 'triangle', dur: 0.25, vol: 0.15 });
    },
    explosion() {
      noise({ dur: 1.0, vol: 0.9, type: 'lowpass', f: 1600, f2: 90, attack: 0.002 });
      tone({ f: 90, f2: 28, type: 'sine', dur: 0.8, vol: 0.8 });
      noise({ t: 0.05, dur: 0.5, vol: 0.3, type: 'bandpass', f: 400, q: 0.5 });
    },
    ability() {
      [880, 1175, 1568].forEach((f, i) => tone({ t: i * 0.05, f, type: 'triangle', dur: 0.18, vol: 0.2 }));
    },
    split() { sfx.ability(); meow(1.6, 0.14, 0.02, 0.3); meow(1.8, 0.12, 0.08, 0.3); },
    dash() {
      noise({ dur: 0.35, vol: 0.4, f: 1200, f2: 5000, q: 1.5 });
      tone({ f: 500, f2: 1600, type: 'square', dur: 0.2, vol: 0.12, filter: { type: 'lowpass', f: 2500 } });
    },
    grow() {
      tone({ f: 160, f2: 520, type: 'square', dur: 0.4, vol: 0.2, filter: { type: 'lowpass', f: 1400 }, curve: 'lin' });
      meow(0.7, 0.25, 0.05, 0.55);
    },
    land() { if (throttle('land', 120)) meow(1.4, 0.12, 0, 0.25); },
    star(i) {
      tone({ t: 0, f: 1046 * Math.pow(1.26, i), type: 'triangle', dur: 0.35, vol: 0.25 });
      tone({ t: 0.06, f: 1568 * Math.pow(1.26, i), type: 'sine', dur: 0.4, vol: 0.18 });
    },
    win() {
      const seq = [523, 659, 784, 1046, 784, 1046];
      seq.forEach((f, i) => tone({ t: i * 0.11, f, type: 'square', dur: 0.2, vol: 0.12, filter: { type: 'lowpass', f: 3000 } }));
      [523, 659, 784, 1046].forEach(f => tone({ t: 0.7, f, type: 'triangle', dur: 0.9, vol: 0.14 }));
      meow(1.3, 0.25, 0.75, 0.5);
    },
    lose() {
      [[392, 370], [370, 349], [349, 262]].forEach(([a, b], i) =>
        tone({ t: i * 0.38, f: a, f2: b, type: 'sawtooth', dur: i === 2 ? 0.9 : 0.36, vol: 0.18, filter: { type: 'lowpass', f: 1100 } }));
      meow(0.8, 0.2, 1.2, 0.7);
    },
    bonus() { if (throttle('bonus', 80)) tone({ f: 1318, f2: 1760, type: 'triangle', dur: 0.15, vol: 0.2 }); },
    meow, hiss,
  };

  // ---------- 背景音樂（步進音序器） ----------
  const NOTE_IDX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  function freq(n) {
    const m = /^([A-G]#?)(\d)$/.exec(n);
    return 440 * Math.pow(2, (NOTE_IDX[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
  }
  const CHORDS = {
    C: ['C', 'E', 'G'], Am: ['A', 'C', 'E'], F: ['F', 'A', 'C'], G: ['G', 'B', 'D'],
    Dm: ['D', 'F', 'A'], Em: ['E', 'G', 'B'],
  };
  const FIFTH = { C: 'G', Am: 'E', F: 'C', G: 'D', Dm: 'A', Em: 'B' };

  const SONGS = {
    menu: {
      bpm: 100, lead: 'triangle', leadVol: 0.16, drums: 'soft', stabs: false,
      chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F|G'],
      mel: ('E5 . G5 . C6 . G5 . D5 . G5 . B5 . G5 . C5 . E5 . A5 . E5 . F5 . A5 . C6 . A5 G5 ' +
            'E5 G5 C6 . D6 . C6 . B5 . G5 . D5 . G5 . A5 . C6 . E6 . C6 A5 F5 . A5 . G5 . . .').split(' '),
    },
    game: {
      bpm: 128, lead: 'square', leadVol: 0.1, drums: 'full', stabs: true,
      chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'F|G', 'C'],
      mel: ('G4 C5 E5 G5 . E5 G5 . A5 G5 E5 C5 . A4 C5 . F5 E5 F5 A5 . G5 F5 . D5 E5 F5 G5 . . B4 . ' +
            'G4 C5 E5 G5 . E5 C6 . A5 G5 A5 C6 . A5 G5 . F5 A5 G5 F5 E5 D5 B4 G4 C5 . E5 . C5 . . .').split(' '),
    },
  };

  let song = null, pendingSong = null, step = 0, nextTime = 0, timer = null;

  function playSong(name) {
    pendingSong = name;
    if (!ctx) return;
    if (song === SONGS[name] && timer) return;
    stopSong();
    song = SONGS[name]; step = 0; nextTime = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 25);
  }
  function stopSong() { if (timer) clearInterval(timer); timer = null; song = null; }

  function schedule() {
    if (!song || !ctx) return;
    const eighth = 60 / song.bpm / 2;
    while (nextTime < ctx.currentTime + 0.15) {
      playStep(step, nextTime, eighth);
      nextTime += eighth;
      step = (step + 1) % 64;
    }
  }

  function chordAt(s) {
    const bar = Math.floor(s / 8);
    const parts = song.chords[bar].split('|');
    return parts.length === 1 ? parts[0] : parts[(s % 8) < 4 ? 0 : 1];
  }

  function playStep(s, at, eighth) {
    const bus = musicBus;
    const note = song.mel[s];
    if (note && note !== '.') {
      tone({ at, f: freq(note), type: song.lead, dur: eighth * 1.7, vol: song.leadVol, attack: 0.01, bus, filter: { type: 'lowpass', f: 3200 } });
      tone({ at, f: freq(note) * 2, type: 'sine', dur: eighth * 0.9, vol: song.leadVol * 0.25, bus });
    }
    const ch = chordAt(s);
    const pos = s % 8;
    // 貝斯：一拍一個音，根音與五度交替
    if (pos % 2 === 0) {
      const n = (pos === 0 || pos === 4) ? CHORDS[ch][0] : FIFTH[ch];
      tone({ at, f: freq(n + '2'), type: 'triangle', dur: eighth * 1.8, vol: 0.34, attack: 0.01, bus });
    }
    // 和弦
    if (song.stabs) {
      if (pos % 2 === 1) CHORDS[ch].forEach(n => tone({ at, f: freq(n + '4'), type: 'triangle', dur: eighth * 0.8, vol: 0.05, bus }));
    } else if (pos === 0 || (pos === 4 && song.chords[Math.floor(s / 8)].includes('|'))) {
      CHORDS[ch].forEach(n => tone({ at, f: freq(n + '4'), type: 'sine', dur: eighth * 7, vol: 0.05, attack: 0.15, bus }));
    }
    // 鼓
    if (song.drums === 'full') {
      if (pos === 0 || pos === 4 || pos === 5 && s % 16 === 13) kick(at);
      if (pos === 2 || pos === 6) snare(at);
      noise({ at, dur: 0.035, vol: pos % 2 ? 0.05 : 0.025, type: 'highpass', f: 7500, bus });
    } else {
      if (pos === 0) kick(at, 0.35);
      if (pos % 2 === 1) noise({ at, dur: 0.03, vol: 0.02, type: 'highpass', f: 8000, bus });
    }
  }
  function kick(at, vol = 0.55) { tone({ at, f: 150, f2: 45, type: 'sine', dur: 0.16, vol, attack: 0.002, bus: musicBus }); }
  function snare(at) {
    noise({ at, dur: 0.12, vol: 0.16, f: 1800, q: 0.8, bus: musicBus });
    tone({ at, f: 220, f2: 160, type: 'triangle', dur: 0.08, vol: 0.12, bus: musicBus });
  }

  function setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.3 : 0, ctx.currentTime, 0.05); }
  function setSfx(on) { sfxOn = on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, 0.02); }
  function duck(on) { if (musicBus && musicOn) musicBus.gain.setTargetAtTime(on ? 0.1 : 0.3, ctx.currentTime, 0.2); }

  return { init, sfx, playSong, stopSong, setMusic, setSfx, duck, get musicOn() { return musicOn; }, get sfxOn() { return sfxOn; } };
})();
