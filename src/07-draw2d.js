// =====================================================================
//  2D LAYERS
//  A = albedo (lit by the shader: moonlight, lamps, fire, lightning)
//  E = emissive (added on top: flames, tracers, glass, sparks)
// =====================================================================
const albCanvas = document.createElement('canvas');
const emiCanvas = document.createElement('canvas');
const A = albCanvas.getContext('2d');
const E = emiCanvas.getContext('2d');
let staticGround = null, lampSprite = null, basketSprite = null;
const SPR = {};

function softSprite(r,g,b, core, puffs){
  const s = 64, c = document.createElement('canvas'); c.width=c.height=s;
  const x = c.getContext('2d');
  const blobs = puffs ? [[32,32,30,1],[24,28,16,0.6],[40,30,15,0.6],[30,40,14,0.5],[38,38,13,0.5]] : [[32,32,31,1]];
  for(const [bx,by,br,ba] of blobs){
    const gr = x.createRadialGradient(bx,by,0,bx,by,br);
    gr.addColorStop(0, `rgba(${core||`${r},${g},${b}`},${ba})`);
    gr.addColorStop(0.45, `rgba(${r},${g},${b},${ba*0.55})`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.beginPath(); x.arc(bx,by,br,0,Math.PI*2); x.fill();
  }
  return c;
}
function buildSprites(){
  SPR.smoke = softSprite(150,150,158,null,true);
  SPR.soot  = softSprite(48,44,42,null,true);
  SPR.steam = softSprite(225,230,240,null,true);
  SPR.dust  = softSprite(140,112,80,null,true);
  SPR.fire  = softSprite(255,140,50,'255,235,170');
  SPR.ember = softSprite(255,170,70,'255,240,200');
  SPR.flash = softSprite(255,220,150,'255,255,240');
  SPR.cyan  = softSprite(120,220,255,'230,250,255');
}

// =====================================================================
//  STATIC GROUND: meadow, cobbled road, verge
// =====================================================================
function buildStaticGround(){
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // back meadow
  let gr = g.createLinearGradient(0,FLOOR_Y-6,0,ROAD_Y0);
  gr.addColorStop(0,'#3d5c33'); gr.addColorStop(1,'#2c4527');
  g.fillStyle = gr; g.fillRect(0, FLOOR_Y-2, W, ROAD_Y0-FLOOR_Y+6);
  for(let i=0;i<W*2.2;i++){
    const x = Math.random()*W, by = FLOOR_Y + Math.random()*(ROAD_Y0-FLOOR_Y), h = rand(2,7)*(0.5+0.5*(by-FLOOR_Y)/14);
    g.strokeStyle = ['#2b4826','#4a7038','#5d8443','#36572e'][(Math.random()*4)|0];
    g.lineWidth = rand(0.6,1.3);
    g.beginPath(); g.moveTo(x,by); g.lineTo(x+rand(-1.5,1.5), by-h); g.stroke();
  }
  // wildflower specks
  for(let i=0;i<W*0.08;i++){
    g.fillStyle = ['#c9c2e8','#e8d27a','#e6b0c4'][(Math.random()*3)|0];
    g.globalAlpha = 0.7; g.fillRect(Math.random()*W, FLOOR_Y+rand(2,12), 1.4, 1.4);
  }
  g.globalAlpha = 1;
  // back kerb
  g.fillStyle = '#5c5a56'; g.fillRect(0, ROAD_Y0-2, W, 5);
  for(let x=0;x<W;x+=rand(16,26)){ g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, ROAD_Y0-2, 1, 5); }
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, ROAD_Y0-2, W, 1);
  // cobblestones (smaller toward the back for perspective)
  g.fillStyle = '#25221f'; g.fillRect(0, ROAD_Y0+3, W, ROAD_Y1-ROAD_Y0-3);
  let y = ROAD_Y0+3, row = 0;
  while(y < ROAD_Y1){
    const rh = 4 + (y-ROAD_Y0)/(ROAD_Y1-ROAD_Y0)*4.5;
    let x = (row%2) ? -rh*0.8 : 0;
    while(x < W){
      const sw = rh*rand(1.3,2.0);
      const base = mixRgb([108,104,98],[84,78,72],Math.random());
      const tint = Math.random()<0.15 ? [96,92,104] : base;
      g.fillStyle = rgbStr(tint);
      const r = Math.min(rh,sw)*0.35;
      g.beginPath();
      if(g.roundRect) g.roundRect(x+0.6, y+0.5, sw-1.2, rh-1, r); else g.rect(x+0.6,y+0.5,sw-1.2,rh-1);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x+1.5, y+0.7, sw-3, 1);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x+1, y+rh-1.6, sw-2, 1);
      x += sw;
    }
    y += rh; row++;
  }
  // puddles (darker, slightly bluish — they read as wet under the lamps)
  for(let i=0;i<Math.round(W/260);i++){
    const px = rand(40,W-40), py = rand(ROAD_Y0+10, ROAD_Y1-6), pw = rand(18,46);
    const pg = g.createRadialGradient(px,py,1,px,py,pw);
    pg.addColorStop(0,'rgba(20,26,40,0.75)'); pg.addColorStop(0.7,'rgba(20,26,40,0.5)'); pg.addColorStop(1,'rgba(20,26,40,0)');
    g.fillStyle = pg; g.save(); g.translate(px,py); g.scale(1,0.22); g.translate(-px,-py);
    g.beginPath(); g.arc(px,py,pw,0,Math.PI*2); g.fill(); g.restore();
  }
  // front kerb
  g.fillStyle = '#4e4b47'; g.fillRect(0, ROAD_Y1, W, 5);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, ROAD_Y1, W, 1);
  // front verge
  gr = g.createLinearGradient(0,ROAD_Y1+5,0,H);
  gr.addColorStop(0,'#33532a'); gr.addColorStop(1,'#1a2e15');
  g.fillStyle = gr; g.fillRect(0, ROAD_Y1+5, W, H-ROAD_Y1-5);
  for(let i=0;i<W*5;i++){
    const x = Math.random()*W, by = ROAD_Y1+5+Math.random()*(H-ROAD_Y1), h = rand(3,10);
    g.strokeStyle = ['#24401d','#3f6a30','#567f3f','#2d4f25'][(Math.random()*4)|0];
    g.lineWidth = rand(0.6,1.5);
    g.beginPath(); g.moveTo(x,by); g.quadraticCurveTo(x+rand(-2,2), by-h*0.6, x+rand(-3,3), by-h); g.stroke();
  }
  staticGround = c;
}

