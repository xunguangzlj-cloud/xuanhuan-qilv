'use strict';
const config = require('../assets/prop-effects/data-packed');
const rocketData = require('../assets/prop-effects/rocket-packed');
const { evaluateKeys } = require('./release-effects');
const { seededRandom } = require('./ambient-effects');
const { createCharacterRenderer, sampleCharacter, sampleTrack } = require('./character-animation');
const { createPropParticles } = require('./prop-particles');
const { createPropParticleRenderer } = require('./prop-particle-renderer');
const clamp = value => Math.max(0, Math.min(1, value));
const settings = config.settings;

// 输入与输出均为1080参考画布坐标；原路径计算的归一化Y轴朝上。
function buildRocketPath({ iconPoint, targetPoint, ringRect, centerX = 540 }, random = Math.random) {
  const start = { x: centerX, y: iconPoint.y - settings.rocketStartOffsetY }, end = { ...targetPoint };
  if (!ringRect || ringRect.w <= 0 || ringRect.h <= 0) return { points: [start, end], near: false };
  const normalize = p => ({ x: (p.x - ringRect.x) / ringRect.w, y: (ringRect.y + ringRect.h - p.y) / ringRect.h });
  const a = normalize(start), b = normalize(end), near = b.y < settings.rocketNearThresholdY;
  const range = value => value.x + (value.y - value.x) * random();
  const p1 = { x: range(settings[near ? 'rocketLowerP1XRange' : 'rocketUpperP1XRange']), y: .5 * b.y + settings[near ? 'rocketLowerP1YConst' : 'rocketUpperP1YConst'] };
  const points = [{ x: p1.x, y: a.y - 1 }, a, p1];
  if (near) points.push({ x: range(settings.rocketLowerP2XRange), y: .5 * (p1.y + b.y) + range(settings.rocketLowerP2YJitterRange) });
  points.push(b, { x: points[points.length - 1].x, y: b.y });
  return { near, points: points.map(p => ({ x: ringRect.x + p.x * ringRect.w, y: ringRect.y + ringRect.h - p.y * ringRect.h })) };
}

function sampleRocketPath(points, time) {
  if (points.length < 4) return { x: points[0].x + (points.at(-1).x - points[0].x) * time, y: points[0].y + (points.at(-1).y - points[0].y) * time };
  const segments = points.length - 3, progress = time * segments, index = Math.max(0, Math.min(segments - 1, Math.floor(progress))), t = progress - index;
  const p = points.slice(index, index + 4), output = {};
  for (const axis of ['x', 'y']) output[axis] = .5 * (2 * p[1][axis] + (-p[0][axis] + p[2][axis]) * t + (2 * p[0][axis] - 5 * p[1][axis] + 4 * p[2][axis] - p[3][axis]) * t * t + (-p[0][axis] + 3 * p[1][axis] - 3 * p[2][axis] + p[3][axis]) * t * t * t);
  return output;
}

function pathLength(points) {
  const pass = points.length >= 4 ? points.slice(1, -1) : points;
  return pass.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - pass[index].x, point.y - pass[index].y), 0);
}

function sampleAnimation(animation, path, attribute, age, fallback) {
  const curve = animation.float.find(c => c.path === path && c.attribute === attribute);
  return curve ? evaluateKeys(curve.keys, age) : fallback;
}

function sampleHammer(age) {
  const animation = config.hammerAnimation, q = animation.rotation[0].keys.map(keys => evaluateKeys(keys, age));
  const scale = animation.scale[0].keys.map(keys => evaluateKeys(keys, age));
  return { x: 105 + sampleAnimation(animation, 'gua/weizhi', 'm_AnchoredPosition.x', age, 102), y: -140 - sampleAnimation(animation, 'gua/weizhi', 'm_AnchoredPosition.y', age, -120), rotation: -2 * Math.atan2(q[2], q[3]), scale, imageX: -117, imageY: -159, alpha: sampleAnimation(animation, 'gua/weizhi/Image', 'm_Alpha', age, 1) };
}

function sampleRocketAppear(age) {
  const animation = config.rocketAnimation, scale = animation.scale[0].keys.map(keys => evaluateKeys(keys, age));
  return { scale, rocketY: sampleAnimation(animation, 'rocket', 'm_AnchoredPosition.y', age, 6), rootY: sampleAnimation(animation, '', 'm_AnchoredPosition.y', age, 0), alpha: sampleAnimation(animation, '', 'm_Alpha', age, 1), sparkAlpha: sampleAnimation(animation, 'rocket/eff_rocket_fly_lipao/rocket/guadian/eff_lipao_loop_spark', 'm_Alpha', age, 1), penAlpha: sampleAnimation(animation, 'eff_lipao_loop_pen', 'm_Alpha', age, 1) };
}

