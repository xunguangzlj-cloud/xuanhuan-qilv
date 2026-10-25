'use strict';
const adapter=require('./native-query-adapter-v2.js'),query=require('./query-gjk-toi-f32-v2.js'),{createSourceBody}=require('./cooker-source-body-runtime-v5.js'),{localEulerZ}=require('./cooker-euler-getter-candidate-v2.js'),{from,bits}=require('./cooker-complete-candidate-v1.js');
function createRingPhysicsFactory(tess,data){
 if(data.schemaVersion!==1)throw new Error('圆环源输入版本不符');
 const levels=new Map(data.levels.map(l=>[l.sourceKey,l]));
 return level=>{
  const source=levels.get(level.sourceKey);if(!source)throw new Error('缺少当前关圆环源输入');
  const parts=new Map(),colliders=new Map(),stats={bodies:0,distances:0,unsupportedWrites:0};
  for(const row of source.rings){
   const body=createSourceBody(tess,{nodes:row.nodes,paths:data.geometries[row.geometryIndex],offsetBits:row.offsetBits},adapter),state={body,active:true,initial:body.snapshot};
   parts.set(row.partId,state);colliders.set(row.colliderId,state);stats.bodies++;
  }
  if(stats.bodies!==level.parts.filter(p=>p.kind==='ring').length)throw new Error('当前关圆环源输入覆盖不全');
  const angle=part=>{const s=parts.get(part.id);return s&&s.active?localEulerZ(s.body.snapshot.localQuaternion):null;};
  const current=collider=>{const s=collider&&colliders.get(collider.id);return s&&s.active?s.body.prepared:null;};
  function setRotation(part,value){
   const s=parts.get(part.id);if(!s||!s.active)return null;value=Math.fround(value);
   // 新控制器读回Euler后始终在正常手势范围；旧版超范围存档保留既有回退。
   if(Math.abs(value)>3600){s.active=false;stats.unsupportedWrites++;return null;}
   s.body.writeEuler(value);return angle(part);
  }
  return {
   stats,angle,current,setRotation,
   isInitial(part){const s=parts.get(part.id);if(!s||!s.active)return false;const p=s.body.snapshot;return ['quaternion','frame','cookQuaternion'].every(k=>p[k].every((v,i)=>Object.is(v,s.initial[k][i])));},
   begin(part){const s=parts.get(part.id);if(s&&s.active)s.body.beginDrag();},
   release(part){const s=parts.get(part.id);if(s&&s.active)s.body.release();},
   hasPair(a,b){return !!current(a)&&!!current(b);},
   distance(a,b){const first=current(a),second=current(b);if(!first||!second)return null;stats.distances++;const result=query.shapeDistance(first.pieces,second.pieces);return Number.isFinite(result.distance)?result.distance:null;},
   capture(){return Array.from(parts,([id,s])=>({id,active:s.active,state:s.body.snapshot}));},
   restore(rows){for(const row of rows){const s=parts.get(row.id);s.active=row.active;s.body.restore(row.state);}},
   save(){return {schemaVersion:1,parts:Array.from(parts,([id,s])=>{const p=s.body.snapshot;return {id,active:s.active,quaternionBits:p.quaternion.map(bits),localQuaternionBits:p.localQuaternion.map(bits),frameBits:p.frame.map(bits),cookQuaternionBits:p.cookQuaternion.map(bits),isStatic:p.isStatic};})};},
   restoreSave(saved){
    if(!saved||saved.schemaVersion!==1)return false;
    for(const p of saved.parts){const s=parts.get(p.id);if(!s)continue;s.active=p.active;s.body.restore({quaternion:p.quaternionBits.map(from),localQuaternion:p.localQuaternionBits.map(from),frame:p.frameBits.map(from),cookQuaternion:p.cookQuaternionBits.map(from),isStatic:p.isStatic,rebuildCount:0});if(p.isStatic)s.body.release();}return true;
   },
   restoreLegacy(part,value){const s=parts.get(part.id);const result=setRotation(part,value);if(result!==null)s.body.rebuild();return result;},
  };
 };
}
module.exports={createRingPhysicsFactory};