// =====================================================================
//  GAS LAMP & BASKET SPRITES (2× for crispness)
// =====================================================================
function buildLampSprite(){
  const S = 2, w = 34, h = LAMP_H+12;
  const c = document.createElement('canvas'); c.width = w*S; c.height = h*S;
  const g = c.getContext('2d'); g.scale(S,S); g.translate(w/2, LAMP_H+6);
  const iron = '#1c2125', hi = '#56626b', mid = '#2c3338';
  const L = LAMP_H;
  // plinth
  g.fillStyle = iron;
  g.beginPath(); g.moveTo(-9,0); g.lineTo(9,0); g.lineTo(7,-6); g.lineTo(-7,-6); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-6,-6); g.lineTo(6,-6); g.lineTo(4.6,-16); g.lineTo(-4.6,-16); g.closePath(); g.fill();
  g.fillStyle = hi; g.fillRect(5,-6,1.2,-10*0); g.beginPath(); g.moveTo(4.6,-16); g.lineTo(6,-6); g.lineTo(5,-6); g.lineTo(3.8,-16); g.fill();
  g.fillStyle = mid; g.fillRect(-7.5,-7,15,1.6); g.fillRect(-5.5,-17,11,1.4);
  // fluted column
  const cTop = -(L-31);
  g.fillStyle = iron;
  g.beginPath(); g.moveTo(-2.8,-16); g.lineTo(2.8,-16); g.lineTo(1.9,cTop); g.lineTo(-1.9,cTop); g.closePath(); g.fill();
  g.strokeStyle = hi; g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(1.8,-16); g.lineTo(1.2,cTop); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.beginPath(); g.moveTo(-0.6,-16); g.lineTo(-0.4,cTop); g.stroke();
  for(const ry of [-34, -62, cTop+6]){ g.fillStyle = mid; g.fillRect(-3,ry,6,1.8); g.fillStyle = hi; g.fillRect(1.5,ry,1.4,1.8); }
  // ladder bar
  const by = -(L-38);
  g.fillStyle = iron; g.fillRect(-12,by,24,1.8);
  g.beginPath(); g.arc(-12,by+0.9,1.7,0,Math.PI*2); g.arc(12,by+0.9,1.7,0,Math.PI*2); g.fill();
  g.fillStyle = hi; g.fillRect(2,by,10,0.6);
  // lantern collar
  g.fillStyle = iron;
  g.beginPath(); g.moveTo(-2,cTop); g.lineTo(2,cTop); g.lineTo(4.6,-(L-26)); g.lineTo(-4.6,-(L-26)); g.closePath(); g.fill();
  // glass (dark amber albedo; the flame is emissive)
  const gB = -(L-26), gT = -(L-10);
  g.fillStyle = '#3c3120';
  g.beginPath(); g.moveTo(-4.6,gB); g.lineTo(4.6,gB); g.lineTo(6.6,gT); g.lineTo(-6.6,gT); g.closePath(); g.fill();
  g.strokeStyle = iron; g.lineWidth = 1.1;
  g.beginPath(); g.moveTo(-4.6,gB); g.lineTo(-6.6,gT); g.moveTo(4.6,gB); g.lineTo(6.6,gT); g.moveTo(0,gB); g.lineTo(0,gT); g.stroke();
  g.fillStyle = iron; g.fillRect(-5.2,gB-1,10.4,2);
  // roof & finial
  g.beginPath(); g.moveTo(-8.5,gT+0.5); g.lineTo(8.5,gT+0.5); g.quadraticCurveTo(4,gT-4, 1.4,-L+1); g.lineTo(-1.4,-L+1); g.quadraticCurveTo(-4,gT-4,-8.5,gT+0.5); g.closePath(); g.fill();
  g.fillStyle = hi; g.beginPath(); g.moveTo(8.5,gT+0.5); g.lineTo(6.5,gT+0.5); g.quadraticCurveTo(3,gT-3,1,-L+1.5); g.lineTo(1.4,-L+1); g.quadraticCurveTo(4,gT-4,8.5,gT+0.5); g.fill();
  g.fillStyle = iron; g.fillRect(-0.7,-L-4,1.4,5);
  g.beginPath(); g.arc(0,-L-4.5,1.6,0,Math.PI*2); g.fill();
  lampSprite = c;
}
function buildBasketSprite(){
  const S = 2, w = 44, h = 26;
  const c = document.createElement('canvas'); c.width = w*S; c.height = h*S;
  const g = c.getContext('2d'); g.scale(S,S); g.translate(w/2, 3);
  const shape = ()=>{ g.beginPath(); g.moveTo(-15,0); g.quadraticCurveTo(-16.5,9,-13,18); g.lineTo(13,18); g.quadraticCurveTo(16.5,9,15,0); g.closePath(); };
  shape(); g.fillStyle = '#6e4a28'; g.fill();
  g.save(); shape(); g.clip();
  // woven wicker: alternating over/under strands
  for(let row=0; row<6; row++){
    const yy = 1.5 + row*3;
    for(let col=-16; col<16; col+=4){
      const off = (row%2)*2;
      const gr = g.createLinearGradient(0,yy-1.4,0,yy+1.4);
      gr.addColorStop(0,'#a77b47'); gr.addColorStop(0.5,'#8a6236'); gr.addColorStop(1,'#5a3c1e');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(col+off, yy, 2.1, 1.35, 0, 0, Math.PI*2); g.fill();
    }
  }
  g.strokeStyle = 'rgba(40,24,10,0.6)'; g.lineWidth = 0.7;
  for(let x=-14;x<=14;x+=4){ g.beginPath(); g.moveTo(x,0); g.lineTo(x*0.88,18); g.stroke(); }
  // moonlight from the right, shade on the left
  const sh = g.createLinearGradient(-16,0,16,0);
  sh.addColorStop(0,'rgba(0,0,0,0.45)'); sh.addColorStop(0.6,'rgba(0,0,0,0)'); sh.addColorStop(1,'rgba(255,240,210,0.12)');
  g.fillStyle = sh; g.fillRect(-17,0,34,19);
  const sv = g.createLinearGradient(0,0,0,18);
  sv.addColorStop(0,'rgba(0,0,0,0)'); sv.addColorStop(1,'rgba(0,0,0,0.35)');
  g.fillStyle = sv; g.fillRect(-17,0,34,19);
  g.restore();
  shape(); g.strokeStyle = '#24160a'; g.lineWidth = 1.1; g.stroke();
  // padded leather rim with stitching
  g.fillStyle = '#3d2414';
  g.beginPath(); if(g.roundRect) g.roundRect(-16.5,-2,33,4.2,2); else g.rect(-16.5,-2,33,4.2); g.fill();
  g.fillStyle = 'rgba(255,220,180,0.25)'; g.fillRect(-15,-1.6,30,0.8);
  g.fillStyle = 'rgba(230,200,150,0.6)';
  for(let x=-14;x<=14;x+=2.5) g.fillRect(x,0.6,1,0.6);
  // skids
  g.fillStyle = '#2a1a0c'; g.fillRect(-13,17.5,26,2.2);
  basketSprite = c;
}

let layerScale = 1;
function sizeLayers(){
  const r = (typeof GLR!=='undefined' && GLR.ok) ? GLR.rs : 1;
  albCanvas.width = Math.round(W*r); albCanvas.height = Math.round(H*r);
  emiCanvas.width = albCanvas.width; emiCanvas.height = albCanvas.height;
  layerScale = albCanvas.width/W;
}
function resize2D(){
  sizeLayers();
  if(!SPR.smoke) buildSprites();
  if(!lampSprite) buildLampSprite();
  if(!basketSprite) buildBasketSprite();
  buildStaticGround();
}

