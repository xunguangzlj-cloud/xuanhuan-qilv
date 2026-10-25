'use strict';
const { finishGLFrame } = require('./gl-frame-sync');
const config = require('../assets/chest-effects/effects-data');
const { evaluateCurve, evaluateGradient } = require('./release-effects');
const { rotateEuler, seededRandom } = require('./ambient-effects');
const STEP = 1 / 240, DEG = Math.PI / 180;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

function sampleChestShape(shape, random) {
  const angle = random() * shape.arc * DEG;
  const inner = 1 - shape.radiusThickness;
  const radius = shape.radius * Math.sqrt(inner * inner + random() * (1 - inner * inner));
  let point = [Math.cos(angle) * radius, Math.sin(angle) * radius, 0], direction;
  if (shape.type === 4) {
    const slope = Math.sin(shape.angle * DEG) * (shape.radius ? radius / shape.radius : 0);
    const z = Math.cos(shape.angle * DEG), length = Math.hypot(slope, z);
    direction = [Math.cos(angle) * slope / length, Math.sin(angle) * slope / length, z / length];
  } else if (shape.type === 10) direction = [Math.cos(angle), Math.sin(angle), 0];
  else throw new Error('未覆盖的原宝箱粒子形状：' + shape.type);
  point = rotateEuler(point.map((v, i) => v * shape.scale[i]), shape.rotation).map((v, i) => v + shape.position[i]);
  return { point, direction: rotateEuler(direction, shape.rotation) };
}

function createParticle(definition, born, random) {
  const shape = sampleChestShape(definition.shape, random), speed = evaluateCurve(definition.speed, 0, random());
  const colorMix = random();
  const color = definition.startColorMode === 0 ? definition.startMaxColor.slice() : definition.startColorMode === 2 ? definition.startMinColor.map((v, i) => v + (definition.startMaxColor[i] - v) * colorMix) : evaluateGradient(definition.startColor, colorMix);
  const rotation = evaluateCurve(definition.rotation, 0, random()) * (random() < definition.rotationDirectionRandom ? -1 : 1);
  return { definition, born, lifetime: evaluateCurve(definition.lifetime, 0, random()), size: evaluateCurve(definition.size, 0, random()), rotation, angularVelocity: definition.rotationEnabled ? evaluateCurve(definition.angularVelocity, 0, random()) : 0, color: color.map(v => Math.round(clamp(v) * 255) / 255), position: shape.point.map((v, i) => v + definition.offset[i]), velocity: shape.direction.map(v => v * speed), simulated: 0, speedRandom: random(), limitRandom: random(), velocityRandom: [random(), random(), random()], gravityRandom: random(), frameRandom: random(), origin: null };
}

function advance(particle, dt) {
  const d = particle.definition, t = clamp((particle.simulated + dt / 2) / particle.lifetime);
  const modifier = d.velocityEnabled ? evaluateCurve(d.speedModifier, t, particle.speedRandom) : 1;
  const velocity = [d.velocityX, d.velocityY, d.velocityZ].map((curve, i) => (particle.velocity[i] + (d.velocityEnabled ? evaluateCurve(curve, t, particle.velocityRandom[i]) : 0)) * modifier);
  const speed = Math.hypot(...velocity), limit = d.limitEnabled ? evaluateCurve(d.limitSpeed, t, particle.limitRandom) : Infinity;
  const damping = speed > limit ? (limit + (speed - limit) * (1 - d.dampen) ** (dt * 60)) / speed : 1;
  const gravity = config.gravityY * evaluateCurve(d.gravity, t, particle.gravityRandom);
  for (let i = 0; i < 3; i++) { particle.position[i] += velocity[i] * damping * dt + (i === 1 ? gravity * dt * dt / 2 : 0); particle.velocity[i] *= damping; }
  particle.velocity[1] += gravity * dt; particle.simulated += dt;
}

function pose(particle, groupAge) {
  const age = groupAge - particle.born;
  if (age < -1e-10 || age >= particle.lifetime - 1e-10) return null;
  const copy = { ...particle, position: particle.position.slice(), velocity: particle.velocity.slice() };
  if (age > particle.simulated) advance(copy, age - particle.simulated);
  const d = particle.definition, t = age / particle.lifetime, uv = d.uv;
  const frame = uv.enabled ? evaluateCurve(uv.startFrame, 0, particle.frameRandom) + evaluateCurve(uv.frameOverTime, t, particle.frameRandom) * uv.cycles : 0;
  return { x: copy.position[0], y: copy.position[1], size: particle.size * evaluateCurve(d.sizeOverLife, t), rotation: particle.rotation + particle.angularVelocity * age, color: evaluateGradient(d.colorOverLife, t).map((v, i) => v * particle.color[i]), frame: Math.floor(((frame % 1) + 1) % 1 * uv.tilesX * uv.tilesY), definition: d, origin: d.simulationSpace === 1 ? particle.origin : null };
}

