function drawFriendUI(ctx, width, height, headerInset, model, hits) {
  hits.length = 0;
  const scale = width / 390, w = width - 36 * scale, h = Math.min(570 * scale, height - headerInset - 45 * scale);
  const x = (width - w) / 2, y = Math.max(headerInset + 10 * scale, (height - h) / 2);
  const text = (value, px, py, size = 15, color = '#75452d') => { ctx.fillStyle = color; ctx.font = `bold ${size*scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(value, px, py); };
  const button = (name, label, px, py, bw, bh) => {
    const r = 8 * scale; ctx.beginPath(); ctx.moveTo(px+r,py); ctx.lineTo(px+bw-r,py); ctx.quadraticCurveTo(px+bw,py,px+bw,py+r); ctx.lineTo(px+bw,py+bh-r); ctx.quadraticCurveTo(px+bw,py+bh,px+bw-r,py+bh); ctx.lineTo(px+r,py+bh); ctx.quadraticCurveTo(px,py+bh,px,py+bh-r); ctx.lineTo(px,py+r); ctx.quadraticCurveTo(px,py,px+r,py); ctx.closePath(); ctx.fillStyle='#247c73';ctx.fill();
    text(label,px+bw/2,py+bh/2,14,'#fff');hits.push({name,x:px,y:py,w:bw,h:bh});
  };
  ctx.save();ctx.fillStyle='rgba(40,29,25,.55)';ctx.fillRect(0,0,width,height);ctx.fillStyle='#fff5df';ctx.fillRect(x,y,w,h);
  text('好友排行榜',width/2,y+28*scale,24);text('按累计通关分数排名',width/2,y+58*scale,13);
  text(`我的累计得分：${model.friendScore || 0}`,width/2,y+83*scale,13);
  const box={x:x+12*scale,y:y+105*scale,w:w-24*scale,h:h-188*scale};
  if (!model.drawFriends || !model.drawFriends(ctx,box)) text(model.friendsHint || '请在微信小游戏中查看好友榜',width/2,y+h/2,14);
  const bw=(w-40*scale)/3,by=y+h-69*scale;
  button('friendsPrev','上一页',x+10*scale,by,bw,29*scale);button('friendsRefresh','刷新',x+20*scale+bw,by,bw,29*scale);button('friendsNext','下一页',x+30*scale+bw*2,by,bw,29*scale);
  button('friendsClose','关闭',x+85*scale,y+h-32*scale,w-170*scale,24*scale);ctx.restore();
}
module.exports = { drawFriendUI };
