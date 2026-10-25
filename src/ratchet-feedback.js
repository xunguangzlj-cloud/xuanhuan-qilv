// 对应原 RingRotationFeelApplicator：屏幕坐标单位为设备像素，时钟单位为秒。
function createRatchetFeedback({ play, stop, clock }) {
  const samples = [];
  let accumulated = 0;
  let lastPlayed = -Infinity;
  function begin() { accumulated = 0; samples.length = 0; }
  function end() { begin(); stop(); }
  function notify(delta, point) {
    const now = clock();
    samples.push({ time: now, x: point.x, y: point.y });
    while (samples.length && samples[0].time < now - 0.15) samples.shift();
    let active = true;
    if (samples.length > 1) {
      const recent = samples[samples.length - 2];
      const first = samples[0];
      const recentTravel = Math.hypot(point.x - recent.x, point.y - recent.y);
      const windowTravel = Math.hypot(point.x - first.x, point.y - first.y);
      if (windowTravel >= 18 && recentTravel < 1.5) active = false;
      else if (!(windowTravel >= 18)) active = recentTravel >= 1.5;
    }
    if (!active) { accumulated = 0; stop(); return false; }
    if (Math.abs(delta) < 0.3) return false;
    accumulated += Math.abs(delta);
    if (accumulated < 15) return false;
    if (now - lastPlayed < 0.12) { accumulated = Math.min(accumulated, 15); return false; }
    stop();
    // 同步返回 true 表示调用方接受播放；异步解码与分包结果不在此处臆测。
    if (play() !== true) return false;
    lastPlayed = now;
    accumulated -= 15;
    return true;
  }
  return { begin, notify, end };
}
module.exports = { createRatchetFeedback };