function createPropEffectsModel() {
  let actions = [], serial = 0, queued = [];
  function start(kind, options) {
    if (actions.some(a => !a.hitEmitted)) return null;
    const seed = options.seed === undefined ? Math.floor(Math.random() * 4294967296) : options.seed >>> 0;
    const action = { id: ++serial, kind, targetId: options.targetId, age: 0, seed, hitEmitted: false, completeEmitted: false, soundEmitted: false, shootEmitted: false };
    if (kind === 'hammer') { action.point = { ...options.point }; action.hitAt = settings.hammerBreakDelaySeconds; action.endAt = 2; }
    else {
      const path = buildRocketPath(options, seededRandom(seed)); action.points = path.points; action.near = path.near;
      action.flightDuration = Math.min(pathLength(path.points) / settings.rocketFlySpeed, settings[path.near ? 'rocketNearFlyDurationMax' : 'rocketFlyDurationMax']);
      action.hitAt = settings.rocketPrepareDuration + action.flightDuration; action.endAt = action.hitAt + 1.2;
      action.point = { ...(path.points.length >= 4 ? path.points.at(-2) : path.points.at(-1)) };
      action.position = { ...(path.points.length >= 4 ? path.points[1] : path.points[0]) }; action.rotation = 0;
      queued.push({ type: 'sound', name: 'ItemRocketFire', actionId: action.id });
    }
    actions.push(action); return action.id;
  }
  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return [];
    const events = queued; queued = [];
    for (const action of actions) {
      action.age += dt;
      if (action.kind === 'hammer' && !action.soundEmitted && action.age + 1e-10 >= settings.hammerHitSoundDelaySeconds) { action.soundEmitted = true; events.push({ type: 'sound', name: 'ItemHammerHit', actionId: action.id }); }
      if (action.kind === 'rocket') {
        if (!action.shootEmitted && action.age + 1e-10 >= settings.rocketPrepareDuration) { action.shootEmitted = true; events.push({ type: 'sound', name: 'ItemRocketShoot', actionId: action.id }); }
        const t = clamp((action.age - settings.rocketPrepareDuration) / (action.flightDuration || 1)), position = sampleRocketPath(action.points, evaluateKeys(settings.rocketFlyEase, t));
        const dx = position.x - action.position.x, dy = position.y - action.position.y;
        if (Math.hypot(dx, dy) > 1e-9) action.rotation = Math.atan2(dy, dx) + Math.PI / 2;
        action.position = position;
      }
      if (!action.hitEmitted && action.age + 1e-10 >= action.hitAt) {
        action.hitEmitted = true;
        if (action.kind === 'rocket') events.push({ type: 'sound', name: 'ItemRocketHit', actionId: action.id });
        events.push({ type: 'shake', kind: action.kind, actionId: action.id }, { type: 'hit', kind: action.kind, targetId: action.targetId, point: { ...action.point }, actionId: action.id });
      }
      if (!action.completeEmitted && action.age + 1e-10 >= action.endAt) { action.completeEmitted = true; events.push({ type: 'complete', kind: action.kind, targetId: action.targetId, actionId: action.id }); }
    }
    actions = actions.filter(a => !a.completeEmitted); return events;
  }
  return { startHammer: options => start('hammer', options), startRocket: options => start('rocket', options), update, reset() { actions = []; queued = []; }, get busy() { return actions.some(a => !a.hitEmitted); }, get actions() { return actions; }, snapshot() { return JSON.parse(JSON.stringify({ version: 1, serial, actions })); }, restore(snapshot) { if (!snapshot || snapshot.version !== 1) return false; serial = snapshot.serial; actions = JSON.parse(JSON.stringify(snapshot.actions)); queued = []; return true; } };
}

