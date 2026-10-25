'use strict';

// 对应同版b2WorldManifold::Initialize的局部数值模型；不读取原生期望法线。
const F = Math.fround;
const add = (a, b) => F(F(a) + F(b));
const sub = (a, b) => F(F(a) - F(b));
const mul = (a, b) => F(F(a) * F(b));
const dot = (a, b) => add(mul(a.y, b.y), mul(a.x, b.x));
const diff = (a, b) => ({ x: sub(a.x, b.x), y: sub(a.y, b.y) });
const offset = (p, n, amount, subtract = false) => ({ x: subtract ? sub(p.x, mul(amount, n.x)) : add(p.x, mul(amount, n.x)), y: subtract ? sub(p.y, mul(amount, n.y)) : add(p.y, mul(amount, n.y)) });
const rotate = (q, p) => ({ x: sub(mul(q.c, p.x), mul(q.s, p.y)), y: add(mul(q.c, p.y), mul(q.s, p.x)) });
function transform(xf, p) {
  const rotated = rotate(xf.q, p);
  return { x: add(rotated.x, xf.p.x), y: add(rotated.y, xf.p.y) };
}

function normalize(delta) {
  const length = F(Math.sqrt(add(mul(delta.y, delta.y), mul(delta.x, delta.x))));
  // 原Normalize的eps>len时保留原差向量，并非强置零。
  if (2 ** -23 > length) return delta;
  const inverse = F(1 / length);
  return { x: mul(delta.x, inverse), y: mul(delta.y, inverse) };
}

function initialize(manifold, xfA, radiusA, xfB, radiusB) {
  if (!manifold || ![1, 2].includes(manifold.pointCount)) throw new Error('WorldManifold仅接受一或二个有效接触点');
  radiusA = F(radiusA); radiusB = F(radiusB);
  const points = [], separations = [];
  let normal;
  function append(cA, cB, reverse = false) {
    points.push({ x: mul(add(cA.x, cB.x), .5), y: mul(add(cA.y, cB.y), .5) });
    separations.push(dot(reverse ? diff(cA, cB) : diff(cB, cA), normal));
  }
  if (manifold.type === 0) {
    const pointA = transform(xfA, manifold.localPoint), pointB = transform(xfB, manifold.points[0].localPoint);
    const delta = diff(pointB, pointA);
    normal = dot(delta, delta) > F((2 ** -23) ** 2) ? normalize(delta) : { x: 1, y: 0 };
    append(offset(pointA, normal, radiusA), offset(pointB, normal, radiusB, true));
  } else if (manifold.type === 1 || manifold.type === 2) {
    const faceA = manifold.type === 1;
    normal = rotate(faceA ? xfA.q : xfB.q, manifold.localNormal);
    const plane = transform(faceA ? xfA : xfB, manifold.localPoint);
    for (let i = 0; i < manifold.pointCount; i++) {
      const clip = transform(faceA ? xfB : xfA, manifold.points[i].localPoint);
      const projection = dot(diff(clip, plane), normal);
      if (faceA) append(offset(clip, normal, sub(radiusA, projection)), offset(clip, normal, radiusB, true));
      else append(offset(clip, normal, radiusA, true), offset(clip, normal, sub(radiusB, projection)), true);
    }
    if (!faceA) normal = { x: -normal.x, y: -normal.y };
  } else {
    throw new Error('未知WorldManifold类型');
  }
  return { normal, points, separations };
}

module.exports = { initialize, normalize };
