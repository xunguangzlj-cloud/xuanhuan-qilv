'use strict';
const {eulerWorldZ}=require('./cooker-euler-world-candidate-v1.js'),{identityParentRotation}=require('./cooker-identity-parent-rotation-v1.js');
function sourceEulerZ(angle,parentCount){
 const normalized=eulerWorldZ(angle),local=[0,0,normalized[2],normalized[3]];
 let world=local;for(let i=0;i<parentCount;i++)world=identityParentRotation(world);
 return {local,world};
}
module.exports={sourceEulerZ};
