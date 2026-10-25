'use strict';
const data = require('../assets/characters/win-presentation-data');

// 原Unity AnimationCurve采用带权三次Bezier；未加权切线等价于Hermite插值。
function sampleCurve(keys, time) {
  if (time <= keys[0][0]) return keys[0][1];
  if (time >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  let low = 0, high = keys.length;
  while (low < high) { const mid = (low + high) >> 1; if (keys[mid][0] <= time) low = mid + 1; else high = mid; }
  const a = keys[low - 1], b = keys[low];
  if (a[7] || b[7]) return a[1];
  const span = b[0] - a[0], outWeight = a[6] & 2 ? a[5] : 1 / 3, inWeight = b[6] & 1 ? b[4] : 1 / 3;
  const x1 = outWeight, x2 = 1 - inWeight;
  const y1 = a[1] + a[3] * span * outWeight, y2 = b[1] - b[2] * span * inWeight;
  const target = (time - a[0]) / span;
  let left = 0, right = 1, mix = target;
  for (let index = 0; index < 36; index++) {
    mix = (left + right) / 2;
    const inverse = 1 - mix, x = 3 * inverse * inverse * mix * x1 + 3 * inverse * mix * mix * x2 + mix * mix * mix;
    if (x < target) left = mix; else right = mix;
  }
  const inverse = 1 - mix;
  return inverse * inverse * inverse * a[1] + 3 * inverse * inverse * mix * y1 + 3 * inverse * mix * mix * y2 + mix * mix * mix * b[1];
}

// 每项只描述当前节点；groupAlpha和变换应向子节点继承，graphicAlpha只影响本节点图文。
function sampleWinNode(id, elapsed) {
  const source = data.nodes[typeof id === 'object' ? id.id : id];
  if (!source) return null;
  const state = { visible: source.start == null || elapsed >= source.start, groupAlpha: 1, graphicAlpha: 1, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  for (const curve of source.curves) {
    const value = sampleCurve(curve.keys, Math.max(0, elapsed - curve.start));
    if (curve.property === 'scaleX') state.scaleX = value / curve.base;
    else if (curve.property === 'scaleY') state.scaleY = value / curve.base;
    else if (curve.property === 'm_AnchoredPosition.y') state.offsetY = curve.base - value;
    else if (curve.property === 'm_Alpha') state.groupAlpha = value;
    else if (curve.property === 'm_Color.a' || curve.property === 'm_fontColor.a') state.graphicAlpha = value;
    else if (curve.property === 'm_IsActive') state.visible = value >= 0.5;
  }
  return state;
}

function winNextEnabled(elapsed, chestLocked = false) { return elapsed >= data.nextReady && !chestLocked; }

module.exports = { sampleCurve, sampleWinNode, winNextEnabled, entranceSchedule: data.schedule };
