'use strict';
const f=Math.fround,T=require('./windows-trig-bounded-v3.js');
function quaternionMatrix(q,scale){
 const [x,y,z,w]=q,x2=f(x*2),y2=f(y*2),z2=f(z*2),xx=f(x*x2),xy=f(x*y2),xz=f(x*z2),yy=f(y*y2),yz=f(y*z2),zz=f(z*z2),wx=f(w*x2),wy=f(w*y2),wz=f(w*z2);
 return [f(f(1-f(yy+zz))*scale[0]),f(f(xy+wz)*scale[0]),f(f(xz-wy)*scale[0]),0,f(f(xy-wz)*scale[1]),f(f(1-f(xx+zz))*scale[1]),f(f(yz+wx)*scale[1]),0,f(f(xz+wy)*scale[2]),f(f(yz-wx)*scale[2]),f(f(1-f(xx+yy))*scale[2]),0,0,0,0,1];
}
// 只覆盖同物体刚体、祖先恒等、纯Z四元数；不把此分支扩成一般层级求逆。
function sameBodyMatrix(q,scale){
 if(q.length!==4||scale.length!==3||q[0]!==0||q[1]!==0||!q.concat(scale).every(n=>Number.isFinite(n)&&f(n)===n))throw new Error('超出同物体纯Z分支支持域');
 let z=q[2],w=q[3];if(w<0){z=-z;w=-w;}
 const half=f(Math.atan2(z,w)),inverse=[-0,-0,-T.sinf(half),T.cosf(half)],left=quaternionMatrix(inverse,[1,1,1]),right=quaternionMatrix(q,scale),out=[];
 for(let col=0;col<4;col++)for(let row=0;row<4;row++)out[col*4+row]=f(f(f(f(left[4+row]*right[col*4+1])+f(left[row]*right[col*4]))+f(left[8+row]*right[col*4+2]))+f(left[12+row]*right[col*4+3]));
 return out;
}
module.exports={sameBodyMatrix,quaternionMatrix};
