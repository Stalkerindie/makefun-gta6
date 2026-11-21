// audio.js — self-contained WebAudio synth for Neon Harbor (2D top-down crime game).
// Every sound is synthesized live (oscillators, noise buffers, filters, gain
// envelopes). No audio files, no network requests, no dependencies.
// Call unlock() from a user gesture first; every method is a safe no-op before
// unlock() and whenever AudioContext is unavailable (headless / no device).
// Loops (engine, siren, music scheduler) are created once and reused — toggling
// them never leaks nodes.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let engine = null; // { osc, filter, gain }
  let siren = null; // { osc, gain, lfo }
  let musicTimer = null;
  let musicOn = false;
  let musicStep = 0;
  let musicNext = 0;

  // A-minor bassline, ~100 BPM: eighth note = 0.3 s. A1 A1 C2 A1 E2 E2 C2 A1.
  const BASS = [55, 55, 65.41, 55, 82.41, 82.41, 65.41, 55];
  const EIGHTH = 60 / 100 / 2;

  function ensureNoise() {
    if (noiseBuf || !ctx) return;
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // One oscillator note with an attack/decay envelope. freqEnd glides the pitch.
  function tone({ type = 'sine', freq = 440, freqEnd = 0, dur = 0.2, vol = 0.15, when = 0, filterFreq = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head = osc;
    if (filterFreq) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      osc.connect(filter);
      head = filter;
    }
    head.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // One filtered noise burst.
  function noise({ dur = 0.2, vol = 0.2, freq = 1000, type = 'lowpass', when = 0 }) {
    if (!ctx) return;
    ensureNoise();
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function setGain(node, value, time = 0.08) {
    if (!ctx || !node) return;
    node.gain.setTargetAtTime(value, ctx.currentTime, time);
  }

  function ensureEngine() {
    if (engine || !ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    engine = { osc, filter, gain };
  }

  function ensureSiren() {
    if (siren || !ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 825; // centre of 700 / 950 Hz
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.9; // alternates roughly every half second
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 125; // 825 ± 125 Hz
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    lfo.start();
    siren = { osc, gain, lfo };
  }

  function scheduleMusic() {
    if (!ctx || !musicOn) return;
    while (musicNext < ctx.currentTime + 0.25) {
      tone({ type: 'sawtooth', freq: BASS[musicStep % BASS.length], dur: EIGHTH * 0.95, vol: 0.11, when: Math.max(0, musicNext - ctx.currentTime), filterFreq: 480 });
      musicNext += EIGHTH;
      musicStep += 1;
    }
  }

  function ensureMusic() {
    if (musicTimer || !ctx) return;
    musicNext = ctx.currentTime + 0.05;
    musicStep = 0;
    musicTimer = setInterval(() => { try { scheduleMusic(); } catch { /* no-op */ } }, 120);
  }

  return {
    unlock() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.5;
          master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      } catch { /* Audio unavailable: stay silent. */ }
    },

    setEngine(on, speed01 = 0) {
      try {
        if (!ctx) return;
        const speed = Math.min(1, Math.max(0, Number(speed01) || 0));
        if (on) {
          ensureEngine();
          if (!engine) return;
          engine.osc.frequency.setTargetAtTime(50 + speed * 110, ctx.currentTime, 0.1);
          engine.filter.frequency.setTargetAtTime(280 + speed * 900, ctx.currentTime, 0.1);
          setGain(engine.gain, 0.035 + speed * 0.055);
        } else if (engine) {
          setGain(engine.gain, 0);
        }
      } catch { /* no-op */ }
    },

    siren(on) {
      try {
        if (!ctx) return;
        if (on) {
          ensureSiren();
          if (siren) setGain(siren.gain, 0.045);
        } else if (siren) {
          setGain(siren.gain, 0);
        }
      } catch { /* no-op */ }
    },

    music(on) {
      try {
        if (!ctx) return;
        musicOn = Boolean(on);
        if (musicOn) {
          ensureMusic();
          musicNext = Math.max(musicNext, ctx.currentTime + 0.05);
        }
      } catch { /* no-op */ }
    },

    shot() {
      try {
        noise({ dur: 0.12, vol: 0.3, freq: 2500, type: 'highpass' });
        tone({ type: 'square', freq: 220, freqEnd: 60, dur: 0.1, vol: 0.16 });
      } catch { /* no-op */ }
    },

    crash() {
      try {
        noise({ dur: 0.35, vol: 0.32, freq: 320 });
        tone({ type: 'sine', freq: 90, freqEnd: 35, dur: 0.3, vol: 0.25 });
      } catch { /* no-op */ }
    },

    cash() {
      try {
        tone({ type: 'sine', freq: 1320, dur: 0.09, vol: 0.14 });
        tone({ type: 'sine', freq: 1760, dur: 0.16, vol: 0.14, when: 0.09 });
      } catch { /* no-op */ }
    },

    pickup() {
      try { tone({ type: 'sine', freq: 880, dur: 0.12, vol: 0.12 }); } catch { /* no-op */ }
    },

    missionDone() {
      try {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          tone({ type: 'triangle', freq, dur: 0.18, vol: 0.15, when: i * 0.11 });
        });
      } catch { /* no-op */ }
    },

    busted() {
      try { tone({ type: 'sawtooth', freq: 320, freqEnd: 110, dur: 0.6, vol: 0.16, filterFreq: 900 }); } catch { /* no-op */ }
    },

    wasted() {
      try { tone({ type: 'sine', freq: 220, freqEnd: 55, dur: 0.9, vol: 0.2 }); } catch { /* no-op */ }
    },

    click() {
      try { tone({ type: 'square', freq: 1200, dur: 0.04, vol: 0.07 }); } catch { /* no-op */ }
    },

    horn() {
      try {
        tone({ type: 'sawtooth', freq: 370, dur: 0.22, vol: 0.12, filterFreq: 1200 });
        tone({ type: 'sawtooth', freq: 466, dur: 0.22, vol: 0.12, filterFreq: 1200 });
      } catch { /* no-op */ }
    },
  };
}
