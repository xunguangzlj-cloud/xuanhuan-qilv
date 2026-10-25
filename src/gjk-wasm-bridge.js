'use strict';

// 固定缓冲只供同步冷GJK查询使用；接触流形与距离选择仍沿用原查询模块。
function createWasmDistance(instance) {
  const api=instance.exports;
  const input=new Float32Array(api.memory.buffer,api.input_pointer(),40);
  const values=new Float32Array(api.memory.buffer,api.output_pointer(),5);
  const fields=new Int32Array(api.memory.buffer,api.output_pointer()+20,9);
  const reasons=['','iteration-limit','triangle','epsilon-squared','duplicate-support'];
  return function distance(output,cache,query) {
    if(query.useRadii!==false||cache.count!==0)throw new Error('编译GJK仅接受冷缓存和useRadii=false');
    const a=query.proxyA,b=query.proxyB,na=a.getVertexCount(),nb=b.getVertexCount();
    if(na<1||na>8||nb<1||nb>8)throw new Error('编译GJK顶点数量不符');
    for(let i=0;i<na;i++){const v=a.getVertex(i);input[i*2]=v.x;input[i*2+1]=v.y;}
    for(let i=0;i<nb;i++){const v=b.getVertex(i);input[16+i*2]=v.x;input[17+i*2]=v.y;}
    const x=query.transformA,y=query.transformB;
    input[32]=x.q.c;input[33]=x.q.s;input[34]=x.p.x;input[35]=x.p.y;
    input[36]=y.q.c;input[37]=y.q.s;input[38]=y.p.x;input[39]=y.p.y;
    if(!api.run(na,nb))throw new Error('编译GJK执行失败');
    output.pointA.x=values[0];output.pointA.y=values[1];output.pointB.x=values[2];output.pointB.y=values[3];
    output.distance=values[4];output.iterations=fields[0];output.stopped=reasons[fields[1]];
    if(!Number.isFinite(output.distance))throw new Error('编译GJK产生非有限值');
    cache.count=fields[2];cache.indexA=[];cache.indexB=[];output.simplexIndices=[];
    for(let i=0;i<cache.count;i++){const ia=fields[3+i],ib=fields[6+i];cache.indexA.push(ia);cache.indexB.push(ib);output.simplexIndices.push([ia,ib]);}
  };
}
function createWasmCandidates(instance) {
  const api=instance.exports,batch=new Float32Array(api.memory.buffer,api.batch_pointer(),512*22);
  const selected=new Uint32Array(api.memory.buffer,api.candidates_pointer(),65536);
  return function candidates(first,second) {
    if(!first.length||!second.length||first.length>256||second.length>256)return null;
    const compatible=p=>p.compiledVertices&&[p.xf.q.c,p.xf.q.s,p.xf.p.x,p.xf.p.y].every(v=>Math.fround(v)===v);
    if(!first.every(compatible)||!second.every(compatible))return null;
    function put(piece,slot){
      const offset=slot*22,x=piece.xf;
      batch.set(piece.compiledVertices,offset);batch[offset+16]=piece.compiledVertices.length/2;
      batch[offset+17]=x.q.c;batch[offset+18]=x.q.s;batch[offset+19]=x.p.x;batch[offset+20]=x.p.y;batch[offset+21]=piece.radius;
    }
    first.forEach((p,i)=>put(p,i));second.forEach((p,i)=>put(p,256+i));
    const count=api.batch_run(first.length,second.length);
    if(count<0)throw new Error('编译GJK批量查询失败');
    return Array.from(selected.subarray(0,count)).sort((a,b)=>a-b);
  };
}
module.exports={createWasmDistance,createWasmCandidates};
