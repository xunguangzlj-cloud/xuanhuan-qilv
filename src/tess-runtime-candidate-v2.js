'use strict';
// 实例入口与平台加载分开；正常剖分算术和内存生命周期沿用已冻桥。
function createTess(instance){
 const e=instance.exports;e._initialize();
 function tesselate(contours){
  const tess=e.tessNewTess(0);if(!tess)throw new Error('剖分内存分配失败');
  try{
   e.tessSetOption(tess,0,1);
   for(const bits of contours){const data=e.malloc(bits.length*4);if(!data)throw new Error('轮廓内存分配失败');
    try{new Int32Array(e.memory.buffer,data,bits.length).set(bits);e.tessAddContour(tess,2,data,8,bits.length/2);}finally{e.free(data);}
   }
   const result=e.tessTesselate(tess,0,0,8,2,0);if(result!==1)throw new Error('原候选拒绝轮廓');
   const vertexCount=e.tessGetVertexCount(tess),elementCount=e.tessGetElementCount(tess);
   return {result,vertexCount,elementCount,vertexBits:Array.from(new Int32Array(e.memory.buffer,e.tessGetVertices(tess),vertexCount*2)),elements:Array.from(new Int32Array(e.memory.buffer,e.tessGetElements(tess),elementCount*8))};
  }finally{e.tessDeleteTess(tess);}
 }
 return {tesselate,memoryBytes:()=>e.memory.buffer.byteLength};
}
async function loadWechatTess(filePath){
 let instance;const imports={wasi_snapshot_preview1:{random_get(pointer,length){new Uint8Array(instance.exports.memory.buffer,pointer,length).fill(0x5a);return 0;}}};
 const loaded=await WXWebAssembly.instantiate(filePath,imports);instance=loaded.instance||loaded;return createTess(instance);
}
module.exports={createTess,loadWechatTess};
