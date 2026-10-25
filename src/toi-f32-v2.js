'use strict';

// 依据同版 b2TimeOfImpact、SeparationFunction 与上游算法恢复平移查询路径。
// 本阶段仍需独立数值采样；Math.sin/cos/atan2 的正确舍入不视为原 CRT 的普遍证明。
const P = require('./planck-body-frame-f32.js');
const GJK = require('./gjk-f32-cache-v2.js');
const F = Math.fround;
const add = (a, b) => F(a + b), sub = (a, b) => F(a - b), mul = (a, b) => F(a * b), div = (a, b) => F(a / b);
const dot = (a, b) => add(mul(a.x, b.x), mul(a.y, b.y));
const diff = (a, b) => ({ x: sub(a.x, b.x), y: sub(a.y, b.y) });
const negative = a => ({ x: -a.x, y: -a.y });
const rotate = (q, p) => ({ x: sub(mul(q.c, p.x), mul(q.s, p.y)), y: add(mul(q.s, p.x), mul(q.c, p.y)) });
const inverseRotate = (q, p) => ({ x: add(mul(q.c, p.x), mul(q.s, p.y)), y: sub(mul(q.c, p.y), mul(q.s, p.x)) });
const transform = (xf, p) => { const q = rotate(xf.q, p); return { x: add(q.x, xf.p.x), y: add(q.y, xf.p.y) }; };
function normalize(v) {
  const length = F(Math.sqrt(dot(v, v)));
  if (length < 2 ** -23) return { ...v };
  const inverse = div(1, length);
  return { x: mul(v.x, inverse), y: mul(v.y, inverse) };
}
function support(proxy, d) {
  let index = 0, value = dot(proxy.getVertex(0), d);
  for (let i = 1; i < proxy.getVertexCount(); i++) { const next = dot(proxy.getVertex(i), d); if (next > value) { value = next; index = i; } }
  return index;
}
function sweep(xf, delta) {
  // 原 ColliderCast 用 atan2f(q.s,q.c) 重新构造不旋转的 sweep。
  const rawAngle = F(Math.atan2(xf.q.s, xf.q.c));
  const tau = F(2 * Math.PI);
  const angle = sub(rawAngle, mul(tau, Math.floor(div(rawAngle, tau))));
  return { start: { ...xf.p }, end: { x: add(xf.p.x, delta.x), y: add(xf.p.y, delta.y) }, angle };
}
function frame(s, t) {
  const complement = sub(1, t), angle = add(mul(complement, s.angle), mul(t, s.angle));
  return { p: { x: add(mul(complement, s.start.x), mul(t, s.end.x)), y: add(mul(complement, s.start.y), mul(t, s.end.y)) }, q: { s: F(Math.sin(angle)), c: F(Math.cos(angle)) } };
}
function separation(cache, proxyA, sweepA, proxyB, sweepB, t) {
  const xfA = frame(sweepA, t), xfB = frame(sweepB, t);
  let type, axis, localPoint;
  if (cache.count === 1) {
    type = 'points'; axis = normalize(diff(transform(xfB, proxyB.getVertex(cache.indexB[0])), transform(xfA, proxyA.getVertex(cache.indexA[0]))));
  } else if (cache.indexA[0] === cache.indexA[1]) {
    type = 'faceB';
    const p = proxyB.getVertex(cache.indexB[0]), q = proxyB.getVertex(cache.indexB[1]), d = diff(q, p);
    axis = normalize({ x: d.y, y: -d.x }); localPoint = { x: mul(.5, add(p.x, q.x)), y: mul(.5, add(p.y, q.y)) };
    const n = rotate(xfB.q, axis);
    if (dot(diff(transform(xfA, proxyA.getVertex(cache.indexA[0])), transform(xfB, localPoint)), n) < 0) axis = negative(axis);
  } else {
    type = 'faceA';
    const p = proxyA.getVertex(cache.indexA[0]), q = proxyA.getVertex(cache.indexA[1]), d = diff(q, p);
    axis = normalize({ x: d.y, y: -d.x }); localPoint = { x: mul(.5, add(p.x, q.x)), y: mul(.5, add(p.y, q.y)) };
    const n = rotate(xfA.q, axis);
    if (dot(diff(transform(xfB, proxyB.getVertex(cache.indexB[0])), transform(xfA, localPoint)), n) < 0) axis = negative(axis);
  }
  let indexA = -1, indexB = -1;
  function evaluate(t, find) {
    const a = frame(sweepA, t), b = frame(sweepB, t);
    if (type === 'points') {
      if (find) { indexA = support(proxyA, inverseRotate(a.q, axis)); indexB = support(proxyB, inverseRotate(b.q, negative(axis))); }
      return dot(diff(transform(b, proxyB.getVertex(indexB)), transform(a, proxyA.getVertex(indexA))), axis);
    }
    if (type === 'faceA') {
      const n = rotate(a.q, axis), point = transform(a, localPoint);
      if (find) indexB = support(proxyB, inverseRotate(b.q, negative(n)));
      return dot(diff(transform(b, proxyB.getVertex(indexB)), point), n);
    }
    const n = rotate(b.q, axis), point = transform(b, localPoint);
    if (find) indexA = support(proxyA, inverseRotate(a.q, negative(n)));
    return dot(diff(transform(a, proxyA.getVertex(indexA)), point), n);
  }
  return { evaluate: t => evaluate(t, false), find: t => evaluate(t, true) };
}
function timeOfImpact(a, b, translation) {
  const proxyA = new P.DistanceProxy(), proxyB = new P.DistanceProxy();
  proxyA.set(a.shape, 0); proxyB.set(b.shape, 0);
  const sweepA = sweep(a.xf, translation), sweepB = sweep(b.xf, { x: 0, y: 0 });
  const radius = add(proxyA.m_radius, proxyB.m_radius), slop = F(.005);
  const target = Math.max(slop, sub(radius, mul(3, slop))), tolerance = mul(.25, slop);
  const upper = add(target, tolerance), lower = sub(target, tolerance);
  let t1 = 0;
  const cache = new P.SimplexCache();
  for (let iter = 0; iter < 20; iter++) {
    const input = { proxyA, proxyB, transformA: frame(sweepA, t1), transformB: frame(sweepB, t1), useRadii: false };
    const output = { pointA: {}, pointB: {} };
    GJK.distance(output, cache, input);
    if (output.distance <= 0) return { state: 2, t: 0 };
    if (output.distance < upper) return { state: 3, t: t1 };
    const f = separation(cache, proxyA, sweepA, proxyB, sweepB, t1);
    let t2 = 1;
    for (let push = 0; push < 8; push++) {
      let s2 = f.find(t2);
      if (s2 > upper) return { state: 4, t: 1 };
      if (s2 > lower) { t1 = t2; break; }
      let s1 = f.evaluate(t1);
      if (s1 < lower) return { state: 1, t: t1 };
      if (s1 <= upper) return { state: 3, t: t1 };
      let a1 = t1, a2 = t2;
      for (let root = 0; root < 50; root++) {
        const t = root & 1 ? add(a1, div(mul(sub(target, s1), sub(a2, a1)), sub(s2, s1))) : mul(.5, add(a1, a2));
        const s = f.evaluate(t);
        if (Math.abs(sub(s, target)) < tolerance) { t2 = t; break; }
        if (s > target) { a1 = t; s1 = s; } else { a2 = t; s2 = s; }
      }
    }
  }
  return { state: 1, t: t1 };
}
function shapeCast(first, second, direction, maximum) {
  const length = F(Math.sqrt(add(mul(direction[0], direction[0]), mul(direction[1], direction[1]))));
  const inverse = length === 0 ? 0 : div(1, length);
  const translation = { x: mul(mul(direction[0], inverse), maximum), y: mul(mul(direction[1], inverse), maximum) };
  const hits = [], failures = [];
  first.forEach((a, i) => second.forEach((b, j) => {
    const result = timeOfImpact(a, b, translation), row = { pair: [i, j], state: result.state, fraction: result.t };
    if (result.state === 2 || result.state === 3) { row.distance = mul(result.t, maximum); hits.push(row); }
    else if (result.state !== 4) failures.push(row);
  }));
  if (failures.length) return { status: '未验证', reason: '单精度TOI失败或未知状态', failures };
  const firstHit = hits.length ? hits.reduce((best, row) => row.distance < best.distance ? row : best) : null;
  return { status: '候选已计算', distance: firstHit ? firstHit.distance : null, first: firstHit };
}
module.exports = { shapeCast, timeOfImpact };
