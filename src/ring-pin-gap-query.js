'use strict';

// Hot.cs 的穿针阻尼查询：环带maxR按Collider.bounds角点，gap先看组件根再看bounds中心。
function pinIntersectsRingGap(pin, ring) {
  let minimum = Infinity, maximum = 0;
  for (const collider of pin.colliders) {
    minimum = Math.min(minimum, collider.minRadius);
    const b = collider.bounds;
    for (const point of [[b.minX,b.minY],[b.minX,b.maxY],[b.maxX,b.minY],[b.maxX,b.maxY],[(b.minX+b.maxX)/2,(b.minY+b.maxY)/2]]) maximum = Math.max(maximum, Math.hypot(point[0]-ring.center[0],point[1]-ring.center[1]));
  }
  if (minimum > ring.outer || maximum < ring.inner) return false;
  const inSector = point => {
    const m = ring.worldToLocal, x = m[0]*point[0]+m[1]*point[1]+m[2], y = m[3]*point[0]+m[4]*point[1]+m[5];
    if (x*x+y*y < 1e-8) return true;
    const raw = ((Math.atan2(y,x)*180/Math.PI-ring.gapDirectionDeg)%360+360)%360, delta = raw > 180 ? raw-360 : raw;
    return Math.abs(delta) <= ring.gapHalfDeg+.5;
  };
  if (pin.root && inSector(pin.root)) return true;
  return pin.colliders.some(collider => { const b=collider.bounds; return inSector([(b.minX+b.maxX)/2,(b.minY+b.maxY)/2]); });
}
module.exports = { pinIntersectsRingGap };
