'use strict';

// 纯CommonJS查询候选：仅需同目录发布源码；没有Node、DOM或微信平台依赖。
const P = require('./planck-body-frame-f32.js');
const WORLD_CAST = require('./toi-f32-v2.js');
const f32 = Math.fround;
// 凸片几何在刚体移动期间不变；只复用只读代理，不复用GJK的冷缓存或计算结果。
const proxies = new WeakMap();
function distanceProxy(shape) {
  let proxy = proxies.get(shape);
  if (!proxy) { proxy = new P.DistanceProxy(); proxy.set(shape, 0); proxies.set(shape, proxy); }
  return proxy;
}
const GJK_F32 = require('./gjk-f32.js');
let compiledDistance = null, compiledCandidates = null;
function installCompiledGjk(distance, candidates) { compiledDistance = distance; compiledCandidates = candidates; }
const PHYSICAL_BASIS = require('./physics-basis-v2.js');
const COLLIDE_POLYGON_CIRCLE_F32 = require('./collide-polygon-circle-f32.js');
const WORLD_F32 = require('./world-manifold-f32.js');
const point = value => [value.x, value.y];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('缺少有效数值：' + label);
  return value;
}

function frameFromMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('缺少原生GetShapes框架');
  if (matrix[0] !== matrix[5] || matrix[1] !== -matrix[4] || matrix[2] !== 0 || matrix[6] !== 0 || matrix[8] !== 0 || matrix[9] !== 0 || matrix[10] !== 1 || matrix[11] !== 0 || matrix[12] !== 0 || matrix[13] !== 0 || matrix[14] !== 0 || matrix[15] !== 1) throw new Error('尚未支持非2D刚体框架，拒绝回退世界预变换');
  const xf = P.Transform.identity();
  xf.p.set(matrix[3], matrix[7]); xf.q.c = matrix[0]; xf.q.s = matrix[4];
  return xf;
}

function makeShape(primitive, matrix) {
  const xf = frameFromMatrix(matrix);
  if (!primitive || !Array.isArray(primitive.localVertices)) throw new Error('缺少原生凸片顶点');
  const vertices = primitive.localVertices.map(v => P.Vec2(finite(v.x, 'x'), finite(v.y, 'y')));
  if (finite(primitive.radius, 'radius') < 0) throw new Error('凸片半径不能为负');
  let shape;
  if (primitive.type === 'Circle' && vertices.length === 1) {
    shape = P.Circle(vertices[0], finite(primitive.radius, 'radius'));
  } else if (primitive.type === 'Polygon' && vertices.length >= 3 && vertices.length <= 8) {
    // 保持上游公开默认polygonRadius=0.01；这不是GetShapes导出radius=0的同义字段。
    shape = P.Polygon(vertices);
    // 独立诊断：仅用候选自身顶点按上游float32边与Normalize顺序重算法线。
    // 不读原生normal；GJK、流形、TOI及门控其余计算仍为原double-v1。
    for (let i = 0; i < shape.m_count; i++) {
      const p = shape.m_vertices[i], q = shape.m_vertices[(i + 1) % shape.m_count];
      const dx = f32(f32(q.x) - f32(p.x)), dy = f32(f32(q.y) - f32(p.y));
      const squared = f32(f32(dx * dx) + f32(dy * dy));
      const length = f32(Math.sqrt(squared));
      // 已接受的凸包边通过上游焊接；无有效长度则拒绝，绝不添阈值挑法线。
      if (!(length > 0) || !Number.isFinite(length)) throw new Error('F32法线边长度无效');
      const inverse = f32(1 / length);
      shape.m_normals[i].set(f32(dy * inverse), f32(-dx * inverse));
    }
  } else {
    throw new Error('尚未支持的原生凸片：' + primitive.type + '/' + vertices.length);
  }
  const proxy = new P.DistanceProxy(); proxy.set(shape, 0);
  if (proxy.getVertexCount() !== vertices.length || Array.from({ length: proxy.getVertexCount() }, (_, i) => proxy.getVertex(i)).some((v, i) => vertices[i].x !== v.x || vertices[i].y !== v.y)) {
    throw new Error('上游凸包焊接、重排或缺省形状改变了原生凸片，拒绝悄悄替代');
  }
  proxies.set(shape, proxy);
  const compiledCompatible = vertices.every(v => f32(v.x) === v.x && f32(v.y) === v.y);
  const compiledVertices = compiledCompatible ? new Float32Array(vertices.flatMap(v => [v.x,v.y])) : null;
  return { shape, type: primitive.type, radius: shape.getRadius(), xf, compiledCompatible, compiledVertices };
}

