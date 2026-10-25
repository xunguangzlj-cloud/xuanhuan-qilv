'use strict';

const handData = require('../assets/tutorial/hand-frames-packed');
const DEG = Math.PI / 180;
const OPEN = handData.animations.guide_drag_open.duration;
const CLOSE = handData.animations.guide_drag_close.duration;
const AFTER_OPEN = 0.15000000596046448;
const MOVE = 0.699999988079071;
const BEFORE_CLOSE = 0.30000001192092896;
const FADE = 0.30000001192092896;
const DELAY = 0.800000011920929;
const BODY = OPEN+AFTER_OPEN+MOVE+BEFORE_CLOSE+Math.max(CLOSE,FADE);

function createTutorial(board, enabled) {
  const target = board && board.parts.find(part => part.id === 'ring_2');
  let state = enabled && target && !board.parts.some(part => part.kind === 'ring' && part.solved) ? 'WaitingForGesture' : 'Completed';
  let elapsed = 0, delay = DELAY, reshow = null;
  let baseRotation = target ? target.rotationDeg : 0;
  let totalRotation = 180;

  function refresh() {
    baseRotation = target.rotationDeg;
    const requested = ((baseRotation-180)%360+360)%360;
    if (requested >= 0.01) totalRotation = requested;
  }
  if (state !== 'Completed') refresh();

  function finish() { state = 'Completed'; reshow = null; }
  function update(dt) {
    if (state === 'Completed') return;
    if (target.solved) { finish(); return; }
    let remaining = Math.max(0, dt);
    if (state === 'WaitingForRingSolved') {
      if (reshow === null) return;
      reshow -= remaining;
      if (reshow > 0) return;
      remaining = -reshow;
      state = 'WaitingForGesture'; reshow = null;
      // Hot.cs:11476-11487与10579：释放后三秒重现时跳过首次0.8秒等待。
      elapsed = 0; delay = 0; refresh();
    }
    elapsed += remaining;
    while (elapsed >= delay+BODY) {
      elapsed -= delay+BODY;
      delay = DELAY;
      refresh();
    }
  }

  function pose() {
    if (state !== 'WaitingForGesture' || elapsed < delay) return null;
    let age = elapsed-delay, deltaDeg = 0, alpha = 1;
    let animation = 'guide_drag_open', animationTime = Math.min(age, OPEN), phase = 'open';
    if (age >= OPEN+AFTER_OPEN) {
      age -= OPEN+AFTER_OPEN;
      deltaDeg = -totalRotation*Math.min(1, age/MOVE);
      animationTime = OPEN;
      phase = age < MOVE ? 'rotate' : 'hold';
      if (age >= MOVE+BEFORE_CLOSE) {
        const closeAge = age-MOVE-BEFORE_CLOSE;
        animation = 'guide_drag_close'; animationTime = Math.min(closeAge, CLOSE);
        alpha = Math.max(0, 1-closeAge/FADE); phase = 'close';
      }
    }
    const radius = (target.data.InnerRadius+target.data.OuterRadius)/48;
    const angle = (baseRotation+136+deltaDeg)*DEG;
    return {
      phase,
      ring: {partId: target.id, deltaDeg, alpha, rotationDeg: baseRotation+deltaDeg},
      hand: {worldX: target.x+radius*Math.cos(angle), worldY: target.y+radius*Math.sin(angle), animation, time: animationTime}
    };
  }

  return {
    update, pose, finish,
    // 原GameplayGestureEvent起手隐藏；保持按住不会启动重现计时。
    gesture() { if (state !== 'Completed') { state = 'WaitingForRingSolved'; reshow = null; } },
    release() { if (state === 'WaitingForRingSolved') reshow = 3; },
    collect(kind) { if (kind === 'ring') finish(); },
    get textKey() { return state === 'WaitingForGesture' ? 'Tutorial_Operation' : ''; },
    get state() { return state; }
  };
}

function sampleHand(animationName, time) {
  const animation = handData.animations[animationName];
  const frames = animation.frames, age = Math.max(0, Math.min(time, animation.duration));
  let lo = 0, hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid][0] < age) lo = mid + 1; else hi = mid;
  }
  let from, to;
  if (lo < frames.length && frames[lo][0] === age) {
    // 同一时刻三帧依次为左极限、精确边界和右极限。
    let end = lo;
    while (end + 1 < frames.length && frames[end + 1][0] === age) end++;
    from = to = frames[lo + Math.floor((end - lo) / 2)];
  } else {
    from = frames[Math.max(0, lo - 1)];
    to = frames[Math.min(lo, frames.length - 1)];
  }
  const fraction = to[0] > from[0] ? (age-from[0])/(to[0]-from[0]) : 0;
  return {alpha: from[1]+(to[1]-from[1])*fraction, vertices: from.slice(2).map((value,i) => value+(to[i+2]-value)*fraction)};
}

function drawHand(ctx, image, hand, screenPoint, uiScale) {
  if (!image || !hand) return;
  const sampled = sampleHand(hand.animation, hand.time);
  if (sampled.alpha <= 0) return;
  const vertices = sampled.vertices, uvs = handData.uvs, triangles = handData.triangles;
  ctx.save();
  ctx.translate(screenPoint.x, screenPoint.y);
  ctx.scale(uiScale, -uiScale);
  // 原eff_guide_hand子节点anchored(22,-118)、scale0.76；骨骼0.01由UI像素单位抵消。
  ctx.translate(22, -118); ctx.scale(0.7599999904632568, 0.7599999904632568);
  ctx.globalAlpha *= sampled.alpha;
  for (let index = 0; index < triangles.length; index += 3) {
    const ids = triangles.slice(index,index+3);
    const source = ids.map(id => [uvs[id*2]*handData.imageWidth, uvs[id*2+1]*handData.imageHeight]);
    const target = ids.map(id => [vertices[id*2],vertices[id*2+1]]);
    const [p,q,r] = source, [a,b,c] = target;
    const ux = q[0]-p[0], uy = q[1]-p[1], vx = r[0]-p[0], vy = r[1]-p[1];
    const determinant = ux*vy-uy*vx;
    if (Math.abs(determinant) < 1e-9) continue;
    const xx = ((b[0]-a[0])*vy-(c[0]-a[0])*uy)/determinant;
    const xy = ((c[0]-a[0])*ux-(b[0]-a[0])*vx)/determinant;
    const yx = ((b[1]-a[1])*vy-(c[1]-a[1])*uy)/determinant;
    const yy = ((c[1]-a[1])*ux-(b[1]-a[1])*vx)/determinant;
    ctx.save(); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); ctx.clip();
    ctx.transform(xx,yx,xy,yy,a[0]-xx*p[0]-xy*p[1],a[1]-yx*p[0]-yy*p[1]);
    ctx.drawImage(image,0,0); ctx.restore();
  }
  ctx.restore();
}

module.exports = {createTutorial, drawHand, sampleHand, handImagePath: 'assets/tutorial/hand.png'};