function makeGroup(definitions, randomOverride) {
  const particles = [];
  let age = -1, lastAnchor = null, finishedAt = Infinity;
  function reset() { particles.length = 0; age = -1; lastAnchor = null; finishedAt = Infinity; }
  function start() {
    reset(); age = 0;
    for (const d of definitions) {
      const random = randomOverride || (d.autoRandomSeed ? Math.random : seededRandom(d.randomSeed)), delay = evaluateCurve(d.startDelay, 0, random()), births = [];
      for (const burst of d.bursts) for (let cycle = 0; cycle < burst.cycles; cycle++) {
        if (burst.probability < 1 && random() > burst.probability) continue;
        const count = Math.floor(evaluateCurve(burst.count, 0, random()));
        for (let index = 0; index < count; index++) births.push(delay + burst.time + cycle * burst.interval);
      }
      // 当前原分支的连续发射率均为常量，按累计发射数保留跨帧一致性。
      const rate = evaluateCurve(d.rateOverTime, 0, random());
      if (rate > 0) for (let index = 1; index <= Math.floor(d.duration * rate + 1e-5); index++) births.push(delay + index / rate);
      births.sort((a, b) => a - b);
      for (const born of births.slice(0, d.maxParticles)) particles.push(createParticle(d, born, random));
    }
    return particles.length;
  }
  function update(dt) {
    if (age < 0 || !Number.isFinite(dt) || dt <= 0) return;
    age += dt;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.born > finishedAt + 1e-10 || age - p.born >= p.lifetime - 1e-10) { particles.splice(i, 1); continue; }
      const target = Math.max(0, age - p.born);
      while (p.simulated + STEP <= target + 1e-10) advance(p, STEP);
    }
  }
  function setAnchor(mount) {
    const previous = lastAnchor || { ...mount, age };
    for (const p of particles) if (p.definition.simulationSpace === 1 && p.born <= age + 1e-10 && !p.origin) {
      const mix = age > previous.age ? clamp((p.born - previous.age) / (age - previous.age)) : 1;
      p.origin = { x: previous.x + (mount.x - previous.x) * mix, y: previous.y + (mount.y - previous.y) * mix, scale: previous.scale + (mount.scale - previous.scale) * mix };
    }
    lastAnchor = { ...mount, age };
  }
  return { start, update, reset, setAnchor, finish() { finishedAt = age; }, poses() { return particles.map(p => pose(p, age)).filter(Boolean); }, get age() { return age; }, get particleCount() { return particles.filter(p => p.born <= age + 1e-10 && age - p.born < p.lifetime - 1e-10).length; }, get scheduledCount() { return particles.length; } };
}

function createChestEffectsModel(random) {
  const trail = makeGroup(config.trail, random), boom = makeGroup(config.boom, random);
  return { trail, boom, startProgress: trail.start, finishProgress({ full = false } = {}) { trail.finish(); if (full) return boom.start(); return 0; }, update(dt) { trail.update(dt); boom.update(dt); }, reset() { trail.reset(); boom.reset(); } };
}

function buildChestVertices(poses, mount) {
  const vertices = [];
  for (const p of poses) {
    const origin = p.origin || mount, scale = origin.scale * config.uiParticleScale;
    const x = origin.x + p.x * scale, y = origin.y - p.y * scale, half = p.size * scale / 2, c = Math.cos(p.rotation), s = -Math.sin(p.rotation), uv = p.definition.uv;
    const left = p.frame % uv.tilesX / uv.tilesX, top = Math.floor(p.frame / uv.tilesX) / uv.tilesY;
    for (const [dx, dy, u, v] of [[-1,-1,0,0],[1,-1,1,0],[-1,1,0,1],[-1,1,0,1],[1,-1,1,0],[1,1,1,1]]) vertices.push(x + half * (c * dx - s * dy), y + half * (s * dx + c * dy), left + u / uv.tilesX, top + v / uv.tilesY, ...p.color);
  }
  return new Float32Array(vertices);
}

