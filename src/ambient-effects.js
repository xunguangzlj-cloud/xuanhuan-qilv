'use strict';
const { finishGLFrame } = require('./gl-frame-sync');

const config = require('../assets/ambient/ambient-data');
const {evaluateCurve, evaluateGradient} = require('./release-effects');
const STEP = 1 / 240;
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// 原系统关闭自动种子；重复开结算页使用相同序列，原生随机算法仍是保留差异。
function seededRandom(seed) {
  let state = seed | 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

function rotateEuler(point, angles) {
  const [x, y, z] = angles.map(value => value * DEG);
  const cz = Math.cos(z), sz = Math.sin(z), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
  const a = cz * point[0] - sz * point[1], b = sz * point[0] + cz * point[1];
  const c = cx * b - sx * point[2], d = sx * b + cx * point[2];
  return [cy * a + sy * d, c, -sy * a + cy * d];
}

function sampleShape(shape, random) {
  let point, direction;
  if (shape.type === 8) {
    // 原ConeVolume的尺寸和朝向；均匀体积采样不等于Unity未公开的随机实现。
    const slope = Math.tan(shape.angle * DEG), first = shape.radius, last = first + shape.length * slope;
    const height = Math.abs(slope) < 1e-8 ? random() * shape.length : (Math.cbrt(first ** 3 + random() * (last ** 3 - first ** 3)) - first) / slope;
    const angle = random() * Math.PI * 2, radius = (first + height * slope) * Math.sqrt(random());
    point = [radius * Math.cos(angle), radius * Math.sin(angle), height];
    const v = [point[0], point[1], first / Math.max(slope, 1e-8) + height], length = Math.hypot(...v);
    direction = v.map(value => value / length);
  } else if (shape.type === 5) {
    point = shape.scale.map(value => (random() - .5) * value);
    direction = [0, 0, 1];
  } else {
    throw new Error('未恢复的胜利环境发射形状：' + shape.type);
  }
  if (shape.type !== 5) point = point.map((value, i) => value * shape.scale[i]);
  point = rotateEuler(point, shape.rotation).map((value, i) => value + shape.position[i]);
  direction = rotateEuler(direction, shape.rotation);
  return {point, direction};
}

function createAmbientParticle(definition, random, born = 0) {
  const shape = sampleShape(definition.shape, random), speed = evaluateCurve(definition.speed, 0, random());
  const color = evaluateGradient(definition.startColor, random()).map(value => Math.round(clamp(value, 0, 1) * 255) / 255);
  const rotation = evaluateCurve(definition.rotation, 0, random()) * (random() < definition.rotationDirectionRandom ? -1 : 1);
  return {definition, born, lifetime:evaluateCurve(definition.lifetime, 0, random()), size:evaluateCurve(definition.size, 0, random()), rotation, angularVelocity:evaluateCurve(definition.angularVelocity, 0, random()), color, frameRandom:random(), gravityRandom:random(), velocityRandom:[random(),random(),random()], speedRandom:random(), limitRandom:random(), position:shape.point.map((value, i) => value + (definition.offset[i] || 0)), velocity:shape.direction.map(value => value * speed), simulated:0};
}

function velocityAt(particle, age) {
  const d = particle.definition, t = clamp(age / particle.lifetime, 0, 1);
  const speed = evaluateCurve(d.speedModifier, t, particle.speedRandom);
  const v = [d.velocityX,d.velocityY,d.velocityZ].map((curve,i) => (particle.velocity[i] + evaluateCurve(curve, t, particle.velocityRandom[i])) * speed);
  return {v, t};
}

function advance(particle, dt) {
  const d = particle.definition, age = particle.simulated + dt / 2;
  const {v, t} = velocityAt(particle, age);
  const speed = Math.hypot(...v), limit = evaluateCurve(d.limitSpeed, t, particle.limitRandom);
  // 原速度限制阻尼由Unity原生求解。这里按240Hz积分并保留60Hz阻尼率，轨迹属于数值近似。
  const damping = speed > limit ? (limit + (speed - limit) * ((1 - d.dampen) ** (dt * 60))) / speed : 1;
  const gravity = config.gravityY * evaluateCurve(d.gravity, t, particle.gravityRandom);
  for (let i = 0; i < 3; i++) {
    particle.position[i] += v[i] * damping * dt + (i === 1 ? gravity * dt * dt / 2 : 0);
    particle.velocity[i] *= damping;
  }
  particle.velocity[1] += gravity * dt;
  particle.simulated += dt;
}

function ambientPose(particle, age) {
  age -= particle.born;
  if (age < 0 || age >= particle.lifetime) return null;
  const remaining = Math.max(0, age - particle.simulated), copy = {...particle, position:particle.position.slice(), velocity:particle.velocity.slice()};
  if (remaining) advance(copy, remaining);
  const d = particle.definition, t = age / particle.lifetime, uv = d.uv;
  const frame = uv.enabled ? evaluateCurve(uv.startFrame, 0, particle.frameRandom) + evaluateCurve(uv.frameOverTime, t, particle.frameRandom) * uv.cycles : 0;
  return {x:copy.position[0], y:copy.position[1], z:copy.position[2], size:particle.size * evaluateCurve(d.sizeOverLife, t), rotation:particle.rotation + particle.angularVelocity * age, color:evaluateGradient(d.colorOverLife, t).map((value,i) => value * particle.color[i]), frame:Math.floor(((frame % 1) + 1) % 1 * uv.tilesX * uv.tilesY), definition:d};
}

function createAmbientModel(random) {
  let age = 0;
  const particles = [];
  function reset() { particles.length = 0; age = 0; }
  return {particles, emit() {
    reset();
    for (const d of config.systems) {
      const rng = random || seededRandom(d.randomSeed), delay = evaluateCurve(d.startDelay, 0, rng());
      let count = 0;
      for (const burst of d.bursts) for (let cycle = 0; cycle < burst.cycles; cycle++) {
        if (burst.probability < 1 && rng() > burst.probability) continue;
        const total = Math.min(d.maxParticles - count, Math.floor(evaluateCurve(burst.count, 0, rng())));
        for (let i = 0; i < total; i++) particles.push(createAmbientParticle(d, rng, delay + burst.time + cycle * burst.interval));
        count += total;
      }
    }
    return particles.length;
  }, update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    age += dt;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i], target = Math.min(p.lifetime, age - p.born);
      while (p.simulated + STEP <= target + 1e-10) advance(p, STEP);
      if (age - p.born >= p.lifetime) particles.splice(i, 1);
    }
  }, poses() { return particles.map(p => ambientPose(p, age)).filter(Boolean); }, reset, get age() { return age; }, get particleCount() { return particles.filter(p => age >= p.born && age < p.born + p.lifetime).length; }};
}

