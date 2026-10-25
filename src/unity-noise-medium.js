'use strict';
// 冻结ESM候选的机械CJS包装；下列源摘要须与外部实测记录一起审查，静态旧注释保持原文。
// 原源SHA256：c94650a8b855d7cba632824c1422d98b879d5c560b2c3617d2fbf766f795c686
const { permutation } = require('./unity-noise-tables');

// 同版Windows有限实测已核验的算术核；本轮运行接入仅固定boom01/dd，ARM与通用等价未批准。

const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));
const buffer = new ArrayBuffer(4);
const view = new DataView(buffer);
function fromBits(bits) { view.setUint32(0, bits, true); return view.getFloat32(0, true); }
function toBits(value) { view.setFloat32(0, value, true); return view.getUint32(0, true); }

// 轴向四项直接来自0x4c214d0；对角四项来自初始化0x7e670的sqrtss/divss顺序。
const diagonal = div(1, f(Math.sqrt(f(2))));
const gradients = Object.freeze([
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [diagonal, diagonal], [-diagonal, diagonal], [diagonal, -diagonal], [-diagonal, -diagonal],
].map(Object.freeze));

function requireFinite(values) {
  if (!values.every(Number.isFinite)) throw new RangeError('候选只接受有限输入');
}

// RandN构造0x1ffb5c0；系统seed的标量展开0x20ad110..0x20ad1d0。
// 这是四个uint32状态的Unity Rand流，不能换成现工程的一状态XorShift32。
function randWords(seed, count) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed必须是uint32');
  let a = seed >>> 0;
  let b = (Math.imul(a, 0x6c078965) + 1) >>> 0;
  let c = (Math.imul(b, 0x6c078965) + 1) >>> 0;
  let d = (Math.imul(c, 0x6c078965) + 1) >>> 0;
  const result = [];
  for (let i = 0; i < count; i++) {
    const t = (a ^ (a << 11)) >>> 0;
    [a, b, c] = [b, c, d];
    d = (d ^ (d >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    result.push(d);
  }
  return result;
}

// 0x34000001是原常量，不以JS双精度1/2^23代替。位置平移在0x20b3cdd乘100。
const unitScale = fromBits(0x34000001);
function systemSeedOffset(seed) {
  return randWords(seed, 3).map(word => mul(mul(f(word & 0x7fffff), unitScale), 100));
}

// 原四系统这些曲线均是Constant，因此当前核不需要消费每粒子随机值。
// 保留其真实通道推导供后续TwoConstants/Curve对照，不把它用作出生随机流。
function particleCurveRandom(seed, channel) {
  const offsets = { strength: 0x3edcba94, positionAmount: 0xb77ce39a, rotationAmount: 0xa92bedcb };
  if (!(channel in offsets)) throw new RangeError('未核实的Noise随机通道');
  const word = randWords((seed + offsets[channel]) >>> 0, 1)[0];
  return mul(f(word & 0x7fffff), unitScale);
}

// Perlin2D 0x20be230；解析梯度而非采样相减。每个算术节点显式float32舍入。
function fade(t) { return mul(mul(mul(t, t), t), add(mul(add(mul(6, t), -15), t), 10)); }
function fadeDerivative(t) { return mul(mul(mul(30, t), t), add(mul(sub(t, 2), t), 1)); }
function gradientAt(x, y) { return gradients[permutation[permutation[x] + y] & 7]; }

function perlinGradient2D(a, b, frequency) {
  requireFinite([a, b, frequency]);
  const px = mul(a, frequency), py = mul(b, frequency);
  if (Math.abs(px) >= 2147483000 || Math.abs(py) >= 2147483000) {
    throw new RangeError('超出本候选已核实的CVTPS2DQ正常整数范围');
  }
  const ix = Math.floor(px), iy = Math.floor(py);
  const x = sub(px, f(ix)), y = sub(py, f(iy));
  const X = ix & 255, Y = iy & 255;
  const g00 = gradientAt(X, Y), g10 = gradientAt(X + 1, Y);
  const g01 = gradientAt(X, Y + 1), g11 = gradientAt(X + 1, Y + 1);
  const xm = sub(x, 1), ym = sub(y, 1);
  const n00 = add(mul(g00[0], x), mul(g00[1], y));
  const n10 = add(mul(g10[0], xm), mul(g10[1], y));
  const n01 = add(mul(g01[1], ym), mul(g01[0], x));
  const n11 = add(mul(g11[1], ym), mul(g11[0], xm));
  const u = fade(x), v = fade(y), du = fadeDerivative(x), dv = fadeDerivative(y);
  // 0x20be91f..0x20bea51的减法与加法顺序，不把混合项重新结合。
  const mixedDot = add(sub(sub(n11, n01), n10), n00);
  const mixedGX = add(sub(sub(g11[0], g01[0]), g10[0]), g00[0]);
  const mixedGY = add(sub(sub(g11[1], g01[1]), g10[1]), g00[1]);
  const baseX = add(mul(u, sub(g10[0], g00[0])), add(mul(v, add(sub(g01[0], g00[0]), mul(u, mixedGX))), g00[0]));
  const baseY = add(mul(u, sub(g10[1], g00[1])), add(mul(v, add(sub(g01[1], g00[1]), mul(u, mixedGY))), g00[1]));
  const dx = add(mul(add(sub(n10, n00), mul(v, mixedDot)), du), baseX);
  const dy = add(mul(add(mul(u, mixedDot), sub(n01, n00)), dv), baseY);
  // 0x20bea55..0x20bea75：先算sqrt(2)*frequency，再分别乘两个导数。
  const scale = mul(fromBits(0x3fb504f3), frequency);
  return [mul(dx, scale), mul(dy, scale)];
}

// 0x20b3c90..0x20b3cd6：RCPPS后两次修正，并带原2.000000476837158常量。
// 未取得实际CPU的RCPPS初始估计时，float32除法仅作显式候选初值，不能声称逐位相等。
function dampingFactor(frequency, enabled, rcppsEstimateBits) {
  const clamped = f(Math.max(f(frequency), fromBits(0x358637bd)));
  if (!enabled) return { frequency: clamped, factor: f(1), estimateMode: '不使用倒数' };
  const r = rcppsEstimateBits === undefined ? div(1, clamped) : fromBits(rcppsEstimateBits);
  let refined = mul(sub(fromBits(0x40000002), mul(clamped, r)), r);
  refined = mul(refined, sub(2, mul(clamped, refined)));
  if (Number.isNaN(refined)) refined = r;
  return { frequency: clamped, factor: refined,
    estimateMode: rcppsEstimateBits === undefined ? '待Oracle核验：以float32除法代替RCPPS初始估计' : '调用方明确提供RCPPS估计位模式' };
}

// 四系统实际路径：Update0x20bf770→CalculateNoise<2,0,0>0x20ad080→Job0x20b3bf0。
function noiseMediumSingle({ position, systemSeed, frequency, scroll, strength, damping,
  positionAmount = 1, quality = 1, octaves = 1, separateAxes = false, remapEnabled = false, rcppsEstimateBits }) {
  if (quality !== 1 || octaves !== 1 || separateAxes || remapEnabled) throw new RangeError('候选仅覆盖Medium/单层/不分轴/无Remap');
  if (position.length !== 3 || typeof damping !== 'boolean') throw new RangeError('需要三个模拟坐标和明确的Damping开关');
  requireFinite([...position, frequency, scroll, strength, positionAmount]);
  const offset = systemSeedOffset(systemSeed);
  const [x, y, z] = position.map((value, axis) => add(value, offset[axis]));
  const d = dampingFactor(frequency, damping, rcppsEstimateBits);
  // 0x20b4070..0x20b4104：沿三个不同平面采解析梯度，原100偏移不可省。
  const A = perlinGradient2D(z, add(scroll, y), d.frequency);
  const B = perlinGradient2D(add(100, x), add(scroll, z), d.frequency);
  const C = perlinGradient2D(y, add(add(100, x), scroll), d.frequency);
  const curl = [sub(C[0], B[1]), sub(A[0], C[1]), sub(B[0], A[1])];
  const gain = mul(d.factor, strength);
  const contribution = curl.map(value => mul(mul(value, gain), positionAmount));
  // 0x20b45ae..0x20b4606加到SoA[0xc0/0xe0/0x100]；CopyToArrayAOS证明它是animatedVelocity。
  return { animatedVelocityContribution: contribution, rawCurl: curl, dampingEstimateMode: d.estimateMode,
    equivalenceApproved: false };
}

// 0x20bf638..0x20bf67d：调用方须先按实际系统时钟求Scroll曲线值，再按实际步长累加。
function advanceScroll(previousScroll, evaluatedSpeed, dt, updateScroll = true) {
  requireFinite([previousScroll, evaluatedSpeed, dt]);
  return updateScroll ? add(previousScroll, mul(evaluatedSpeed, dt)) : f(previousScroll);
}

// 原四解锁同一条非加权两键曲线。Hermite系数缓存的原生操作顺序仍待Oracle，单列为候选。
function originalUnlockScrollSpeedCandidate(normalizedSystemTime) {
  if (!Number.isFinite(normalizedSystemTime) || normalizedSystemTime < 0 || normalizedSystemTime > 1) {
    throw new RangeError('原曲线候选仅覆盖0至1；loop/预热/区间外时钟语义待原生验证');
  }
  const v0 = f(0.7235797643661499), m0 = f(-0.981319010257721);
  if (normalizedSystemTime <= 0) return v0;
  if (normalizedSystemTime >= 1) return f(0);
  const t = f(normalizedSystemTime);
  const a = add(mul(2, v0), m0);
  const b = sub(mul(-3, v0), mul(2, m0));
  return add(mul(add(mul(add(mul(a, t), b), t), m0), t), v0);
}

module.exports = { fromBits, toBits, gradients, systemSeedOffset, particleCurveRandom, perlinGradient2D, dampingFactor, noiseMediumSingle, advanceScroll, originalUnlockScrollSpeedCandidate };