// =====================================================================
//  BALLOON
// =====================================================================
const GORES = 10;
const PAL_RGB = {};
function palRgb(b){
  if(!PAL_RGB[b.id]){ const p = b.pal; PAL_RGB[b.id] = { main:hexToRgb(p.main), alt:hexToRgb(p.alt), band:hexToRgb(p.band), cap:hexToRgb(p.cap) }; }
  return PAL_RGB[b.id];
}
function envProfile(b){
  const n = 26;
  const hpF = b.alive ? clamp(b.hp/b.maxHp,0,1) : 0;
  const sx = b.alive ? 0.86 + 0.14*hpF : 0.55;
  const top = -46 + (1-hpF)*(b.alive?7:16), bot = 22;
  const wr = b.alive ? (1-hpF)*2.4 : 4.5;
  const ys = new Float32Array(n), hw = new Float32Array(n);
  for(let i=0;i<n;i++){
    const u = i/(n-1);
    const y = top + u*(bot-top);
    let w;
    if(u<0.48){ const q = (0.48-u)/0.48; w = 34*Math.sqrt(Math.max(0,1-q*q)); }
    else { const t = (u-0.48)/0.52; w = 10 + 24*(1-Math.pow(t,1.55)); }
    w *= sx;
    if(u>0.12) w += wr*Math.sin(y*0.45 + windTime*(b.alive?3:9) + b.id*2);
    ys[i] = y; hw[i] = Math.max(w,0);
  }
  return { ys, hw, n, top, bot };
}
function envelopePath(ctx, P){
  ctx.beginPath();
  ctx.moveTo(0, P.ys[0]);
  for(let i=1;i<P.n;i++) ctx.lineTo(P.hw[i], P.ys[i]);
  for(let i=P.n-1;i>=1;i--) ctx.lineTo(-P.hw[i], P.ys[i]);
  ctx.closePath();
}
function gorePath(ctx, P, k){
  const a0 = -Math.PI/2 + k*Math.PI/GORES, a1 = a0 + Math.PI/GORES;
  const s0 = Math.sin(a0), s1 = Math.sin(a1);
  ctx.beginPath();
  ctx.moveTo(0, P.ys[0]);
  for(let i=1;i<P.n;i++) ctx.lineTo(P.hw[i]*s0, P.ys[i]);
  for(let i=P.n-1;i>=1;i--) ctx.lineTo(P.hw[i]*s1, P.ys[i]);
  ctx.closePath();
}
function hwAt(P, y){
  if(y<=P.ys[0]) return 0;
  for(let i=1;i<P.n;i++) if(y<=P.ys[i]){ const t=(y-P.ys[i-1])/(P.ys[i]-P.ys[i-1]); return lerp(P.hw[i-1],P.hw[i],t); }
  return P.hw[P.n-1];
}

function drawEnvelope(b, P){
  const C = palRgb(b);
  const dead = !b.alive;
  const char = dead ? 0.35 : 1;
  // --- albedo: flat gores, band and crown, then shading passes ---
  A.save();
  envelopePath(A, P); A.clip();
  for(let k=0;k<GORES;k++){
    const c = (k%2) ? C.alt : C.main;
    A.fillStyle = rgbStr(scaleRgb(c, char));
    gorePath(A, P, k); A.fill();
  }
  // zig-zag band around the equator
  const bandY = -18;
  A.fillStyle = rgbStr(scaleRgb(C.band, char));
  A.beginPath();
  const zw = 34;
  A.moveTo(-zw, bandY-4);
  for(let x=-zw, i=0; x<=zw; x+=6, i++) A.lineTo(x, bandY + (i%2? -5 : 3));
  A.lineTo(zw, bandY+8);
  for(let x=zw, i=0; x>=-zw; x-=6, i++) A.lineTo(x, bandY + 10 + (i%2? -3 : 3));
  A.closePath(); A.fill();
  A.fillStyle = rgbStr(scaleRgb(C.cap, char*0.9));
  A.fillRect(-40, P.top-2, 80, 11);
  A.fillStyle = rgbStr(scaleRgb(C.cap, char*0.75));
  A.fillRect(-40, 12, 80, 14);
  // shading: horizontal lambert (moon to the right), then top→bottom falloff
  A.globalCompositeOperation = 'multiply';
  const hs = A.createLinearGradient(-36,0,36,0);
  hs.addColorStop(0,'rgb(70,72,92)'); hs.addColorStop(0.35,'rgb(175,175,190)'); hs.addColorStop(0.72,'rgb(255,255,255)'); hs.addColorStop(1,'rgb(185,190,210)');
  A.fillStyle = hs; A.fillRect(-40, P.top-4, 80, 80);
  const vs = A.createLinearGradient(0,P.top,0,P.bot);
  vs.addColorStop(0,'rgb(255,255,255)'); vs.addColorStop(0.55,'rgb(220,220,228)'); vs.addColorStop(1,'rgb(110,105,115)');
  A.fillStyle = vs; A.fillRect(-40, P.top-4, 80, 80);
  A.globalCompositeOperation = 'source-over';
  if(!dead){
    // soft sheen on the moon side
    const sp = A.createRadialGradient(12,-24,1,12,-24,22);
    sp.addColorStop(0,'rgba(255,255,255,0.32)'); sp.addColorStop(1,'rgba(255,255,255,0)');
    A.fillStyle = sp; A.fillRect(-10,-48,46,48);
  }
  // seams (gores) and horizontal load tapes
  A.strokeStyle = 'rgba(25,18,14,0.5)'; A.lineWidth = 0.8;
  for(let k=1;k<GORES;k++){
    const s = Math.sin(-Math.PI/2 + k*Math.PI/GORES);
    A.beginPath(); A.moveTo(0,P.ys[0]);
    for(let i=1;i<P.n;i++) A.lineTo(P.hw[i]*s, P.ys[i]);
    A.stroke();
  }
  A.strokeStyle = 'rgba(25,18,14,0.35)'; A.lineWidth = 0.7;
  for(const ty of [-32,-4,12]){
    const w = hwAt(P, ty);
    A.beginPath(); A.moveTo(-w,ty); A.quadraticCurveTo(0,ty+3,w,ty); A.stroke();
  }
  // fabric patches (applied by Patch Kit) — small stitched squares
  // tears: torn fabric with frayed edges
  for(const t of b.tears){
    const tx = Math.cos(t.ang)*30*t.rr, ty = -8 + Math.sin(t.ang)*32*t.rr;
    A.save(); A.translate(tx,ty); A.rotate(t.ang);
    A.fillStyle = 'rgba(12,8,6,0.9)';
    A.beginPath();
    for(let i=0;i<t.poly.length;i++){ const a=(i/t.poly.length)*Math.PI*2, r=t.s*t.poly[i]; i?A.lineTo(Math.cos(a)*r,Math.sin(a)*r*0.75):A.moveTo(Math.cos(a)*r,Math.sin(a)*r*0.75); }
    A.closePath(); A.fill();
    A.rotate(t.flap); A.fillStyle = 'rgba(60,30,20,0.7)';
    A.beginPath(); A.moveTo(t.s*0.3,0); A.lineTo(t.s*1.25,-t.s*0.4); A.lineTo(t.s*1.0,t.s*0.5); A.closePath(); A.fill();
    A.restore();
  }
  A.restore();
  envelopePath(A, P); A.strokeStyle = 'rgba(10,8,8,0.55)'; A.lineWidth = 1; A.stroke();

  // --- emissive: burner light glowing through the fabric (translucency) ---
  const heat = b.burnerHeat;
  if(heat>0.02 && !dead){
    const fl = 0.9 + 0.1*Math.sin(windTime*23 + b.id*4);
    for(let k=0;k<GORES;k++){
      const kk = (k%2) ? b.pal.glowAlt : b.pal.glowMain;
      const gr = E.createRadialGradient(0,20,2,0,6,58);
      gr.addColorStop(0, `rgba(255,170,90,${0.42*heat*kk*fl})`);
      gr.addColorStop(0.45, `rgba(255,110,45,${0.17*heat*kk*fl})`);
      gr.addColorStop(1, 'rgba(200,60,20,0)');
      E.fillStyle = gr; gorePath(E, P, k); E.fill();
    }
    E.fillStyle = `rgba(255,150,70,${0.22*heat})`;
    for(const t of b.tears){
      const tx = Math.cos(t.ang)*30*t.rr, ty = -8 + Math.sin(t.ang)*32*t.rr;
      E.beginPath(); E.ellipse(tx,ty,t.s*0.3,t.s*0.2,t.ang,0,Math.PI*2); E.fill();
    }
  }
  // cool moonlit rim on the right edge
  if(!dead){
    E.save(); envelopePath(E, P); E.clip();
    E.strokeStyle = 'rgba(150,175,235,0.16)'; E.lineWidth = 3;
    E.beginPath(); E.moveTo(0,P.ys[0]);
    for(let i=1;i<P.n-3;i++) E.lineTo(P.hw[i], P.ys[i]);
    E.stroke(); E.restore();
  }
  if(b.flash>0){ E.fillStyle = `rgba(255,240,220,${b.flash*2.2})`; envelopePath(E,P); E.fill(); }
}

