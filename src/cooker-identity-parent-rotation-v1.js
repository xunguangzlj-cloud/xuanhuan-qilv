'use strict';
const f=Math.fround;
const shuffle=(a,mask)=>Array.from({length:4},(_,i)=>a[(mask>>>(i*2))&3]);
const multiply=(a,b)=>a.map((v,i)=>f(v*b[i]));
const subtract=(a,b)=>a.map((v,i)=>f(v-b[i]));
// Transform::GetRotation RVA 0x117dfbd..0x117e013；恒等父级的原SSE顺序。
function identityParentRotation(q){
 const p=[0,0,0,1],a=multiply(shuffle(p,0xaf),q),b=multiply([p[0],p[1],p[0],p[1]],shuffle(q,0xf5));
 const c=shuffle(multiply(shuffle(q,0x88),p),0x1e);
 let result=subtract(multiply(shuffle(q,0xd2),p),c);
 result=subtract(result,shuffle(a,0x8d));result=subtract(result,shuffle(b,0x63));
 return shuffle(result,0xd2).map((v,i)=>i<3?-v:v);
}
module.exports={identityParentRotation};