function primitiveDistance(a, b) {
  // 同版CalculateColliderDistance：两个半径先addss，核心距离不大于其和就走接触流形。
  const radii = f32(f32(a.radius) + f32(b.radius));
  const input = { transformA: a.xf, transformB: b.xf, proxyA: distanceProxy(a.shape), proxyB: distanceProxy(b.shape), useRadii: false };
  const core = new P.DistanceOutput();
  // 原生物理框架和顶点为F32；其他调用仍保留原JS计算语义。
  const compatible = compiledDistance && a.compiledCompatible && b.compiledCompatible &&
    [a.xf.q.c,a.xf.q.s,a.xf.p.x,a.xf.p.y,b.xf.q.c,b.xf.q.s,b.xf.p.x,b.xf.p.y].every(v => f32(v) === v);
  (compatible ? compiledDistance : GJK_F32.distance)(core, new P.SimplexCache(), input);
  // 原生GJK输出字段及comiss均为float；本阶段恢复cold-cache0的GJK核心F32路径。
  const branchCore = f32(core.distance);
  if (branchCore > radii && branchCore > 2 ** -23) {
    const distance = f32(branchCore - radii);
    const delta = { x: f32(f32(core.pointA.x) - f32(core.pointB.x)), y: f32(f32(core.pointA.y) - f32(core.pointB.y)) };
    const normal = point(WORLD_F32.normalize(delta));
    // 原正距路径比较/保存core作为bestKey，返回距离另外减radii。
    return { distance, normal, selectionKey: branchCore, coreIterations: core.iterations, coreStopped: core.stopped, simplexIndices: core.simplexIndices, method: 'GJK-F32-core-minus-radii' };
  }
  const manifold = new P.Manifold();
  const swapped = a.type === 'Circle' && b.type !== 'Circle';
  const [first, second] = swapped ? [b, a] : [a, b];
  if (a.type === 'Circle' && b.type === 'Circle') {
    // 同心法线的原生选择尚无独立证据，仍保留未知，不能借上游默认轴提高通过计数。
    if (branchCore === 0) return { distance: -radii, normal: null, method: 'coincident-circles-unverified-normal' };
    P.CollideCircles(manifold, a.shape, a.xf, b.shape, b.xf);
  } else if (a.type === 'Polygon' && b.type === 'Polygon') {
    P.CollidePolygons(manifold, a.shape, a.xf, b.shape, b.xf);
  } else {
    COLLIDE_POLYGON_CIRCLE_F32(manifold, first.shape, first.xf, second.shape, second.xf);
  }
  if (!manifold.pointCount) {
    // 原 CalculateColliderDistance 在接触点数为零时恢复 GJK 结果，减半径并用 witness 差向量。
    const normal = point(WORLD_F32.normalize({ x: f32(core.pointA.x - core.pointB.x), y: f32(core.pointA.y - core.pointB.y) }));
    const distance = f32(branchCore - radii);
    return { distance, normal, selectionKey: distance, method: 'native-no-manifold-GJK-fallback' };
  }
  const world = WORLD_F32.initialize(manifold, first.xf, first.radius, second.xf, second.radius);
  let normal = point(world.normal);
  if (swapped) normal = normal.map(v => -v);
  const separations = world.separations.slice(0, manifold.pointCount);
  // 原单点直接取separation；双点addss后mulss(.5)，没有近似倒数。
  const distance = separations.length === 1 ? separations[0] : f32(f32(separations[0] + separations[1]) * .5);
  if (distance > 0) normal = normal.map(v => -v);
  return { distance, normal, selectionKey: distance, method: 'world-manifold-F32-mean-separation', manifoldType: manifold.type, contactNormalIndex: manifold.sourceNormalIndex, separations };
}