function drawBurnerFlame(b){
  const heat = b.burnerHeat;
  // pilot lights
  E.fillStyle = 'rgba(140,190,255,0.9)';
  for(const sx of [-4.5,4.5]){ E.beginPath(); E.ellipse(sx,24.5,1.1,1.8,0,0,Math.PI*2); E.fill(); }
  if(heat<0.03) return;
  for(const sx of [-4.5,4.5]){
    const L = (14 + 16*heat) * (0.85 + 0.15*Math.sin(windTime*31 + sx));
    let gr = E.createLinearGradient(0,25,0,25-L);
    gr.addColorStop(0,`rgba(255,250,230,${heat})`); gr.addColorStop(0.3,`rgba(255,200,90,${heat})`);
    gr.addColorStop(0.7,`rgba(255,110,40,${0.8*heat})`); gr.addColorStop(1,'rgba(255,60,20,0)');
    E.fillStyle = gr;
    E.beginPath(); E.moveTo(sx-3.4,25); E.quadraticCurveTo(sx-4,25-L*0.5, sx+Math.sin(windTime*17+sx)*1.5,25-L); E.quadraticCurveTo(sx+4,25-L*0.5, sx+3.4,25); E.closePath(); E.fill();
    gr = E.createLinearGradient(0,25,0,25-L*0.45);
    gr.addColorStop(0,`rgba(200,225,255,${heat})`); gr.addColorStop(1,'rgba(90,140,255,0)');
    E.fillStyle = gr;
    E.beginPath(); E.moveTo(sx-1.6,25); E.quadraticCurveTo(sx,25-L*0.55, sx+1.6,25); E.closePath(); E.fill();
  }
  const g = E.createRadialGradient(0,20,2,0,20,30);
  g.addColorStop(0,`rgba(255,200,120,${0.5*heat})`); g.addColorStop(1,'rgba(255,120,40,0)');
  E.fillStyle = g; E.beginPath(); E.arc(0,20,30,0,Math.PI*2); E.fill();
}
function drawThrusterJet(x, y, dir, len, hot){
  // dir: +1 → jet points right. Mach diamonds give it a "real rocket" read.
  E.save(); E.translate(x,y); E.scale(dir,1);
  let gr = E.createLinearGradient(0,0,len,0);
  gr.addColorStop(0, hot ? 'rgba(255,240,220,1)' : 'rgba(220,240,255,0.95)');
  gr.addColorStop(0.35, hot ? 'rgba(255,170,80,0.85)' : 'rgba(140,190,255,0.7)');
  gr.addColorStop(1, 'rgba(80,120,255,0)');
  E.fillStyle = gr;
  const w = hot ? 4.5 : 2.6;
  E.beginPath(); E.moveTo(0,-w); E.quadraticCurveTo(len*0.5,-w*0.8,len,0); E.quadraticCurveTo(len*0.5,w*0.8,0,w); E.closePath(); E.fill();
  E.fillStyle = hot ? 'rgba(255,255,240,0.9)' : 'rgba(235,245,255,0.85)';
  const nD = hot ? 4 : 2;
  for(let i=1;i<=nD;i++){ const dx = i*len/(nD+1.6); E.beginPath(); E.ellipse(dx,0,2.2*(1-i/(nD+2)),w*0.45*(1-i/(nD+2)),0,0,Math.PI*2); E.fill(); }
  E.restore();
}
function drawPilot(b){
  const f = b.facing, hx = -2*f, hy = 29.5;
  // scarf streams downwind of the apparent airflow
  const rel = (windAt(b.y)*0.6 - b.vx);
  const sd = rel>=0 ? 1 : -1;
  A.strokeStyle = b.pal.scarf; A.lineWidth = 2.2; A.lineCap = 'round';
  A.beginPath(); A.moveTo(hx, hy+3);
  for(let i=1;i<=4;i++) A.lineTo(hx + sd*i*3.4, hy+3 + Math.sin(windTime*9 + i*1.3)*1.4 + i*0.6);
  A.stroke(); A.lineCap = 'butt';
  A.fillStyle = '#d6ad86'; A.beginPath(); A.arc(hx, hy, 4.2, 0, Math.PI*2); A.fill();
  A.fillStyle = '#3a2416'; A.beginPath(); A.arc(hx, hy-0.6, 4.4, Math.PI, Math.PI*2); A.fill();
  A.fillStyle = '#c9a04a';
  A.beginPath(); A.arc(hx-1.7, hy-2.2, 1.35, 0, Math.PI*2); A.arc(hx+1.7, hy-2.2, 1.35, 0, Math.PI*2); A.fill();
  E.fillStyle = 'rgba(180,210,255,0.25)';
  E.beginPath(); E.arc(hx+1.7*f, hy-2.2, 0.8, 0, Math.PI*2); E.fill();
}
function drawBasketAssembly(b){
  // rigging
  A.strokeStyle = 'rgba(40,30,20,0.95)'; A.lineWidth = 0.9;
  A.beginPath();
  A.moveTo(-9,24); A.lineTo(-14,34); A.moveTo(-4,25); A.lineTo(-6,34);
  A.moveTo(9,24); A.lineTo(14,34); A.moveTo(4,25); A.lineTo(6,34);
  A.stroke();
  // skirt / scoop and throat
  A.fillStyle = '#1e1b1c';
  A.beginPath(); A.moveTo(-10,20); A.lineTo(10,20); A.lineTo(11.5,27); A.lineTo(-11.5,27); A.closePath(); A.fill();
  A.fillStyle = '#0b0909'; A.beginPath(); A.ellipse(0,21,8,2.2,0,0,Math.PI*2); A.fill();
  // burner frame and twin cans
  A.fillStyle = '#3a3f45'; A.fillRect(-13,30,26,2);
  for(const sx of [-4.5,4.5]){
    const g = A.createLinearGradient(sx-2.6,0,sx+2.6,0);
    g.addColorStop(0,'#2c3035'); g.addColorStop(0.6,'#9aa3ab'); g.addColorStop(1,'#3a3f45');
    A.fillStyle = g; A.fillRect(sx-2.6,25,5.2,5.6);
    A.fillStyle = '#1a1c1f'; A.fillRect(sx-2.8,24.4,5.6,1.2);
  }
  if(b.alive) drawBurnerFlame(b);
  // pilot behind the rim, basket in front
  if(b.alive) drawPilot(b);
  A.drawImage(basketSprite, -22, 31, 44, 26);
  // brass steering nozzles
  for(const s of [-1,1]){
    A.fillStyle = '#9a7632';
    A.beginPath(); A.moveTo(s*14,42); A.lineTo(s*18.5,40.6); A.lineTo(s*18.5,46.4); A.lineTo(s*14,45); A.closePath(); A.fill();
    A.fillStyle = 'rgba(255,230,170,0.35)'; A.fillRect(s>0?15:-18, 41.2, 3, 0.8);
  }
  if(b.alive){
    if(b.boostT>0) drawThrusterJet(-b.boostDir*18.5, 43.5, -b.boostDir, 40 + Math.random()*12, true);
    else if(b.steer){ const sg = Math.sign(b.steer); drawThrusterJet(-sg*18.5, 43.5, -sg, (11 + Math.random()*5)*(0.4+0.6*Math.abs(b.steer)), false); }
  }
  // bombs in their cradle
  if(b.alive && b.bombAmmo>0){
    const cy = 57 + Math.sin(windTime*3+b.id)*1.1;
    A.strokeStyle = 'rgba(40,30,20,0.85)'; A.lineWidth = 0.9;
    A.beginPath(); A.moveTo(-9,53); A.lineTo(-7,cy); A.moveTo(9,53); A.lineTo(7,cy); A.stroke();
    for(let i=0;i<b.bombAmmo;i++){
      const bx = -7 + i*7 - (b.bombAmmo-1)*3.5, by = cy+5;
      A.fillStyle = '#1d1712'; A.beginPath(); A.arc(bx,by,4.2,0,Math.PI*2); A.fill();
      A.fillStyle = 'rgba(255,255,255,0.14)'; A.beginPath(); A.arc(bx+1.3,by-1.4,1.4,0,Math.PI*2); A.fill();
      A.strokeStyle = '#c9974a'; A.lineWidth = 0.8; A.beginPath(); A.moveTo(bx,by-4.2); A.lineTo(bx+1,by-6.4); A.stroke();
    }
  }
}
function drawGun(b){
  // drawn un-rotated, exactly where the sim fires from
  const f = b.facing, mx = b.x + f*MUZZLE_DX, my = b.y + MUZZLE_DY;
  const tilt = clamp(b.vx/500,-0.18,0.18);
  const rx = b.x + Math.cos(tilt)*(f*13) - Math.sin(tilt)*34, ry = b.y + Math.sin(tilt)*(f*13) + Math.cos(tilt)*34;
  A.strokeStyle = '#2d3136'; A.lineWidth = 1.8;
  A.beginPath(); A.moveTo(rx,ry); A.lineTo(mx - f*12, my+3); A.stroke();
  A.save(); A.translate(mx,my); A.scale(f,1);
  A.fillStyle = '#2b2f34'; A.fillRect(-15,-3,10,6);
  A.fillStyle = '#4b5258'; A.fillRect(-15,-3,10,1.4);
  A.fillStyle = '#3a2c18'; A.beginPath(); A.arc(-12,4,3.4,0,Math.PI*2); A.fill();  // ammo drum
  A.fillStyle = '#1b1e22'; A.fillRect(-5,-2.2,6,1.6); A.fillRect(-5,0.6,6,1.6);   // twin barrels
  A.restore();
  // barrel heat glow & muzzle flash
  const ht = b.heat/100;
  if(ht>0.25){
    E.fillStyle = `rgba(255,${Math.round(120-60*ht)},40,${(ht-0.25)*0.9})`;
    E.fillRect(f>0?mx-5:mx-1, my-2.2, 6, 1.6); E.fillRect(f>0?mx-5:mx-1, my+0.6, 6, 1.6);
  }
  if(b.muzzle>0){
    const g = E.createRadialGradient(mx+f*4,my,0,mx+f*4,my,14);
    g.addColorStop(0,'rgba(255,250,220,1)'); g.addColorStop(0.4,'rgba(255,190,90,0.7)'); g.addColorStop(1,'rgba(255,120,40,0)');
    E.fillStyle = g; E.beginPath(); E.arc(mx+f*4,my,14,0,Math.PI*2); E.fill();
  }
}
function drawShieldBubble(b){
  if(b.shieldTimer<=0) return;
  const fade = clamp(b.shieldTimer/0.4,0,1)*clamp((TUNE.shield.dur-b.shieldTimer)/0.15,0,1);
  const cx = b.x, cy = b.y+4, R = 56 + Math.sin(windTime*12)*1.2;
  const hit = b.shieldHit*3;
  const g = E.createRadialGradient(cx,cy,R*0.6,cx,cy,R);
  g.addColorStop(0,'rgba(100,200,255,0)'); g.addColorStop(0.85,`rgba(110,210,255,${0.05*fade+0.15*hit})`); g.addColorStop(1,`rgba(190,240,255,${0.3*fade+0.25*hit})`);
  E.fillStyle = g; E.beginPath(); E.arc(cx,cy,R,0,Math.PI*2); E.fill();
  E.save(); E.beginPath(); E.arc(cx,cy,R,0,Math.PI*2); E.clip();
  E.strokeStyle = `rgba(170,230,255,${0.09*fade+0.15*hit})`; E.lineWidth = 0.8;
  const s = 11, rot = windTime*0.3;
  for(let gx=-R; gx<=R; gx+=s*1.5){
    for(let gy=-R; gy<=R; gy+=s*1.732){
      const ox = gx + ((Math.round(gy/(s*1.732))%2)?s*0.75:0);
      const px = cx + ox*Math.cos(rot) - gy*Math.sin(rot)*0.15, py = cy + gy;
      E.beginPath();
      for(let i=0;i<6;i++){ const a=i*Math.PI/3; const hx=px+Math.cos(a)*s*0.5, hy=py+Math.sin(a)*s*0.5; i?E.lineTo(hx,hy):E.moveTo(hx,hy); }
      E.closePath(); E.stroke();
    }
  }
  E.restore();
}
function drawBalloon(b){
  const P = envProfile(b);
  const tilt = b.alive ? clamp(b.vx/500, -0.18, 0.18) : b.deadRot;
  const vS = b.alive ? clamp(-b.vy/700, -0.07, 0.07) : 0;
  for(const c of [A,E]){ c.save(); c.translate(b.x,b.y); c.rotate(tilt); c.scale(1-vS,1+vS); }
  if(b.alive || !b.grounded) drawEnvelope(b, P);
  else drawEnvelope(b, P);
  if(b.liftSurge>0){
    const a = Math.min(1,b.liftSurge)*0.25;
    const g = E.createRadialGradient(0,-8,10,0,-8,54);
    g.addColorStop(0,'rgba(255,210,120,0)'); g.addColorStop(0.8,`rgba(255,210,120,${a})`); g.addColorStop(1,'rgba(255,210,120,0)');
    E.fillStyle = g; E.beginPath(); E.arc(0,-8,54,0,Math.PI*2); E.fill();
  }
  drawBasketAssembly(b);
  if(b.patching){
    const p = 1 - b.patchTimer/TUNE.patch.time;
    E.strokeStyle = 'rgba(150,255,230,0.85)'; E.lineWidth = 2.4; E.setLineDash([4,4]);
    E.beginPath(); E.arc(0,-8,44,-Math.PI/2,-Math.PI/2+Math.PI*2*p); E.stroke(); E.setLineDash([]);
  }
  if(!b.alive){
    // the burning wreck
    for(let i=0;i<4;i++){
      const fx = Math.sin(windTime*7+i*2)*10, fy = -10 + i*6;
      const g = E.createRadialGradient(fx,fy,0,fx,fy,14);
      g.addColorStop(0,'rgba(255,220,140,0.7)'); g.addColorStop(1,'rgba(255,80,20,0)');
      E.fillStyle = g; E.beginPath(); E.arc(fx,fy,14,0,Math.PI*2); E.fill();
    }
  }
  A.restore(); E.restore();
  if(b.alive) drawGun(b);
  drawShieldBubble(b);
}
function drawGroundShadow(b){
  if(b.grounded && !b.alive) return;
  const hgt = FLOOR_Y - b.y;
  const alt = clamp(hgt/(FLOOR_Y-STORM_Y), 0, 1);
  const sx = b.x - hgt*0.42;
  const w = 46 + alt*60;
  const a = 0.42 - alt*0.3;
  if(a<=0.03) return;
  A.save(); A.translate(sx, FLOOR_Y+7); A.scale(1,0.18);
  const g = A.createRadialGradient(0,0,0,0,0,w);
  g.addColorStop(0,`rgba(0,0,0,${a})`); g.addColorStop(1,'rgba(0,0,0,0)');
  A.fillStyle = g; A.beginPath(); A.arc(0,0,w,0,Math.PI*2); A.fill();
  A.restore();
}

