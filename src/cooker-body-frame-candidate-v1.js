'use strict';
const f=Math.fround,T=require('./windows-trig-bounded-v3.js');
function bodyFrame(position,quaternion){
 let z=quaternion[2],w=quaternion[3];if(w<0){z=-z;w=-w;}
 const angle=f(f(Math.atan2(z,w))*2),s=T.sinf(angle),c=T.cosf(angle);
 return [f(f(c*1)-f(s*0)),f(f(c*0)-f(s*1)),position[0],f(f(s*1)+f(c*0)),f(f(s*0)+f(c*1)),position[1]];
}
module.exports={bodyFrame};
