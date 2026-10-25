'use strict';
const platform=require('./platform'),{ungzip}=require('../vendor/pako-inflate'),{loadWechatTess,createTess}=require('./tess-runtime-candidate-v2'),{createRingPhysicsFactory}=require('./ring-physics-runtime-v1');
async function loadRingPhysicsFactory(){
 await platform.ensurePackage('geometry');
 const read=path=>typeof wx!=='undefined'?new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:path,success:r=>resolve(r.data),fail:reject})):fetch(path).then(r=>{if(!r.ok)throw new Error('物理资源读取失败');return r.arrayBuffer();});
 const data=JSON.parse(ungzip(new Uint8Array(await read('packages/geometry/ring-source-runtime-v1.json.gz')),{to:'string'}));
 let tess;
 if(typeof WXWebAssembly!=='undefined')tess=await loadWechatTess('packages/geometry/libtess2-candidate-v3.wasm');
 else{let instance;const imports={wasi_snapshot_preview1:{random_get(pointer,length){new Uint8Array(instance.exports.memory.buffer,pointer,length).fill(0x5a);return 0;}}},loaded=await WebAssembly.instantiate(await read('packages/geometry/libtess2-candidate-v3.wasm'),imports);instance=loaded.instance;tess=createTess(instance);}
 try {
  const loaded=typeof WXWebAssembly!=='undefined'
   ? await WXWebAssembly.instantiate('packages/geometry/gjk-f32.wasm',{})
   : await WebAssembly.instantiate(await read('packages/geometry/gjk-f32.wasm'),{});
  const bridge=require('./gjk-wasm-bridge');
  require('./query-gjk-toi-f32-v2').installCompiledGjk(bridge.createWasmDistance(loaded.instance),bridge.createWasmCandidates(loaded.instance));
  console.info('RR_GJK_BACKEND82',{compiled:true});
 } catch(error) { console.warn('编译物理查询不可用，沿用原JS查询',error); }
 return createRingPhysicsFactory(tess,data);
}
module.exports={loadRingPhysicsFactory};
