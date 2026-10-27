// =====================================================================
//  WEATHER & WIND
// =====================================================================
let windTime = 0;
let weatherState = 'calm';
let weatherTimer = rand(14,22);
let weatherIntensity = 0;
let ambientLightningTimer = rand(4,9);
const sheet = { x:0, y:0, i:0 };          // in-cloud "sheet" lightning (no bolt)
let sheetTimer = rand(1,3);

function updateWeather(dt){
  weatherTimer -= dt;
  let target = 0;
  if(weatherState==='calm'){
    if(weatherTimer<=0){ weatherState='building'; weatherTimer = rand(5,8); }
  } else if(weatherState==='building'){
    target = 1;
    if(weatherTimer<=0){ weatherState='storm'; weatherTimer = rand(16,26); }
  } else if(weatherState==='storm'){
    target = 1;
    if(weatherTimer<=0){ weatherState='clearing'; weatherTimer = rand(6,9); }
  } else {
    if(weatherTimer<=0){ weatherState='calm'; weatherTimer = rand(14,22); }
  }
  weatherIntensity += (target-weatherIntensity)*clamp(dt*0.5,0,1);
}
// in-cloud sheet lightning is pure decoration: each client rolls its own
function updateSheet(dt){
  sheet.i = Math.max(0, sheet.i - dt*5);
  sheetTimer -= dt;
  if(sheetTimer<=0){
    sheetTimer = rand(0.8, 3.5) / (0.3 + weatherIntensity);
    if(Math.random() < 0.15 + weatherIntensity*0.8){
      sheet.x = rand(0,W); sheet.y = rand(30,190); sheet.i = rand(0.6,1.4)*(0.4+weatherIntensity);
      if(weatherIntensity>0.3) Sfx.rumble();
    }
  }
}
// ---------------------------------------------------------------------
//  WIND — the only way to steer a real balloon is to change altitude.
//  Four layers blow independently and change their minds every half a
//  minute or so; the air between them blends smoothly. On top of that:
//  gusts that sweep across the arena (announced a few seconds ahead) and
//  two thermals that lift anyone who rides them. All of it is part of the
//  shared simulation, so online play stays in sync.
// ---------------------------------------------------------------------
const WORLD = { windScale:1, fogLevel:1, moonMode:'tonight' };     // set per match (settings offline, fixed online)
const WIND_SCALES = { calm:0.35, light:0.7, realistic:1, gale:1.45 };
const FOG_LEVELS = { clear:0, variable:1, dense:2 };
const bands = [
  {y0:STORM_Y, y1:230}, {y0:230, y1:380}, {y0:380, y1:520}, {y0:520, y1:GROUND_Y+60},
];
const WIND_ALT = [170, 305, 450, 600];               // anchor altitude of each layer
const windL = [ {v:55,to:55,t:22}, {v:-70,to:-70,t:30}, {v:90,to:90,t:26}, {v:-40,to:-40,t:34} ];
const gust = { ph:0, t:12, dir:1, str:0, x:0, y0:0, y1:0 };   // ph 0 idle · 1 warning · 2 blowing
const bandOffsets = [0,0,0,0];             // integrated drift, feeds the cloud/fog shaders
function resetWind(){
  const base = [55,-70,90,-40];
  for(let i=0;i<4;i++){ const s = Math.random()<0.5?-1:1; windL[i].v = windL[i].to = base[i]*s*rand(0.75,1.1); windL[i].t = rand(14,30); }
  gust.ph = 0; gust.t = rand(10,18); gust.str = 0;
}
function windAt(y){
  // smooth blend between the layer anchors (no hard band edges)
  let v;
  if(y <= WIND_ALT[0]) v = windL[0].v;
  else if(y >= WIND_ALT[3]) v = windL[3].v;
  else {
    let i = 0; while(i<2 && y > WIND_ALT[i+1]) i++;
    const t = smoothstep(WIND_ALT[i], WIND_ALT[i+1], y);
    v = lerp(windL[i].v, windL[i+1].v, t);
  }
  return v * WORLD.windScale * (1 + weatherIntensity*0.6);
}
function gustAt(x, y){
  if(gust.ph!==2 || y < gust.y0-40 || y > gust.y1+40) return 0;
  const behind = (x - gust.x)*gust.dir;             // > 0: the front has already passed this point
  if(behind > 0 || behind < -520) return 0;
  const band = smoothstep(gust.y0-40, gust.y0+20, y)*smoothstep(gust.y1+40, gust.y1-20, y);
  return gust.dir*gust.str*band*smoothstep(-520,-380,behind)*smoothstep(0,-90,behind) * WORLD.windScale;
}
function windAtXY(x, y){ return windAt(y) + gustAt(x, y); }
// warm air rising off the two lamps nearest the edges' heat: both columns, alternating strength
const THERMAL_X = [0.3, 0.7];
function thermalAt(x, y){
  if(y < 240) return 0;
  let a = 0;
  for(let k=0;k<2;k++){
    const cx = W*THERMAL_X[k] + Math.sin(windTime*0.07 + k*2)*30;
    const dx = Math.abs(x-cx);
    if(dx < 75){
      const pulse = 0.5 + 0.5*Math.sin(windTime*0.12 + k*Math.PI);
      a += 110*pulse*(1-dx/75)*smoothstep(240, 360, y);
    }
  }
  return a * Math.min(1, WORLD.windScale*1.2);
}
function bandWind(i){ const b = bands[i]; return windAt((b.y0+b.y1)/2); }
function updateBandOffsets(dt){ for(let i=0;i<4;i++) bandOffsets[i] -= bandWind(i)*dt*0.45; }
function updateWind(dt){
  for(let i=0;i<4;i++){
    const L = windL[i];
    L.t -= dt;
    if(L.t<=0){
      L.t = rand(20,38);
      const mag = [55,75,90,45][i]*rand(0.6,1.15);
      L.to = (Math.random() < 0.45 ? -Math.sign(L.v||1) : Math.sign(L.v||1)) * mag;
    }
    L.v += (L.to - L.v)*clamp(dt*0.28, 0, 1);         // a change of mind takes a few seconds to arrive
  }
  if(gust.ph===0){
    gust.t -= dt;
    if(gust.t<=0 && WORLD.windScale>0.5){
      const li = (Math.random()*4)|0;
      gust.ph = 1; gust.t = 3; gust.dir = Math.random()<0.5?-1:1; gust.str = rand(70,120);
      gust.y0 = (bands[li].y0 + (li? 0 : 30)); gust.y1 = bands[li].y1;
      gust.x = gust.dir>0 ? -40 : W+40;
      fx('gustWarn', gust.dir, gust.y0, gust.y1);
    }
  } else if(gust.ph===1){
    gust.t -= dt;
    if(gust.t<=0){ gust.ph = 2; }
  } else {
    gust.x += gust.dir*480*dt;
    if((gust.dir>0 && gust.x > W+560) || (gust.dir<0 && gust.x < -560)){ gust.ph = 0; gust.t = rand(14,26); gust.str = 0; }
  }
}
function gustWarning(){ return gust.ph===1 ? Math.max(0, gust.t) : -1; }