// =====================================================================
//  GRASS, LAMPS, FIREFLIES
// =====================================================================
function drawBlade(ctx, b){
  const bend = b.bend, h = b.h;
  const tipX = b.x + bend*h*0.85, tipY = b.base - h*(1 - 0.22*bend*bend);
  const cx = b.x + bend*h*0.3, cy = b.base - h*0.55;
  ctx.beginPath();
  ctx.moveTo(b.x - b.w*0.5, b.base);
  ctx.quadraticCurveTo(cx - b.w*0.25, cy, tipX, tipY);
  ctx.quadraticCurveTo(cx + b.w*0.25, cy, b.x + b.w*0.5, b.base);
  ctx.closePath(); ctx.fill();
}
function drawGrassBack(){ for(const b of GRASS_BACK){ A.fillStyle = rgbStr(b.col); drawBlade(A, b); } }
function drawGrassFront(){
  for(const b of GRASS){
    A.fillStyle = rgbStr(b.col); drawBlade(A, b);
  }
}
function drawLamps(){
  const sw = lampSprite.width/2, sh = lampSprite.height/2;
  for(const l of LAMPS) A.drawImage(lampSprite, l.x - sw/2, l.y - LAMP_H - 6, sw, sh);
}
function lampFlicker(l){
  const gas = clamp((l.gas===undefined ? 100 : l.gas)/40, 0, 1);
  const sputter = gas < 0.75 ? (0.85 + 0.15*Math.sin(windTime*31 + l.flick)*Math.sin(windTime*13.7)) : 1;
  return (0.88 + 0.08*Math.sin(windTime*7.3 + l.flick) + 0.04*Math.sin(windTime*23 + l.flick*2)) * l.glow * (0.3 + 0.7*gas) * sputter;
}
function drawLampGlass(){
  for(const l of LAMPS){
    const f = lampFlicker(l);
    if(f<=0.01) continue;
    const L = LAMP_H, x = l.x, y = l.y;
    const gB = y-(L-26), gT = y-(L-10);
    const g = E.createLinearGradient(0,gT,0,gB);
    g.addColorStop(0,`rgba(255,200,120,${0.75*f})`); g.addColorStop(1,`rgba(255,235,170,${0.95*f})`);
    E.fillStyle = g;
    E.beginPath(); E.moveTo(x-4.2,gB); E.lineTo(x+4.2,gB); E.lineTo(x+6.1,gT); E.lineTo(x-6.1,gT); E.closePath(); E.fill();
    const c = E.createRadialGradient(x,y-L+18,0,x,y-L+18,7);
    c.addColorStop(0,`rgba(255,255,235,${f})`); c.addColorStop(1,'rgba(255,200,120,0)');
    E.fillStyle = c; E.beginPath(); E.arc(x,y-L+18,7,0,Math.PI*2); E.fill();
  }
}
function drawFireflies(){
  for(const f of FIREFLIES){
    const b = Math.max(0, Math.sin(f.ph*2.2)) ** 3;
    if(b<0.05) continue;
    const g = E.createRadialGradient(f.x,f.y,0,f.x,f.y,6);
    g.addColorStop(0,`rgba(230,255,150,${0.9*b})`); g.addColorStop(1,'rgba(180,255,90,0)');
    E.fillStyle = g; E.beginPath(); E.arc(f.x,f.y,6,0,Math.PI*2); E.fill();
  }
}