function buildAmbientVertices(poses, mount) {
  const vertices = [], scale = mount.scale * config.uiParticleScale;
  for (const pose of poses) {
    const x = mount.x + pose.x * scale, y = mount.y - pose.y * scale, half = pose.size * scale / 2, c = Math.cos(pose.rotation), s = -Math.sin(pose.rotation), uv = pose.definition.uv;
    const left = pose.frame % uv.tilesX / uv.tilesX, top = Math.floor(pose.frame / uv.tilesX) / uv.tilesY;
    const color = pose.color.slice(); color[3] *= mount.alpha == null ? 1 : mount.alpha;
    for (const [dx,dy,u,v] of [[-1,-1,0,0],[1,-1,1,0],[-1,1,0,1],[-1,1,0,1],[1,-1,1,0],[1,1,1,1]]) vertices.push(x + half * (c * dx - s * dy), y + half * (s * dx + c * dy), left + u / uv.tilesX, top + v / uv.tilesY, ...color);
  }
  return new Float32Array(vertices);
}

async function createAmbientEffects({canvas, createCanvas, loadImage, width, height, ratio = 1, random}) {
  const model = createAmbientModel(random), definitions = config.systems;
  const images = Object.fromEntries(await Promise.all(definitions.map(async d => [d.material.texture, await loadImage(d.material.texture)])));
  let gl = null;
  try { gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false, preserveDrawingBuffer:true}); } catch (_) {}
  let program, buffer, locations;
  const textures = {}, tinted = new Map();
  if (gl) {
    function shader(type, source) { const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value); if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(value); gl.deleteShader(value); throw new Error('胜利环境着色器编译失败：' + error); } return value; }
    const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 aPosition;attribute vec2 aUV;attribute vec4 aColor;uniform vec2 uViewport;varying vec2 vUV;varying vec4 vColor;void main(){gl_Position=vec4(aPosition/uViewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);vUV=aUV;vColor=aColor;}');
    // 原编译GLSL为2*顶点色*TintColor*贴图、SrcAlpha/OneMinusSrcAlpha、ColorMask RGB。
    // 离屏Canvas输出等价的预乘RGB与覆盖率Alpha，再合成到主Canvas，避免二次预乘。
    const fragment = shader(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D uTexture;uniform vec4 uTint;varying vec2 vUV;varying vec4 vColor;void main(){vec4 value=2.0*vColor*uTint*texture2D(uTexture,vUV);float alpha=clamp(value.a,0.0,1.0);gl_FragColor=vec4(value.rgb*alpha,alpha);}');
    program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('胜利环境着色器链接失败：' + gl.getProgramInfoLog(program));
    buffer = gl.createBuffer();
    locations = {position:gl.getAttribLocation(program,'aPosition'),uv:gl.getAttribLocation(program,'aUV'),color:gl.getAttribLocation(program,'aColor'),viewport:gl.getUniformLocation(program,'uViewport'),texture:gl.getUniformLocation(program,'uTexture'),tint:gl.getUniformLocation(program,'uTint')};
    for (const [path,image] of Object.entries(images)) {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image); textures[path] = texture;
    }
  }
  function resize(view) { width = view.width; height = view.height; ratio = view.ratio; canvas.width = gl ? 1 : Math.round(width * ratio); canvas.height = gl ? 1 : Math.round(height * ratio); }
  resize({width,height,ratio});
  function draw(ctx, mount = {x:width/2,y:height/2-366*width/1080,scale:width/1080}) {
    const poses = model.poses();
    if (!poses.length) return false;
    // 与角色绘制一致：UI回调传1080参考坐标和coordinateScale，保留父级入场矩阵与CanvasGroup透明度。
    const coordinateScale = mount.coordinateScale || 1;
    ctx.save();
    if (gl) {
      // 只在首次实际绘制时分配全尺寸附件，保持原视口和材质。
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      gl.viewport(0,0,canvas.width,canvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      for (const [location,count,offset] of [[locations.position,2,0],[locations.uv,2,8],[locations.color,4,16]]) { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,count,gl.FLOAT,false,32,offset); }
      gl.uniform2f(locations.viewport,width,height); gl.uniform1i(locations.texture,0);
      for (const d of definitions) {
        const selected = poses.filter(p => p.definition === d);
        if (!selected.length) continue;
        const vertices = buildAmbientVertices(selected,{...mount,x:mount.x*coordinateScale,y:mount.y*coordinateScale,scale:mount.scale*coordinateScale});
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,textures[d.material.texture]); gl.uniform4fv(locations.tint,d.material.tint); gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW); gl.drawArrays(gl.TRIANGLES,0,vertices.length/8);
      }
      finishGLFrame(gl); ctx.drawImage(canvas,0,0,width/coordinateScale,height/coordinateScale);
    } else if (createCanvas) {
      // 回退保留原PNG和Alpha；Canvas的乘色会截断HDR亮度，属于保留差异。
      for (const pose of poses) {
        const material = pose.definition.material, path = material.texture, rgb = pose.color.slice(0,3).map((value,i) => Math.round(clamp(2*value*material.tint[i],0,1)*255)), key = path+':'+rgb.join(',');
        if (!tinted.has(key)) { const target=createCanvas(); target.width=images[path].width; target.height=images[path].height; const context=target.getContext('2d'); context.drawImage(images[path],0,0); context.globalCompositeOperation='multiply'; context.fillStyle='rgb('+rgb.join(',')+')'; context.fillRect(0,0,target.width,target.height); context.globalCompositeOperation='destination-in'; context.drawImage(images[path],0,0); tinted.set(key,target); }
        const atlas=tinted.get(key), uv=pose.definition.uv, sw=atlas.width/uv.tilesX, sh=atlas.height/uv.tilesY, scale=mount.scale*config.uiParticleScale, size=pose.size*scale;
        ctx.save(); ctx.translate(mount.x+pose.x*scale,mount.y-pose.y*scale); ctx.rotate(-pose.rotation); ctx.globalAlpha*=clamp(2*pose.color[3]*material.tint[3],0,1)*(mount.alpha==null?1:mount.alpha); ctx.drawImage(atlas,pose.frame%uv.tilesX*sw,Math.floor(pose.frame/uv.tilesX)*sh,sw,sh,-size/2,-size/2,size,size); ctx.restore();
      }
    }
    ctx.restore(); return true;
  }
  return {emit:model.emit,update:model.update,draw,reset:model.reset,resize,get particleCount(){return model.particleCount;},get age(){return model.age;},gl,dispose(){model.reset();tinted.clear();if(gl){gl.deleteBuffer(buffer);gl.deleteProgram(program);for(const texture of Object.values(textures))gl.deleteTexture(texture);}}};
}

module.exports = {createAmbientEffects,createAmbientModel,createAmbientParticle,ambientPose,buildAmbientVertices,sampleShape,rotateEuler,seededRandom};