async function createChestEffects({ canvas, createCanvas, loadImage, width, height, ratio = 1 }) {
  const model = createChestEffectsModel(), definitions = config.trail.concat(config.boom), paths = [...new Set(definitions.map(d => d.material.texture))];
  const images = Object.fromEntries(await Promise.all(paths.map(async path => [path, await loadImage(path)])));
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true }); } catch (_) {}
  let program, buffer, locations;
  const textures = {}, tinted = new Map();
  if (gl) {
    function shader(type, source) { const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value); if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(value); gl.deleteShader(value); throw new Error('宝箱特效着色器编译失败：' + error); } return value; }
    const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 aPosition;attribute vec2 aUV;attribute vec4 aColor;uniform vec2 uViewport;varying vec2 vUV;varying vec4 vColor;void main(){gl_Position=vec4(aPosition/uViewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);vUV=aUV;vColor=aColor;}');
    // 两种原GLSL的颜色公式相同，区别在Alpha Blended与Additive的目标混合因子。
    const fragment = shader(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D uTexture;uniform vec4 uTint;varying vec2 vUV;varying vec4 vColor;void main(){vec4 value=2.0*vColor*uTint*texture2D(uTexture,vUV);float alpha=clamp(value.a,0.0,1.0);gl_FragColor=vec4(value.rgb*alpha,alpha);}');
    program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('宝箱特效着色器链接失败：' + gl.getProgramInfoLog(program));
    buffer = gl.createBuffer();
    locations = { position: gl.getAttribLocation(program,'aPosition'), uv: gl.getAttribLocation(program,'aUV'), color: gl.getAttribLocation(program,'aColor'), viewport: gl.getUniformLocation(program,'uViewport'), texture: gl.getUniformLocation(program,'uTexture'), tint: gl.getUniformLocation(program,'uTint') };
    for (const path of paths) {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,images[path]); textures[path] = texture;
    }
  }
  function resize(view) { width = view.width; height = view.height; ratio = view.ratio; canvas.width = gl ? 1 : Math.round(width * ratio); canvas.height = gl ? 1 : Math.round(height * ratio); }
  resize({ width, height, ratio });
  function draw(ctx, mount, group) {
    group.setAnchor(mount);
    const poses = group.poses(); if (!poses.length) return false;
    const coordinateScale = mount.coordinateScale || 1;
    ctx.save();
    if (gl) {
      // 只在首次实际绘制时分配全尺寸附件，保持原视口和材质。
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      gl.viewport(0,0,canvas.width,canvas.height); gl.useProgram(program); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      for (const [location,count,offset] of [[locations.position,2,0],[locations.uv,2,8],[locations.color,4,16]]) { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,count,gl.FLOAT,false,32,offset); }
      gl.uniform2f(locations.viewport,width,height); gl.uniform1i(locations.texture,0);
      for (const d of definitions) {
        const selected = poses.filter(p => p.definition === d); if (!selected.length) continue;
        const additive = d.material.shader.endsWith('/Additive');
        const vertices = buildChestVertices(selected.map(p => ({ ...p, origin: p.origin ? { x: p.origin.x * coordinateScale, y: p.origin.y * coordinateScale, scale: p.origin.scale * coordinateScale } : null })), { x: mount.x * coordinateScale, y: mount.y * coordinateScale, scale: mount.scale * coordinateScale });
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,textures[d.material.texture]); gl.uniform4fv(locations.tint,d.material.tint); gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW); gl.drawArrays(gl.TRIANGLES,0,vertices.length/8);
        ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over'; finishGLFrame(gl); ctx.drawImage(canvas,0,0,width/coordinateScale,height/coordinateScale);
      }
    } else if (createCanvas) {
      // Canvas回退保留原图、混合类型和Alpha；RGB乘色超过1的HDR部分仍会被截断。
      for (const p of poses) {
        const material = p.definition.material, path = material.texture, rgb = p.color.slice(0,3).map((v,i) => Math.round(clamp(2 * v * material.tint[i]) * 255)), key = path + ':' + rgb.join(',');
        if (!tinted.has(key)) { const target = createCanvas(); target.width = images[path].width; target.height = images[path].height; const context = target.getContext('2d'); context.drawImage(images[path],0,0); context.globalCompositeOperation = 'multiply'; context.fillStyle = 'rgb(' + rgb.join(',') + ')'; context.fillRect(0,0,target.width,target.height); context.globalCompositeOperation = 'destination-in'; context.drawImage(images[path],0,0); tinted.set(key,target); }
        const image = tinted.get(key), uv = p.definition.uv, sw = image.width / uv.tilesX, sh = image.height / uv.tilesY, origin = p.origin || mount, scale = origin.scale * config.uiParticleScale, size = p.size * scale;
        ctx.save(); ctx.globalCompositeOperation = material.shader.endsWith('/Additive') ? 'lighter' : 'source-over'; ctx.translate(origin.x + p.x * scale, origin.y - p.y * scale); ctx.rotate(-p.rotation); ctx.globalAlpha *= clamp(2 * p.color[3] * material.tint[3]); ctx.drawImage(image,p.frame % uv.tilesX * sw,Math.floor(p.frame / uv.tilesX) * sh,sw,sh,-size/2,-size/2,size,size); ctx.restore();
      }
    }
    ctx.restore(); return true;
  }
  return { startProgress: model.startProgress, finishProgress: model.finishProgress, update: model.update, reset: model.reset, drawTrail(ctx,mount) { return draw(ctx,mount,model.trail); }, drawBoom(ctx,mount) { return draw(ctx,mount,model.boom); }, resize, model, gl, dispose() { model.reset(); tinted.clear(); if (gl) { gl.deleteBuffer(buffer); gl.deleteProgram(program); for (const texture of Object.values(textures)) gl.deleteTexture(texture); } } };
}

module.exports = { createChestEffects, createChestEffectsModel, sampleChestShape, buildChestVertices };