// ---------------------------------------------------------------------
//  FOG BANKS — drift with the wind at their altitude and hide pilots.
//  Visibility is part of the simulation: the AI and seeker rockets use it.
// ---------------------------------------------------------------------
let fogBanks = [];
let fogTimer = 6;
function resetFog(){ fogBanks = []; fogTimer = rand(4,10); if(WORLD.fogLevel>=2) for(let i=0;i<2;i++) spawnFogBank(true); }
function spawnFogBank(anywhere){
  const y = rand(260, 600);
  const w = windAt(y);
  const big = WORLD.fogLevel>=2 ? 1.25 : 1;
  const rx = rand(200, 340)*big, ry = rand(60, 105)*big;
  const x = anywhere ? rand(W*0.2, W*0.8) : (w>=0 ? -rx*0.6 : W+rx*0.6);
  fogBanks.push({ id:uid(), x, y, rx, ry, d:rand(0.85,1.05), life:rand(45,75), age:0 });
}
function updateFog(dt){
  if(WORLD.fogLevel<=0){ fogBanks.length = 0; return; }
  const want = WORLD.fogLevel>=2 ? 4 : 2;
  fogTimer -= dt;
  if(fogTimer<=0){ fogTimer = WORLD.fogLevel>=2 ? rand(8,16) : rand(16,32); if(fogBanks.length < want) spawnFogBank(false); }
  for(let i=fogBanks.length-1;i>=0;i--){
    const f = fogBanks[i];
    f.age += dt;
    f.x += windAt(f.y)*0.85*dt;
    f.y += Math.sin(windTime*0.1 + f.id)*4*dt;
    if(f.age > f.life || f.x < -f.rx*2 || f.x > W+f.rx*2) fogBanks.splice(i,1);
  }
}
function fogFade(f){ return smoothstep(0, 5, f.age)*smoothstep(f.life, f.life-6, f.age); }
function fogAt(x, y){
  let d = WORLD.fogLevel>=2 ? 0.12 : 0;
  for(const f of fogBanks){
    const u = (x-f.x)/f.rx, v = (y-f.y)/f.ry, q = u*u+v*v;
    if(q < 4) d += f.d*Math.exp(-q*1.4)*fogFade(f);
  }
  return d;
}

