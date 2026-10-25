'use strict';
const data = require('../assets/settlement/presentation-data');
const { sampleCurve } = require('./win-presentation');
const { sampleCharacter } = require('./character-animation');
const { timing } = require('./chest-settlement');
const clamp = value => Math.max(0, Math.min(1, value));

function sampleRewardNode(id, elapsed, closing = false) {
  const source = data[closing ? 'close' : 'open'][typeof id === 'object' ? id.id : id];
  if (!source) return null;
  const state = { visible: true, groupAlpha: 1, graphicAlpha: 1, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  for (const curve of source.curves) {
    const value = sampleCurve(curve.keys, Math.max(0, elapsed));
    if (curve.property === 'scaleX') state.scaleX = value / curve.base;
    else if (curve.property === 'scaleY') state.scaleY = value / curve.base;
    else if (curve.property === 'm_AnchoredPosition.y') state.offsetY = curve.base - value;
    else if (curve.property === 'm_Alpha') state.groupAlpha = value;
    else if (curve.property === 'm_Color.a' || curve.property === 'm_fontColor.a') state.graphicAlpha = value;
    else if (curve.property === 'm_IsActive') state.visible = value >= .5;
  }
  return state;
}

function sampleBoxMotion(start, end, rewardAge) {
  const mix = clamp(rewardAge / timing.boxFly);
  return { x: start.x + (end.x - start.x) * mix, y: start.y + (end.y - start.y) * mix, alpha: mix };
}

function samplePropMotion(start, end, elapsed, index = 0, returning = false) {
  const age = elapsed - index * timing.propStagger;
  const mix = clamp(age / timing.propFly), curves = data.paths[returning ? 'back' : 'fly'];
  const x = sampleCurve(curves.X, mix), y = sampleCurve(curves.Y, mix);
  return { x: start.x + (end.x - start.x) * x, y: start.y + (end.y - start.y) * y, visible: age >= 0 && (!returning || age < timing.propFly) };
}

function sampleRewardItemNode(path, elapsed, closing = false) {
  const state = { groupAlpha: 1, scaleX: 1, scaleY: 1 };
  for (const curve of data.item[closing ? 'disappear' : 'appear']) {
    if (curve.path !== path) continue;
    const value = sampleCurve(curve.keys, Math.max(0, elapsed));
    if (curve.property === 'm_Alpha') state.groupAlpha = value;
    else if (curve.property === 'scaleX') state.scaleX = value;
    else if (curve.property === 'scaleY') state.scaleY = value;
  }
  return state;
}

function sampleChestPose(rewardData, rewardAge) {
  return sampleCharacter(rewardData.characters.chest, '01', rewardAge);
}

module.exports = { sampleRewardNode, sampleBoxMotion, samplePropMotion, sampleRewardItemNode, sampleChestPose, rewardMount: data.mount };
