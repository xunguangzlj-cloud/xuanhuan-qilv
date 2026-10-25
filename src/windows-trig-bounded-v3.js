'use strict';
// 同版Windows DLL的sinf/cosf非FMA路径逐算术候选；只覆盖有限小角度，不是通用libm。
// 常数/次序来自native-physics-15f1-gjk-windows-trig-v3，尚不批准Android或生产使用。
const F=Math.fround,INV=0.6366197723675814,P1=1.5707963267341256,T1=6.077100506506192e-11,P2=6.077100506303966e-11,T2=2.0222662487959506e-21;
const view=new DataView(new ArrayBuffer(8));
function exponent(x){view.setFloat64(0,Math.abs(x),true);return view.getUint32(4,true)>>>20&2047;}
function check(x){if(!Number.isFinite(x)||F(x)!==x||Math.abs(x)>32)throw new Error('Windows小角度三角候选仅接受|F32输入|≤32');}
function reduce(x){
 const n=Math.trunc(x*INV+.5);let a=x-n*P1,r=a-n*T1;
 if(exponent(x)-exponent(r)>15){const old=a,b=n*P2;a=a-b;const error=(old-a)-b;r=a-(n*T2-error);}
 return [r,n];
}
function sinPolynomial(x){const t=x*x,u=t*t;return x+(((2.7557319223985893e-6*t-0.0001984126984126984)*u+(0.008333333333333333*t-0.16666666666666666))*(x*t));}
function cosPolynomial(x){const t=x*x,u=t*t;return (1-.5*t)+(((-2.755731922398589e-7*t+2.4801587301587298e-5)*u+(-0.0013888888888888887*t+0.041666666666666664))*u);}
function directSin(x){if(Math.abs(x)<2**-13)return x;if(Math.abs(x)<2**-7)return x-((x*x)*x)*0.16666666666666666;return sinPolynomial(x);}
function reducedSin(x){if(Math.abs(x)<2**-32)return x;if(Math.abs(x)<2**-13)return x-(0.16666666666666666*x)*(x*x);return sinPolynomial(x);}
function reducedCos(x){if(Math.abs(x)<2**-32)return 1;if(Math.abs(x)<2**-13)return 1-(x*x)*.5;return cosPolynomial(x);}
function cosf(x){check(x);const a=Math.abs(x);if(a<=Math.PI/4)return F(cosPolynomial(a));const [r,n]=reduce(a),v=(n&1)?reducedSin(r):reducedCos(r);return F((n+1)&2?-v:v);}
function sinf(x){check(x);const a=Math.abs(x);if(a<=Math.PI/4)return F(directSin(x));const [r,n]=reduce(a),v=(n&1)?reducedCos(r):reducedSin(r),sign=((n>>>1)&1)!==Number(x<0);return F(sign?-v:v);}
module.exports={sinf,cosf};
