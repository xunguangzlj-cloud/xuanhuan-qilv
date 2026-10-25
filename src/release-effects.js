'use strict';
const { finishGLFrame } = require('./gl-frame-sync');

const config = require('../assets/effects/release-data');
const materials = require('../assets/rings/materials-data');
const {buildRingMesh} = require('./ring-mesh');
const DEG = Math.PI / 180;
const STEP = 1 / 240;
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 原AnimationCurve的切线与加权Bezier节点均直接来自序列化粒子参数。
function evaluateKeys(keys, time) {
  if (!keys.length) return 0;
  if (time <= keys[0][0]) return keys[0][1];
  if (time >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  let index = 1;
  while (keys[index][0] < time) index++;
  const a = keys[index - 1], b = keys[index], duration = b[0] - a[0];
  if (!Number.isFinite(a[3]) || !Number.isFinite(b[2])) return a[1];
  const outWeight = a[4] & 2 ? a[6] : 1 / 3, inWeight = b[4] & 1 ? b[5] : 1 / 3;
  const bezier = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  let t = (time - a[0]) / duration;
  if ((a[4] & 2) || (b[4] & 1)) {
    let low = 0, high = 1;
    for (let i = 0; i < 24; i++) {
      t = (low + high) / 2;
      if (bezier(0, outWeight, 1 - inWeight, 1, t) < (time - a[0]) / duration) low = t;
      else high = t;
    }
    t = (low + high) / 2;
  }
  return bezier(a[1], a[1] + a[3] * duration * outWeight, b[1] - b[2] * duration * inWeight, b[1], t);
}

function evaluateCurve(curve, time = 0, random = .5) {
  if (!curve) return 0;
  if (curve.mode === 0) return curve.scalar;
  if (curve.mode === 3) return mix(curve.min, curve.scalar, random);
  const maximum = evaluateKeys(curve.maxKeys, time);
  return curve.scalar * (curve.mode === 2 ? mix(evaluateKeys(curve.minKeys, time), maximum, random) : maximum);
}

function evaluateGradient(gradient, time) {
  function sample(keys, channels) {
    if (time <= keys[0][0]) return keys[0].slice(1);
    let index = 1;
    while (index < keys.length && time > keys[index][0]) index++;
    if (index === keys.length) return keys[index - 1].slice(1);
    if (gradient.mode === 1) return keys[index].slice(1);
    const a = keys[index - 1], b = keys[index], t = (time - a[0]) / (b[0] - a[0]);
    return Array.from({length:channels}, (_, i) => mix(a[i + 1], b[i + 1], t));
  }
  return sample(gradient.colors, 3).concat(sample(gradient.alpha, 1));
}

const area = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function polygonTriangles(path) {
  const points = path.map(p => p.slice(0, 2));
  if (points.length > 2 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-8) points.pop();
  const remaining = points.map((_, i) => i), triangles = [];
  let direction = 0;
  for (let i = 0; i < points.length; i++) direction += points[i][0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * points[i][1];
  const sign = Math.sign(direction);
  while (remaining.length > 2) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = points[remaining[(i + remaining.length - 1) % remaining.length]], b = points[remaining[i]], c = points[remaining[(i + 1) % remaining.length]];
      if (area(a, b, c) * sign <= 1e-10) continue;
      if (remaining.some(j => points[j] !== a && points[j] !== b && points[j] !== c && area(a, b, points[j]) * sign >= 0 && area(b, c, points[j]) * sign >= 0 && area(c, a, points[j]) * sign >= 0)) continue;
      triangles.push([a, b, c]); remaining.splice(i, 1); found = true; break;
    }
    if (!found) break;
  }
  return triangles;
}

