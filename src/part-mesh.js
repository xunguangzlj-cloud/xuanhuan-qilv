'use strict';

// 对照原 ArrowPathMeshBuilder、QuadPlaneController 和 FixedButterflyMeshPart。
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const add = (a, b, scale = 1) => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const sub = (a, b) => add(a, b, -1);
const length = a => Math.hypot(...a);
const unit = a => { const size = length(a); return size > 1e-8 ? a.map(v => v / size) : [0, 0, 0]; };
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function arrays(positions, tangents, uv0, uv1, uv2, indices) {
  return { positions: new Float32Array(positions), tangents: new Float32Array(tangents), uv0: new Float32Array(uv0), uv1: new Float32Array(uv1), uv2: new Float32Array(uv2), indices: new Uint16Array(indices) };
}

function buildPullMesh(render) {
  if (!render || !render._pathPoints || !render._buildSettings) return null;
  const cleaned = [], source = render._pathPoints.map(p => [p.x, p.y, p.z || 0]);
  for (const point of source) if (!cleaned.length || length(sub(point, cleaned[cleaned.length - 1])) > .0001) cleaned.push(point);
  if (cleaned.length >= 3) {
    let next = 1;
    const last = cleaned.length - 1;
    for (let i = 1; i < last; i++) {
      const first = sub(cleaned[i], cleaned[next - 1]), second = sub(cleaned[i + 1], cleaned[i]);
      if (length(first) < .0001 || length(second) < .0001) continue;
      const a = unit(first), b = unit(second);
      if (length(cross(a, b)) >= .001 || dot(a, b) <= 0) cleaned[next++] = cleaned[i];
    }
    cleaned[next++] = cleaned[last]; cleaned.length = next;
  }
  if (cleaned.length < 2) return null;
  const settings = render._buildSettings, centerline = [cleaned[0]];
  const segments = Math.max(1, settings.cornerSegments), radius = Math.max(0, settings.cornerRadius);
  for (let i = 1; i < cleaned.length - 1; i++) {
    const corner = cleaned[i], first = sub(corner, cleaned[i - 1]), second = sub(cleaned[i + 1], corner);
    const a = unit(first), b = unit(second), angle = Math.acos(clamp(-dot(a, b), -1, 1));
    if (length(first) < .0001 || length(second) < .0001 || angle < .02 || angle > 3.1215928) { centerline.push(corner); continue; }
    const half = angle * .5, tangent = Math.tan(half);
    const offset = Math.min(tangent > .0001 ? radius / tangent : 0, .5 * Math.min(length(first), length(second)));
    const roundedRadius = offset * tangent, bisector = sub(b, a);
    if (offset < .0001 || roundedRadius < .0001 || length(bisector) < .0001) { centerline.push(corner); continue; }
    const start = add(corner, a, -offset), end = add(corner, b, offset);
    const center = add(corner, unit(bisector), roundedRadius / Math.sin(half));
    const from = sub(start, center), to = sub(end, center), arcAngle = Math.acos(clamp(dot(unit(from), unit(to)), -1, 1));
    const sinAngle = Math.sin(arcAngle);
    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      const point = add(center, add(from.map(v => v * Math.sin((1 - t) * arcAngle) / sinAngle), to, Math.sin(t * arcAngle) / sinAngle));
      if (length(sub(point, centerline[centerline.length - 1])) > .0001) centerline.push(point);
    }
  }
  const end = cleaned[cleaned.length - 1];
  if (length(sub(end, centerline[centerline.length - 1])) > .0001) centerline.push(end);
  const headIndex = centerline.length - 1;
  let originalLength = 0;
  for (let i = 1; i <= headIndex; i++) originalLength += length(sub(centerline[i], centerline[i - 1]));
  const extra = Math.max(0, settings.exitExtraLength);
  if (extra > .0001) centerline.push(add(end, unit(sub(end, centerline[centerline.length - 2])), extra));
  const count = centerline.length, across = clamp(settings.widthSubdivisions, 0, 8) + 2;
  const positions = [], tangents = [], uv0 = [], uv1 = [], uv2 = [], indices = [], previous = [], distances = new Array(across).fill(0), arcs = [];
  for (let row = 0; row < count; row++) {
    let tangent = row === 0 ? sub(centerline[1], centerline[0]) : row === count - 1 ? sub(centerline[row], centerline[row - 1]) : sub(centerline[row + 1], centerline[row - 1]);
    tangent = length(tangent) < .0001 ? [1, 0, 0] : unit(tangent);
    const side = unit(cross([0, 0, 1], tangent));
    for (let column = 0; column < across; column++) {
      const v = column / (across - 1), point = add(centerline[row], side, Math.max(0, settings.width) * (.5 - v));
      positions.push(...point); tangents.push(...tangent, -1);
      if (row) distances[column] += length(sub(point, previous[column]));
      previous[column] = point; arcs.push(distances[column]);
      uv0.push(0, v); uv1.push(originalLength, settings.styleIndex + 1); uv2.push(1, 0);
    }
  }
  // 原实现逐列归一弧长，圆角内外缘具有不同长度；不能用中心线距离代替。
  for (let column = 0; column < across; column++) {
    const headLength = arcs[headIndex * across + column], scale = headLength > .0001 ? originalLength / headLength : 1;
    for (let row = 0; row < count; row++) uv0[(row * across + column) * 2] = arcs[row * across + column] * scale;
  }
  for (let row = 0; row < count - 1; row++) for (let column = 0; column < across - 1; column++) {
    const a = row * across + column, b = a + across;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return arrays(positions, tangents, uv0, uv1, uv2, indices);
}

