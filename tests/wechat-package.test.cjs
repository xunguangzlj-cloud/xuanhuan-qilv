'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.resolve(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'), 'utf8'));

// 按实际打包忽略项与微信仅 JS 模块规则加载；早期验收的 Node 式 JSON.parse 分支曾掩盖真机错误。
function packageModules(wx = {}) {
  const ignored = settings.packOptions.ignore;
  const cache = new Map();
  const context = vm.createContext({ console, wx });
  const available = filename => {
    const relative = path.relative(project, filename).split(path.sep).join('/');
    return !relative.startsWith('../') && fs.existsSync(filename) && fs.statSync(filename).isFile() && !ignored.some(item =>
      item.type === 'folder' ? relative === item.value || relative.startsWith(item.value.replace(/\/$/, '') + '/') : relative === item.value);
  };
  function load(request, parent = path.join(project, 'game.js')) {
    assert.ok(request.startsWith('.'), '入口依赖必须来自工程内：' + request);
    const base = path.resolve(path.dirname(parent), request);
    const filename = [base.endsWith('.js') ? base : base + '.js'].find(available);
    assert.ok(filename, '微信打包后模块缺失：' + request + '，来源 ' + path.relative(project, parent));
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8');
    const wrapper = vm.runInContext('(function(require,module,exports){\n' + source + '\n})', context, { filename });
    wrapper(name => load(name, filename), module, module.exports);
    return module.exports;
  }
  return { load, cache, available };
}

test('微信打包忽略文件后仍能加载 app 的真实顶层模块闭包', () => {
  const packaged = packageModules();
  const app = packaged.load('./src/app');
  assert.equal(typeof app.boot, 'function');
  assert.ok(packaged.cache.has(path.join(project, 'src/platform.js')));
  assert.ok(packaged.cache.has(path.join(project, 'assets/tutorial/hand-frames-packed.js')));
  assert.equal(packaged.cache.has(path.join(project, 'assets/tutorial/hand-frames.json')), false);
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.name.endsWith('.js') && packaged.available(filename)) {
        const source = fs.readFileSync(filename, 'utf8');
        for (const match of source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
          assert.ok(match[2].startsWith('.'), '不得依赖外部 Node 模块：' + filename);
          const base = path.resolve(path.dirname(filename), match[2]);
          assert.ok(!match[2].endsWith('.json'), '微信模块加载器不支持 Node 式 JSON require：' + path.relative(project, filename) + ' → ' + match[2]);
          assert.ok(packaged.available(base.endsWith('.js') ? base : base + '.js'), '延后执行的打包依赖也必须存在：' + path.relative(project, filename) + ' → ' + match[2]);
        }
      }
    }
  };
  visit(project);
});

test('道具渲染在真实窗口缩放链路中保持粒子画布的有效像素尺寸', async () => {
  const { createPropEffects } = require(path.join(project, 'src/prop-effects'));
  const canvases = [];
  const createCanvas = () => {
    const canvas = { width: 0, height: 0, getContext() { return null; } };
    canvases.push(canvas);
    return canvas;
  };
  const loadImage = async file => {
    const bytes = fs.readFileSync(path.join(project, file));
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };
  const effects = await createPropEffects({
    characterCanvas: { getContext() { return null; } }, createCanvas, loadImage,
    width: 540, height: 960, ratio: 2,
  });
  assert.equal(canvases.length, 1);
  assert.equal(canvases[0].width, 1080);
  assert.equal(canvases[0].height, 1920);
  effects.resize(360, 640, 3);
  assert.equal(canvases[0].width, 1080);
  assert.equal(canvases[0].height, 1920);
  effects.resize(414, 896, 2);
  assert.equal(canvases[0].width, 828);
  assert.equal(canvases[0].height, 1792);
  effects.dispose();
});

test('微信分包回调先完成再读取 ArrayBuffer，工程内 pako 能解码全部运行数据包', async () => {
  const game = JSON.parse(fs.readFileSync(path.join(project, 'game.json'), 'utf8'));
  const loaded = new Set(), reads = [];
  const platform = packageModules({
    loadSubpackage({ name, success }) {
      assert.ok(game.subpackages.some(item => item.name === name));
      setImmediate(() => { loaded.add(name); success({}); });
    },
    getFileSystemManager() {
      return { readFile({ filePath, success }) {
        const name = filePath.split('/')[1];
        assert.ok(loaded.has(name), '文件读取必须在分包成功后：' + filePath);
        const bytes = fs.readFileSync(path.join(project, filePath));
        reads.push(filePath);
        success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
      } };
    },
  }).load('./src/platform');
  let levelCount = 0;
  for (const name of ['geometry', 'levels1', 'levels2', 'levels3', 'levels4', 'levels5', 'characters', 'home-characters', 'rewards']) {
    const data = await platform.readData(name);
    assert.equal(typeof data, 'object');
    assert.ok(Object.keys(data).length > 0);
    if (name.startsWith('levels')) levelCount += Object.keys(data).length;
    if (['characters', 'home-characters', 'rewards'].includes(name)) assert.ok(data.characters);
  }
  assert.equal(levelCount, 400);
  assert.equal(loaded.size, 9);
  assert.equal(reads.length, 9);
});

test('九份 JSON 数据转为 JS 后逐值完全一致，原 JSON 保留且不重复入包', () => {
  const sources = [
    'assets/ambient/ambient.json', 'assets/ui/subpackages.json', 'assets/background/material.json',
    'assets/chest-effects/effects.json', 'assets/effects/release.json', 'assets/rings/materials.json',
    'assets/settlement/presentation.json', 'assets/parts/materials.json', 'assets/characters/win-presentation.json',
  ];
  const packaged = packageModules();
  let negativeZeros = 0;
  function countNegativeZeros(value) {
    if (typeof value === 'number' && Object.is(value, -0)) negativeZeros++;
    if (value && typeof value === 'object') Object.values(value).forEach(countNegativeZeros);
  }
  for (const source of sources) {
    const expected = JSON.parse(fs.readFileSync(path.join(project, source), 'utf8'));
    const target = source.replace(/\.json$/, '-data.js');
    assert.deepStrictEqual(require(path.join(project, target)), expected, source);
    countNegativeZeros(expected);
    assert.equal(packaged.available(path.join(project, source)), false, '原 JSON 仅保留供恢复：' + source);
    assert.equal(packaged.available(path.join(project, target)), true, 'JS 数据必须随包：' + target);
  }
  assert.ok(negativeZeros > 0, '原数据包含负零，转换不能借 JSON.stringify 抹平它');
});
