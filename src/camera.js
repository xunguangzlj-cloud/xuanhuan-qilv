'use strict';

// 来源Hot.cs:15136、165181-165464。gameRect采用Canvas左上原点像素。
function worldRectFromAabb(bounds) {
  const width = bounds.boundsMaxX-bounds.boundsMinX, height = bounds.boundsMaxY-bounds.boundsMinY;
  const margin = Math.hypot(width,height)*0.01, unit = Math.fround(1/24);
  const x = Math.fround(Math.fround(bounds.boundsMinX-margin)*unit);
  const y = Math.fround(Math.fround(-bounds.boundsMaxY-margin)*unit);
  const w = Math.fround(Math.fround(width+2*margin)*unit);
  const h = Math.fround(Math.fround(height+2*margin)*unit);
  return {x,y,width:w,height:h};
}

function calculateFraming(bounds, screenWidth, screenHeight, gameRect, scaleValue=1) {
  const centerX=bounds.x+bounds.width/2, centerY=bounds.y+bounds.height/2;
  const rect=gameRect, scale=scaleValue;
  let ortho=15, cameraY=centerY, strategy;
  const position = size => {
    const rectCenterFromBottom=screenHeight-(rect.y+rect.height/2);
    return centerY-(rectCenterFromBottom-screenHeight/2)*2*size/screenHeight;
  };
  const fits = size => {
    const p=screenHeight/(2*size), cy=position(size);
    const left=screenWidth/2+(bounds.x-centerX)*p;
    const right=screenWidth/2+(bounds.x+bounds.width-centerX)*p;
    const top=screenHeight/2-(bounds.y+bounds.height-cy)*p;
    const bottom=screenHeight/2-(bounds.y-cy)*p;
    return left>=rect.x && right<=rect.x+rect.width && top>=rect.y && bottom<=rect.y+rect.height;
  };
  if(rect && rect.width>0 && rect.height>0 && screenHeight>0) {
    const fitSize=Math.max(bounds.width*screenHeight/(2*rect.width),bounds.height*screenHeight/(2*rect.height));
    if(fits(15)) {
      ortho=15/scale;
      strategy='TryBaseSize';
      if(!fits(ortho)) {ortho=fitSize;strategy='TryAutoAdaptScale1';}
    } else {
      ortho=fitSize/scale;
      strategy='TryAutoAdapt';
      if(!fits(ortho)) {ortho=fitSize;strategy='TryAutoAdaptScale1';}
    }
    cameraY=position(ortho);
  } else {
    const aspect=screenWidth>0&&screenHeight>0?screenWidth/screenHeight:2;
    ortho=Math.max(bounds.width/(2*aspect*scale),bounds.height/(2*scale));
    strategy='Fullscreen';
  }
  const pixelsPerWorld=screenHeight/(2*ortho);
  return {orthographicSize:ortho,cameraX:centerX,cameraY,pixelsPerWorld,strategy,
    canvasOriginX:screenWidth/2-centerX*pixelsPerWorld,
    canvasOriginY:screenHeight/2+cameraY*pixelsPerWorld};
}

module.exports={worldRectFromAabb,calculateFraming};
