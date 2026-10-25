'use strict';
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');

esbuild.buildSync({
  stdin: {
    contents: "require('./src/app').boot().catch(error => { console.error('游戏启动失败', error); document.getElementById('toast').textContent = '加载失败，请重试'; });",
    resolveDir: root,
    sourcefile: 'preview-entry.js',
  },
  bundle: true,
  outfile: path.join(root, 'preview.bundle.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2019',
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
});
console.log('旋环奇旅浏览器预览已构建。');