function createSurface(part) {
  const render = part.render && part.render[0], triangles = [];
  if (part.kind === 'ring' && render) {
    const mesh = buildRingMesh(render, materials[render._extraEnabled ? 'RingExtra' : 'ring']);
    if (mesh) for (let i = 0; i < mesh.indices.length; i += 3) triangles.push(Array.from(mesh.indices.slice(i, i + 3), n => [mesh.positions[n * 3], mesh.positions[n * 3 + 1]]));
  } else {
    // 拉杆/固定件的原渲染网格尚未纳入关卡数据，暂用已恢复的碰撞轮廓作发射面。
    const rotation = (part.rotationDeg || 0) * DEG, c = Math.cos(rotation), s = Math.sin(rotation);
    const paths = (part.body || []).concat((part.pegs || []).flatMap(peg => peg.paths));
    for (const path of paths) triangles.push(...polygonTriangles(path.map(p => [c * (p[0] - part.x) + s * (p[1] - part.y), -s * (p[0] - part.x) + c * (p[1] - part.y)])));
  }
  let total = 0;
  const nondegenerate = triangles.filter(triangle => Math.abs(area(...triangle)) > 1e-12);
  const cumulative = nondegenerate.map(triangle => (total += Math.abs(area(...triangle)) / 2));
  return {triangles:nondegenerate, cumulative, total};
}

function sampleSurface(surface, random) {
  const distance = random() * surface.total;
  let low = 0, high = surface.cumulative.length - 1;
  while (low < high) { const middle = (low + high) >> 1; if (surface.cumulative[middle] < distance) low = middle + 1; else high = middle; }
  const triangle = surface.triangles[low], u = Math.sqrt(random()), v = random();
  return [triangle[0][0] * (1 - u) + triangle[1][0] * u * (1 - v) + triangle[2][0] * u * v, triangle[0][1] * (1 - u) + triangle[1][1] * u * (1 - v) + triangle[2][1] * u * v];
}

function createParticleBurst(part, random = Math.random) {
  const definition = config.systems[part.kind === 'fixed' ? 'fixed' : 'fragment'];
  const surface = createSurface(part), particles = [];
  if (surface.total <= 0) return {age:0, particles};
  const rotation = (part.rotationDeg || 0) * DEG, c = Math.cos(rotation), s = Math.sin(rotation);
  for (let i = 0; i < definition.count; i++) {
    const point = sampleSurface(surface, random), length = Math.hypot(...point) || 1;
    const speed = evaluateCurve(definition.speed, 0, random()), vx = point[0] / length * speed * definition.sphericalDirection, vy = point[1] / length * speed * definition.sphericalDirection;
    const randomColor = evaluateGradient(definition.startColor, random());
    const frame = evaluateCurve(definition.uv.startFrame, 0, random()) + evaluateCurve(definition.uv.frameOverTime, 0, random()) * definition.uv.cycles;
    particles.push({definition, lifetime:evaluateCurve(definition.lifetime, 0, random()), size:evaluateCurve(definition.size, 0, random()), rotation:evaluateCurve(definition.rotation, 0, random()) + rotation, angularVelocity:evaluateCurve(definition.angularVelocity, 0, random()), color:randomColor.map(value => Math.floor(clamp(value, 0, 1) * 255) / 255), frame:Math.floor(((frame % 1) + 1) % 1 * definition.uv.tilesX * definition.uv.tilesY), x:part.x + c * point[0] - s * point[1], y:part.y + s * point[0] + c * point[1], vx:c * vx - s * vy, vy:s * vx + c * vy, simulated:0, c, s, gravityRandom:random(), velocityXRandom:random(), velocityYRandom:random(), noisePhase:random() * Math.PI * 2});
  }
  return {age:0, particles};
}

function advanceParticle(particle, age) {
  const target = Math.min(age, particle.lifetime), definition = particle.definition;
  while (particle.simulated + STEP <= target + 1e-10) {
    const t = (particle.simulated + STEP / 2) / particle.lifetime;
    const ax = evaluateCurve(definition.velocityX, t, particle.velocityXRandom), ay = evaluateCurve(definition.velocityY, t, particle.velocityYRandom);
    const gravity = config.gravityY * evaluateCurve(definition.gravity, t, particle.gravityRandom);
    particle.x += (particle.vx + (definition.velocityInWorldSpace ? ax : particle.c * ax - particle.s * ay)) * STEP;
    particle.y += (particle.vy + (definition.velocityInWorldSpace ? ay : particle.s * ax + particle.c * ay)) * STEP + gravity * STEP * STEP / 2;
    particle.vy += gravity * STEP;
    particle.simulated += STEP;
  }
}

