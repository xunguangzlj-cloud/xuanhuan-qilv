'use strict';

// 已匹配同版PolygonAndCircle与Evaluate(false)的局部F32恢复，不改发布vendor。
const F = Math.fround;
const add = (a, b) => F(F(a) + F(b));
const sub = (a, b) => F(F(a) - F(b));
const mul = (a, b) => F(F(a) * F(b));
const dot = (a, b) => add(mul(a.y, b.y), mul(a.x, b.x));
const diff = (a, b) => ({ x: sub(a.x, b.x), y: sub(a.y, b.y) });
const midpoint = (a, b) => ({ x: mul(add(a.x, b.x), .5), y: mul(add(a.y, b.y), .5) });
const normalize = require('./world-manifold-f32.js').normalize;

module.exports = function collide(manifold, polygon, xfA, circle, xfB) {
  manifold.pointCount = 0;
  const p = circle.m_p;
  const world = { x: add(sub(mul(xfB.q.c, p.x), mul(xfB.q.s, p.y)), xfB.p.x), y: add(add(mul(xfB.q.c, p.y), mul(xfB.q.s, p.x)), xfB.p.y) };
  const delta = diff(world, xfA.p);
  const local = { x: add(mul(xfA.q.c, delta.x), mul(xfA.q.s, delta.y)), y: sub(mul(xfA.q.c, delta.y), mul(xfA.q.s, delta.x)) };
  let normalIndex = 0, separation = -3.4028234663852886e38;
  const radius = add(polygon.m_radius, circle.m_radius);
  for (let i = 0; i < polygon.m_count; i++) {
    const current = dot(diff(local, polygon.m_vertices[i]), polygon.m_normals[i]);
    if (current > radius) return;
    // 原生strict>；平局保留首边，绝不以case或原生期望选择。
    if (current > separation) { separation = current; normalIndex = i; }
  }
  const v1 = polygon.m_vertices[normalIndex], v2 = polygon.m_vertices[(normalIndex + 1) % polygon.m_count];
  let localNormal = polygon.m_normals[normalIndex], localPoint;
  if (separation < 2 ** -23) {
    localPoint = midpoint(v1, v2);
  } else {
    const u1 = dot(diff(local, v1), diff(v2, v1));
    const u2 = dot(diff(local, v2), diff(v1, v2));
    if (u1 <= 0) {
      const d = diff(local, v1);
      if (dot(d, d) > mul(radius, radius)) return;
      localNormal = normalize(d); localPoint = v1;
    } else if (u2 <= 0) {
      const d = diff(local, v2);
      if (dot(d, d) > mul(radius, radius)) return;
      localNormal = normalize(d); localPoint = v2;
    } else {
      localPoint = midpoint(v1, v2);
      if (dot(diff(local, localPoint), localNormal) > radius) return;
    }
  }
  manifold.pointCount = 1; manifold.type = 1;
  manifold.localNormal.x = localNormal.x; manifold.localNormal.y = localNormal.y;
  manifold.localPoint.x = localPoint.x; manifold.localPoint.y = localPoint.y;
  manifold.points[0].localPoint.x = F(p.x); manifold.points[0].localPoint.y = F(p.y);
  manifold.points[0].id.setFeatures(0, 0, 0, 0);
  manifold.sourceNormalIndex = normalIndex;
};