function buildFixedMesh(render) {
  if (!render || !Number.isFinite(render.width) || !Number.isFinite(render.height)) return null;
  const x = render.width * .5, y = render.height * .5;
  const positions = render.orientation === 1 ? [-x, 0, -y, x, 0, -y, -x, 0, y, x, 0, y] : [-x, -y, 0, x, -y, 0, -x, y, 0, x, y, 0];
  return arrays(positions, [], [0, 0, 1, 0, 0, 1, 1, 1], [], [], [0, 2, 1, 1, 2, 3]);
}

function buildButterflyMesh(render, texture) {
  if (!render || !Number.isFinite(render.quadWidth)) return null;
  const width = render.quadWidth, half = render.quadHeight * .5, center = render.localCenter || { x: 0, y: 0 }, z = render.zOffset || 0;
  const natural = render.role === 0 && texture ? render.quadHeight * texture.height / texture.width : 0;
  if (natural <= .0001) return arrays([center.x - width * .5, center.y - half, z, center.x + width * .5, center.y - half, z, center.x - width * .5, center.y + half, z, center.x + width * .5, center.y + half, z], [], [0, 0, 0, 1, 1, 0, 1, 1], [], [], [0, 2, 1, 1, 2, 3]);
  let first = render.capStartLength, last = render.capEndLength;
  if (first + last <= 0) first = last = 0;
  else {
    if (width < first + last) { first = width * first / (first + last); last = width - first; }
    if (first + last > natural * .999) { const scale = natural * .999 / (first + last); first *= scale; last *= scale; }
  }
  const columns = [0, first, width - last, width], v = [0, first / natural, 1 - last / natural, 1];
  const positions = [], uv0 = [], indices = [];
  for (let row = 0; row < 2; row++) for (let column = 0; column < 4; column++) {
    positions.push(center.x - width * .5 + columns[column], center.y + (row ? half : -half), z); uv0.push(row, v[column]);
  }
  for (let i = 0; i < 3; i++) indices.push(i, i + 4, i + 1, i + 1, i + 4, i + 5);
  return arrays(positions, [], uv0, [], [], indices);
}

function buildPartMeshes(part, materials) {
  const render = part.render && part.render[0];
  if (part.kind === 'pull') {
    const mesh = buildPullMesh(render);
    return mesh ? [{ mesh, render, materialName: 'ring' }] : [];
  }
  if (part.kind === 'fixed') {
    const mesh = buildFixedMesh(render);
    return mesh ? [{ mesh, render, materialName: 'MatCatch' }] : [];
  }
  if (part.kind !== 'butterfly') return [];
  const controller = part.render.find(value => Number.isFinite(value.slotSpan));
  const bridge = part.render.find(value => value.role === 0 && Number.isFinite(value.quadWidth));
  if (!controller || !bridge) return [];
  const result = [{ mesh: buildButterflyMesh(bridge, materials.MatButterflyBody.textures._MainTex), render: bridge, materialName: 'MatButterflyBody' }];
  // 原 56 个蝴蝶子变换均是局部 X 正负偏移、无旋转缩放；与控制器公式逐个对照完全相同。
  for (const sign of [-1, 1]) {
    const slot = { role: 1, quadWidth: controller.endCapWidth, quadHeight: controller.endCapLength, localCenter: { x: -sign * (controller.slotSpan * .5 - controller.endCapWidth * .5), y: 0 }, zOffset: controller.slotZ, vertexColor: bridge.vertexColor };
    result.push({ mesh: buildButterflyMesh(slot), render: slot, materialName: 'MatButterflyCatch' });
  }
  return result;
}

module.exports = { buildPullMesh, buildFixedMesh, buildButterflyMesh, buildPartMeshes };