// ---------------------------------------------------------------------
//  MOON — phase is rolled per match and sets how bright the night is.
// ---------------------------------------------------------------------
const MOONST = { phase:0.72, side:1 };
function realMoonPhase(){
  // days since a known new moon (2000-01-06 18:14 UTC) on the 29.53-day synodic month
  const days = (Date.now() - Date.UTC(2000,0,6,18,14))/864e5;
  const age = ((days % 29.530588) + 29.530588) % 29.530588 / 29.530588;   // 0 new → 0.5 full → 1 new
  return { phase: clamp(1 - Math.abs(age-0.5)*2, 0.08, 1), side: age < 0.5 ? 1 : -1 };
}
function rollMoon(){
  if(WORLD.moonMode==='full'){ MOONST.phase = 1; MOONST.side = 1; }
  else if(WORLD.moonMode==='tonight'){ const r = realMoonPhase(); MOONST.phase = r.phase; MOONST.side = r.side; }
  else { MOONST.phase = rand(0.12, 1); MOONST.side = Math.random()<0.5 ? 1 : -1; }
}
function moonBright(){ const p = MOONST.phase; return 0.1 + 0.9*p*p; }

// ---------------------------------------------------------------------
//  VISIBILITY — how well a pilot can be seen right now (0 hidden … 1 clear)
// ---------------------------------------------------------------------
function visibilityOf(b){
  if(!b) return 1;
  const fd = clamp(fogAt(b.x, b.y), 0, 1.2);
  let v = 1 - clamp(fd*(0.8 + 0.2*(1-moonBright())), 0, 0.94);
  if(v >= 0.999) return 1;
  let reveal = 0;
  for(const l of LAMPS){ if(l.out>0) continue; const p = lampLightPos(l), d = dist(b.x, b.y, p.x, p.y); if(d < 190) reveal = Math.max(reveal, 0.75*(1-d/190)); }
  for(const f of flareList){ const d = dist(b.x, b.y, f.x, f.y), R = TUNE.flare.radius*smoothstep(0, 1.2, f.life); if(d < R) reveal = Math.max(reveal, 0.95*(1-d/R)); }
  if(b.burnerOn) reveal = Math.max(reveal, 0.2);
  if(simTime - b.lastFire < 0.35 || b.muzzle > 0) reveal = Math.max(reveal, 0.5);
  if(b.shieldTimer > 0) reveal = Math.max(reveal, 0.35);
  if(!b.alive) reveal = 1;
  return clamp(v + (1-v)*reveal, 0, 1);
}

// ---------------------------------------------------------------------
//  FLARES — dropped by a pilot, they drift down and light up the fog
// ---------------------------------------------------------------------
let flareList = [];
function updateFlareList(dt){
  for(let i=flareList.length-1;i>=0;i--){
    const f = flareList[i];
    f.life -= dt;
    f.vy = Math.min(f.vy + 30*dt, 38);
    f.vx += (windAt(f.y)*0.5 - f.vx)*dt*0.8;
    f.x += f.vx*dt; f.y += f.vy*dt;
    if(f.life<=0 || f.y > FLOOR_Y-6) flareList.splice(i,1);
  }
}

// =====================================================================
//  CAMERA SHAKE & FLASH
// =====================================================================
let shakeMag = 0, shakeTime = 0, shakeOX = 0, shakeOY = 0;
function shake(mag, dur){ if(typeof settings!=='undefined' && settings.motion) mag *= 0.25; shakeMag = Math.max(shakeMag, mag); shakeTime = Math.max(shakeTime, dur); }
function updateShake(dt){
  if(shakeTime>0){
    shakeTime -= dt;
    if(shakeTime<=0){ shakeTime=0; shakeMag=0; shakeOX=0; shakeOY=0; }
    else { shakeOX = rand(-shakeMag,shakeMag); shakeOY = rand(-shakeMag,shakeMag); }
  }
}
let flashAlpha = 0;      // full-screen white flash
let ambientFlash = 0;    // brightens the whole scene's ambient light (lightning)
function flashScreen(a){ if(typeof settings!=='undefined' && settings.motion) a *= 0.3; flashAlpha = Math.max(flashAlpha, a); }

