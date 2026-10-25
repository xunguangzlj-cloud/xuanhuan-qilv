'use strict';
const f=Math.fround,{bodyFrame}=require('./cooker-body-frame-candidate-v1.js'),{localEulerZ}=require('./cooker-euler-getter-candidate-v2.js'),{from}=require('./cooker-complete-candidate-v1.js'),{identityParentRotation}=require('./cooker-identity-parent-rotation-v1.js');
function initialFromSource(nodes){
 if(nodes.length<2)throw new Error('当前只覆盖带恒等父级的原圆环');
 for(const n of nodes.slice(0,-1)){
  const a=n.sourcePQSFloat32Bits.map(from);
  if(a.some((v,i)=>v!==[0,0,0,0,0,0,1,1,1,1][i]))throw new Error('当前仅支持零位移、恒等旋转和缩放的祖先');
 }
 const pqs=nodes[nodes.length-1].sourcePQSFloat32Bits.map(from);
 if(pqs[3]!==0||pqs[4]!==0)throw new Error('当前仅支持纯Z源旋转');
 const z=pqs[5],w=pqs[6],length=f(Math.sqrt(f(f(z*z)+f(w*w))));
 if(!(length>0)||!pqs.every(Number.isFinite))throw new Error('源PQS无效');
 let nz=f(z/length),nw=f(w/length);if(nw<0){nz=-nz;nw=-nw;}
 // 无角位移的首次模拟，保留ReadPose3D的正w代表，再按实际父级合成顺序取世界旋转。
 let quaternion=[0,0,nz,nw];for(let i=nodes.length-2;i>=0;i--)quaternion=identityParentRotation(quaternion);
 const origin=pqs.slice(0,2);
 return {quaternion,origin,frame:bodyFrame(origin,quaternion),initialLocalZ:localEulerZ(quaternion),scale:pqs.slice(7,10)};
}
module.exports={initialFromSource};
