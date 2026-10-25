'use strict';
const {sameBodyMatrix}=require('./cooker-matrix-samebody-candidate-v1.js');
const {transformPoints}=require('./cooker-transform-candidate-v1.js');
const {removeCollinear,hullVertices,validatePolygon}=require('./cooker-polygon-candidate-v1.js');
const cell=new DataView(new ArrayBuffer(4));
const from=v=>{cell.setInt32(0,v,true);return cell.getFloat32(0,true);};
const bits=v=>{cell.setFloat32(0,v,true);return cell.getInt32(0,true);};
const threshold=from(919713559);
function cookCollider(tess,paths,offset,scale,quaternion){
 const matrix=sameBodyMatrix(quaternion,scale),contours=paths.map(p=>transformPoints(p,matrix,offset,threshold).map(bits));
 const raw=tess.tesselate(contours),polygons=[];
 for(let at=0;at<raw.elements.length;at+=8){
  const vertices=[];for(const i of raw.elements.slice(at,at+8)){if(i<0)break;vertices.push([from(raw.vertexBits[i*2]),from(raw.vertexBits[i*2+1])]);}
  const clean=removeCollinear(vertices);if(!validatePolygon(clean,threshold))continue;
  polygons.push(hullVertices(clean).flat().map(bits));
 }
 return {matrixBits:matrix.map(bits),contours,raw,polygons};
}
module.exports={cookCollider,from,bits};
