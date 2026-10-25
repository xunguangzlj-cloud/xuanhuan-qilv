'use strict';

// 有限拉杆接入：只用已证原始框架与Rigidbody位置平移，旋转路径未验证时整次回退。
const API = require('./native-query-adapter-v2.js');
const F = Math.fround;
function createNativePull(level, nativeLevel, ringPhysics) {
  if (!nativeLevel || nativeLevel.sourceKey !== level.sourceKey || typeof nativeLevel.get !== 'function') throw new Error('缺少每关精确原生物理数据');
  const compiled = new Map();
  function current(collider) {
    const precise = ringPhysics && ringPhysics.current(collider); if (precise) return precise;
    if (ringPhysics && collider.part && collider.part.kind === 'ring' && !ringPhysics.isInitial(collider.part)) return null;
    let value = compiled.get(collider.id);
    if (!value) {
      const record = nativeLevel.get(collider.id, collider.g);
      value = { record, prepared: API.prepareCollider(record) }; compiled.set(collider.id, value);
    }
    const part = collider.part, initial = part?.initialMatrix;
    if (part && part.rotationDeg !== part.initialRotation) return null;
    if (value.record.hasAttachedRigidbody) {
      if (!part) throw new Error('原附着刚体未精确映射运行部件');
      const frame = value.record.bodyPhysicsFrame.slice();
      frame[2] = F(frame[2] + F(part.x - initial[2])); frame[5] = F(frame[5] + F(part.y - initial[5]));
      API.setBodyFrame(value.prepared, frame);
    } else if (part && (part.x !== initial[2] || part.y !== initial[5])) return null;
    return value.prepared;
  }
  function query(body, targets, direction, maximum) {
    const first = current(body), others = targets.map(collider => ({ collider, prepared: current(collider) }));
    if (!first || others.some(x => !x.prepared)) return { status: '未验证', reason: '对手或自身已有尚未验证的旋转/静态位移' };
    let hit = null, selected = null, equalFirst = false;
    for (const { collider, prepared } of others) {
      const result = API.queryPrepared(first, prepared, direction.map(F), F(maximum), { useTriggers: false, triggerB: collider.trigger, layerMask: 128, layerB: collider.layer });
      if (result.status !== '候选已计算' || result.cast.status !== '候选已计算' || result.distanceAB.distance === null || result.tryEscapeGate === null) return { status: '未验证', reason: '存在未验证的原生查询字段' };
      if (result.cast.distance !== null && (!hit || result.cast.distance < hit.distance)) { hit = { collider, distance: result.cast.distance }; selected = result; equalFirst = false; }
      else if (result.cast.distance !== null && hit && result.cast.distance === hit.distance) equalFirst = true;
    }
    if (equalFirst) return { status: '未验证', reason: '多个不同Collider并列最小Cast距离，原首命中排序尚未验证' };
    if (selected && hit.distance <= F(.01) && Math.abs(selected.distanceAB.distance) <= 1e-5) return { status: '未验证', reason: '近零距离法线仍未验证，整次拉杆查询回退' };
    const overlap = selected && selected.distanceAB.distance < 0 && hit.distance <= F(.01) ? { depth: -selected.distanceAB.distance, movingOut: selected.tryEscapeGate } : null;
    return { status: '已计算', hit, overlap };
  }
  return { query };
}
module.exports = { createNativePull };
