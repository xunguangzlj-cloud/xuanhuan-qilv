'use strict';

// 只解码采集器直接记录的int32位；不从原生distance/normal回填任何输入。
const storage = new DataView(new ArrayBuffer(4));
function decode(value) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('缺少有效int32原生位');
  storage.setInt32(0, value, true);
  const result = storage.getFloat32(0, true);
  if (!Number.isFinite(result)) throw new Error('原生位不是有效有限float32');
  return result;
}
function floatArray(values, bits, length, label) {
  if (!Array.isArray(values) || !Array.isArray(bits) || values.length !== length || bits.length !== length) throw new Error('缺少F32原生位数组：' + label);
  return bits.map((value, i) => {
    const native = decode(value);
    // JSON只可能丢零符号，非零十进制必须精确回到相同float32。
    if (typeof values[i] !== 'number' || !Number.isFinite(values[i]) || Math.fround(values[i]) !== native) throw new Error('十进制与原生位不匹配：' + label);
    return native;
  });
}
function vectorList(values, bits, label) {
  if (!Array.isArray(values)) throw new Error('缺少顶点数组：' + label);
  const decoded = floatArray(values.flatMap(v => [v.x, v.y]), bits, values.length * 2, label);
  return values.map((_, i) => ({ x: decoded[2 * i], y: decoded[2 * i + 1] }));
}

function normalizeCollider(collider) {
  if (!collider || !Array.isArray(collider.primitives) || typeof collider.hasAttachedRigidbody !== 'boolean') throw new Error('缺少physics-basis-v2几何记录');
  const group = floatArray(collider.primitiveLocalToWorld, collider.groupMatrixBits, 16, 'groupMatrix');
  const b = collider.boundsCenter, s = collider.boundsSize;
  if (!b || !s) throw new Error('缺少bounds');
  floatArray([b.x, b.y, b.z, s.x, s.y, s.z], collider.boundsBits, 6, 'bounds');
  const probes = ['actualPhysicalBasisX', 'actualPhysicalBasisY', 'actualPhysicalOrigin', 'attachedBodyPosition', 'attachedBodyRotation'];
  let frame;
  if (collider.hasAttachedRigidbody) {
    if (collider.physicalFrameStatus !== 'AttachedRigidbody') throw new Error('刚体基分类不一致');
    const read = (name, length) => floatArray(collider[name], collider[name + 'Bits'], length, name);
    const x = read(probes[0], 2), y = read(probes[1], 2), origin = read(probes[2], 2), position = read(probes[3], 2);
    read(probes[4], 1);
    if (x[0] !== y[1] || x[1] !== -y[0] || x[0] === 0 && x[1] === 0) throw new Error('物理单位基不是2D旋转形式');
    if (origin[0] !== position[0] || origin[1] !== position[1]) throw new Error('物理原点与刚体位置不一致');
    frame = [x[0], -x[1], 0, position[0], x[1], x[0], 0, position[1], 0, 0, 1, 0, 0, 0, 0, 1];
  } else {
    if (collider.physicalFrameStatus !== 'NoAttachedRigidbody' || probes.some(name => collider[name] !== null || collider[name + 'Bits'] !== null)) throw new Error('无刚体必须显式null物理探针');
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (group.some((v, i) => v !== identity[i])) throw new Error('无刚体但局部框架非单位，拒绝推测物理基');
    frame = group;
  }
  const primitives = collider.primitives.map(p => {
    const radius = decode(p.radiusBits);
    if (typeof p.radius !== 'number' || Math.fround(p.radius) !== radius) throw new Error('半径十进制与位不一致');
    return { ...p, radius, localVertices: vectorList(p.localVertices, p.localVerticesBits, 'localVertices'), worldVertices: vectorList(p.worldVertices, p.worldVerticesBits, 'worldVertices') };
  });
  return { ...collider, primitives, actualPhysicsFrameMatrix: frame };
}

module.exports = { normalizeCollider, decode };