function particlePose(particle, age) {
  if (age >= particle.lifetime) return null;
  const t = clamp(age / particle.lifetime, 0, 1), definition = particle.definition, remaining = Math.max(0, age - particle.simulated);
  const vx = evaluateCurve(definition.velocityX, t, particle.velocityXRandom), vy = evaluateCurve(definition.velocityY, t, particle.velocityYRandom);
  const color = evaluateGradient(definition.colorOverLife, t).map((v, i) => v * particle.color[i]);
  // Unity原生噪声实现未恢复；保留原强度/频率，以有界连续扰动近似，不宣称逐粒轨迹相同。
  const noise = definition.noise, amplitude = noise.strength * noise.positionAmount;
  const phase = particle.noisePhase, clock = age * noise.frequency * Math.PI * 2;
  return {x:particle.x + (particle.vx + (definition.velocityInWorldSpace ? vx : particle.c * vx - particle.s * vy)) * remaining + amplitude * (Math.sin(phase + clock) - Math.sin(phase)), y:particle.y + (particle.vy + (definition.velocityInWorldSpace ? vy : particle.s * vx + particle.c * vy)) * remaining + amplitude * (Math.cos(phase + clock) - Math.cos(phase)), rotation:particle.rotation + particle.angularVelocity * age, size:particle.size * evaluateCurve(definition.sizeOverLife, t), color, frame:particle.frame, definition};
}

function createEffectModel(random = Math.random) {
  const bursts = [];
  return {bursts, emit(part) { const burst = createParticleBurst(part, random); if (burst.particles.length) bursts.push(burst); return burst.particles.length; }, update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const burst = bursts[i]; burst.age += dt;
      for (const particle of burst.particles) advanceParticle(particle, burst.age);
      if (burst.particles.every(particle => burst.age >= particle.lifetime)) bursts.splice(i, 1);
    }
  }, poses() { return bursts.flatMap(burst => burst.particles.map(particle => particlePose(particle, burst.age)).filter(Boolean)); }, resetLevel() { bursts.length = 0; }, get particleCount() { return bursts.reduce((sum, burst) => sum + burst.particles.filter(particle => burst.age < particle.lifetime).length, 0); }};
}

