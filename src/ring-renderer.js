'use strict';
const { finishGLFrame } = require('./gl-frame-sync');

const shaders = require('./ring-shaders');
const materials = Object.assign({}, require('../assets/rings/materials-data'), require('../assets/parts/materials-data'));
const { buildRingMesh } = require('./ring-mesh');
const { buildPartMeshes } = require('./part-mesh');
const { sampleHand, handImagePath } = require('./tutorial');
const handData = require('../assets/tutorial/hand-frames-packed');

// 副画布保留原平面网格、切线、UV、法线光照与SDF阴影，再合成到已有界面。
async function createRingRenderer({ canvas, loadImage, width, height, ratio = 1 }) {
  // 主界面仍按设备像素比绘制；离屏3D层最高2倍采样，减少拖动时的GPU填充和复制带宽。
  const rasterRatio = () => typeof wx === 'undefined' ? ratio : Math.min(ratio, 2);
  canvas.width = Math.round(width * rasterRatio());
  canvas.height = Math.round(height * rasterRatio());
  const options = { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true };
  let gl = null, legacy = false;
  try { gl = canvas.getContext('webgl2', options); } catch (_) {}
  if (!gl) { try { gl = canvas.getContext('webgl', options); } catch (_) {} legacy = true; }
  if (!gl) return null;
  if (legacy && (!gl.getExtension('OES_standard_derivatives') || !gl.getExtension('EXT_shader_texture_lod'))) return null;
  const programs = {}, textures = {}, allBuffers = [];
  const enabledAttributes = new Set();
  const boundTextures = new Map();
  let meshes = new WeakMap();
  let handEntry = null;
  let cachedState = null, cachedRendered = null;

  function sourceForContext(source, stage) {
    if (!legacy) return source;
    let result = source.replace('#version 300 es', '#version 100');
    if (stage === 'fragment') {
      result = result.replace('#version 100', '#version 100\n#extension GL_OES_standard_derivatives : enable\n#extension GL_EXT_shader_texture_lod : enable');
      result = result.replace(/^layout\(location = 0\) out mediump vec4 SV_Target0;$/m, '');
      result = result.replace(/\bSV_Target0\b/g, 'gl_FragColor').replace(/^in /gm, 'varying ');
    } else result = result.replace(/^in /gm, 'attribute ').replace(/^out /gm, 'varying ');
    return result.replace(/\btextureGrad\(/g, 'texture2DGradEXT(').replace(/\btexture\(/g, 'texture2D(');
  }
  function compile(source, stage) {
    const shader = gl.createShader(stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
    gl.shaderSource(shader, sourceForContext(source, stage));
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
      throw new Error('圆环着色器编译失败：' + message);
    }
    return shader;
  }
  function createProgram(definition, layerAlpha = false) {
    if (layerAlpha) definition = { ...definition, fragment: definition.fragment.replace('void main()', 'uniform mediump float _LayerAlpha;\nvoid layerMain()') + '\nvoid main(){layerMain();SV_Target0.a *= _LayerAlpha;}' };
    const program = gl.createProgram();
    const vertex = compile(definition.vertex, 'vertex'), fragment = compile(definition.fragment, 'fragment');
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('圆环着色器链接失败：' + gl.getProgramInfoLog(program));
    const uniforms = [];
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) {
      const info = gl.getActiveUniform(program, index);
      uniforms.push({ name: info.name.replace(/\[0\]$/, ''), type: info.type, size: info.size, location: gl.getUniformLocation(program, info.name) });
    }
    const attributes = {};
    for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); index++) {
      const info = gl.getActiveAttrib(program, index);
      attributes[info.name] = gl.getAttribLocation(program, info.name);
    }
    return { program, uniforms, attributes };
  }
  for (const name of ['ring', 'RingExtra', 'RingExtraGlow', 'ringShadow', 'RingExtraShadow']) programs[name] = createProgram(shaders[name], name === 'RingExtraGlow' || name === 'RingExtraShadow');
  programs.part = createProgram(require('./part-shaders'));
  programs.hand = createProgram({
    vertex: '#version 300 es\nprecision highp float;\nin vec2 in_POSITION0;\nin vec2 in_TEXCOORD0;\nout highp vec2 vs_TEXCOORD0;\nuniform vec2 _Viewport;\nvoid main(){gl_Position=vec4(in_POSITION0*vec2(2.0,-2.0)/_Viewport+vec2(-1.0,1.0),0.0,1.0);vs_TEXCOORD0=in_TEXCOORD0;}',
    fragment: '#version 300 es\nprecision highp float;\nin highp vec2 vs_TEXCOORD0;\nuniform sampler2D _MainTex;\nuniform float _Alpha;\nlayout(location = 0) out mediump vec4 SV_Target0;\nvoid main(){SV_Target0=texture(_MainTex,vs_TEXCOORD0)*_Alpha;}'
  });
  const descriptors = new Map();
  for (const name of ['ring', 'RingExtra', 'RingExtraGlow', 'MatCatch', 'MatButterflyBody', 'MatButterflyCatch']) for (const value of Object.values(materials[name].textures)) descriptors.set(value.path, value);
  descriptors.set(handImagePath, { path: handImagePath, width: handData.imageWidth, height: handData.imageHeight });
  await Promise.all([...descriptors].map(async ([path, descriptor]) => {
    const image = await loadImage(path), texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, path !== handImagePath);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (typeof wx === 'undefined') gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    // 原PlayerSettings.m_ActiveColorSpace为0（Gamma），纹理与输出均保留原数值。
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const powerOfTwo = value => (value & (value - 1)) === 0;
    const mipmap = path !== handImagePath && (!legacy || powerOfTwo(descriptor.width) && powerOfTwo(descriptor.height));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    textures[path] = texture;
  }));
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.clearColor(0, 0, 0, 0);

  function buffer(data, type) {
    const target = type || gl.ARRAY_BUFFER, value = gl.createBuffer();
    gl.bindBuffer(target, value); gl.bufferData(target, data, gl.STATIC_DRAW); allBuffers.push(value); return value;
  }
  function prepare(part) {
    if (meshes.has(part)) return meshes.get(part);
    const render = part.render && part.render[0];
    let definitions;
    if (part.kind === 'ring' && render && Number.isFinite(render._radius)) {
      const materialName = render._extraEnabled ? 'RingExtra' : 'ring';
      definitions = [{ mesh: buildRingMesh(render, materials[materialName]), render, materialName }];
    } else definitions = buildPartMeshes(part, materials);
    const entries = definitions.filter(value => value.mesh).map(({ mesh, render, materialName }) => ({ mesh, render, material: materials[materialName], materialName, buffers: {
      in_POSITION0: { value: buffer(mesh.positions), count: 3 },
      in_TANGENT0: { value: buffer(mesh.tangents), count: 4 },
      in_TEXCOORD0: { value: buffer(mesh.uv0), count: 2 },
      in_TEXCOORD1: { value: buffer(mesh.uv1), count: 2 },
      in_TEXCOORD2: { value: buffer(mesh.uv2), count: 2 },
    }, indices: buffer(mesh.indices, gl.ELEMENT_ARRAY_BUFFER) }));
    meshes.set(part, entries); return entries;
  }
  function matrices(part, camera) {
    const delta = (part.rotationDeg - part.initialRotation) * Math.PI / 180, c = Math.cos(delta), s = Math.sin(delta), initial = part.initialMatrix || part.matrix;
    const a = c * initial[0] - s * initial[3], b = c * initial[1] - s * initial[4];
    const d = s * initial[0] + c * initial[3], e = s * initial[1] + c * initial[4], determinant = a * e - b * d;
    const x = part.x, y = part.y, z = part.z || 0;
    return {
      hlslcc_mtx4x4unity_ObjectToWorld: [a, d, 0, 0, b, e, 0, 0, 0, 0, 1, 0, x, y, z, 1],
      hlslcc_mtx4x4unity_WorldToObject: [e / determinant, -d / determinant, 0, 0, -b / determinant, a / determinant, 0, 0, 0, 0, 1, 0, (b * y - e * x) / determinant, (d * x - a * y) / determinant, -z, 1],
      hlslcc_mtx4x4unity_MatrixVP: [2 * camera.scale / width, 0, 0, 0, 0, 2 * camera.scale / height, 0, 0, 0, 0, .01, 0, 2 * (camera.cx - camera.x * camera.scale) / width - 1, 1 - 2 * (camera.cy + camera.y * camera.scale) / height, 0, 1],
    };
  }
  function drawProgram(program, entry, values, color) {
    gl.useProgram(program.program);
    const needed = new Set(Object.values(program.attributes));
    for (const location of enabledAttributes) if (!needed.has(location)) { gl.disableVertexAttribArray(location); enabledAttributes.delete(location); }
    for (const [name, location] of Object.entries(program.attributes)) {
      const attribute = entry.buffers[name];
      if (attribute) {
        gl.bindBuffer(gl.ARRAY_BUFFER, attribute.value); gl.enableVertexAttribArray(location);
        enabledAttributes.add(location);
        gl.vertexAttribPointer(location, attribute.count, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(location);
        enabledAttributes.delete(location);
        if (name === 'in_COLOR0') gl.vertexAttrib4fv(location, color);
        else if (name === 'in_NORMAL0') gl.vertexAttrib3f(location, 0, 0, 1);
      }
    }
    let unit = 0;
    for (const uniform of program.uniforms) {
      const name = uniform.name;
      if (uniform.type === gl.SAMPLER_2D) {
        const descriptor = entry.material.textures[name];
        if (!descriptor) continue;
        const texture = textures[descriptor.path];
        if (boundTextures.get(unit) !== texture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); boundTextures.set(unit, texture); }
        if (uniform.lastUnit !== unit) { gl.uniform1i(uniform.location, unit); uniform.lastUnit = unit; }
        unit++;
      } else {
        const value = values[name] ?? entry.material.floats[name] ?? entry.material.vectors[name] ?? 0;
        // 参数属于各自Program；比较实际数值，避免可变数组引用造成漏更新。
        const current = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : value;
        const previous = uniform.lastValue;
        const same = typeof current === 'number' ? Object.is(current, previous) : Array.isArray(previous) && current.length === previous.length && current.every((v, i) => Object.is(v, previous[i]));
        if (same) continue;
        if (uniform.type === gl.FLOAT) gl.uniform1f(uniform.location, value);
        else if (uniform.type === gl.FLOAT_VEC2) gl.uniform2fv(uniform.location, value);
        else if (uniform.type === gl.FLOAT_VEC3) gl.uniform3fv(uniform.location, value);
        else if (uniform.type === gl.FLOAT_VEC4) gl.uniform4fv(uniform.location, value);
        uniform.lastValue = current;
      }
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.indices);
    gl.drawElements(gl.TRIANGLES, entry.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  }
  function drawPart(ctx, part, camera, pose = null, batch = false) {
    if (!batch) cachedState = null;
    const prepared = prepare(part);
    if (!prepared.length || part.solved) return false;
    const alpha = pose ? Math.max(0, Math.min(1, pose.alpha ?? 1)) : 1;
    if (alpha <= 0) return false;
    const visualPart = pose ? Object.assign({}, part, { rotationDeg: Number.isFinite(pose.rotationDeg) ? pose.rotationDeg : part.rotationDeg + (pose.deltaDeg || 0) }) : part;
    gl.viewport(0, 0, canvas.width, canvas.height); gl.depthMask(true);
    if (!batch) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (const original of prepared) {
      const entry = pose ? Object.assign({}, original, { material: materials.RingExtraGlow, materialName: 'RingExtraGlow' }) : original;
      const descriptor = entry.material.textures._MainTex, sdf = entry.material.textures._SDFTex;
      const values = Object.assign(matrices(visualPart, camera), {
        _MainTex_TexelSize: [1 / descriptor.width, 1 / descriptor.height, descriptor.width, descriptor.height],
        _GlobalMipBias: [0, 1], _LayerAlpha: batch ? alpha : 1,
      });
      if (sdf) values._SDFTex_TexelSize = [1 / sdf.width, 1 / sdf.height, sdf.width, sdf.height];
      let vertexColor = entry.render._vertexColor || entry.render.vertexColor || { r: 1, g: 1, b: 1, a: 1 };
      if ((part.kind === 'ring' || part.kind === 'pull') && /^#[\da-f]{6}$/i.test(part.color || '')) {
        const value = parseInt(part.color.slice(1), 16);
        vertexColor = {r:(value >> 16) / 255,g:((value >> 8) & 255) / 255,b:(value & 255) / 255,a:1};
      }
      // 原Gamma工程直接量化顶点色，与首关原baked Mesh的50/175/221一致。
      const color = [vertexColor.r, vertexColor.g, vertexColor.b].map(value => Math.round(value * 255) / 255).concat(vertexColor.a);
      if (sdf) {
        gl.depthMask(false);
        drawProgram(programs[(pose ? 'RingExtra' : entry.materialName) + 'Shadow'], entry, values, color);
        gl.depthMask(true);
        drawProgram(programs[entry.materialName], entry, values, color);
      } else drawProgram(programs.part, entry, values, color);
    }
    if (!batch) { ctx.save(); ctx.globalAlpha *= alpha; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); finishGLFrame(gl); ctx.drawImage(canvas, 0, 0, width, height); ctx.restore(); }
    return true;
  }
  function drawParts(ctx, parts, camera, overlay = null) {
    const state = !overlay ? [camera.x, camera.y, camera.scale, camera.cx, camera.cy, ...parts.flatMap(part => [part, part.x, part.y, part.z, part.rotationDeg, part.solved, part.color])] : null;
    // 静止棋盘保留已完成的颜色缓冲；拖动、相机变化、消除或教程动画均会失效。
    if (state && cachedState && state.length === cachedState.length && state.every((value, i) => Object.is(value, cachedState[i]))) {
      ctx.save(); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.drawImage(canvas, 0, 0, width, height); ctx.restore();
      return cachedRendered;
    }
    gl.viewport(0, 0, canvas.width, canvas.height); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const rendered = new Set();
    // 原透明队列由远到近；透明四角仍写深度，必须先画z较大的后方物件。
    for (const part of [...parts].sort((a, b) => (b.z || 0) - (a.z || 0))) if (drawPart(null, part, camera, null, true)) rendered.add(part.id);
    if (overlay) {
      // 一帧只合成一次：避免原生2D延迟读取时，同一源画布已被教程手清空。
      if (overlay.guide) {
        gl.clear(gl.DEPTH_BUFFER_BIT);
        drawPart(null, overlay.guide.part, overlay.guide.camera, overlay.guide.pose, true);
      }
      if (overlay.hand) drawHand(null, overlay.hand.pose, overlay.hand.point, overlay.hand.scale, true);
    }
    ctx.save(); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); finishGLFrame(gl); ctx.drawImage(canvas, 0, 0, width, height); ctx.restore();
    cachedState = state; cachedRendered = rendered;
    return rendered;
  }
  function invalidateUniforms() {
    cachedState = null; cachedRendered = null;
    boundTextures.clear();
    for (const program of Object.values(programs)) for (const uniform of program.uniforms) { delete uniform.lastValue; delete uniform.lastUnit; }
  }
  function resetLevel() {
    invalidateUniforms();
    for (const location of enabledAttributes) gl.disableVertexAttribArray(location);
    enabledAttributes.clear();
    for (const value of allBuffers) gl.deleteBuffer(value);
    allBuffers.length = 0;
    meshes = new WeakMap();
    handEntry = null;
  }
  function drawGuide(ctx, part, camera, pose) { return pose ? drawPart(ctx, part, camera, pose) : false; }
  function drawHand(ctx, hand, point, uiScale, batch = false) {
    if (!batch) cachedState = null;
    const sampled = sampleHand(hand.animation, hand.time);
    if (!handEntry) handEntry = {
      positions: new Float32Array(handData.uvs.length),
      buffers: { in_POSITION0: { value: buffer(new Float32Array(handData.uvs.length)), count: 2 }, in_TEXCOORD0: { value: buffer(new Float32Array(handData.uvs)), count: 2 } },
      indices: buffer(new Uint16Array(handData.triangles), gl.ELEMENT_ARRAY_BUFFER),
      mesh: { indices: handData.triangles }, material: { textures: { _MainTex: { path: handImagePath } }, floats: {}, vectors: {} }
    };
    for (let i = 0; i < sampled.vertices.length; i += 2) {
      handEntry.positions[i] = point.x + uiScale * (22 + .7599999904632568 * sampled.vertices[i]);
      handEntry.positions[i + 1] = point.y - uiScale * (-118 + .7599999904632568 * sampled.vertices[i + 1]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, handEntry.buffers.in_POSITION0.value);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, handEntry.positions);
    gl.viewport(0, 0, canvas.width, canvas.height); gl.depthMask(true);
    if (!batch) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    // 原atlas标记pma:true；一次GPU三角网格避免Canvas逐片裁剪产生接缝和二次预乘。
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    drawProgram(programs.hand, handEntry, { _Viewport: [width, height], _Alpha: sampled.alpha }, [1, 1, 1, 1]);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    if (!batch) { ctx.save(); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); finishGLFrame(gl); ctx.drawImage(canvas, 0, 0, width, height); ctx.restore(); }
    return true;
  }
  function resize(view) {
    invalidateUniforms();
    width = view.width; height = view.height; ratio = view.ratio;
    canvas.width = Math.round(width * rasterRatio()); canvas.height = Math.round(height * rasterRatio());
  }
  return { canvas, gl, drawPart, drawParts, drawGuide, drawHand, resetLevel, resize, dispose() {
    resetLevel();
    for (const value of Object.values(textures)) gl.deleteTexture(value);
    for (const value of Object.values(programs)) gl.deleteProgram(value.program);
  } };
}

module.exports = { createRingRenderer };
