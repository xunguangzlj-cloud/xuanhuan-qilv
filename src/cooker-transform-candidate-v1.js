'use strict';
// 同版TransformPoints RVA0x243ea00：逐指令F32顺序、极小值归零及相邻点过滤。
const f=Math.fround;
function transformPoints(source,matrix,offset,threshold){
  const result=[];
  for(let i=0;i<source.length;i+=2){
    const x=f(source[i]+offset[0]),y=f(source[i+1]+offset[1]);
    let a=f(f(f(f(x*matrix[0])+f(y*matrix[4]))+f(matrix[8]*0))+matrix[12]);
    let b=f(f(f(f(x*matrix[1])+f(y*matrix[5]))+f(matrix[9]*0))+matrix[13]);
    const z=f(f(f(f(x*matrix[2])+f(y*matrix[6]))+f(matrix[10]*0))+matrix[14]);
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(z)||f(f(f(b*b)+f(a*a))+f(z*z))>f(999999995904))return [];
    if(Math.abs(a)<1.1920928955078125e-6)a=0;
    if(Math.abs(b)<1.1920928955078125e-6)b=0;
    if(result.length){const dx=f(result[result.length-2]-a),dy=f(result[result.length-1]-b);if(threshold>=f(f(dx*dx)+f(dy*dy)))continue;}
    result.push(a,b);
  }
  return result;
}
module.exports={transformPoints};
