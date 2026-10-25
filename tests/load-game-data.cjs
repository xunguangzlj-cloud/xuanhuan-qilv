'use strict';

const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const gameRoot=path.resolve(__dirname,'..');
const index=require(path.join(gameRoot,'src/data-index.js'));
const {decodeOriginalHierarchyLevel}=require(path.join(gameRoot,'src/native-level-reader.js'));
let nativeChunk;

function loadNativeLevel(sourceKey,geometries) {
  const name=index.levelChunks[sourceKey];
  if(!nativeChunk||nativeChunk.name!==name)nativeChunk={name,bytes:new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(gameRoot,'packages',name,'native-physics.rrh1-v2.gz'))))};
  return decodeOriginalHierarchyLevel(nativeChunk.bytes,index=>geometries[index],sourceKey);
}

function loadGameData() {
  let geometries;
  const levels=[];
  for(const item of index.packages) {
    const decoded=zlib.gunzipSync(fs.readFileSync(path.join(gameRoot,item.root,'data.gz')));
    const hash=crypto.createHash('sha256').update(decoded).digest('hex');
    if(hash!==item.decodedSha256) throw new Error('微信分包内容校验失败：'+item.name);
    const value=JSON.parse(decoded.toString('utf8'));
    if(item.name==='geometry') geometries=value;
    else levels.push(...Object.values(value));
  }
  return {geometries,levels};
}

module.exports={gameRoot,loadGameData,loadNativeLevel};