function shapeDistance(first, second) {
  let best = null, unresolved = false;
  const key = row => row.selectionKey === undefined ? row.distance : row.selectionKey;
  // 保留全部凸片的原有遍历及严格更小比较，仅取消整张临时配对结果数组。
  const indices = compiledCandidates ? compiledCandidates(first, second) : null;
  const visit = (a, b, i, j) => {
    const row = primitiveDistance(a, b);
    if (row.distance === null || !Number.isFinite(row.distance)) unresolved = true;
    if (!best || key(row) < key(best)) best = { ...row, pair: [i, j] };
  };
  if (indices) for (const index of indices) {
    const i = Math.floor(index / second.length), j = index % second.length;
    visit(first[i], second[j], i, j);
  } else first.forEach((a, i) => second.forEach((b, j) => visit(a,b,i,j)));
  if (!best || unresolved) return { distance: null, normal: null, method: 'unresolved-primitive-pair' };
  return best;
}

function query(colliderA, colliderB, direction, maximum, filter = {}) {
  colliderA = PHYSICAL_BASIS.normalizeCollider(colliderA); colliderB = PHYSICAL_BASIS.normalizeCollider(colliderB);
  const primitivesA = colliderA && colliderA.primitives, primitivesB = colliderB && colliderB.primitives;
  if (!Array.isArray(primitivesA) || !Array.isArray(primitivesB)) throw new Error('缺少原生凸片数组');
  if (!Array.isArray(direction) || direction.length !== 2) throw new Error('缺少二维查询方向');
  for (const key of ['useTriggers', 'triggerB']) if (filter[key] !== undefined && typeof filter[key] !== 'boolean') throw new Error('过滤开关类型不符');
  if (filter.layerB !== undefined && (!Number.isInteger(filter.layerB) || filter.layerB < 0 || filter.layerB > 31)) throw new Error('过滤层必须是0至31整数');
  if (filter.layerMask !== undefined && (!Number.isInteger(filter.layerMask) || filter.layerMask < -2147483648 || filter.layerMask > 4294967295)) throw new Error('过滤掩码超出32位');
  if (!primitivesA.length || !primitivesB.length) {
    return { status: '未验证', reason: '原生空shape，未构造替代几何' };
  }
  finite(direction[0], 'direction.x'); finite(direction[1], 'direction.y'); finite(maximum, 'maximum');
  if (maximum < 0) throw new Error('最大位移不能为负');
  const first = primitivesA.map(p => makeShape(p, colliderA.actualPhysicsFrameMatrix)), second = primitivesB.map(p => makeShape(p, colliderB.actualPhysicsFrameMatrix));
  const distanceAB = shapeDistance(first, second), distanceBA = shapeDistance(second, first);
  const allowed = (filter.useTriggers === true || !filter.triggerB) && ((filter.layerMask === undefined ? 128 : filter.layerMask) & (1 << (filter.layerB === undefined ? 7 : filter.layerB))) !== 0;
  const cast = allowed ? WORLD_CAST.shapeCast(first, second, direction, maximum) : { status: '候选已计算', distance: null, first: null };
  let gate = null, directionDot = null;
  if (cast.status !== '未验证' && distanceAB.normal && distanceAB.distance !== null) {
    // 仅Windows Editor托管表达式对照：乘加中间值为double，存float时舍入；不推广到Android ABI。
    directionDot = f32(direction[0] * distanceAB.normal[0] + direction[1] * distanceAB.normal[1]);
    gate = cast.distance !== null && cast.distance <= f32(.01) && distanceAB.distance < 0 && directionDot < 0;
  }
  return { status: '候选已计算', distanceAB, distanceBA, cast, tryEscapeGate: gate, directionDot };
}

module.exports = { installCompiledGjk, query, makeShape, primitiveDistance, shapeDistance, frameFromMatrix };
