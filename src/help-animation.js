const clips = require('../assets/ui/help-animation-data');

// 按原Unity曲线的关键帧、切线和阶跃状态采样三页演示。
function sampleCurve(keys, age) {
  let index = 0;
  while (index + 1 < keys.length && keys[index + 1][0] <= age) index++;
  const a = keys[index], b = keys[index + 1];
  if (!b || age <= a[0] || a[3] == null || b[2] == null) return a[1];
  const duration = b[0] - a[0], t = (age - a[0]) / duration, t2 = t * t, t3 = t2 * t;
  return (2*t3 - 3*t2 + 1)*a[1] + (t3 - 2*t2 + t)*duration*a[3] + (-2*t3 + 3*t2)*b[1] + (t3 - t2)*duration*b[2];
}

function sampleHelpNode(node, nodes, page, elapsed) {
  const path = []; let current = node;
  while (current && !/^Content[123]$/.test(current.name)) { path.unshift(current.name); current = nodes[current.parent]; }
  if (!current || current.name !== 'Content' + page) return null;
  const clip = clips[page - 1], curves = clip.curves[path.join('/')];
  if (!curves) return null;
  const age = Math.max(0, elapsed) % clip.duration;
  const sample = (name, fallback) => curves[name] ? sampleCurve(curves[name], age) : fallback;
  const anchored = node.transform.m_AnchoredPosition || { x: 0, y: 0 };
  const pose = { visible: true, groupAlpha: 1, graphicAlpha: sample('m_Color.a', 1), offsetX: sample('m_AnchoredPosition.x', anchored.x) - anchored.x, offsetY: -(sample('m_AnchoredPosition.y', anchored.y) - anchored.y), scaleX: sample('scale.x', 1), scaleY: sample('scale.y', 1) };
  if (curves.m_IsActive) pose.active = sample('m_IsActive', node.active ? 1 : 0) >= .5;
  if (curves['rotation.z']) pose.rotation = { z: sample('rotation.z', 0), w: sample('rotation.w', 1) };
  return pose;
}
module.exports = { sampleCurve, sampleHelpNode };
