'use strict';
const f=Math.fround,EPS=2**-23,WELD=f(f(.005*.5)**2);
const sub=(a,b)=>[f(a[0]-b[0]),f(a[1]-b[1])],lengthSquared=a=>f(f(a[0]*a[0])+f(a[1]*a[1]));
function collinear(a,b,c){
 const first=sub(c,b),second=sub(b,a),one=f(Math.sqrt(f(f(first[1]*first[1])+f(first[0]*first[0])))),two=f(Math.sqrt(lengthSquared(second))),product=f(one*two);
 if(product<EPS)return true;
 const cosine=f(f(f(first[0]*second[0])+f(first[1]*second[1]))/product);
 if(cosine<=f(.99999))return false;
 let chord=sub(c,a),length=f(Math.sqrt(f(f(chord[1]*chord[1])+f(chord[0]*chord[0]))));
 if(length>=EPS){const inverse=f(1/length);chord=[f(chord[0]*inverse),f(chord[1]*inverse)];}
 return f(f(chord[1]*second[0])-f(chord[0]*second[1]))<=f(.01);
}
function removeCollinear(input){
 const points=input.map(p=>p.slice());let index=0,previous=points.at(-1),remaining=points.length-1;
 while(remaining>0){if(collinear(previous,points[index],points[index+1])){points.splice(index,1);if(points.length<3)return points;}else{previous=points[index];index++;}remaining--;}
 if(collinear(previous,points[index],points[0]))points.pop();
 return points;
}
function hullVertices(input,threshold=WELD){
 const points=[];for(const p of input){if(!points.some(q=>lengthSquared(sub(p,q))<threshold))points.push(p.slice());}
 if(points.length<3)return [];
 let start=0;for(let i=1;i<points.length;i++)if(points[i][0]>points[start][0]||(points[i][0]===points[start][0]&&points[i][1]<points[start][1]))start=i;
 const hull=[];let current=start;
 do{
  hull.push(points[current]);let next=0;
  for(let i=1;i<points.length;i++){
   if(next===current){next=i;continue;}
   const a=sub(points[next],points[current]),b=sub(points[i],points[current]),cross=f(f(a[0]*b[1])-f(a[1]*b[0]));
   if(cross<0||(cross===0&&lengthSquared(b)>lengthSquared(a)))next=i;
  }
  current=next;if(hull.length>8)throw new Error('凸包超过原上限');
 }while(current!==start);
 return hull;
}
function validatePolygon(input,threshold){
 if(input.length<3||input.length>8)return false;
 const hull=hullVertices(input,threshold);if(hull.length<3)return false;
 let x=0,y=0;for(const p of hull){x=f(x+p[0]);y=f(y+p[1]);}const inverse=f(1/hull.length),center=[f(x*inverse),f(y*inverse)];let area=0;
 for(let i=0;i<hull.length;i++){const a=sub(hull[i],center),b=sub(hull[(i+1)%hull.length],center);area=f(area+f(f(f(b[1]*a[0])-f(b[0]*a[1]))*.5));}
 return Number.isFinite(area)&&area>EPS;
}
module.exports={removeCollinear,hullVertices,validatePolygon};
