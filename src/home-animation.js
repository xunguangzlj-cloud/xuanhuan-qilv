'use strict';
const { prepareCharacter, sampleCharacter } = require('./character-animation');
const { sampleCurve } = require('./win-presentation');

function applyCurves(state, node, time) {
  if (!node) return;
  for (const curve of node.curves) {
    const value = sampleCurve(curve.keys, time);
    if (curve.property === 'scaleX') state.scaleX = value / curve.base;
    else if (curve.property === 'scaleY') state.scaleY = value / curve.base;
    else if (curve.property === 'm_AnchoredPosition.x') state.offsetX = value - curve.base;
    else if (curve.property === 'm_AnchoredPosition.y') state.offsetY = curve.base - value;
    else if (curve.property === 'm_Alpha') state.groupAlpha = value;
    else if (curve.property === 'm_Color.a') state.graphicAlpha = value;
  }
}

// 原Clip中失效的旧路径已在离线构建时排除，禁止改挂到名称相似的新节点。
function sampleHomeNode(presentation, id, elapsed, closeElapsed = null) {
  id = typeof id === 'object' ? id.id : id;
  const clip = presentation.clips[closeElapsed == null ? 'open' : 'close'];
  const node = clip.nodes[id], button = closeElapsed == null && presentation.clips.button.nodes[id];
  if (!node && !button) return null;
  const state = { visible: true, groupAlpha: 1, graphicAlpha: 1, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  // 两个原Animation都在注册时启动；入场阶段优先保留Home的同属性曲线，随后每5秒重播按钮脉冲。
  if (button) applyCurves(state, button, elapsed % presentation.buttonIdleInterval);
  if (node && (closeElapsed != null || elapsed <= clip.duration)) applyCurves(state, node, closeElapsed == null ? elapsed : closeElapsed);
  return state;
}

function createHomePlayer(data) {
  const model = data.characters.home, presentation = data.presentation;
  if (!model || !presentation) throw new Error('缺少主页原骨骼或原AnimationClip数据');
  prepareCharacter(model);
  let elapsed = 0, paused = false, closeElapsed = null;
  return {
    model, presentation,
    update(delta) {
      if (paused) return;
      delta = Math.max(0, delta); elapsed += delta;
      if (closeElapsed != null) closeElapsed += delta;
    },
    pause(value = true) { paused = value; },
    reset() { elapsed = 0; closeElapsed = null; },
    close() { if (closeElapsed == null) closeElapsed = 0; },
    pose() {
      const open = model.animations.open.duration;
      if (elapsed < open) return sampleCharacter(model, 'open', elapsed);
      const idleTime = elapsed - open;
      if (idleTime < model.animations.idleFirst.duration) return sampleCharacter(model, 'idleFirst', idleTime);
      return sampleCharacter(model, 'idle', idleTime % model.animations.idle.duration);
    },
    nodePose(id) { return sampleHomeNode(presentation, id, elapsed, closeElapsed); },
    anchor(area) {
      return { x: area.x + area.w / 2 + presentation.logoOffset[0] * (area.sx || 1), y: area.y + area.h / 2 - presentation.logoOffset[1] * (area.sy || 1), scale: presentation.logoScale * (area.sx || 1), alpha: closeElapsed == null ? 1 : Math.max(0, 1 - closeElapsed / presentation.logoFadeDuration) };
    },
    get elapsed() { return elapsed; },
    get closing() { return closeElapsed != null; },
    get closed() { return closeElapsed != null && closeElapsed >= presentation.clips.close.duration; },
  };
}

module.exports = { createHomePlayer, sampleHomeNode };
