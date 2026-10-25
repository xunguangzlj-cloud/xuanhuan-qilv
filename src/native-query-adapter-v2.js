'use strict';

// RRH1 解码记录到查询候选的最小桥接；这里只准备接口，尚未批准接入游戏。
const QUERY = require('./query-gjk-toi-f32-v2.js');
const TOI = require('./toi-f32-v2.js');
const F = Math.fround;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function frameMatrix(values) {
  if (!Array.isArray(values) || values.length !== 6 || !values.every(v => Number.isFinite(v) && F(v) === v)) throw new Error('需要原F32物理框架');
  const [c, ns, x, s, c2, y] = values;
  if (c !== c2 || s !== -ns || c === 0 && s === 0) throw new Error('需要实际二维刚体基');
  return [c, ns, 0, x, s, c2, 0, y, 0, 0, 1, 0, 0, 0, 0, 1];
}
function prepareCollider(record) {
  if (!record || !Array.isArray(record.primitives) || typeof record.hasAttachedRigidbody !== 'boolean') throw new Error('需要RRH1解码记录');
  let matrix;
  if (record.hasAttachedRigidbody) {
    if (record.physicalFrameStatus !== 'AttachedRigidbody') throw new Error('刚体分类不符');
    matrix = frameMatrix(record.bodyPhysicsFrame);
  } else {
    if (record.physicalFrameStatus !== 'NoAttachedRigidbody' || record.bodyPhysicsFrame !== null || !Array.isArray(record.groupLocalToWorld) || record.groupLocalToWorld.length !== 16 || record.groupLocalToWorld.some((v, i) => v !== identity[i])) throw new Error('无刚体记录必须是显式单位框架');
    matrix = identity;
  }
  const pieces = record.primitives.map(p => QUERY.makeShape({ ...p, localVertices: p.localVertices.map(v => ({ x: v[0], y: v[1] })) }, matrix));
  return { pieces, hasAttachedRigidbody: record.hasAttachedRigidbody };
}
function setBodyFrame(prepared, values) {
  if (!prepared.hasAttachedRigidbody) throw new Error('不能给无刚体记录补造移动物理框架');
  const matrix = frameMatrix(values);
  for (const piece of prepared.pieces) { piece.xf.p.set(matrix[3], matrix[7]); piece.xf.q.c = matrix[0]; piece.xf.q.s = matrix[4]; }
}
function queryPrepared(a, b, direction, maximum, filter = {}) {
  if (!a || !b || !Array.isArray(a.pieces) || !Array.isArray(b.pieces)) throw new Error('需要已编译查询形状');
  if (!Array.isArray(direction) || direction.length !== 2 || !direction.every(Number.isFinite) || !Number.isFinite(maximum) || maximum < 0) throw new Error('查询方向或距离无效');
  if (!a.pieces.length || !b.pieces.length) return { status: '未验证', reason: '原生空shape，未构造替代几何' };
  const distanceAB = QUERY.shapeDistance(a.pieces, b.pieces), distanceBA = QUERY.shapeDistance(b.pieces, a.pieces);
  const allowed = (filter.useTriggers === true || !filter.triggerB) && ((filter.layerMask === undefined ? 128 : filter.layerMask) & (1 << (filter.layerB === undefined ? 7 : filter.layerB))) !== 0;
  const cast = allowed ? TOI.shapeCast(a.pieces, b.pieces, direction, maximum) : { status: '候选已计算', distance: null, first: null };
  let gate = null, directionDot = null;
  if (cast.status !== '未验证' && distanceAB.normal && distanceAB.distance !== null) {
    directionDot = F(direction[0] * distanceAB.normal[0] + direction[1] * distanceAB.normal[1]);
    gate = cast.distance !== null && cast.distance <= F(.01) && distanceAB.distance < 0 && directionDot < 0;
  }
  return { status: '候选已计算', distanceAB, distanceBA, cast, tryEscapeGate: gate, directionDot };
}
module.exports = { prepareCollider, setBodyFrame, queryPrepared };