// =====================================================================
//  PARTICLES  (layer 0 = lit albedo, layer 1 = emissive/additive)
// =====================================================================
let particles = [];
function addParticle(p){
  if(particles.length > 1700) particles.splice(0, 300);
  p.max = p.max || p.life;
  particles.push(p);
}
function updateParticles(dt){
  const k = dt*60;
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.life -= dt;
    if(p.life<=0){ particles.splice(i,1); continue; }
    p.x += p.vx*dt; p.y += p.vy*dt;
    if(p.grav) p.vy += p.grav*dt;
    if(p.drag){ const d = Math.pow(p.drag,k); p.vx*=d; p.vy*=d; }
    if(p.grow) p.size += p.grow*dt;
    if(p.wind) p.vx += windAt(p.y)*p.wind*dt;
    if(p.spin) p.rot = (p.rot||0) + p.spin*dt;
    if(p.floor && p.y > p.floor){ p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; }
  }
}
function smokePuff(x,y,opts){
  opts = opts||{};
  addParticle({ x:x+rand(-4,4), y:y+rand(-4,4), vx:(opts.vx||0)+rand(-14,14), vy:(opts.vy||-18)+rand(-10,10),
    life:opts.life||rand(1.0,1.8), size:opts.size||rand(8,14), grow:opts.grow||14, sprite:opts.dark?'soot':'smoke',
    alpha:opts.alpha||0.55, layer:0, drag:0.985, wind:0.5, grav:-4 });
}
function sparks(x,y,n,opts){
  opts = opts||{};
  for(let i=0;i<n;i++){
    const a = opts.dir!==undefined ? opts.dir + rand(-opts.spread,opts.spread) : rand(0,Math.PI*2);
    const sp = rand(opts.min||80, opts.max||320);
    addParticle({ x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:rand(0.25,opts.life||0.7), size:rand(1,2.4),
      sprite:'streak', color:opts.color||[255,200,120], alpha:1, layer:1, grav:opts.grav===undefined?260:opts.grav, drag:0.96, floor:FLOOR_Y+10 });
  }
}
function embers(x,y,n,spread){
  for(let i=0;i<n;i++){
    addParticle({ x:x+rand(-spread,spread), y:y+rand(-spread,spread), vx:rand(-30,30), vy:rand(-70,-15),
      life:rand(0.6,1.4), size:rand(1.2,2.6), sprite:'ember', alpha:1, layer:1, grav:-12, drag:0.98, wind:0.4 });
  }
}
function debris(x,y,n,color){
  for(let i=0;i<n;i++){
    const a = rand(0,Math.PI*2), sp = rand(60,240);
    addParticle({ x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-60, life:rand(0.8,1.6), size:rand(1.5,3.6),
      sprite:'chunk', color:color||[60,44,30], alpha:1, layer:0, grav:520, drag:0.99, spin:rand(-12,12), rot:rand(0,6), floor:FLOOR_Y+rand(4,40) });
  }
}

// ---------- transient lights (explosions, muzzles, strikes) ----------
let flares = [];
function addFlare(x,y,radius,intensity,col,life){
  flares.push({x,y,r:radius,i:intensity,col:col||[1,0.6,0.3],life,max:life});
  if(flares.length>40) flares.shift();
}
function updateFlares(dt){ for(let i=flares.length-1;i>=0;i--){ flares[i].life-=dt; if(flares[i].life<=0) flares.splice(i,1); } }

// ---------- screen-space distortion rings ----------
let ripples = [];
function addRipple(x,y,speed,strength,life){ ripples.push({x,y,r:6,speed,strength,life,max:life}); if(ripples.length>8) ripples.shift(); }
function updateRipples(dt){
  for(let i=ripples.length-1;i>=0;i--){ const r=ripples[i]; r.life-=dt; r.r += r.speed*dt; if(r.life<=0) ripples.splice(i,1); }
}

// ---------- fireballs ----------
let blasts = [];
function addBlast(x,y,radius,hot){ blasts.push({x,y,R:radius,life:0.55,max:0.55,hot:hot||1, seed:Math.random()*10}); }
function updateBlasts(dt){ for(let i=blasts.length-1;i>=0;i--){ blasts[i].life-=dt; if(blasts[i].life<=0) blasts.splice(i,1); } }

