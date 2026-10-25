'use strict';
const {initialFromSource}=require('./cooker-source-initial-candidate-v2.js'),{sourceEulerZ}=require('./cooker-source-euler-candidate-v2.js'),{bodyFrame}=require('./cooker-body-frame-candidate-v1.js'),{cookCollider,from}=require('./cooker-complete-candidate-v1.js');
// 原主圆环的有限状态桥：写角只更新刚体基，实际bodyType变化或Collider重启才重建凸片。
function createSourceBody(tess,source,adapter){
 const initial=initialFromSource(source.nodes),paths=source.paths.map(p=>p.map(from)),offset=source.offsetBits.map(from);
 let quaternion=initial.quaternion,localQuaternion=quaternion,frame=initial.frame,polygons=null,prepared=null,isStatic=false,rebuildCount=0,cookQuaternion=null;
 const pairs=a=>Array.from({length:a.length/2},(_,i)=>[from(a[i*2]),from(a[i*2+1])]);
 function rebuild(){
  cookQuaternion=quaternion.slice();polygons=cookCollider(tess,paths,offset,initial.scale,quaternion).polygons;
  prepared=adapter.prepareCollider({hasAttachedRigidbody:true,physicalFrameStatus:'AttachedRigidbody',bodyPhysicsFrame:frame,primitives:polygons.map(a=>({type:'Polygon',radius:0,localVertices:pairs(a)}))});rebuildCount++;
 }
 rebuild();
 return {
  beginDrag(){if(!isStatic){isStatic=true;rebuild();}},
  writeEuler(angle){const value=sourceEulerZ(angle,source.nodes.length-1);quaternion=value.world;localQuaternion=value.local;frame=bodyFrame(initial.origin,quaternion);adapter.setBodyFrame(prepared,frame);},
  release(){if(isStatic){isStatic=false;rebuild();}},
  rebuild,
  restore(saved){quaternion=saved.quaternion.slice();localQuaternion=saved.localQuaternion.slice();frame=saved.frame.slice();cookQuaternion=saved.cookQuaternion.slice();polygons=saved.polygons||cookCollider(tess,paths,offset,initial.scale,cookQuaternion).polygons;isStatic=saved.isStatic;rebuildCount=saved.rebuildCount;prepared=adapter.prepareCollider({hasAttachedRigidbody:true,physicalFrameStatus:'AttachedRigidbody',bodyPhysicsFrame:frame,primitives:polygons.map(a=>({type:'Polygon',radius:0,localVertices:pairs(a)}))});},
  get prepared(){return prepared;},
  get initialLocalZ(){return initial.initialLocalZ;},
  get snapshot(){return {quaternion:quaternion.slice(),localQuaternion:localQuaternion.slice(),frame:frame.slice(),polygons,cookQuaternion:cookQuaternion.slice(),rebuildCount,isStatic};},
 };
}
module.exports={createSourceBody};
