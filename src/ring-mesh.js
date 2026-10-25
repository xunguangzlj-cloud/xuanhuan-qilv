'use strict';

// 按原 RingSegmentController/RingSegmentMeshBuilder 的带状网格与UV规则生成。
const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const add = (a, b, scale = 1) => [a[0] + b[0] * scale, a[1] + b[1] * scale];
const mul = (a, scale) => [a[0] * scale, a[1] * scale];

function buildRingMesh(render, material) {
  if (!render || !Number.isFinite(render._radius) || !Number.isFinite(render._width)) return null;
  const positions = [], tangents = [], uv0 = [], uv1 = [], uv2 = [], indices = [];
  const radius = render._radius, width = render._width, style = render._styleIndex + 1;
  const floats = material.floats;
  const tail = floats._TailLength || 0, head = floats._HeadLength || 0;
  const half = width * .5, cap = render._capRatio || 0;
  const gap = clamp(render._gapAngleDeg, 0, 360), visible = 360 - gap;
  if (visible < .01) return null;

  function vertex(point, tangent, u, v, length, row, z, outlineMask = 1) {
    positions.push(point[0], point[1], z || 0);
    tangents.push(tangent[0], tangent[1], 0, -1);
    uv0.push(u, v); uv1.push(length, row); uv2.push(outlineMask, 0);
  }
  function quad(a) { indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  function ribbon(origin, direction, bandWidth, distances, uValues, length, row, z) {
    const normal = [direction[1], -direction[0]], first = positions.length / 3;
    for (let index = 0; index < distances.length; index++) {
      const center = add(origin, direction, distances[index]);
      vertex(add(center, normal, bandWidth * .5), direction, uValues[index], 1, length, row, z);
      vertex(add(center, normal, -bandWidth * .5), direction, uValues[index], 0, length, row, z);
    }
    for (let index = 0; index < distances.length - 1; index++) quad(first + index * 2);
  }
  function stemGeometry(attachment) {
    const angle = attachment.angleDeg * DEG, radial = [Math.cos(angle), Math.sin(angle)];
    const insert = Math.max(0, attachment.stemInsertOffset);
    return {
      origin: mul(radial, radius + (attachment.isInnerMount ? -half + insert : half - insert)),
      direction: mul(radial, attachment.isInnerMount ? -1 : 1),
      length: attachment.stemLength + insert,
      crossDirection: [-radial[1], radial[0]]
    };
  }
  // 原顺序先画插入环内的杆，再画主体，最后画横向栓。
  for (const attachment of render._attachments || []) {
    const geometry = stemGeometry(attachment), factor = width / attachment.stemWidth;
    const headed = attachment.type === 0, total = geometry.length;
    const tip = headed ? attachment.crossWidth : 0;
    const distances = headed && tip > 0 && tip < total ? [0, total - tip, total] : [0, total];
    ribbon(geometry.origin, geometry.direction, attachment.stemWidth, distances, distances.map(value => 100 + value * factor), headed ? 100 + total * factor : 99999, attachment.styleIndex + 1, render._stemZ);
  }

  const start = (render._gapDirectionDeg + gap * .5) * DEG;
  const end = start + visible * DEG, arcLength = visible * DEG * radius;
  const bodyTile = Math.max(.001, floats._BodyTileLength || 1), bodyLength = arcLength - tail - head;
  const uvLength = bodyLength > .001 ? tail + Math.max(1, Math.round(bodyLength / bodyTile)) * bodyTile + head : arcLength;
  const capStart = gap > .01 ? tail / radius * cap : 0;
  const capEnd = gap > .01 ? head / radius * cap : 0;
  const arcStart = start + capStart, arcEnd = end - capEnd;
  const innerCore = radius * 24 - width * 12;
  const fullDivisions = clamp(Math.round(64 * Math.pow(Math.max(1, innerCore / 36), .7)), 64, 384);
  const angle = arcEnd - arcStart;
  const divisions = gap > .01
    ? clamp(Math.max(Math.round(fullDivisions * angle / (2 * Math.PI)), Math.ceil(radius * angle / .35)), 1, 96)
    : clamp(Math.max(fullDivisions, Math.ceil(2 * Math.PI * radius / .35)), 64, 384);
  const first = positions.length / 3;
  const uStart = gap > .01 ? tail * cap : 100;
  const uEnd = gap > .01 ? uvLength - head * cap : 100 + arcLength;
  const finalLength = gap > .01 ? uvLength : 99999;
  for (let index = 0; index <= divisions; index++) {
    const t = index / divisions, a = arcStart + angle * t;
    const radial = [Math.cos(a), Math.sin(a)], tangent = [-radial[1], radial[0]];
    const u = uStart + (uEnd - uStart) * t;
    vertex(mul(radial, radius + half), tangent, u, 1, finalLength, style, render._ringZ);
    vertex(mul(radial, radius - half), tangent, u, 0, finalLength, style, render._ringZ);
  }
  for (let index = 0; index < divisions; index++) quad(first + index * 2);
  function capQuad(angleValue, outward, length, uAnchor, uTip) {
    const radial = [Math.cos(angleValue), Math.sin(angleValue)], anchor = mul(radial, radius);
    const tangent = mul(outward, uTip >= uAnchor ? 1 : -1), tip = add(anchor, outward, length);
    const firstVertex = positions.length / 3;
    vertex(add(anchor, radial, half), tangent, uAnchor, 1, uvLength, style, render._ringZ);
    vertex(add(anchor, radial, -half), tangent, uAnchor, 0, uvLength, style, render._ringZ);
    vertex(add(tip, radial, half), tangent, uTip, 1, uvLength, style, render._ringZ);
    vertex(add(tip, radial, -half), tangent, uTip, 0, uvLength, style, render._ringZ);
    if (outward[0] * radial[1] - outward[1] * radial[0] < 0) quad(firstVertex);
    else indices.push(firstVertex, firstVertex + 2, firstVertex + 1, firstVertex + 1, firstVertex + 2, firstVertex + 3);
  }
  if (gap > .01 && cap > .001 && tail > .001) capQuad(arcStart, [Math.sin(arcStart), -Math.cos(arcStart)], tail * cap, tail * cap, 0);
  if (gap > .01 && cap > .001 && head > .001) capQuad(arcEnd, [-Math.sin(arcEnd), Math.cos(arcEnd)], head * cap, uvLength - head * cap, uvLength);

  for (const attachment of render._attachments || []) {
    if (attachment.type !== 1) continue;
    const geometry = stemGeometry(attachment), direction = geometry.crossDirection;
    const center = add(geometry.origin, geometry.direction, geometry.length);
    const extra = !!render._extraEnabled, crossLength = attachment.crossLength * (extra ? 2 : 1);
    const crossWidth = attachment.crossWidth, factor = width / crossWidth;
    const capLength = extra ? 0 : crossWidth * clamp(attachment.crossCapLength, 0, 1);
    const middle = (capLength > .0001 ? capLength : 0) + crossLength * .5;
    const inset = attachment.stemWidth * .25;
    const left = clamp(middle - inset, capLength, capLength + crossLength);
    const right = clamp(middle + inset, capLength, capLength + crossLength);
    let distances, us, length;
    if (capLength > .0001) {
      distances = [0, capLength, left, right, capLength + crossLength, crossLength + capLength * 2];
      us = [0, tail, tail + (left - capLength) * factor, tail + (right - capLength) * factor, tail + crossLength * factor, tail + crossLength * factor + head];
      length = tail + crossLength * factor + head;
    } else {
      distances = [0, left, right, crossLength];
      const uOffset = extra ? 0 : 100;
      us = distances.map(value => uOffset + value * factor);
      length = extra ? crossLength * factor : 99999;
    }
    const origin = add(center, direction, -crossLength * .5 - capLength);
    const normal = [direction[1], -direction[0]], row = (attachment.styleIndex + 1) * (extra ? -1 : 1);
    for (let segment = 0; segment < distances.length - 1; segment++) {
      for (let side = 0; side < 2; side++) {
        const offset = positions.length / 3;
        const outlineMask = segment === (capLength > .0001 ? 2 : 1) && side === 1 ? 0 : 1;
        for (let endpoint = 0; endpoint < 2; endpoint++) {
          const point = add(origin, direction, distances[segment + endpoint]);
          for (let lane = side; lane <= side + 1; lane++) vertex(add(point, normal, crossWidth * (.5 - lane * .5)), direction, us[segment + endpoint], 1 - lane * .5, length, row, render._crossBarZ, outlineMask);
        }
        quad(offset);
      }
    }
  }
  return { positions: new Float32Array(positions), tangents: new Float32Array(tangents), uv0: new Float32Array(uv0), uv1: new Float32Array(uv1), uv2: new Float32Array(uv2), indices: new Uint16Array(indices) };
}

module.exports = { buildRingMesh };
