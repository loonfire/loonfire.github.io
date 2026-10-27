// =====================================================================
//  CLIENT FX — what every fx() event looks and sounds like, plus the
//  continuous effects (trails, steam, smoke) derived purely from state.
//  Offline play and online play use exactly the same code paths.
// =====================================================================
const DEBRIS_COL = [null, [90,90,96], [70,52,34]];
function fxBalloon(id){ return id===1 ? p1 : id===2 ? p2 : null; }

FX_IMPL = {
  sfx(name, x, y){ if(Sfx[name]) Sfx.at(x, y)[name](); },
  bfloat(id, dy, text, col){ const b = fxBalloon(id); if(b) floatText(b.x, b.y+dy, text, col); },
  float(x, y, text, col){ floatText(x, y, text, col); },
  death(id){
    const b = fxBalloon(id); if(!b) return;
    addBlast(b.x, b.y-6, 110, 1.4);
    addFlare(b.x, b.y, 420, 3.4, [1,0.55,0.25], 1.0);
    addRipple(b.x, b.y, 700, 10, 0.4);
    sparks(b.x, b.y, 40, {max:420});
    embers(b.x, b.y, 30, 30);
    debris(b.x, b.y, 18, [80,60,40]);
    for(let i=0;i<14;i++) smokePuff(b.x+rand(-30,30), b.y+rand(-30,20), {dark:true, size:rand(14,24), vy:rand(-60,-10), life:rand(1.6,2.6), alpha:0.6});
    flashScreen(0.22); shake(14,0.5);
    Sfx.at(b.x, b.y).boom(1.7); rumblePads(1, 0.5);
  },
  boom(x, y, R, big, hot, shk, deb){
    big = !!big;
    addBlast(x, y, R, hot||1);
    addFlare(x, y, R*3.2, big?3.2:2.2, [1,0.55,0.25], big?0.8:0.5);
    addRipple(x, y, R*5, big?7:5, 0.32);
    sparks(x, y, Math.round(R/3), { max:R*4.5 });
    embers(x, y, Math.round(R/8), R*0.3);
    for(let i=0;i<Math.round(R/8);i++) smokePuff(x+rand(-R*0.3,R*0.3), y+rand(-R*0.3,R*0.3), {vy:rand(-50,-10), size:rand(10,20), life:rand(1.2,2.2), dark:Math.random()<0.5, alpha:0.6});
    if(deb && DEBRIS_COL[deb]) debris(x, y, 10, DEBRIS_COL[deb]);
    shake(shk || (big?13:7), big?0.4:0.22);
    Sfx.at(x, y).boom(R/70); rumbleNear(x, y, R);
    if(y > FLOOR_Y-170) grassImpulse(x, (R/40)*clamp(1-(FLOOR_Y-y)/170,0.2,1)*4, R*2.6);
  },
  fizzle(x, y){
    addParticle({x,y,vx:0,vy:0,life:0.18,size:14,sprite:'flash',alpha:0.9,layer:1});
    sparks(x,y,8,{max:160,color:[255,230,170]});
    smokePuff(x,y,{size:8,life:0.8});
  },
  shot(id){
    const b = fxBalloon(id); if(!b) return;
    const m = muzzlePos(b);
    b.muzzle = 0.06;
    addFlare(m.x, m.y, 60, 0.9, [1,0.75,0.45], 0.06);
    addParticle({ x:m.x, y:m.y, vx:b.facing*40, vy:rand(-10,10), life:0.07, size:6, sprite:'flash', alpha:1, layer:1 });
    Sfx.at(m.x, m.y).shot();
  },
  mortarLaunch(id){
    const b = fxBalloon(id); if(!b) return;
    const x = b.x+b.facing*14, y = b.y+26;
    addFlare(x, y, 110, 1.6, [1,0.7,0.4], 0.12);
    for(let i=0;i<6;i++) smokePuff(x, y, {vx:b.facing*60, vy:-50, size:rand(5,9), life:rand(0.6,1.0)});
    shake(3,0.12); Sfx.at(x, y).thump();
  },
  shield(id){
    const b = fxBalloon(id); if(!b) return;
    addRipple(b.x, b.y, 260, 3, 0.25);
    addFlare(b.x, b.y, 120, 0.9, [0.5,0.85,1], 0.3);
    Sfx.at(b.x, b.y).shield();
  },
  boost(id, dir){
    const b = fxBalloon(id); if(!b) return;
    addFlare(b.x - dir*24, b.y+44, 140, 1.6, [0.7,0.8,1], 0.35);
    addRipple(b.x - dir*22, b.y+44, 300, 2.5, 0.22);
    Sfx.at(b.x, b.y).boost();
  },
  patchDone(id){
    const b = fxBalloon(id); if(!b) return;
    floatText(b.x, b.y-70, '+'+TUNE.patch.heal+' HULL', '#9fffe6');
    Sfx.at(b.x, b.y).chime();
  },
  land(x){
    grassImpulse(x, 2.4, 70);
    for(let i=0;i<6;i++) addParticle({x:x+rand(-16,16),y:FLOOR_Y-2,vx:rand(-60,60),vy:rand(-50,-10),life:0.7,size:rand(4,7),grow:10,sprite:'dust',alpha:0.4,layer:0,drag:0.95});
  },
  tracerHit(x, y, sgn, shielded){
    const dir = sgn>0 ? Math.PI : 0;
    if(shielded) sparks(x,y,5,{dir,spread:1.2,color:[170,235,255],max:200});
    else { sparks(x,y,4,{dir,spread:0.9,max:180}); addParticle({x,y,vx:0,vy:-10,life:0.5,size:5,grow:14,sprite:'smoke',alpha:0.35,layer:0}); }
  },
  tracerGround(x){ sparks(x,FLOOR_Y,3,{dir:-Math.PI/2,spread:1,max:120}); },
  ignite(x, y){ addFlare(x,y,120,1.5,[1,0.7,0.4],0.15); Sfx.at(x, y).ignite(); },
  flak(x, y){ sparks(x, y, 18, { max:420, color:[255,220,160], grav:200, life:0.5 }); Sfx.at(x, y).flak(); },
  hookBlock(x, y){ sparks(x, y, 8, {color:[170,235,255]}); },
  hooked(id, dir){
    const t = fxBalloon(id); if(!t) return;
    sparks(t.x - dir*26, t.y, 10, {color:[255,220,160]});
    floatText(t.x, t.y-74, 'HOOKED', '#ffe0a0');
    Sfx.at(t.x, t.y).tether(); rumbleFor(id, 0.6, 0.2);
  },
  shockwave(x, y){
    addRipple(x, y, 620, 9, 0.35);
    addFlare(x, y, 220, 1.3, [1,0.85,0.55], 0.25);
    shake(6,0.18);
    grassImpulse(x, 3*clamp(1-(FLOOR_Y-y)/220,0,1), 200);
    for(let k=0;k<24;k++){ const a = k/24*Math.PI*2; addParticle({x:x+Math.cos(a)*20,y:y+Math.sin(a)*20,vx:Math.cos(a)*420,vy:Math.sin(a)*420,life:0.28,size:rand(5,9),grow:30,sprite:'steam',alpha:0.45,layer:0,drag:0.9}); }
  },
  bolt(x, y){ strikeLightning(x, y); },
  groundBolt(x){ strikeLightning(x, FLOOR_Y+4); grassImpulse(x, 3, 120); },
  lampBreak(i){
    const l = LAMPS[i]; if(!l) return;
    const p = lampLightPos(l);
    sparks(p.x,p.y,18,{color:[255,210,140]});
    Sfx.at(p.x, p.y).glass();
    for(let k=0;k<8;k++) addParticle({x:p.x,y:p.y,vx:rand(-90,90),vy:rand(-120,-20),life:rand(0.6,1.1),size:rand(1,2),sprite:'chunk',color:[150,170,180],alpha:0.9,layer:0,grav:600,spin:rand(-20,20),floor:ROAD_Y0+rand(0,30)});
    for(let k=0;k<10;k++) addParticle({x:p.x+rand(-6,6),y:p.y+rand(-6,6),vx:rand(-30,30),vy:rand(-90,-40),life:rand(0.5,0.9),size:rand(6,12),sprite:'fire',alpha:0.9,layer:1,grav:-40});
    floatText(p.x, p.y-30, 'GAS MAIN!', '#ffcf8a');
    rumblePads(0.8, 0.25);
  },
  lampRelit(i){ const l = LAMPS[i]; if(!l) return; const p = lampLightPos(l); embers(p.x,p.y,6,4); Sfx.at(p.x, p.y).ignite(); },
  flare(x, y){ addFlare(x, y, 160, 1.4, [1,0.55,0.35], 0.3); sparks(x, y, 10, {color:[255,170,120], max:140}); Sfx.at(x, y).ignite(); },
  gustWarn(dir, y0, y1){ gustBanner = { dir, y0, y1, t:3.2 }; Sfx.gust && Sfx.gust(dir); },
};
let gustBanner = null;