// =====================================================================
//  PROJECTILES & EFFECTS
// =====================================================================
function drawTracers(){
  E.lineCap = 'round';
  for(const p of projectiles){
    const c = p.col, tx = p.x - p.vx*0.035, ty = p.y - p.vy*0.035;
    E.strokeStyle = rgbStr(c, 0.25); E.lineWidth = 5;
    E.beginPath(); E.moveTo(tx,ty); E.lineTo(p.x,p.y); E.stroke();
    const g = E.createLinearGradient(tx,ty,p.x,p.y);
    g.addColorStop(0,rgbStr(c,0)); g.addColorStop(0.7,rgbStr(c,0.9)); g.addColorStop(1,'rgba(255,255,245,1)');
    E.strokeStyle = g; E.lineWidth = 2.2;
    E.beginPath(); E.moveTo(tx,ty); E.lineTo(p.x,p.y); E.stroke();
  }
  E.lineCap = 'butt';
}
function drawRockets(){
  for(const m of rockets){
    A.save(); A.translate(m.x,m.y); A.rotate(m.ang);
    const g = A.createLinearGradient(0,-3,0,3);
    g.addColorStop(0,'#c9ced6'); g.addColorStop(0.5,'#8d939c'); g.addColorStop(1,'#4c5158');
    A.fillStyle = g; A.fillRect(-9,-2.6,15,5.2);
    A.fillStyle = '#c0432a'; A.beginPath(); A.moveTo(6,-2.6); A.quadraticCurveTo(12,0,6,2.6); A.closePath(); A.fill();
    A.fillStyle = '#3a3f45';
    A.beginPath(); A.moveTo(-9,-2.6); A.lineTo(-12,-6); A.lineTo(-5,-2.6); A.closePath(); A.fill();
    A.beginPath(); A.moveTo(-9,2.6); A.lineTo(-12,6); A.lineTo(-5,2.6); A.closePath(); A.fill();
    A.restore();
    if(m.lit){
      E.save(); E.translate(m.x,m.y); E.rotate(m.ang+Math.PI);
      const L = 16 + Math.random()*10;
      const fg = E.createLinearGradient(9,0,9+L,0);
      fg.addColorStop(0,'rgba(255,255,235,1)'); fg.addColorStop(0.3,'rgba(255,190,90,0.9)'); fg.addColorStop(1,'rgba(255,90,30,0)');
      E.fillStyle = fg; E.beginPath(); E.moveTo(9,-3); E.quadraticCurveTo(9+L*0.5,-2.4,9+L,0); E.quadraticCurveTo(9+L*0.5,2.4,9,3); E.closePath(); E.fill();
      const gg = E.createRadialGradient(10,0,0,10,0,16);
      gg.addColorStop(0,'rgba(255,200,120,0.6)'); gg.addColorStop(1,'rgba(255,120,40,0)');
      E.fillStyle = gg; E.beginPath(); E.arc(10,0,16,0,Math.PI*2); E.fill();
      E.restore();
    }
  }
}
function drawShells(){
  for(const mo of mortars){
    const a = Math.atan2(mo.vy, mo.vx);
    A.save(); A.translate(mo.x,mo.y); A.rotate(a);
    A.fillStyle = '#2a2b2e'; A.beginPath(); A.ellipse(0,0,7.5,5,0,0,Math.PI*2); A.fill();
    A.fillStyle = '#b08a3a'; A.fillRect(-3,-5,2,10);
    A.fillStyle = 'rgba(255,255,255,0.18)'; A.beginPath(); A.ellipse(1,-2,4,1.4,0,0,Math.PI*2); A.fill();
    A.restore();
    const g = E.createRadialGradient(mo.x,mo.y,0,mo.x,mo.y,10);
    g.addColorStop(0,'rgba(255,170,80,0.55)'); g.addColorStop(1,'rgba(255,90,30,0)');
    E.fillStyle = g; E.beginPath(); E.arc(mo.x,mo.y,10,0,Math.PI*2); E.fill();
  }
  for(const b of bombs){
    A.save(); A.translate(b.x,b.y); A.rotate(b.rot);
    A.fillStyle = '#1d1712'; A.beginPath(); A.arc(0,0,9,0,Math.PI*2); A.fill();
    A.fillStyle = 'rgba(255,255,255,0.14)'; A.beginPath(); A.arc(-2.6,-2.6,2.8,0,Math.PI*2); A.fill();
    A.strokeStyle = '#c9974a'; A.lineWidth = 1.2; A.beginPath(); A.moveTo(0,-9); A.lineTo(1.5,-11.6); A.stroke();
    A.restore();
    const fx = b.x + Math.cos(b.rot-Math.PI/2)*11.8 + Math.cos(b.rot)*1.5, fy = b.y + Math.sin(b.rot-Math.PI/2)*11.8 + Math.sin(b.rot)*1.5;
    const g = E.createRadialGradient(fx,fy,0,fx,fy,6);
    g.addColorStop(0,'rgba(255,240,190,1)'); g.addColorStop(1,'rgba(255,140,40,0)');
    E.fillStyle = g; E.beginPath(); E.arc(fx,fy,6,0,Math.PI*2); E.fill();
  }
}
function drawHarpoons(){
  for(const h of harpoons){
    const a = harpoonAnchor(h);
    let tx, ty;
    if(h.state==='tether' && h.target){ tx = h.target.x - h.dir*22; ty = h.target.y + 2; }
    else { tx = a.x + h.dir*h.len; ty = a.y; }
    const L = Math.hypot(tx-a.x, ty-a.y);
    const sag = h.state==='tether' ? 6 : Math.min(26, L*0.05);
    const mx = (a.x+tx)/2, my = (a.y+ty)/2 + sag;
    const n = Math.max(2, Math.floor(L/6));
    for(let i=0;i<n;i++){
      const t = i/n, it = 1-t;
      const x = it*it*a.x + 2*it*t*mx + t*t*tx, y = it*it*a.y + 2*it*t*my + t*t*ty;
      const dx = 2*it*(mx-a.x) + 2*t*(tx-mx), dy = 2*it*(my-a.y) + 2*t*(ty-my);
      A.save(); A.translate(x,y); A.rotate(Math.atan2(dy,dx));
      A.strokeStyle = i%2 ? '#6b6e73' : '#9ea2a8'; A.lineWidth = 1.2;
      A.beginPath(); if(i%2) A.ellipse(0,0,3.4,1.1,0,0,Math.PI*2); else A.ellipse(0,0,3.4,2.2,0,0,Math.PI*2); A.stroke();
      A.restore();
    }
    const ang = h.state==='tether' ? Math.atan2(ty-my, tx-mx) : (h.dir>0?0:Math.PI);
    A.save(); A.translate(tx,ty); A.rotate(ang);
    A.fillStyle = '#b9bec5';
    A.beginPath(); A.moveTo(9,0); A.lineTo(-2,-3); A.lineTo(0,0); A.lineTo(-2,3); A.closePath(); A.fill();
    A.strokeStyle = '#80858c'; A.lineWidth = 1.2;
    A.beginPath(); A.moveTo(1,-1); A.lineTo(-5,-5.5); A.moveTo(1,1); A.lineTo(-5,5.5); A.stroke();
    A.restore();
  }
}
function drawShockwaves(){
  for(const s of shockwaves){
    if(!s.triggered){
      const p = s.t/s.delay;
      E.strokeStyle = `rgba(255,220,150,${0.4+0.5*Math.sin(windTime*40)**2})`; E.lineWidth = 2;
      E.beginPath(); E.arc(s.x,s.y, 60*(1-p)+18, 0, Math.PI*2); E.stroke();
      continue;
    }
    const a = clamp(1 - s.radius/(TUNE.shock.radius+30), 0, 1);
    E.strokeStyle = `rgba(255,240,200,${0.55*a})`; E.lineWidth = 3;
    E.beginPath(); E.arc(s.x,s.y,s.radius,0,Math.PI*2); E.stroke();
  }
}
function drawBolts(){
  E.lineJoin = 'round'; E.lineCap = 'round';
  for(const l of lightnings){
    const t = l.life/l.max;
    // classic triple-stroke strobe
    const strobe = (t>0.75 || (t>0.4 && t<0.55) || t<0.15) ? 1 : 0.35;
    const a = Math.min(1, t*1.6)*strobe;
    const stroke = (pts, w, col) => { E.strokeStyle = col; E.lineWidth = w; E.beginPath(); E.moveTo(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++) E.lineTo(pts[i].x,pts[i].y); E.stroke(); };
    stroke(l.path, 16, `rgba(150,180,255,${0.12*a})`);
    stroke(l.path, 7, `rgba(190,215,255,${0.35*a})`);
    stroke(l.path, 2.6, `rgba(255,255,255,${a})`);
    for(const br of l.branches){ stroke(br, 4, `rgba(170,200,255,${0.25*a})`); stroke(br, 1.3, `rgba(235,245,255,${0.8*a})`); }
  }
  E.lineJoin = 'miter'; E.lineCap = 'butt';
}
function drawBlasts(){
  for(const b of blasts){
    const t = 1 - b.life/b.max;
    const ease = 1 - Math.pow(1-t, 3);
    const R = b.R*(0.3 + 0.7*ease);
    const heat = Math.pow(1-t, 1.4);
    for(let i=0;i<4;i++){
      const ang = b.seed + i*1.7, off = R*0.28*(i?1:0);
      const cx = b.x + Math.cos(ang)*off, cy = b.y + Math.sin(ang)*off - t*R*0.35;
      const r = R*(i?0.62:0.85);
      const g = E.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,`rgba(255,240,200,${heat*(i?0.35:0.7)})`);
      g.addColorStop(0.35,`rgba(255,${Math.round(170-70*t)},70,${heat*0.45})`);
      g.addColorStop(0.75,`rgba(200,60,20,${heat*0.22})`);
      g.addColorStop(1,'rgba(120,30,10,0)');
      E.fillStyle = g; E.beginPath(); E.arc(cx,cy,r,0,Math.PI*2); E.fill();
    }
  }
}
function drawParticleLayer(ctx, layer){
  for(const p of particles){
    if(p.layer!==layer) continue;
    const lf = p.life/p.max;
    let a = p.alpha * lf;
    if(p.sprite==='smoke'||p.sprite==='soot'||p.sprite==='steam'||p.sprite==='dust') a = p.alpha * Math.min(1,(1-lf)*8) * lf;
    if(a<=0.005) continue;
    ctx.globalAlpha = Math.min(1,a);
    if(p.sprite==='streak'){
      ctx.strokeStyle = rgbStr(p.color||[255,200,120]); ctx.lineWidth = p.size;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x - p.vx*0.03, p.y - p.vy*0.03); ctx.stroke();
    } else if(p.sprite==='chunk'){
      ctx.fillStyle = rgbStr(p.color||[60,44,30]);
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot||0); ctx.fillRect(-p.size,-p.size*0.6,p.size*2,p.size*1.2); ctx.restore();
    } else {
      const s = SPR[p.sprite] || SPR.smoke;
      if(p.color && p.sprite==='ember'){ ctx.fillStyle = rgbStr(p.color); ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); }
      else ctx.drawImage(s, p.x-p.size, p.y-p.size, p.size*2, p.size*2);
    }
  }
  ctx.globalAlpha = 1;
}
function drawFloatTexts(){
  E.textAlign = 'center'; E.font = '600 12px Rajdhani, sans-serif';
  for(const f of floatTexts){
    E.globalAlpha = clamp(f.life/f.max*1.6,0,1)*0.85;
    E.fillStyle = f.col; E.fillText(f.text, f.x, f.y);
  }
  E.globalAlpha = 1;
}