// ---------- floating callouts ----------
let floatTexts = [];
function floatText(x,y,text,col){ floatTexts.push({x,y,text,col:col||'#ffe9b8',life:1.2,max:1.2}); if(floatTexts.length>10) floatTexts.shift(); }
function updateFloatTexts(dt){ for(let i=floatTexts.length-1;i>=0;i--){ const f=floatTexts[i]; f.life-=dt; f.y-=22*dt; if(f.life<=0) floatTexts.splice(i,1); } }

// =====================================================================
//  LIGHTNING
// =====================================================================
let lightnings = [];
function strikeLightning(x,y){
  const path = [];
  let cx = x + rand(-60,60);
  const y0 = rand(40,90);
  for(let yy=y0; yy<y; yy+=rand(12,24)){ cx += rand(-18,18) + (x-cx)*0.12; path.push({x:cx,y:yy}); }
  path.push({x,y});
  const branches = [];
  for(let i=1;i<path.length-1;i++){
    if(Math.random()<0.38){
      const start = path[i];
      const dir = Math.random()<0.5?-1:1;
      const bpath = [{x:start.x,y:start.y}];
      let bx = start.x, by = start.y;
      const steps = Math.floor(rand(2,6));
      for(let k=0;k<steps;k++){ bx += dir*rand(8,26); by += rand(8,22); bpath.push({x:bx, y:by}); }
      branches.push(bpath);
    }
  }
  lightnings.push({path, branches, x, y, life:0.5, max:0.5, seed:Math.random()*100});
  addFlare(x, (y0+y)/2, 420, 1.3, [0.72,0.8,1.0], 0.45);
  addFlare(x, y, 180, 1.4, [0.85,0.9,1.0], 0.3);
  sheet.x = x; sheet.y = Math.min(y0+40,160); sheet.i = 1.4;
  ambientFlash = Math.max(ambientFlash, 0.8);
  flashScreen(0.1);
  shake(6, 0.25);
  sparks(x,y,14,{color:[200,225,255],max:260});
  addRipple(x,y,500,4,0.3);
  Sfx.at(x, y).thunder();
}
function updateLightnings(dt){
  for(let i=lightnings.length-1;i>=0;i--){ lightnings[i].life -= dt; if(lightnings[i].life<=0) lightnings.splice(i,1); }
  ambientFlash = Math.max(0, ambientFlash - dt*3);
}

// =====================================================================
//  GAS LAMPS — left, centre and right, mirror-placed so neither side
//  has an edge. Hover beside a lit lamp to top up your fuel from the gas
//  main; its light reveals anyone near it; shoot it and the gas bursts.
// =====================================================================
let LAMPS = [];
const LAMP_H = 122;
const LAMP_X = [0.16, 0.5, 0.84];
const LAMP_TUNE = { reach:150, rate:16, gasMax:100, gasRegen:6, out:14, burstR:84, burstDmg:14 };
function buildLamps(){
  const prev = LAMPS;
  LAMPS = LAMP_X.map((f,i)=>({ x: Math.round(W*f), y: ROAD_Y0+1, out: prev[i] ? prev[i].out : 0, gas: prev[i] ? prev[i].gas : LAMP_TUNE.gasMax,
    flick: prev[i] ? prev[i].flick : i*37.3, glow: prev[i] ? prev[i].glow : 1, draw:0 }));
}
function resetLamps(){ for(const l of LAMPS){ l.out = 0; l.gas = LAMP_TUNE.gasMax; l.draw = 0; } }
function lampLightPos(l){ return { x:l.x, y:l.y - LAMP_H + 18 }; }
// simulation: refuelling + regen (shared by browser and server)
function simLamps(dt){
  for(const l of LAMPS){
    l.draw = 0;
    if(l.out>0){ l.out = Math.max(0, l.out - dt); if(l.out<=0) fx('lampRelit', LAMPS.indexOf(l)); continue; }
    if(!p1) continue;
    const p = lampLightPos(l);
    for(const b of [p1,p2]){
      if(!b.alive || l.gas<=0 || b.fuel >= b.maxFuel-0.5) continue;
      const d = dist(b.x, b.y+30, p.x, p.y);
      if(d < LAMP_TUNE.reach){
        const k = LAMP_TUNE.rate*dt*(1 - 0.5*d/LAMP_TUNE.reach);
        const take = Math.min(k, l.gas, b.maxFuel-b.fuel);
        b.fuel += take; l.gas -= take; l.draw += take/dt;
        b.refuelT = 0.25;
      }
    }
    if(!l.draw) l.gas = Math.min(LAMP_TUNE.gasMax, l.gas + LAMP_TUNE.gasRegen*dt);
  }
}
// an explosion or tracer hit breaks the glass and the gas main bursts
function breakLamp(l, owner){
  if(l.out>0) return false;
  l.out = LAMP_TUNE.out; l.gas = Math.min(l.gas, 30);
  const p = lampLightPos(l);
  fx('lampBreak', LAMPS.indexOf(l));
  explode({ x:p.x, y:p.y, radius:LAMP_TUNE.burstR, dmg:LAMP_TUNE.burstDmg, owner:owner||0, kind:'gas', hot:1.3 });
  return true;
}
function lampDamage(x, y, r, owner){
  for(const l of LAMPS){
    const p = lampLightPos(l);
    if(l.out<=0 && dist(x,y,p.x,p.y) < r+16) breakLamp(l, owner);
  }
}
// client-only: glow fades out/in smoothly and flickers with low gas
function updateLamps(dt){
  for(const l of LAMPS){
    if(l.out>0) l.glow = Math.max(0, l.glow - dt*6);
    else l.glow = Math.min(1, l.glow + dt*1.5);
  }
}