// continuous effects, read straight off the state (works on snapshots too)
function ambientFx(dt){
  if(started && p1){
    for(const b of [p1,p2]){
      if(!b.alive){
        if(b.grounded){
          if(roll(0.25,dt)) smokePuff(b.x+rand(-14,14), b.y+30, {dark:true, vy:-30});
          if(roll(0.3,dt)) embers(b.x,b.y+30,1,12);
        } else {
          if(roll(0.7,dt)) smokePuff(b.x+rand(-10,10), b.y-14, {dark:true, vy:-50, size:rand(10,16)});
          if(roll(0.9,dt)) embers(b.x, b.y-10, 1, 18);
          if(roll(0.4,dt)) addParticle({x:b.x+rand(-16,16), y:b.y+rand(-24,8), vx:rand(-10,10), vy:rand(-60,-25), life:rand(0.3,0.55), size:rand(5,10), sprite:'fire', alpha:0.9, layer:1, grav:-30});
        }
        continue;
      }
      if(b.overheated && roll(0.35,dt)) addParticle({ x:b.x+b.facing*MUZZLE_DX, y:b.y+MUZZLE_DY-3, vx:rand(-10,10), vy:rand(-50,-25), life:0.7, size:rand(3,6), grow:12, sprite:'steam', alpha:0.5, layer:0, drag:0.98, wind:0.4 });
      if(b.patching && roll(0.5,dt)) addParticle({x:b.x+rand(-26,26), y:b.y+rand(-36,16), vx:0, vy:-18, life:0.5, size:rand(1.5,2.5), sprite:'ember', color:[160,255,230], alpha:1, layer:1});
      if(b.ventOn && roll(0.25,dt)) addParticle({ x:b.x+rand(-6,6), y:b.y-48, vx:rand(-8,8), vy:rand(-40,-20), life:0.8, size:rand(4,7), grow:14, sprite:'steam', alpha:0.35, layer:0, drag:0.98, wind:0.5 });
      if(b.steer && roll(0.28*Math.abs(b.steer),dt)) addParticle({ x:b.x - Math.sign(b.steer)*19, y:b.y+44, vx:-b.steer*rand(60,110)+b.vx*0.3, vy:rand(-8,8), life:0.45, size:rand(2.5,4), grow:18, sprite:'steam', alpha:0.4, layer:0, drag:0.94 });
      if(b.boostT>0 && roll(1,dt)) addParticle({ x:b.x - b.boostDir*22, y:b.y+44, vx:-b.boostDir*rand(140,240), vy:rand(-15,15), life:0.3, size:rand(4,7), sprite:'fire', alpha:0.9, layer:1, drag:0.9 });
      if(b.y > GROUND_Y-110 && (b.burnerOn || b.ventOn) && roll(0.5,dt)) grassImpulse(b.x, 0.22, 80);
      if(b.hp < 40 && roll(0.45,dt)) smokePuff(b.x+rand(-12,12), b.y-20, {dark:true, vy:-30, alpha:0.4});
      if(b.tears.length && b.burnerHeat>0.4 && roll(0.12*b.tears.length/4,dt)){
        const t = b.tears[(Math.random()*b.tears.length)|0];
        addParticle({ x:b.x+Math.cos(t.ang)*30*t.rr, y:b.y-6+Math.sin(t.ang)*34*t.rr, vx:rand(-10,10), vy:rand(-40,-20), life:0.6, size:rand(3,5), grow:10, sprite:'steam', alpha:0.25, layer:0, wind:0.5 });
      }
    }
  }
  for(const m of rockets) if(m.lit && roll(1,dt)) addParticle({ x:m.x-Math.cos(m.ang)*10, y:m.y-Math.sin(m.ang)*10, vx:rand(-10,10), vy:rand(-10,10), life:rand(0.7,1.2), size:rand(3,5), grow:16, sprite:'smoke', alpha:0.4, layer:0, drag:0.97, wind:0.35 });
  for(const mo of mortars) if(roll(0.6,dt)) addParticle({ x:mo.x, y:mo.y, vx:rand(-6,6), vy:rand(-6,6), life:0.6, size:rand(2.5,4), grow:10, sprite:'smoke', alpha:0.35, layer:0, wind:0.3 });
  for(const b of bombs) if(roll(0.6,dt)) addParticle({x:b.x+3,y:b.y-9,vx:rand(-8,8),vy:rand(-20,-6),life:0.25,size:rand(1,2),sprite:'ember',alpha:1,layer:1});
  // gas being drawn from a lamp: a shimmering stream of warm motes into the basket
  if(started && p1) for(const l of LAMPS){
    if(l.out>0 || !(l.draw>0)) continue;
    const p = lampLightPos(l);
    for(const b of [p1,p2]){
      if(!b.alive || dist(b.x, b.y+30, p.x, p.y) > LAMP_TUNE.reach) continue;
      if(roll(0.9,dt)){ const t = Math.random(); addParticle({ x:lerp(p.x, b.x, t)+rand(-4,4), y:lerp(p.y, b.y+44, t)+rand(-4,4), vx:(b.x-p.x)*0.8, vy:(b.y+44-p.y)*0.8, life:0.35, size:rand(1.2,2.2), sprite:'ember', color:[255,214,150], alpha:0.9, layer:1 }); }
    }
  }
  // flares sputter as they fall
  for(const f of flareList) if(roll(0.8,dt)) addParticle({ x:f.x+rand(-2,2), y:f.y, vx:rand(-20,20), vy:rand(-30,10), life:rand(0.3,0.6), size:rand(1,2.2), sprite:'ember', color:[255,190,140], alpha:1, layer:1, grav:120 });
  // thermals: dust and warm haze rising in the columns
  if(WORLD.windScale > 0.3) for(let k=0;k<2;k++){
    const cx = W*THERMAL_X[k] + Math.sin(windTime*0.07 + k*2)*30;
    const pulse = 0.5 + 0.5*Math.sin(windTime*0.12 + k*Math.PI);
    if(roll(0.18*pulse, dt)) addParticle({ x:cx+rand(-50,50), y:FLOOR_Y-rand(0,40), vx:rand(-6,6), vy:-rand(40,80), life:rand(2.5,4), size:rand(1,1.8), sprite:'ember', color:[255,220,170], alpha:0.35, layer:1, grav:-6 });
  }
  if(gustBanner){ gustBanner.t -= dt; if(gustBanner.t<=0) gustBanner = null; }
}
// purely visual per-step systems (never part of the simulation)
function stepVisuals(dt){
  updateSheet(dt);
  ambientFx(dt);
  updateLamps(dt); updateGrass(dt); updateFireflies(dt);
  updateLightnings(dt); updateParticles(dt); updateFlares(dt); updateRipples(dt); updateBlasts(dt); updateFloatTexts(dt);
  updateShake(dt);
  if(flashAlpha>0) flashAlpha = Math.max(0, flashAlpha - dt*1.6);
}
