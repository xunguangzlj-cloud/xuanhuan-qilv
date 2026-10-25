'use strict';
const { prepareCharacter, sampleCharacter, createCharacterRenderer } = require('./character-animation');

// 原HomeActivityEntryHost按左右组、Order排序，只在一段完成后等待2秒。
function createHomeEntryPlayer(data) {
  if (!data.homeEntries) throw new Error('缺少主页活动图标原骨骼');
  const source = data.homeEntries;
  const entries = [...source.entries].sort((a, b) => a.slot - b.slot || a.order - b.order);
  for (const model of Object.values(source.characters)) prepareCharacter(model);
  let running = false, nextFrame = false, index = 0, current = null, age = 0, wait = 0;
  let visible = {};
  const poses = {};
  function clear() {
    current = null; age = 0; wait = 0; index = 0;
    for (const entry of entries) poses[entry.key] = { animation: 'setup', time: 0 };
  }
  function findNext() {
    for (let offset = 0; offset < entries.length; offset++) {
      const selected = (index + offset) % entries.length, entry = entries[selected];
      // 原代码先StopOther再Try；隐藏候选失败也会清除另一图标的旧track。
      for (const other of entries) if (other !== entry) poses[other.key] = { animation: 'setup', time: 0 };
      if (!visible[entry.key]) continue;
      current = entry; age = 0; wait = 0; index = (selected + 1) % entries.length;
      poses[entry.key] = { animation: entry.animation, time: 0 };
      return;
    }
    for (const entry of entries) poses[entry.key] = { animation: 'setup', time: 0 };
    current = null; wait = 2;
  }
  clear();
  return {
    update(delta, state) {
      visible = state;
      if (!state.active) { running = false; nextFrame = false; clear(); return; }
      if (!running) { running = true; nextFrame = true; return; }
      if (nextFrame) { nextFrame = false; findNext(); return; }
      let remaining = Math.max(0, delta);
      while (remaining > 0) {
        if (current) {
          const duration = source.characters[current.key].animations[current.animation].duration;
          const step = Math.min(remaining, Math.max(0, duration - age));
          age += step; remaining -= step;
          poses[current.key].time = age;
          if (age < duration) break;
          // 原Complete回调冻结在末帧，直到下一次播放其他图标才还原setup。
          current = null; wait = 2;
        } else {
          const step = Math.min(remaining, wait); wait -= step; remaining -= step;
          if (wait > 1e-10) break;
          findNext();
        }
      }
    },
    reset() { running = false; nextFrame = false; clear(); },
    pose(key) {
      if (!visible[key]) return null;
      const value = poses[key];
      return value ? sampleCharacter(source.characters[key], value.animation, value.time) : null;
    },
    get state() { return { running, nextFrame, index, playing: current?.key || null, age, wait, poses: JSON.parse(JSON.stringify(poses)) }; },
  };
}

function homeEntryAnchor(entry, area) {
  const transform = entry.transform, lo = transform.m_AnchorMin, hi = transform.m_AnchorMax, pivot = transform.m_Pivot;
  const position = transform.m_AnchoredPosition, local = transform.m_LocalScale;
  const sx = area.sx || 1, sy = area.sy || 1;
  return {
    x: area.x + area.w * (lo.x + (hi.x - lo.x) * pivot.x) + position.x * sx,
    y: area.y + area.h * (1 - lo.y - (hi.y - lo.y) * pivot.y) - position.y * sy,
    scale: entry.scale * sx * local.x,
  };
}

async function createHomeEntryRenderer({ data, createCanvas, loadImage, width, height, ratio = 1 }) {
  const source = data.homeEntries, renderers = {};
  // 微信主2D画布可能延后读取drawImage源，每个入口保留独立离屏内容。
  for (const entry of source.entries) renderers[entry.key] = await createCharacterRenderer({ canvas: createCanvas(), loadImage, data: source, character: entry.key, width, height, ratio, cropToPose: true });
  return {
    available: Object.values(renderers).every(Boolean),
    draw(ctx, key, pose, area, coordinateScale) {
      const entry = source.entries.find(entry => entry.key === key), renderer = renderers[key];
      if (entry && pose && renderer) return renderer.draw(ctx, pose, { ...homeEntryAnchor(entry, area), coordinateScale });
      return false;
    },
    resize(view) { for (const renderer of Object.values(renderers)) if (renderer) renderer.resize(view); },
  };
}

module.exports = { createHomeEntryPlayer, createHomeEntryRenderer, homeEntryAnchor };