// =====================================================================
//  GRASS (simulated blades: wind sway, gusts, blast & downdraft push)
// =====================================================================
let GRASS = [], GRASS_BACK = [];
function buildGrass(){
  const n = Math.round(300*W/1200);
  GRASS = [];
  for(let i=0;i<n;i++){
    const base = rand(746, 812);
    const depth = clamp((base-746)/66,0,1);           // 0 = far (road edge), 1 = nearest camera
    GRASS.push({ x:rand(-12,W+12), base, h:rand(14,30)+depth*rand(14,34), w:rand(1.6,3.2)+depth*2.2,
      lean:rand(-0.25,0.25), k:rand(16,30), bend:0, bv:0, ph:rand(0,6.28),
      col: mixRgb([58,98,44],[34,64,28], Math.random()*0.7+depth*0.3), tip: mixRgb([150,170,90],[96,140,64],Math.random()) });
  }
  GRASS.sort((a,b)=>a.base-b.base);
  const nb = Math.round(170*W/1200);
  GRASS_BACK = [];
  for(let i=0;i<nb;i++){
    GRASS_BACK.push({ x:rand(-6,W+6), base:FLOOR_Y + rand(2,14), h:rand(6,15), w:rand(1.2,2.2), lean:rand(-0.3,0.3), k:rand(18,30), bend:0, bv:0, ph:rand(0,6.28),
      col: mixRgb([46,78,40],[30,52,30],Math.random()) });
  }
}
function grassImpulse(x, strength, radius){
  for(const arr of [GRASS, GRASS_BACK]) for(const b of arr){
    const dx = b.x - x, ad = Math.abs(dx);
    if(ad<radius) b.bv += Math.sign(dx||1)*strength*(1-ad/radius);
  }
}
function updateGrass(dt){
  const wind = windAt(GROUND_Y);
  for(const arr of [GRASS, GRASS_BACK]) for(const b of arr){
    const gust = Math.sin(windTime*1.7 - b.x*0.012 + b.ph*0.2)*0.5 + Math.sin(windTime*0.6 + b.x*0.004)*0.5;
    const target = b.lean + clamp(wind/80,-1,1)*0.35 + gust*(0.12 + weatherIntensity*0.2);
    b.bv += (target - b.bend)*b.k*dt;
    b.bv *= Math.pow(0.9, dt*60);
    b.bend = clamp(b.bend + b.bv*dt, -1.3, 1.3);
  }
}

// =====================================================================
//  FIREFLIES (ambient, over the meadow)
// =====================================================================
let FIREFLIES = [];
function buildFireflies(){
  FIREFLIES = Array.from({length:Math.round(16*W/1200)}, ()=>({ x:rand(0,W), y:rand(FLOOR_Y-70, FLOOR_Y+50), ph:rand(0,6.28), sp:rand(0.4,1.1), vx:rand(-8,8) }));
}
function updateFireflies(dt){
  for(const f of FIREFLIES){
    f.ph += dt*f.sp;
    f.x += (f.vx + Math.sin(f.ph*1.3)*10 + windAt(GROUND_Y)*0.08)*dt;
    f.y += Math.cos(f.ph)*9*dt;
    if(f.x<-10) f.x = W+10; if(f.x>W+10) f.x = -10;
    f.y = clamp(f.y, FLOOR_Y-90, FLOOR_Y+60);
  }
}