function drawRocketCanvas(ctx, image, pose, { x, y, alpha }) {
  const model=rocketData.characters.rocket;
  for(const draw of pose.draws){const attachment=model.attachments[draw.id];
    for(let triangle=0;triangle<attachment.triangles.length;triangle+=3){const indices=attachment.triangles.slice(triangle,triangle+3),p=indices.map(i=>[x+draw.vertices[i*2],y-draw.vertices[i*2+1],attachment.uvs[i*2]*image.width,attachment.uvs[i*2+1]*image.height]);
      const [a,b,c]=p,det=(b[2]-a[2])*(c[3]-a[3])-(c[2]-a[2])*(b[3]-a[3]);if(Math.abs(det)<1e-9)continue;
      const m0=((b[0]-a[0])*(c[3]-a[3])-(c[0]-a[0])*(b[3]-a[3]))/det,m1=((b[1]-a[1])*(c[3]-a[3])-(c[1]-a[1])*(b[3]-a[3]))/det,m2=((b[2]-a[2])*(c[0]-a[0])-(c[2]-a[2])*(b[0]-a[0]))/det,m3=((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/det;
      ctx.save();ctx.globalAlpha*=alpha*draw.color[3];ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(c[0],c[1]);ctx.closePath();ctx.clip();ctx.transform(m0,m1,m2,m3,a[0]-m0*a[2]-m2*a[3],a[1]-m1*a[2]-m3*a[3]);ctx.drawImage(image,0,0);ctx.restore();
    }
  }
}

async function createPropEffects({ canvas, createCanvas, characterCanvas, loadImage, width, height, ratio = 1, model = createPropEffectsModel() }) {
  const particleModels = new Map();
  const hammerImage = await loadImage(config.hammerImage);
  const rocketRenderer = await createCharacterRenderer({ canvas: characterCanvas || createCanvas(), loadImage, data: rocketData, character: 'rocket', width, height, ratio });
  const rocketFallbackImage = rocketRenderer ? null : await loadImage(rocketData.characters.rocket.image);
  const particleRenderer = await createPropParticleRenderer({ canvas: createCanvas(), createCanvas, loadImage, config, width, height, ratio });
  function draw(ctx, { coordinateScale = 1, time } = {}) {
    for (const action of model.actions) {
      let particles = particleModels.get(action.id);
      if (!particles) { particles = createPropParticles(action, config, (age, definition) => {
        if (action.kind === 'hammer' || definition.group === 'boom') return { x: action.point.x, y: action.point.y, scale: 1, rotation: 0 };
        const t = clamp((age - settings.rocketPrepareDuration) / (action.flightDuration || 1)), position = sampleRocketPath(action.points, evaluateKeys(settings.rocketFlyEase, t)), before = sampleRocketPath(action.points, evaluateKeys(settings.rocketFlyEase, clamp(t - .001))), appear = sampleRocketAppear(age);
        const rotation = Math.hypot(position.x-before.x, position.y-before.y) > 1e-8 ? Math.atan2(position.y-before.y, position.x-before.x) + Math.PI/2 : 0;
        return { x: position.x, y: position.y, ...appear, appearScale: appear.scale, scale: evaluateKeys(settings.rocketScaleCurve, t), rotation, tx: sampleTrack(rocketData.characters.rocket.animations.zhuan.bones[2], age).slice(1) };
      }); particleModels.set(action.id, particles); }
      const sprites = particles.sample(action.age, action);
      if (sprites.length) particleRenderer.draw(ctx, sprites, { coordinateScale, time: Number.isFinite(time) ? time : action.age });
      if (action.kind === 'hammer') {
        const pose = sampleHammer(action.age); if (pose.alpha <= 0) continue;
        ctx.save(); ctx.translate(action.point.x + pose.x, action.point.y + pose.y); ctx.rotate(pose.rotation); ctx.translate(pose.imageX, pose.imageY); ctx.scale(pose.scale[0], pose.scale[1]); ctx.globalAlpha *= pose.alpha; ctx.drawImage(hammerImage, -128, -128, 256, 256); ctx.restore();
      } else if (action.age < action.hitAt) {
        const appear = sampleRocketAppear(action.age), t = clamp((action.age - settings.rocketPrepareDuration) / (action.flightDuration || 1)), scale = evaluateKeys(settings.rocketScaleCurve, t), pose = sampleCharacter(rocketData.characters.rocket, 'zhuan', action.age);
        // 对原骨矩阵顶点施加原Animation的非均匀缩放与根旋转。
        const c = Math.cos(action.rotation), s = Math.sin(action.rotation);
        for (const draw of pose.draws) for (let i = 0; i < draw.vertices.length; i += 2) {
          const x = 1 + draw.vertices[i] * appear.scale[0], y = appear.rootY + appear.rocketY + draw.vertices[i + 1] * appear.scale[1];
          draw.vertices[i] = (c * x + s * y) * scale; draw.vertices[i + 1] = (-s * x + c * y) * scale;
        }
        if(rocketRenderer)rocketRenderer.draw(ctx, pose, { x: action.position.x, y: action.position.y, scale: 1, alpha: appear.alpha, coordinateScale });
        else drawRocketCanvas(ctx,rocketFallbackImage,pose,{x:action.position.x,y:action.position.y,alpha:appear.alpha});
      }
    }
    for (const id of particleModels.keys()) if (!model.actions.some(a => a.id === id)) particleModels.delete(id);
  }
  return { startHammer: model.startHammer, startRocket: model.startRocket, update: model.update, draw, snapshot: model.snapshot, restore(snapshot) { particleModels.clear(); return model.restore(snapshot); }, reset() { model.reset(); particleModels.clear(); }, resize(w, h, r = ratio) { if(rocketRenderer)rocketRenderer.resize({ width:w, height:h, ratio:r }); particleRenderer.resize({ width:w, height:h, ratio:r }); }, dispose() { model.reset(); particleModels.clear(); if(rocketRenderer)rocketRenderer.dispose(); particleRenderer.dispose(); }, get busy() { return model.busy; }, get actions() { return model.actions; }, backend: particleRenderer.backend, limitations: particleRenderer.limitations.concat(['噪声模块采用数值近似。','速度限幅采用240Hz数值近似，Canvas距离烟雾使用世界尺度换算。',...(rocketRenderer?[]:['无WebGL时使用原骨矩阵和图集的Canvas三角形回退，PMA边缘可能不同。'])]) };
}

module.exports = { createPropEffects, createPropEffectsModel, buildRocketPath, sampleRocketPath, pathLength, sampleHammer, sampleRocketAppear };
