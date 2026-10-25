'use strict';
const f=Math.fround;
// 同版OrderZXY普通分支；保留xy乘积的零符号，不能约掉这一项。
function localEulerZ(q){
 if(q.length!==4||q[0]!==0||q[1]!==0||!q.every(Number.isFinite))throw new Error('仅支持有限纯Z四元数');
 const [x,y,z,w]=q,zz=f(z*z),ww=f(w*w),xy=f(x*y),zw=f(w*z);
 const numerator=f(f(zw+xy)*2),denominator=f(f(f(f(y*y)-zz)-f(x*x))+ww);
 let degree=f(f(Math.atan2(numerator,denominator))*f(180/Math.PI));
 const negativeFlip=f(f(-.0001)*f(180/Math.PI)),positiveFlip=f(360+negativeFlip);
 if(degree<negativeFlip)degree=f(degree+360);else if(degree>positiveFlip)degree=f(degree-360);
 return degree;
}
module.exports={localEulerZ};