async function createReleaseEffects({canvas, createCanvas, loadImage, width, height, ratio = 1, random}) {
  const model = createEffectModel(random), paths = [...new Set(Object.values(config.systems).map(system => system.material.texture))];
  const images = Object.fromEntries(await Promise.all(paths.map(async path => [path, await loadImage(path)])));
  let gl = null;
  try { gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false, preserveDrawingBuffer:true}); } catch (_) {}
  let program, buffer, locations, textures;
  const tinted = new Map();
  if (gl) {
    function shader(type, source) {
      const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(value); gl.deleteShader(value); throw new Error('星粒子着色器编译失败：' + message); }
      return value;
    }
    const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 aPosition;attribute vec2 aUV;attribute vec4 aColor;uniform vec2 uViewport;varying vec2 vUV;varying vec4 vColor;void main(){gl_Position=vec4(aPosition/uViewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);vUV=aUV;vColor=aColor;}');
    // 对应原HsApp/UIParticle/3Blend无UI裁剪分支，输出预乘RGB、保留1.35亮度与8位顶点Alpha。
    const fragment = shader(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D uTexture;uniform float uIntensity;uniform vec4 uColor;varying vec2 vUV;varying vec4 vColor;void main(){vec4 tex=texture2D(uTexture,vUV);float value=vColor.a*255.0;float base=floor(value);float fraction=value-base;float rounded=base+(fraction>0.5?1.0:(fraction<0.5?0.0:mod(base,2.0)));float alpha=tex.a*rounded/255.0*uColor.a;gl_FragColor=vec4(tex.rgb*vColor.rgb*uIntensity*uColor.rgb*alpha,alpha);}');
    program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('星粒子着色器链接失败：' + gl.getProgramInfoLog(program));
    buffer = gl.createBuffer();
    locations = {position:gl.getAttribLocation(program, 'aPosition'), uv:gl.getAttribLocation(program, 'aUV'), color:gl.getAttribLocation(program, 'aColor'), viewport:gl.getUniformLocation(program, 'uViewport'), texture:gl.getUniformLocation(program, 'uTexture'), intensity:gl.getUniformLocation(program, 'uIntensity'), materialColor:gl.getUniformLocation(program, 'uColor')};
    textures = Object.fromEntries(paths.map(path => {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[path]); return [path, texture];
    }));
  }
  function resize(view) { width = view.width; height = view.height; ratio = view.ratio; canvas.width = gl ? 1 : Math.round(width * ratio); canvas.height = gl ? 1 : Math.round(height * ratio); }
  resize({width,height,ratio});
  function draw(ctx, camera) {
    const poses = model.poses();
    if (!poses.length) return false;
    ctx.save(); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (gl) {
      // 只在首次实际绘制时分配全尺寸附件，保持原视口和材质。
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [location, count, offset] of [[locations.position,2,0],[locations.uv,2,8],[locations.color,4,16]]) { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, count, gl.FLOAT, false, 32, offset); }
      gl.uniform2f(locations.viewport, width, height); gl.uniform1i(locations.texture, 0);
      for (const path of paths) {
        const vertices = [], selected = poses.filter(p => p.definition.material.texture === path);
        if (!selected.length) continue;
        for (const pose of selected) {
          const x = (pose.x - camera.x) * camera.scale + camera.cx, y = (camera.y - pose.y) * camera.scale + camera.cy, half = pose.size * camera.scale / 2, c = Math.cos(pose.rotation), s = -Math.sin(pose.rotation), uv = pose.definition.uv;
          const left = pose.frame % uv.tilesX / uv.tilesX, top = Math.floor(pose.frame / uv.tilesX) / uv.tilesY;
          for (const [dx,dy,u,v] of [[-1,-1,0,0],[1,-1,1,0],[-1,1,0,1],[-1,1,0,1],[1,-1,1,0],[1,1,1,1]]) vertices.push(x + half * (c * dx - s * dy), y + half * (s * dx + c * dy), left + u / uv.tilesX, top + v / uv.tilesY, ...pose.color);
        }
        const material = selected[0].definition.material;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures[path]); gl.uniform1f(locations.intensity, material.intensity); gl.uniform4fv(locations.materialColor, material.color);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW); gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 8);
      }
      finishGLFrame(gl); ctx.drawImage(canvas, 0, 0, width, height);
    } else if (createCanvas) {
      // 无WebGL时仍用原图Alpha；Canvas会截断HDR颜色，属于明确保留的回退差异。
      for (const pose of poses) {
        const material = pose.definition.material, path = material.texture, rgb = pose.color.slice(0,3).map((value,i) => Math.round(clamp(value * material.intensity * material.color[i],0,1) * 255));
        const key = path + ':' + rgb.join(',');
        if (!tinted.has(key)) { const target = createCanvas(); target.width = images[path].width; target.height = images[path].height; const context = target.getContext('2d'); context.drawImage(images[path], 0, 0); context.globalCompositeOperation = 'multiply'; context.fillStyle = 'rgb(' + rgb.join(',') + ')'; context.fillRect(0, 0, target.width, target.height); context.globalCompositeOperation = 'destination-in'; context.drawImage(images[path], 0, 0); tinted.set(key, target); }
        const atlas = tinted.get(key), uv = pose.definition.uv, sw = atlas.width / uv.tilesX, sh = atlas.height / uv.tilesY, size = pose.size * camera.scale;
        ctx.save(); ctx.translate((pose.x - camera.x) * camera.scale + camera.cx, (camera.y - pose.y) * camera.scale + camera.cy); ctx.rotate(-pose.rotation); ctx.globalAlpha *= Math.round(pose.color[3] * 255) / 255 * material.color[3];
        ctx.drawImage(atlas, pose.frame % uv.tilesX * sw, Math.floor(pose.frame / uv.tilesX) * sh, sw, sh, -size / 2, -size / 2, size, size); ctx.restore();
      }
    }
    ctx.restore(); return true;
  }
  return {emit:model.emit, update:model.update, draw, resetLevel:model.resetLevel, resize, get particleCount() { return model.particleCount; }, gl, dispose() { model.resetLevel(); tinted.clear(); if (gl) { gl.deleteBuffer(buffer); gl.deleteProgram(program); for (const texture of Object.values(textures)) gl.deleteTexture(texture); } }};
}

module.exports = {createReleaseEffects, createEffectModel, createParticleBurst, particlePose, evaluateCurve, evaluateKeys, evaluateGradient, createSurface, sampleSurface};
