'use strict';
// 独立候选桥：仅允许malloc初始化所需的本地随机cookie，不读取账号或网络。
function instantiateTess(bytes){
  const module=new WebAssembly.Module(bytes),imports=WebAssembly.Module.imports(module);
  if(imports.length!==1||imports[0].module!=='wasi_snapshot_preview1'||imports[0].name!=='random_get')throw new Error('出现未审WASM导入');
  let instance;
  instance=new WebAssembly.Instance(module,{wasi_snapshot_preview1:{random_get(pointer,length){
    new Uint8Array(instance.exports.memory.buffer,pointer,length).fill(0x5a);return 0;
  }}});
  const e=instance.exports;e._initialize();
  function tesselate(contours){
    const tess=e.tessNewTess(0);if(!tess)throw new Error('剖分内存分配失败');
    try{
      e.tessSetOption(tess,0,1);
      for(const bits of contours){
        const data=e.malloc(bits.length*4);if(!data)throw new Error('轮廓内存分配失败');
        try{new Int32Array(e.memory.buffer,data,bits.length).set(bits);e.tessAddContour(tess,2,data,8,bits.length/2);}finally{e.free(data);}
      }
      const result=e.tessTesselate(tess,0,0,8,2,0);if(result!==1)throw new Error('原候选拒绝轮廓');
      const vertexCount=e.tessGetVertexCount(tess),elementCount=e.tessGetElementCount(tess);
      return {result,vertexCount,elementCount,vertexBits:Array.from(new Int32Array(e.memory.buffer,e.tessGetVertices(tess),vertexCount*2)),elements:Array.from(new Int32Array(e.memory.buffer,e.tessGetElements(tess),elementCount*8))};
    }finally{e.tessDeleteTess(tess);}
  }
  return {tesselate,memoryBytes:()=>e.memory.buffer.byteLength};
}
module.exports={instantiateTess};
