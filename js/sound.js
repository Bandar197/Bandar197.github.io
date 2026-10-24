// Small synthesized sound set (no audio files). Respects the mute switch and volume in prefs.
import { prefs } from './ui.js';
let ctx = null;
function ac() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; }
function noise(t, len, freq, gain) {
  const c = ac(), buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = gain * (prefs.volume ?? 0.7);
  src.buffer = buf; src.connect(f).connect(g).connect(c.destination); src.start(t);
}
function tones(t, notes, gain = 0.12, step = 0.09, type = 'triangle') {
  const c = ac();
  notes.forEach((fq, i) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = fq;
    const v = gain * (prefs.volume ?? 0.7);
    g.gain.setValueAtTime(0, t + i * step); g.gain.linearRampToValueAtTime(v, t + i * step + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + i * step + 0.28);
    o.connect(g).connect(c.destination); o.start(t + i * step); o.stop(t + i * step + 0.3);
  });
}
export function play(kind) {
  if (!prefs.sound) return;
  try {
    const t = ac().currentTime;
    switch (kind) {
      case 'card': return noise(t, 0.07, 1800, 0.5);
      case 'deal': for (let i = 0; i < 4; i++) noise(t + i * 0.06, 0.05, 2200, 0.35); return;
      case 'soft': return noise(t, 0.05, 1200, 0.25);
      case 'bid': return tones(t, [440]);
      case 'double': return tones(t, [523, 659, 784], 0.14, 0.07, 'square');
      case 'proj': return tones(t, [659, 880]);
      case 'win': return tones(t, [523, 784]);
      case 'good': return tones(t, [523, 659, 784, 1047]);
      case 'bad': return tones(t, [392, 330, 262]);
      case 'turn': return tones(t, [660, 990], 0.1);
      case 'tick': return tones(t, [880], 0.06, 0, 'sine');
      case 'msg': return tones(t, [880], 0.07, 0, 'sine');
      case 'error': return tones(t, [220], 0.08, 0, 'sawtooth');
    }
  } catch { /* audio unavailable */ }
}
