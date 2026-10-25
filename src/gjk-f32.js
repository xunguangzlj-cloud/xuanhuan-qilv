'use strict';

// 独立单精度移植：依据已匹配同版GJK/Solve3/GetWitnessPoints和上游Voronoi算法。
// 算法来源归属Erin Catto；Planck移植许可与原版权见vendor/LICENSE.txt，非未修改原版。
const F = Math.fround;
const add = (a, b) => F(a + b);
const sub = (a, b) => F(a - b);
const mul = (a, b) => F(a * b);
const dot = (a, b) => add(mul(a.x, b.x), mul(a.y, b.y));
const cross = (a, b) => sub(mul(a.x, b.y), mul(a.y, b.x));
const diff = (a, b) => ({ x: sub(a.x, b.x), y: sub(a.y, b.y) });
const neg = a => ({ x: -a.x, y: -a.y });
const length = a => F(Math.sqrt(dot(a, a)));
function transform(xf, p) {
  return { x: add(sub(mul(xf.q.c, p.x), mul(xf.q.s, p.y)), xf.p.x), y: add(add(mul(xf.q.s, p.x), mul(xf.q.c, p.y)), xf.p.y) };
}
function inverseRotate(q, p) {
  return { x: add(mul(q.c, p.x), mul(q.s, p.y)), y: sub(mul(q.c, p.y), mul(q.s, p.x)) };
}
function support(proxy, direction) {
  let index = 0, maximum = dot(proxy.getVertex(0), direction);
  for (let i = 1; i < proxy.getVertexCount(); i++) {
    const value = dot(proxy.getVertex(i), direction);
    if (value > maximum) { maximum = value; index = i; }
  }
  return index;
}
function vertex(input, indexA, indexB) {
  const wA = transform(input.transformA, input.proxyA.getVertex(indexA)), wB = transform(input.transformB, input.proxyB.getVertex(indexB));
  return { indexA, indexB, wA, wB, w: diff(wB, wA), a: 1 };
}
function solve2(vertices) {
  const [v1, v2] = vertices, e12 = diff(v2.w, v1.w);
  const d12_2 = -dot(v1.w, e12);
  if (d12_2 <= 0) { v1.a = 1; return [v1]; }
  const d12_1 = dot(v2.w, e12);
  if (d12_1 <= 0) { v2.a = 1; return [v2]; }
  const inverse = F(1 / add(d12_1, d12_2));
  v1.a = mul(d12_1, inverse); v2.a = mul(d12_2, inverse);
  return vertices;
}
function solve3(vertices) {
  const [v1, v2, v3] = vertices, w1 = v1.w, w2 = v2.w, w3 = v3.w;
  const e12 = diff(w2, w1), d12_1 = dot(w2, e12), d12_2 = -dot(w1, e12);
  const e13 = diff(w3, w1), d13_1 = dot(w3, e13), d13_2 = -dot(w1, e13);
  const e23 = diff(w3, w2), d23_1 = dot(w3, e23), d23_2 = -dot(w2, e23);
  const n123 = cross(e12, e13);
  const d123_1 = mul(n123, cross(w2, w3)), d123_2 = mul(n123, cross(w3, w1)), d123_3 = mul(n123, cross(w1, w2));
  if (d12_2 <= 0 && d13_2 <= 0) { v1.a = 1; return [v1]; }
  if (d12_1 > 0 && d12_2 > 0 && d123_3 <= 0) {
    const inverse = F(1 / add(d12_1, d12_2));
    v1.a = mul(d12_1, inverse); v2.a = mul(d12_2, inverse); return [v1, v2];
  }
  if (d13_1 > 0 && d13_2 > 0 && d123_2 <= 0) {
    const inverse = F(1 / add(d13_1, d13_2));
    v1.a = mul(d13_1, inverse); v3.a = mul(d13_2, inverse); return [v1, v3];
  }
  if (d12_1 <= 0 && d23_2 <= 0) { v2.a = 1; return [v2]; }
  if (d13_1 <= 0 && d23_1 <= 0) { v3.a = 1; return [v3]; }
  if (d23_1 > 0 && d23_2 > 0 && d123_1 <= 0) {
    const inverse = F(1 / add(d23_1, d23_2));
    v2.a = mul(d23_1, inverse); v3.a = mul(d23_2, inverse);
    // 原生及上游把v3移到槽0，v2保留槽1；不能排序后改变重复支撑点路径。
    return [v3, v2];
  }
  const inverse = F(1 / add(add(d123_1, d123_2), d123_3));
  v1.a = mul(d123_1, inverse); v2.a = mul(d123_2, inverse); v3.a = mul(d123_3, inverse);
  return vertices;
}
function witness(vertices, field) {
  if (vertices.length === 1) return { ...vertices[0][field] };
  let x = add(mul(vertices[0].a, vertices[0][field].x), mul(vertices[1].a, vertices[1][field].x));
  let y = add(mul(vertices[0].a, vertices[0][field].y), mul(vertices[1].a, vertices[1][field].y));
  if (vertices.length === 3) { x = add(x, mul(vertices[2].a, vertices[2][field].x)); y = add(y, mul(vertices[2].a, vertices[2][field].y)); }
  return { x, y };
}

function distance(output, cache, input) {
  if (input.useRadii !== false || cache.count !== 0) throw new Error('当前恢复仅接受原查询cold-cache0和useRadii=false');
  if (input.proxyA.getVertexCount() < 1 || input.proxyB.getVertexCount() < 1) throw new Error('GJK不能接受空proxy');
  let vertices = [vertex(input, 0, 0)], iterations = 0, stopped = 'iteration-limit';
  while (iterations < 20) {
    const saved = vertices.map(v => [v.indexA, v.indexB]);
    if (vertices.length === 2) vertices = solve2(vertices);
    else if (vertices.length === 3) vertices = solve3(vertices);
    if (vertices.length === 3) { stopped = 'triangle'; break; }
    let direction;
    if (vertices.length === 1) direction = neg(vertices[0].w);
    else {
      const edge = diff(vertices[1].w, vertices[0].w);
      direction = cross(edge, neg(vertices[0].w)) > 0 ? { x: -edge.y, y: edge.x } : { x: edge.y, y: -edge.x };
    }
    if (dot(direction, direction) < F((2 ** -23) ** 2)) { stopped = 'epsilon-squared'; break; }
    const indexA = support(input.proxyA, inverseRotate(input.transformA.q, neg(direction)));
    const indexB = support(input.proxyB, inverseRotate(input.transformB.q, direction));
    const next = vertex(input, indexA, indexB);
    iterations++;
    if (saved.some(pair => pair[0] === indexA && pair[1] === indexB)) { stopped = 'duplicate-support'; break; }
    vertices.push(next);
  }
  const pointA = witness(vertices, 'wA'), pointB = vertices.length === 3 ? { ...pointA } : witness(vertices, 'wB');
  output.pointA.x = pointA.x; output.pointA.y = pointA.y;
  output.pointB.x = pointB.x; output.pointB.y = pointB.y;
  output.distance = length(diff(pointB, pointA)); output.iterations = iterations;
  if (!Number.isFinite(output.distance)) throw new Error('GJK产生非有限值');
  output.stopped = stopped; output.simplexIndices = vertices.map(v => [v.indexA, v.indexB]);
  cache.count = vertices.length;
  cache.indexA = vertices.map(v => v.indexA); cache.indexB = vertices.map(v => v.indexB);
}

module.exports = { distance, solve2, solve3 };
