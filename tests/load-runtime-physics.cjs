'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const project=path.resolve(__dirname,'..');
const {createRingPhysicsFactory}=require(path.join(project,'src/ring-physics-runtime-v1.js')),{instantiateTess}=require('./tess-node.cjs');
let factory;
function createFactory(){if(!factory)factory=createRingPhysicsFactory(instantiateTess(fs.readFileSync(path.join(project,'packages/geometry/libtess2-candidate-v3.wasm'))),JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(project,'packages/geometry/ring-source-runtime-v1.json.gz')))));return factory;}
module.exports={createFactory};
