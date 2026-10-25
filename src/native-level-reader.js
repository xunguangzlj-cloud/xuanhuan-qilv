'use strict';

// 仅已解压Uint8Array与源几何查询函数；无Node、DOM、BigInt或解压依赖。
function createOriginalHierarchyReader(bytes,getSourceGeometry){
  if(!(bytes instanceof Uint8Array)||typeof getSourceGeometry!=='function')throw new Error('需要Uint8Array及源几何函数');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),scratch=new DataView(new ArrayBuffer(4));let at=0;
  const need=n=>{if(n>view.byteLength-at)throw new Error('RRH1截断：'+at);};
  const u8=()=>{need(1);return view.getUint8(at++);};
  const u16=()=>{need(2);const v=view.getUint16(at,true);at+=2;return v;};
  const i16=()=>{need(2);const v=view.getInt16(at,true);at+=2;return v;};
  const u32=()=>{need(4);const v=view.getUint32(at,true);at+=4;return v;};
  const number=size=>{need(size);const v=size===4?view.getFloat32(at,true):view.getFloat64(at,true);at+=size;if(!Number.isFinite(v))throw new Error('RRH1非有限数');return v;};
  const numbers=(n,size)=>Array.from({length:n},()=>number(size));
  const asBits=v=>{scratch.setFloat32(0,v,true);return scratch.getUint32(0,true);};
  const asFloat=v=>{scratch.setUint32(0,v,true);const n=scratch.getFloat32(0,true);if(!Number.isFinite(n))throw new Error('RRH1残差产生非有限点');return n;};
  const point=(m,p)=>[m[0]*p[0]+m[1]*p[1]+m[2],m[3]*p[0]+m[4]*p[1]+m[5]];
  const matrix6=m=>[m[0],m[1],m[3],m[4],m[5],m[7]];
  const pathId=()=>{
    let lo=u32(),hi=u32(),negative=(hi>>>31)!==0;
    if(negative){lo=(~lo+1)>>>0;hi=(~hi+(lo===0?1:0))>>>0;}
    // 四个16位字按1e7进制累积，每次整数运算均低于2^53，保留64位ID。
    const digits=[0];
    for(const word of [hi>>>16,hi&65535,lo>>>16,lo&65535]){
      let carry=word;
      for(let i=0;i<digits.length;i++){const next=digits[i]*65536+carry;digits[i]=next%10000000;carry=Math.floor(next/10000000);}
      if(carry)digits.push(carry);
    }
    let result=String(digits.pop());while(digits.length)result+=String(digits.pop()).padStart(7,'0');return negative?'-'+result:result;
  };
  if([u8(),u8(),u8(),u8()].join(',')!=='82,82,72,49'||u32()!==2)throw new Error('不支持的RRH1第2版格式');
  const count=u32(),mappingCount=u32(),levelCount=u16();if(!count||!mappingCount||!levelCount)throw new Error('RRH1空目录');
  // 只建Uint32位置表和80个关卡目录，不读取/缓存未请求关卡的geometry。
  const offsets=new Uint32Array(count+1),levelDirectory=new Map();
  const skip=n=>{need(n);at+=n;};
  for(let ordinal=0;ordinal<count;ordinal++){
    offsets[ordinal]=at;
    if(u32()!==ordinal)throw new Error('RRH1记录序号不连续');
    skip(164);const body=i16();if(body< -1)throw new Error('RRH1刚体索引不符');
    if(body>=0)skip(45);
    const primitives=u16(),dictionary=u16(),wide=u8();
    if(!primitives||!dictionary||wide>1||(!wide&&dictionary>255))throw new Error('RRH1片/字典目录错误');
    skip(48+dictionary*18);
    for(let i=0;i<primitives;i++){
      const type=u8(),length=u8(),radius=number(4);
      if(!((type===1&&length===1)||(type===2&&length>=3))||radius<0)throw new Error('RRH1片目录错误');
      skip(length*(wide?2:1));
    }
  }
  offsets[count]=at;let totalMappings=0;
  for(let i=0;i<levelCount;i++){
    const length=u8();if(!length)throw new Error('RRH1空关卡名');let name='';
    for(let j=0;j<length;j++){const c=u8();if(!((c>=48&&c<=57)||(c>=97&&c<=122)||c===95))throw new Error('RRH1关卡名非约定ASCII');name+=String.fromCharCode(c);}
    const entries=u32();if(levelDirectory.has(name))throw new Error('RRH1重复关卡');
    levelDirectory.set(name,{at,count:entries});
    for(let j=0;j<entries;j++){skip(8);if(u32()>=count)throw new Error('RRH1映射记录越界');}
    totalMappings+=entries;
  }
  if(totalMappings!==mappingCount||at!==view.byteLength)throw new Error('RRH1映射数量或尾长不符');
  function readRecord(ordinal){
    at=offsets[ordinal];
    if(u32()!==ordinal)throw new Error('RRH1记录序号不连续');
    const geometryIndex=u32(),scale=numbers(2,4);if(scale.some(v=>v<=0))throw new Error('RRH1尺度键非正');
    const nativeLocalToWorld=numbers(16,4),representativeSourceMatrix=numbers(6,8),offset=numbers(2,8),boundsCenter=numbers(3,4),boundsSize=numbers(3,4),nearestBodyIndex=i16();
    if(nearestBodyIndex< -1||boundsSize.some(v=>v<0))throw new Error('RRH1原生框架元数据错误');
    const bodyPose=nearestBodyIndex<0?null:numbers(3,4),bodyPhysicsFrame=nearestBodyIndex<0?null:numbers(6,4);
    const bodyAngleBeforeBits=nearestBodyIndex<0?null:(u32()|0),bodyAngleAfterBits=nearestBodyIndex<0?null:(u32()|0),bodyWritebackFlags=nearestBodyIndex<0?0:u8();
    if(bodyWritebackFlags>3)throw new Error('RRH1未知回写分类');
    if(nearestBodyIndex>=0){
      if((asBits(bodyPose[2])|0)!==bodyAngleAfterBits)throw new Error('RRH1实际body角度位与post不符');
      if(bodyWritebackFlags&1){if(bodyAngleBeforeBits!==-2147483648||bodyAngleAfterBits!==0)throw new Error('RRH1不是实证的-0归正');}
      else if(bodyAngleBeforeBits!==bodyAngleAfterBits)throw new Error('RRH1角度变化未标记');
    }
    const primitiveCount=u16(),dictionaryCount=u16(),wide=u8(),predictionMatrix=numbers(6,8);
    if(!primitiveCount||!dictionaryCount||wide>1||(!wide&&dictionaryCount>255))throw new Error('RRH1片/字典范围错误');
    const geometry=getSourceGeometry(geometryIndex);if(!geometry)throw new Error('RRH1缺源geometry：'+geometryIndex);
    let source;
    if(geometry.type==='PolygonCollider2D')source=geometry.paths.flat();
    else if(geometry.type==='CircleCollider2D')source=[[0,0]];
    else if(geometry.type==='BoxCollider2D'){const x=geometry.size.x/2,y=geometry.size.y/2;source=[[-x,-y],[x,-y],[x,y],[-x,y]];}
    else throw new Error('RRH1不支持的源类型');
    const dictionary=[];
    for(let i=0;i<dictionaryCount;i++){
      const sourceIndex=u16(),lx=u32(),ly=u32(),wx=u32(),wy=u32(),p=source[sourceIndex];
      if(!p||p.length!==2||!p.every(Number.isFinite))throw new Error('RRH1源点索引越界');
      const predicted=point(predictionMatrix,p),local=[asFloat(asBits(predicted[0])^lx),asFloat(asBits(predicted[1])^ly)],worldPrediction=point(matrix6(nativeLocalToWorld),local);
      dictionary.push({local,world:[asFloat(asBits(worldPrediction[0])^wx),asFloat(asBits(worldPrediction[1])^wy)]});
    }
    const primitives=[];
    for(let i=0;i<primitiveCount;i++){
      const type=u8(),length=u8(),radius=number(4);
      if(!((type===1&&length===1)||(type===2&&length>=3))||radius<0)throw new Error('RRH1片类型/顶点数/半径错误');
      const localVertices=[],worldVertices=[];
      for(let j=0;j<length;j++){const index=wide?u16():u8();if(index>=dictionary.length)throw new Error('RRH1片索引越界');localVertices.push(dictionary[index].local);worldVertices.push(dictionary[index].world);}
      primitives.push({type:type===1?'Circle':'Polygon',radius,localVertices,worldVertices});
    }
    const record={recordIndex:ordinal,geometryIndex,scale,scaleKey:geometryIndex+'@'+scale[0]+'/'+scale[1],nativeLocalToWorld,groupLocalToWorld:nativeLocalToWorld,representativeSourceMatrix,offset,boundsCenter,boundsSize,nearestBodyIndex,bodyPose,bodyPhysicsFrame,bodyAngleBeforeBits,bodyAngleAfterBits,bodyWritebackFlags,bodyAngleBitsPreserved:nearestBodyIndex<0?null:!(bodyWritebackFlags&1),originalPQSBitsPreservedAfterSimulate:!(bodyWritebackFlags&2),hasAttachedRigidbody:nearestBodyIndex>=0,physicalFrameStatus:nearestBodyIndex<0?'NoAttachedRigidbody':'AttachedRigidbody',predictionMatrix,primitives};
    if(at!==offsets[ordinal+1])throw new Error('RRH1按关记录长度不符');return record;
  }
  let activeLevel=null;
  function readLevel(sourceKey){
    if(activeLevel&&activeLevel.sourceKey===sourceKey)return activeLevel;
    const directory=levelDirectory.get(sourceKey);if(!directory)throw new Error('当前RRH1块不含关卡：'+sourceKey);
    const byCollider=new Map(),uniqueRecords=new Map();at=directory.at;
    for(let i=0;i<directory.count;i++){
      const id=pathId(),ordinal=u32();if(byCollider.has(id))throw new Error('RRH1原ID重复');
      byCollider.set(id,ordinal);
    }
    for(const ordinal of byCollider.values())if(!uniqueRecords.has(ordinal))uniqueRecords.set(ordinal,readRecord(ordinal));
    // 只保留当前关；换关直接替换，未建立跨关geometry缓存。
    activeLevel={sourceKey,records:Array.from(uniqueRecords.values()),colliderMappings:byCollider.size,get(requestedSourceKey,colliderId,expectedGeometryIndex){
      if(requestedSourceKey!==sourceKey)throw new Error('按关RRH1视图不能读取其他关');
      const ordinal=byCollider.get(colliderId);if(ordinal===undefined)throw new Error('缺少精确原Collider姿态键：'+sourceKey+'/'+colliderId);
      const record=uniqueRecords.get(ordinal);
      if(expectedGeometryIndex!==undefined&&record.geometryIndex!==expectedGeometryIndex)throw new Error('原Collider geometry身份不符');return record;
    }};
    return activeLevel;
  }
  return{readLevel,get(sourceKey,colliderId,expectedGeometryIndex){return readLevel(sourceKey).get(sourceKey,colliderId,expectedGeometryIndex);},
    hasLevel(sourceKey){return levelDirectory.has(sourceKey);},releaseLevel(){activeLevel=null;},
    get activeSourceKey(){return activeLevel&&activeLevel.sourceKey;},get activeRecordCount(){return activeLevel?activeLevel.records.length:0;},
    recordCount:count,levelCount:levelDirectory.size,rawBytes:bytes.byteLength,indexBytes:offsets.byteLength};
}

function decodeOriginalHierarchyLevel(bytes,getSourceGeometry,sourceKey){
  if(typeof sourceKey!=='string'||!sourceKey)throw new Error('RRH1按关解码需要明确sourceKey');
  const reader=createOriginalHierarchyReader(bytes,getSourceGeometry),level=reader.readLevel(sourceKey);
  return{sourceKey,recordCount:level.records.length,colliderMappings:level.colliderMappings,rawBytes:reader.rawBytes,indexBytes:reader.indexBytes,
    get(colliderId,expectedGeometryIndex){return level.get(sourceKey,colliderId,expectedGeometryIndex);}};
}

module.exports={decodeOriginalHierarchyLevel,createOriginalHierarchyReader};
