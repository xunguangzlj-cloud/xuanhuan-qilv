const { ungzip } = require('../vendor/pako-inflate');
const { decodeOriginalHierarchyLevel } = require('./native-level-reader');

const isWechat = typeof wx !== 'undefined';
const images = new Map();
const packages = new Map();
let mainCanvas;
let nativeChunk;

function viewport() {
  if (isWechat) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const headerInset = Math.max(0, info.safeArea?.top || 0, menu && menu.height > 0 ? menu.bottom + 8 : 0);
    return { width: info.windowWidth, height: info.windowHeight, ratio: info.pixelRatio || 1, safeArea: info.safeArea, headerInset };
  }
  const css = getComputedStyle(document.documentElement);
  const top = parseFloat(css.getPropertyValue('--safe-top')) || 0;
  const bottom = parseFloat(css.getPropertyValue('--safe-bottom')) || 0;
  return { width: Math.min(window.innerWidth, 500, window.innerHeight / 2), height: window.innerHeight, ratio: Math.min(window.devicePixelRatio || 1, 3), safeArea: { top, bottom: window.innerHeight - bottom } };
}

function createCanvas() {
  if (!mainCanvas) mainCanvas = isWechat ? wx.createCanvas() : document.getElementById('game');
  return mainCanvas;
}

function showStartup(message) {
  const canvas = createCanvas(), view = viewport();
  const width = Math.round(view.width * view.ratio), height = Math.round(view.height * view.ratio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.setTransform(view.ratio, 0, 0, view.ratio, 0, 0);
  ctx.fillStyle = '#fff4e5';
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.fillStyle = '#7e4136'; ctx.font = '18px sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(message, view.width / 2, view.height / 2);
  ctx.restore();
}

function createRenderCanvas() {
  return isWechat ? wx.createCanvas() : document.createElement('canvas');
}

function loadImageAsync(path) {
  return new Promise((resolve, reject) => {
    const image = isWechat ? wx.createImage() : new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    // 微信使用兼容文件名读取原PNG，图像字节和材质索引保持不变。
    image.src = isWechat && path === 'assets/prop-effects/Tex_glow_06_256x256 1.png' ? 'assets/prop-effects/Tex_glow_06_256x256_1.png' : path;
  });
}

function ensurePackage(name) {
  if (!isWechat) return Promise.resolve();
  if (!packages.has(name)) {
    packages.set(name, new Promise((resolve, reject) => wx.loadSubpackage({ name, success: resolve, fail: reject })).catch(error => { packages.delete(name); throw error; }));
  }
  return packages.get(name);
}

async function readData(name) {
  await ensurePackage(name);
  const path = `packages/${name}/data.gz`;
  const bytes = isWechat
    ? await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, success: result => resolve(result.data), fail: reject }))
    : await (await fetch(path)).arrayBuffer();
  return JSON.parse(ungzip(new Uint8Array(bytes), { to: 'string' }));
}

async function readNativeLevel(name, sourceKey, geometries) {
  await ensurePackage(name);
  if (!nativeChunk || nativeChunk.name !== name) {
    const path = `packages/${name}/native-physics.rrh1-v2.gz`;
    const bytes = isWechat
      ? await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, success: result => resolve(result.data), fail: reject }))
      : await (await fetch(path)).arrayBuffer();
    // 仅持有当前块的原字节，每次只实例化当前关，避免缓存80关的完整碰撞对象。
    nativeChunk = { name, bytes: ungzip(new Uint8Array(bytes)) };
  }
  return decodeOriginalHierarchyLevel(nativeChunk.bytes, index => geometries[index], sourceKey);
}

function loadImage(path) {
  const previous = images.get(path);
  if (previous) return previous.ready ? previous.image : null;
  const image = isWechat ? wx.createImage() : new Image();
  const entry = { image, ready: false };
  images.set(path, entry);
  image.onload = () => { entry.ready = true; };
  image.onerror = () => { entry.error = true; };
  image.src = path;
  return null;
}

async function loadFont(path, family) {
  if (isWechat) return wx.loadFont ? wx.loadFont(path) : 'sans-serif';
  const font = new FontFace(family, `url(${path})`);
  await font.load();
  document.fonts.add(font);
  return family;
}

