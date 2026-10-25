const platform = require('./platform');
const clips = require('./audio-index');
const config = require('./config');
// 音频事件及默认激活的配音变体。
const events = require('../assets/audio-events-packed');

const aliases = { rr_bgm_level: 'rr_bgm_level_2', rr_sfx_level_complete_2: 'rr_sfx_level_complete', rr_sfx_blocked_2: 'rr_sfx_blocked', rr_sfx_ui_deny_2: 'rr_sfx_ui_deny', _rr_sfx_reward_double: 'rr_sfx_reward_double' };
const voices = new Set();
const selections = new Map();
const lastPlayed = new Map();
let music = null;
let musicRequest = 0;
let soundMuted = false;

function select(name, event) {
  const previous = selections.get(name);
  let index = 0;
  if (event.mode === 'Sequence') index = previous === undefined ? 0 : (previous + 1) % event.rows.length;
  else if (event.mode === 'Random') {
    const candidates = event.rows.map((row, i) => [i, row[2]]).filter(row => !event.avoid || row[0] !== previous);
    let weight = Math.random() * candidates.reduce((sum, row) => sum + row[1], 0);
    index = candidates[candidates.length - 1][0];
    for (const row of candidates) { weight -= row[1]; if (weight < 0) { index = row[0]; break; } }
  }
  selections.set(name, index);
  return event.rows[index];
}

function finish(voice, stop = false) {
  if (voice.cancelled) return;
  voice.cancelled = true;
  voices.delete(voice);
  const audio = voice.audio;
  if (audio) {
    if (stop) audio.stop ? audio.stop() : audio.pause();
    if (audio.destroy) audio.destroy();
  }
  if (music === voice) music = null;
}

async function play(name, settings, loop = false) {
  name = aliases[name] || name;
  const event = events[name];
  loop = loop || !!event?.loop;
  if (loop ? !settings.music : !settings.sound) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  if (event?.cooldown && now - (lastPlayed.get(name) ?? -Infinity) < event.cooldown - 1e-9) return;
  if (event?.max && [...voices].filter(voice => voice.name === name).length >= event.max) return;
  const row = event ? select(name, event) : [name, 0];
  const clip = clips[row[0]];
  if (!clip) return;
  const request = loop ? ++musicRequest : 0;
  const voice = { name, loop, audio: null, cancelled: false, volume: Math.min(1, Math.max(0, 10 ** (row[1] / 20) * (config.AudioConfig[name]?.Volume ?? 1))) };
  voices.add(voice);
  lastPlayed.set(name, now);
  try {
    await platform.ensurePackage(clip.package);
    if (voice.cancelled) return;
    if (loop ? !settings.music || request !== musicRequest : !settings.sound) { finish(voice); return; }
    if (loop) disposeMusic();
    const audio = platform.isWechat ? wx.createInnerAudioContext() : new Audio();
    voice.audio = audio;
    audio.src = clip.path;
    audio.loop = loop;
    // 两个平台的 volume 属性上限为 1；正分贝增益仍受此平台上限约束。
    audio.volume = !loop && soundMuted ? 0 : voice.volume;
    if (loop) music = voice;
    const done = () => finish(voice);
    if (platform.isWechat) { audio.onEnded(done); audio.onError(done); }
    else { audio.addEventListener?.('ended', done); audio.addEventListener?.('error', done); }
    const result = audio.play();
    if (result && result.catch) result.catch(() => { if (!loop) done(); });
  } catch (error) { finish(voice); throw error; }
}

function disposeMusic() { if (music) finish(music, true); }
function stopMusic() { musicRequest++; for (const voice of voices) if (voice.loop) finish(voice, true); }
function stopSound(name) { name = aliases[name] || name; for (const voice of voices) if (voice.name === name) finish(voice, true); }
function setSoundMuted(muted) { soundMuted = muted; for (const voice of voices) if (!voice.loop && voice.audio) voice.audio.volume = muted ? 0 : voice.volume; }
function resumeMusic(settings) { if (music?.audio && settings.music && !platform.isWechat) { const result = music.audio.play(); if (result?.catch) result.catch(() => {}); } }
module.exports = { play, stopMusic, resumeMusic, stopSound, setSoundMuted };
