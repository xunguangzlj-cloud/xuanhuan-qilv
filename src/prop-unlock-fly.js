const sizeKeys=[[0,.68465775,2.552036,2.552036],[.12625235,1.0870794,.02031332,.02031332],[.35,1,-.54180974,0],[.95,1,0,0]];
const pathKeys=[[.1,0,.1038436,.1038436],[.25049734,.018962976,.2635341,.2635341],[.67882103,.47865734,1.7807078,1.7807078],[.92456299,.96939909,1.2401172,1.2401172],[1,1,.0000008988,.0000008988]];
function curve(keys,t){
  if(t<=keys[0][0])return keys[0][1];
  for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){
    const a=keys[i-1],b=keys[i],d=b[0]-a[0],u=(t-a[0])/d,v=1-u;
    return (1+2*u)*v*v*a[1]+u*v*v*d*a[3]+u*u*(3-2*u)*b[1]-u*u*v*d*b[2];
  }
  return keys[keys.length-1][1];
}
// 原统一圆周发射、接手曲线及按序暂停；解析积分不包含Unity帧边界接手误差。
function sampleUnlockFly({age,count,start,target}){
  const result=[],time=age-.5,n=Math.max(1,Math.min(6,Math.trunc(count)||1));
  for(let i=0;i<n;i++){
    const delay=i*.08,lifetime=.86+delay;
    if(time<0||time>lifetime+1e-9)continue;
    const t=time<.245?time:time<.245+delay?.245:time-delay,u=Math.min(1,t/.86);
    const angle=i*2*Math.PI/n,dx=-Math.sin(angle),dy=-Math.cos(angle);
    const sx=start.x+dx*(45+527*.186),sy=start.y+dy*(45+527*.186);
    let x=start.x+dx*(45+527*t),y=start.y+dy*(45+527*t);
    if(t>=.186){
      const p=curve(pathKeys,Math.min(1,(t-.186)/.674)),q=1-p;
      const cx=.75*sx+.25*target.x+230,cy=.75*sy+.25*target.y-71.53;
      const b=Math.min(1,(t-.186)/.059),blend=b*b*(3-2*b);
      x+=(q*q*sx+2*q*p*cx+p*p*target.x-x)*blend;
      y+=(q*q*sy+2*q*p*cy+p*p*target.y-y)*blend;
    }
    const scale=curve(sizeKeys,u);
    result.push({index:i,x,y,scale,size:180*scale,rotation:-(1+u),alpha:Math.min(1,u/(2313/65535)),lifetime});
  }
  return result;
}
module.exports={sampleUnlockFly};
