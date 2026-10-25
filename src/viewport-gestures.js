'use strict';

// 原Hot.cs RotateCameraGestureController的参数；原实验开关默认0，不擅自打开。
const defaults = Object.freeze({ minSize: 15, minSizeOut: .5, maxSizeOut: .5, snapBackDuration: .1, panMarginFactor: .1, initialSizeThreshold: 15, panSensitivity: 1, zoomSensitivity: 1, smoothTime: .06, pinchThresholdDp: 10, panThresholdDp: 8, dpi: 160, coordinateRatio: 1 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const approximately = (a, b) => Math.abs(a - b) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1.121039e-44);

// Unity SmoothDamp无限maxSpeed分支；二维位置用整体点积判定越过目标，避免逐轴误判。
function smoothDamp(current, target, velocity, smoothTime, delta) {
  if (delta <= 0) return { value: current, velocity };
  const omega = 2 / Math.max(.0001, smoothTime), x = omega * delta, decay = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
  const change = current - target, temp = (velocity + omega * change) * delta;
  let nextVelocity = (velocity - omega * temp) * decay, value = target + (change + temp) * decay;
  if ((target - current > 0) === (value > target)) { value = target; nextVelocity = 0; }
  return { value, velocity: nextVelocity };
}

function smoothDampPosition(current, target, velocity, smoothTime, delta) {
  if (delta <= 0) return { value: { ...current }, velocity: { ...velocity } };
  const omega = 2 / Math.max(.0001, smoothTime), x = omega * delta, decay = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
  const value = {}, nextVelocity = {};
  for (const axis of ['x', 'y']) {
    const change = current[axis] - target[axis], temp = (velocity[axis] + omega * change) * delta;
    nextVelocity[axis] = (velocity[axis] - omega * temp) * decay;
    value[axis] = target[axis] + (change + temp) * decay;
  }
  if ((target.x - current.x) * (value.x - target.x) + (target.y - current.y) * (value.y - target.y) > 0) return { value: { ...target }, velocity: { x: 0, y: 0 } };
  return { value, velocity: nextVelocity };
}

function createViewportGestures(options) {
  const settings = { ...defaults, ...options };
  let width = options.width, height = options.height, bounds = options.bounds;
  let current, initial, targetSize, targetPosition, initialSize, feature = options.cameraZoomAndPan == null ? 0 : options.cameraZoomAndPan;
  let fingers = new Map(), suppressed = false, gesture = null, follow = false, snap = null, modified = false;
  let sizeVelocity = 0, positionVelocity = { x: 0, y: 0 }, guidePolicy = null;
  const onChange = options.onChange || (() => {}), onControlChanged = options.onControlChanged || (() => {});
  const enabled = () => feature === 1 && initialSize > settings.initialSizeThreshold;
  const effective = kind => enabled() && (!guidePolicy || guidePolicy[kind] !== false);
  const sizeOf = camera => camera.orthographicSize || height / (2 * camera.scale);
  const dpToPixels = dp => dp * (settings.dpi > 0 ? settings.dpi : 160) / 160 / settings.coordinateRatio;

  function apply(size, position) {
    current = { ...current, x: position.x, y: position.y, scale: height / (2 * size), orthographicSize: size, cx: width / 2, cy: height / 2 };
    onChange({ ...current });
  }
  function setModified(value) { if (modified !== value) { modified = value; onControlChanged(value); } }
  function stopFollow() { follow = false; sizeVelocity = 0; positionVelocity = { x: 0, y: 0 }; }
  function clampPosition(position) {
    const mx = bounds.width * settings.panMarginFactor, my = bounds.height * settings.panMarginFactor;
    return { x: clamp(position.x, bounds.x - mx, bounds.x + bounds.width + mx), y: clamp(position.y, bounds.y - my, bounds.y + bounds.height + my) };
  }
  function snapIfOutside() {
    const size = sizeOf(current);
    if (size < settings.minSize || size > initialSize) snap = { age: 0, size, toSize: clamp(size, settings.minSize, initialSize), position: { x: current.x, y: current.y }, toPosition: clampPosition(current) };
  }
  function resetGesture() { gesture = null; }
  function beginFollow() {
    if (follow) return;
    follow = true; targetSize = sizeOf(current); targetPosition = { x: current.x, y: current.y }; sizeVelocity = 0; positionVelocity = { x: 0, y: 0 };
  }
  function commit() { if (settings.smoothTime <= 0) apply(targetSize, targetPosition); setModified(true); }
  function beginGesture() {
    if (gesture || !enabled()) return;
    const usable = [...fingers.values()].filter(finger => finger.id !== -42 && !finger.startedOverGui);
    if (usable.length < 2 || !effective('allowZoom') && !effective('allowPan')) return;
    const [a, b] = usable, center = midpoint(a, b), span = distance(a, b);
    gesture = { a: a.id, b: b.id, mode: 'undetermined', startSpan: span, lastSpan: span, startMidpoint: center, lastMidpoint: center, anchor: null, startSize: follow ? targetSize : sizeOf(current), peakZoom: 0, latestSize: 0, peakPan: 0 };
    snap = null;
  }
  function updateGuide(center) {
    if (!guidePolicy || !gesture) return;
    gesture.peakPan = Math.max(gesture.peakPan, distance(center, gesture.startMidpoint));
    const expected = guidePolicy.expectedStep;
    if (!['zoomIn', 'zoomOut', 'pan'].includes(expected)) return;
    const available = expected === 'zoomIn' ? gesture.startSize - (settings.minSize - settings.minSizeOut) : initialSize + settings.maxSizeOut - gesture.startSize;
    const threshold = available > 0 ? Math.min(3, available) : 3;
    const success = expected === 'pan' ? gesture.mode === 'pan' && gesture.peakPan >= 100 / settings.coordinateRatio : gesture.mode === 'zoom' && gesture.peakZoom >= threshold && (expected === 'zoomIn' ? gesture.latestSize < gesture.startSize : gesture.latestSize > gesture.startSize);
    if (success) { guidePolicy = null; if (options.onGuideSucceeded) options.onGuideSucceeded(expected); }
  }
  function moveGesture(propActive) {
    if (!gesture) return;
    if (propActive) { resetGesture(); stopFollow(); snapIfOutside(); return; }
    const a = fingers.get(gesture.a), b = fingers.get(gesture.b);
    if (!a || !b) return;
    const span = distance(a, b), center = midpoint(a, b);
    if (gesture.mode === 'undetermined') {
      const zoomDelta = Math.abs(span - gesture.startSpan), panDelta = distance(center, gesture.startMidpoint), zoomThreshold = dpToPixels(settings.pinchThresholdDp), panThreshold = dpToPixels(settings.panThresholdDp);
      const zoom = effective('allowZoom') && zoomDelta >= zoomThreshold, pan = effective('allowPan') && panDelta >= panThreshold;
      if (!zoom && !pan) { gesture.lastSpan = span; gesture.lastMidpoint = center; return; }
      gesture.mode = zoom && pan ? zoomDelta / zoomThreshold >= panDelta / panThreshold ? 'zoom' : 'pan' : zoom ? 'zoom' : 'pan';
      gesture.lastSpan = gesture.startSpan; gesture.lastMidpoint = gesture.startMidpoint; gesture.anchor = center; beginFollow();
    }
    if (gesture.mode === 'zoom') {
      if (span >= 1 && gesture.lastSpan >= 1) {
        const ratio = 1 + (gesture.lastSpan / span - 1) * settings.zoomSensitivity;
        if (!approximately(ratio, 1)) {
          const next = clamp(targetSize * ratio, settings.minSize - settings.minSizeOut, initialSize + settings.maxSizeOut);
          if (!approximately(next, targetSize)) {
            const unit = 2 * (targetSize - next) / height;
            targetPosition = clampPosition({ x: targetPosition.x + (gesture.anchor.x - width / 2) * unit, y: targetPosition.y - (gesture.anchor.y - height / 2) * unit });
            targetSize = next; gesture.latestSize = next; gesture.peakZoom = Math.max(gesture.peakZoom, Math.abs(next - gesture.startSize)); commit();
          }
          gesture.lastSpan = span;
        }
      } else gesture.lastSpan = span;
    } else {
      const dx = center.x - gesture.lastMidpoint.x, dy = center.y - gesture.lastMidpoint.y;
      if (dx * dx + dy * dy > 1.401298e-45) {
        const unit = 2 * targetSize / height * settings.panSensitivity;
        const next = clampPosition({ x: targetPosition.x - dx * unit, y: targetPosition.y + dy * unit });
        if ((next.x - targetPosition.x) ** 2 + (next.y - targetPosition.y) ** 2 >= 1e-10) { targetPosition = next; commit(); }
      }
      gesture.lastMidpoint = center;
    }
    updateGuide(center);
  }

  function reset(next = {}) {
    if (next.width != null) width = next.width;
    if (next.height != null) height = next.height;
    if (next.bounds) bounds = next.bounds;
    if (next.cameraZoomAndPan != null) feature = next.cameraZoomAndPan;
    current = { ...(next.camera || options.camera) }; initialSize = sizeOf(current); initial = { ...current, orthographicSize: initialSize };
    targetSize = initialSize; targetPosition = { x: current.x, y: current.y };
    fingers.clear(); suppressed = false; resetGesture(); stopFollow(); snap = null; guidePolicy = null; setModified(false);
  }
  reset();
  return {
    handle(event, { propActive = false } = {}) {
      const previous = fingers;
      const nextFingers = new Map((event.touches || []).map(point => {
        const old = previous.get(point.id);
        const startedOverGui = old ? old.startedOverGui : point.startedOverGui != null ? point.startedOverGui : !!(options.isOverGui && options.isOverGui(point.x, point.y));
        return [point.id, { ...point, startedOverGui }];
      }));
      fingers = new Map([...previous.keys(), ...nextFingers.keys()].filter((id, index, ids) => nextFingers.has(id) && ids.indexOf(id) === index).map(id => [id, nextFingers.get(id)]));
      const active = [...fingers.values()].filter(finger => finger.id !== -42);
      if (!suppressed && active.length >= 2) { suppressed = true; if (options.onSuppressGameplay) options.onSuppressGameplay(); }
      if (event.type === 'cancel') { resetGesture(); if (!follow) snapIfOutside(); }
      else if (event.type === 'end') {
        if (gesture && (event.changedTouches || []).some(point => point.id === gesture.a || point.id === gesture.b)) { resetGesture(); if (!follow) snapIfOutside(); }
      } else if (event.type === 'start') { if (!propActive && (event.changedTouches || []).some(point => fingers.has(point.id) && point.id !== -42 && !fingers.get(point.id).startedOverGui)) beginGesture(); }
      else if (event.type === 'move') moveGesture(propActive);
      // 多指结束后仍在场的单指不得接管圆环，必须全部抬起后重新触摸。
      if (!active.length) suppressed = false;
      return { suppressed, mode: gesture ? gesture.mode : null };
    },
    update(delta) {
      delta = Math.max(0, delta);
      if (follow) {
        const size = smoothDamp(sizeOf(current), targetSize, sizeVelocity, settings.smoothTime, delta), position = smoothDampPosition(current, targetPosition, positionVelocity, settings.smoothTime, delta);
        sizeVelocity = size.velocity; positionVelocity = position.velocity; apply(size.value, position.value);
        if (!gesture && Math.abs(sizeOf(current) - targetSize) < .001 && (current.x - targetPosition.x) ** 2 + (current.y - targetPosition.y) ** 2 < 1e-6) { apply(targetSize, targetPosition); stopFollow(); snapIfOutside(); }
      } else if (snap) {
        snap.age += delta; const time = clamp(snap.age / settings.snapBackDuration, 0, 1), ease = 1 - (1 - time) ** 2;
        apply(snap.size + (snap.toSize - snap.size) * ease, { x: snap.position.x + (snap.toPosition.x - snap.position.x) * ease, y: snap.position.y + (snap.toPosition.y - snap.position.y) * ease });
        if (time === 1) snap = null;
      }
    },
    restore() {
      resetGesture(); stopFollow(); snap = { age: 0, size: sizeOf(current), toSize: initialSize, position: { x: current.x, y: current.y }, toPosition: { x: initial.x, y: initial.y } }; setModified(false); return initialSize > 0;
    },
    cancel() { fingers.clear(); suppressed = false; resetGesture(); stopFollow(); snapIfOutside(); },
    reset,
    setGuidePolicy(value) { guidePolicy = value ? { ...value } : null; },
    clearGuidePolicy() { guidePolicy = null; },
    get enabled() { return enabled(); },
    get modified() { return modified; },
    get suppressed() { return suppressed; },
    get mode() { return gesture ? gesture.mode : null; },
    get camera() { return { ...current }; },
    get target() { return { orthographicSize: targetSize, ...targetPosition }; },
  };
}

module.exports = { createViewportGestures, smoothDamp, smoothDampPosition, defaults };
