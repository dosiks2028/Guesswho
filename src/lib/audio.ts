import { read } from './storage';
let context: AudioContext | undefined;
export function sound(kind: 'click' | 'flip' | 'win' | 'message' | 'wrong' | 'turn' | 'draw' = 'click') {
  if (!read('sound', true)) return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const ctx = context;
    const volume = read('volume', 50) / 100;
    if (kind === 'flip') {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * .12, ctx.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / channel.length, 3);
      const source = ctx.createBufferSource(); const filter = ctx.createBiquadFilter(); const gain = ctx.createGain();
      source.buffer = buffer; filter.type = 'highpass'; filter.frequency.value = 900; gain.gain.value = .26 * volume;
      source.connect(filter).connect(gain).connect(ctx.destination); source.start(); return;
    }
    const notes = kind === 'win' ? [523, 659, 784, 1047] : kind === 'turn' ? [440, 660, 880] : kind === 'draw' ? [523, 659, 523] : kind === 'wrong' ? [240, 160] : kind === 'message' ? [680, 880] : [600];
    notes.forEach((freq, i) => {
      const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); const at = ctx.currentTime + i * .12;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.12 * volume, at + .01); gain.gain.exponentialRampToValueAtTime(.001, at + .17);
      oscillator.connect(gain).connect(ctx.destination); oscillator.start(at); oscillator.stop(at + .2);
    });
  } catch { return; }
}
