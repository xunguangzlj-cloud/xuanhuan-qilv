'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function platformHarness() {
  const canvases=[],calls=[],frames=[];
  const wx={getWindowInfo:()=>({windowWidth:360,windowHeight:800,pixelRatio:3}),createCanvas(){
    const id=canvases.length,ctx={save(){calls.push(['save',id]);},restore(){calls.push(['restore',id]);},setTransform(...args){calls.push(['transform',id,...args]);},fillRect(...args){calls.push(['fill',id,...args]);},fillText(...args){calls.push(['text',id,...args]);}};
    const canvas={getContext:()=>ctx};canvases.push(canvas);return canvas;
  }};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'src/platform.js'),'utf8'),{module,exports:module.exports,wx,require:()=>({ungzip(){}}),requestAnimationFrame:callback=>frames.push(callback)});
  return {platform:module.exports,canvases,calls,frames};
}

test('微信主屏Canvas复用，渲染副画布仍独立创建',()=>{
  const h=platformHarness(),main=h.platform.createCanvas();
  assert.equal(h.platform.createCanvas(),main);
  assert.notEqual(h.platform.createRenderCanvas(),main);
  assert.notEqual(h.platform.createRenderCanvas(),main);
  assert.equal(h.canvases.length,3);
});

test('入口模块加载失败也在已创建的微信主屏绘制提示，保留原绘图状态',async()=>{
  const h=platformHarness(),main=h.platform.createCanvas(),errors=[];
  vm.runInNewContext(fs.readFileSync(path.join(root,'game.js'),'utf8'),{require(name){if(name==='./src/platform')return h.platform;throw new Error('模拟入口模块失败');},console:{error(...args){errors.push(args);}}});
  h.frames.shift()(0);h.frames.shift()(16);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(errors.length,1);assert.match(errors[0][1].message,/模拟入口模块失败/);
  assert.equal(h.canvases.length,1);assert.equal(h.platform.createCanvas(),main);
  assert.equal(main.width,1080);assert.equal(main.height,2400);
  assert.deepEqual(h.calls.filter(row=>row[0]==='text').at(-1),['text',0,'加载失败，请重新进入',180,400]);
  assert.equal(h.calls[0][0],'save');assert.equal(h.calls.at(-1)[0],'restore');
  assert.deepEqual(h.calls.find(row=>row[0]==='transform'),['transform',0,3,0,0,3,0,0]);
});

test('入口先绘制并提交加载首帧，再读取玩法模块，首帧不等待玩法解析',async()=>{
 const h=platformHarness();let appLoaded=false;
 vm.runInNewContext(fs.readFileSync(path.join(root,'game.js'),'utf8'),{require(name){if(name==='./src/platform')return h.platform;if(name==='./src/app'){appLoaded=true;return {boot:()=>Promise.resolve()};}throw Error('意外模块');},console});
 assert.equal(appLoaded,false);assert.deepEqual(h.calls.find(r=>r[0]==='text'),['text',0,'加载中…',180,400]);
 h.frames.shift()(0);assert.equal(appLoaded,false);
 h.frames.shift()(16);await new Promise(resolve=>setImmediate(resolve));assert.equal(appLoaded,true);
});

test('真实boot在第一个分包等待之前显示加载文案',()=>{
  const order=[],module={exports:{}};
  const platform={viewport:()=>({width:360,height:800,ratio:3}),createCanvas:()=>({getContext:()=>({})}),showStartup:message=>order.push(['loading',message]),readSave:()=>null,readData:name=>{order.push(['read',name]);return new Promise(()=>{});},ensurePackage:name=>{order.push(['package',name]);return new Promise(()=>{});}};
  const requireLocal=name=>name==='./platform'?platform:require(path.resolve(root,'src',name));
  vm.runInNewContext(fs.readFileSync(path.join(root,'src/app.js'),'utf8'),{module,exports:module.exports,require:requireLocal,console});
  module.exports.boot();
  assert.equal(order[0][0],'loading');assert.equal(order[0][1],'加载中…');assert.equal(order[1][0],'read');assert.equal(order[1][1],'geometry');
});