// =====================================================================
//  FRAME → A & E
// =====================================================================
// fog hides pilots: the rival fades out (with a "last seen" marker), your own balloon only dims
function fogRole(b){
  if(mode==='online' || mode==='lanhost') return b.id===netSeat() ? 'self' : 'foe';
  if(mode==='ai') return b.id===1 ? 'self' : 'foe';
  if(mode==='pvp') return 'self';
  return 'spec';
}
const FOG_MIN = { self:0.5, foe:0.05, spec:0.3 };
function fogAlpha(b){
  if(!b.alive) return 1;
  const v = visibilityOf(b), role = fogRole(b), m = FOG_MIN[role];
  const target = m + (1-m)*v;
  b._va = b._va===undefined ? target : lerp(b._va, target, 0.12);
  if(role==='foe'){
    if(b._va < 0.35){ if(!b._ls) b._ls = { x:b.x, y:b.y, t:performance.now() }; }
    else b._ls = null;
  } else b._ls = null;
  return b._va;
}
function drawLastSeen(){
  for(const b of [p1,p2]){
    const L = b && b._ls; if(!L) continue;
    const age = (performance.now() - L.t)/1000;
    const a = clamp(1 - age/3.5, 0, 1)*0.8;
    if(a <= 0.02) continue;
    E.save(); E.globalAlpha = a;
    E.strokeStyle = b.id===1 ? 'rgba(127,233,220,0.9)' : 'rgba(255,154,116,0.9)'; E.lineWidth = 1.6; E.setLineDash([6,6]);
    E.beginPath();
    if(E.roundRect) E.roundRect(L.x-38, L.y-48, 76, 108, 16); else E.rect(L.x-38, L.y-48, 76, 108);
    E.stroke(); E.setLineDash([]);
    E.fillStyle = E.strokeStyle; E.font = '600 11px Rajdhani, sans-serif'; E.textAlign = 'center';
    E.fillText('LAST SEEN', L.x, L.y+74);
    E.restore();
  }
}
function drawWorld2D(){
  A.setTransform(layerScale,0,0,layerScale,0,0); E.setTransform(layerScale,0,0,layerScale,0,0);
  A.clearRect(0,0,W,H); E.clearRect(0,0,W,H);
  A.drawImage(staticGround,0,0);
  drawGrassBack();
  E.globalCompositeOperation = 'lighter';
  drawBolts();
  if(started && p1){
    drawGroundShadow(p1); drawGroundShadow(p2);
    drawHarpoons();
    // the dead balloon is drawn first so the survivor stays on top
    const order = (!p1.alive) ? [p1,p2] : [p2,p1];
    for(const b of order){
      const a = fogAlpha(b);
      A.globalAlpha = a; E.globalAlpha = a;
      drawBalloon(b);
      A.globalAlpha = 1; E.globalAlpha = 1;
    }
    drawLastSeen();
    drawRockets(); drawShells();
    drawTracers();
    drawShockwaves();
  } else if(!started && menuBalloons){
    for(const b of menuBalloons) drawBalloon(b);
  }
  drawParticleLayer(A, 0);
  drawBlasts();
  drawParticleLayer(E, 1);
  drawFireflies();
  drawLamps();
  drawGrassFront();
  // lamps occlude glow behind them, then their own glass lights up
  E.globalCompositeOperation = 'destination-out';
  const sw = lampSprite.width/2, sh = lampSprite.height/2;
  for(const l of LAMPS) E.drawImage(lampSprite, l.x - sw/2, l.y - LAMP_H - 6, sw, sh);
  E.globalCompositeOperation = 'lighter';
  drawLampGlass();
  drawFloatTexts();
  E.globalCompositeOperation = 'source-over';
}