function readSave() {
  const value = isWechat ? wx.getStorageSync('xuanhuan-qilv.save.v1') : localStorage.getItem('xuanhuan-qilv.save.v1');
  return value ? (typeof value === 'string' ? JSON.parse(value) : value) : null;
}

function writeSave(value) {
  if (isWechat) wx.setStorageSync('xuanhuan-qilv.save.v1', value);
  else localStorage.setItem('xuanhuan-qilv.save.v1', JSON.stringify(value));
}

function onTouchSet(canvas, callback) {
  if (isWechat) {
    const points = touches => (touches || []).map(touch => ({ id: touch.identifier, x: touch.clientX == null ? touch.x : touch.clientX, y: touch.clientY == null ? touch.y : touch.clientY }));
    const bind = (type, event) => callback({ type, touches: points(event.touches), changedTouches: points(event.changedTouches) });
    wx.onTouchStart(event => bind('start', event));
    wx.onTouchMove(event => bind('move', event));
    wx.onTouchEnd(event => bind('end', event));
    wx.onTouchCancel(event => bind('cancel', event));
    if (wx.onHide) wx.onHide(() => callback({ type: 'cancel', touches: [], changedTouches: [] }));
    return;
  }
  const active = new Map();
  if (canvas.style) canvas.style.touchAction = 'none';
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function emit(type, event) {
    const changed = point(event);
    if (type === 'move' && !active.has(changed.id)) return;
    if (type === 'start' || type === 'move') active.set(changed.id, changed);
    else if (type === 'cancel') active.clear();
    else active.delete(changed.id);
    callback({ type, touches: [...active.values()], changedTouches: [changed] });
  }
  canvas.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); emit('start', event); });
  canvas.addEventListener('pointermove', event => emit('move', event));
  canvas.addEventListener('pointerup', event => emit('end', event));
  canvas.addEventListener('pointercancel', event => emit('cancel', event));
  window.addEventListener('pagehide', () => {
    const changedTouches = [...active.values()]; active.clear();
    callback({ type: 'cancel', touches: [], changedTouches });
  });
}

function onPointer(canvas, down, move, up, cancel = up) {
  let primary = null, suppressed = false;
  onTouchSet(canvas, event => {
    if (event.type === 'cancel') { primary = null; suppressed = false; cancel(); return; }
    if (event.touches.length >= 2) { if (!suppressed && primary != null) cancel(); suppressed = true; primary = null; return; }
    if (suppressed) { if (!event.touches.length) suppressed = false; return; }
    const changed = event.changedTouches.find(point => point.id === primary) || event.changedTouches[0];
    if (event.type === 'start' && primary == null && changed) { primary = changed.id; down(changed.x, changed.y); }
    else if (changed && changed.id === primary && event.type === 'move') move(changed.x, changed.y);
    else if (changed && changed.id === primary && event.type === 'end') { primary = null; up(changed.x, changed.y); }
  });
}

function toast(message) {
  if (isWechat) wx.showToast({ title: message, icon: 'none' });
  else window.dispatchEvent(new CustomEvent('game-toast', { detail: message }));
}

async function editName(currentName) {
  if (isWechat) {
    const result = await new Promise(resolve => wx.showModal({ title: '昵称', editable: true, placeholderText: currentName || '请输入昵称', success: resolve, fail: () => resolve({ confirm: false }) }));
    return result.confirm ? String(result.content || '').trim().slice(0, 20) : null;
  }
  const name = window.prompt('请输入昵称', currentName || '');
  return name == null ? null : name.trim().slice(0, 20);
}

function vibrate(enabled) {
  if (enabled && isWechat) wx.vibrateShort({ type: 'light' });
}

// 在真正可操作的场景完成绘制后，向平台提交交互阶段标记。
function reportInteractive() { if (isWechat && wx.reportScene) wx.reportScene({ sceneId: 7 }); }

function frame(callback) { return requestAnimationFrame(callback); }
function onResize(callback) {
  if (isWechat) wx.onWindowResize(callback);
  else window.addEventListener('resize', callback);
}
function onHide(callback) {
  if (isWechat) wx.onHide(callback);
  else window.addEventListener('pagehide', callback);
}

module.exports = { reportInteractive, isWechat, viewport, createCanvas, createRenderCanvas, showStartup, ensurePackage, readData, readNativeLevel, loadImage, loadImageAsync, loadFont, readSave, writeSave, onPointer, onTouchSet, toast, editName, vibrate, frame, onResize, onHide };
