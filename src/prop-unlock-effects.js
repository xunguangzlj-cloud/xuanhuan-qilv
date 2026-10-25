'use strict';
const config = require('../assets/unlock-effects/data-packed');
const { evaluateKeys } = require('./release-effects');
const { createPropParticles } = require('./prop-particles');
const { createPropParticleRenderer } = require('./prop-particle-renderer');

// XorShift32是GF(2)线性变换；跳过旧出生的随机抽样仍得到同一序列。
const randomStep = value => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; };
const randomPowers = [Array.from({ length: 32 }, (_, i) => randomStep(1 << i))];
function applyRandomPower(matrix, value) {
  let result = 0, bit = 0;
  for (; value; value >>>= 1, bit++) if (value & 1) result ^= matrix[bit];
  return result >>> 0;
}
function unlockRandom(seed) {
  let state = seed >>> 0 || 1;
  const random = () => (state = randomStep(state)) / 4294967296;
  random.skip = count => {
    for (let power = 0; count; count = Math.floor(count / 2), power++) {
      if (!randomPowers[power]) { const previous = randomPowers[power - 1]; randomPowers[power] = previous.map(value => applyRandomPower(previous, value)); }
      if (count % 2) state = applyRandomPower(randomPowers[power], state);
    }
  };
  return random;
}

// 布尔曲线按原阶跃键切换，精确到达键时采用新值。
function activeAt(keys, age) {
  let value = keys[0][1];
  for (const key of keys) { if (key[0] > age) break; value = key[1]; }
  return value > .5;
}

function sampleUnlockLayer(intro, layer) {
  const group = config.layers[layer];
  if (!intro || !group) return { visible: false, age: 0, alpha: 0 };
  const closing = !!intro.closing, time = closing ? intro.closeAge : intro.age;
  const curves = config.timelines[closing ? 'close' : 'open'][group];
  const visible = activeAt(curves.m_IsActive, time);
  const activated = config.timelines.open[group].m_IsActive.find(key => key[1] > .5);
  let age = time;
  if (layer === 'boom02') age -= curves.m_IsActive.find(key => key[1] > .5)?.[0] || 0;
  else {
    const openAge = closing ? intro.age - intro.closeAge : intro.age;
    age = intro.age - Math.min(activated[0], closing ? openAge : activated[0]);
  }
  return { visible, age: Math.max(0, age), alpha: curves.m_Alpha ? evaluateKeys(curves.m_Alpha, time) : 1 };
}

function createUnlockParticleModel(random = Math.random) {
  let states = new WeakMap();
  function sample(layer, intro, anchor) {
    const pose = sampleUnlockLayer(intro, layer);
    if (!pose.visible || pose.alpha <= 0) return [];
    let state = states.get(intro);
    if (!state) { state = { seed: Math.floor(random() * 4294967296), models: new Map(), anchor }; states.set(intro, state); }
    state.anchor = anchor;
    const group = config.layers[layer], horizon = Math.max(5, Math.ceil(pose.age / 5) * 5);
    let item = state.models.get(layer);
    if (!item || pose.age > item.horizon || pose.age < item.age) {
      const action = { kind: 'unlock', group, seed: state.seed, endAt: horizon, point: anchor, randomFactory: unlockRandom };
      // 原生loop/dd跨horizon保留状态；同组其他发射器仍沿原窗口生成。
      if(layer==='loop')action.autoLoopState=state.autoLoopState||(state.autoLoopState={});
      // 原两种loop的最大寿命为2秒，rate恒定且粒子上限不会截断出生。
      if (layer === 'loop' && pose.age > 30) action.birthStart = Math.floor((pose.age - 2) / 5) * 5;
      const root = config.roots[group];
      item = { horizon, age: 0, particles: createPropParticles(action, config, () => ({ x: state.anchor.x + root[0], y: state.anchor.y - root[1], scale: 1, rotation: 0 })) };
      state.models.set(layer, item);
    }
    item.age = pose.age;
    const sprites = item.particles.sample(pose.age);
    for (const sprite of sprites) sprite.color[3] *= pose.alpha;
    return sprites;
  }
  return { sample, reset() { states = new WeakMap(); } };
}

async function createPropUnlockEffects(options) {
  const renderer = await createPropParticleRenderer({ ...options, config });
  const model = createUnlockParticleModel();
  return {
    draw(ctx, layer, intro, anchor, options) { return renderer.draw(ctx, model.sample(layer, intro, anchor), options); },
    resize: renderer.resize,
    dispose() { model.reset(); renderer.dispose(); },
    backend: renderer.backend,
    limitations: renderer.limitations.concat(['原固定seed boom01/dd已接入同版实测首观察态与Noise/限速/240Hz轨迹；首步前、ARM及位级轨迹等价未证。','原固定seed caidai_tuowei已接入同版首态后的Noise/重力/限速/轨道/240Hz轨迹与活动Trail环；宽度颜色网格、ARM及首步前仍未证。','boom02的完整出生与轨迹已通过给定非零systemSeed的同版留出；移植层使用既有action种子，原平台auto来源、ARM和最终渲染仍未证。','loop/dd的完整预热、持续出生和Noise轨迹已通过给定非零systemSeed的同版留出；原auto来源、ARM、Canvas/UIParticle与最终渲染仍未证。'])
  };
}

module.exports = { createPropUnlockEffects, createUnlockParticleModel, sampleUnlockLayer };
