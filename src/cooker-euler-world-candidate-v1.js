'use strict';
const f=Math.fround,T=require('./windows-trig-bounded-v3.js');
// 同物体、恒等祖先、纯Z写入：SetLocalR使用sqrtps后divps，不能改成乘倒数。
function eulerWorldZ(degrees){
 if(!Number.isFinite(degrees)||f(degrees)!==degrees)throw new Error('角度必须是有限单精度值');
 const half=f(f(degrees*f(Math.PI/180))*.5),z=T.sinf(half),w=T.cosf(half),length=f(Math.sqrt(f(f(z*z)+f(w*w))));
 return [-0,-0,f(z/length),f(w/length)];
}
module.exports={eulerWorldZ};
