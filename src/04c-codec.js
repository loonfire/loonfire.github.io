// =====================================================================
//  NETWORK CODEC — shared by the browser and the game server.
//  Snapshots are compact arrays; inputs are one small array per step.
// =====================================================================
const NET_PROTO = 2;
const NET_TICK = 120;                 // simulation steps per second (STEP = 1/120)
const NET_SNAP_EVERY = 4;             // → 30 snapshots per second
const NET_W = 1422;                   // online arena: 16:9 at H = 800 (everyone sees the same sky)
const WSTATES = ['calm','building','storm','clearing'];
const HSTATES = ['fly','tether','retract'];
const B_KEYS = ['x','y','vx','vy','facing','hp','maxHp','fuel','heat','overheated','alive','grounded','deadRot','deadT',
  'weapon','rocketAmmo','rocketCd','rocketRegen','mortarAmmo','mortarCd','mortarRegen','bombAmmo','bombCd','bombRegen',
  'harpoonCd','shockCd','shieldCd','shieldTimer','shieldHit','patchCharges','patchRegen','patching','patchTimer',
  'boostCd','boostT','boostDir','boostVy','stunSteer','liftSurge','flash','burnerOn','burnerHeat','steer','ventOn',
  'muzzle','flameout','repCd','lastFireAgo','stormTimer','flareCd','refuelT'];
const B_BOOL = new Set(['overheated','alive','grounded','patching','burnerOn','ventOn','flameout']);
const q1 = v => Math.round(v*10)/10;
const q2 = v => Math.round(v*100)/100;

function encBalloon(b){
  const out = new Array(B_KEYS.length);
  for(let i=0;i<B_KEYS.length;i++){
    const k = B_KEYS[i];
    let v;
    if(k==='weapon') v = Math.max(0, WEAPONS.indexOf(b.weapon));
    else if(k==='lastFireAgo') v = Math.min(9, simTime - b.lastFire);
    else v = b[k];
    out[i] = typeof v==='boolean' ? (v?1:0) : q2(+v||0);
  }
  return out;
}
function decBalloon(arr, b){
  for(let i=0;i<B_KEYS.length;i++){
    const k = B_KEYS[i], v = arr[i];
    if(k==='weapon') b.weapon = WEAPONS[v] || 'rep';
    else if(k==='lastFireAgo') b.lastFire = simTime - v;
    else if(B_BOOL.has(k)) b[k] = !!v;
    else b[k] = v;
  }
}
function encTears(b){ return b.tears.map(t=>[q2(t.ang), q2(t.rr), q2(t.s), q2(t.flap)]); }
function decTears(arr){
  return arr.map(([ang, rr, s, flap], i)=>{
    // the ragged outline is cosmetic: rebuild it deterministically
    const poly = []; let h = Math.abs(Math.sin(ang*91.7 + i*13.1))*1e4;
    for(let j=0;j<7;j++){ h = (h*9301 + 49297) % 233280; poly.push(0.55 + 0.55*h/233280); }
    return { ang, rr, s, flap, poly };
  });
}
// snapshot of the whole match, as seen by the server at `tick`
function encodeSnapshot(tick, acks, events, tearsFor){
  const snap = {
    t:'s', k:tick, a:acks,
    w:[q2(windTime), q2(weatherIntensity), WSTATES.indexOf(weatherState), q1(bandOffsets[0]), q1(bandOffsets[1]), q1(bandOffsets[2]), q1(bandOffsets[3]),
       q2(roundTime), gameOver?1:0, winnerId||0, q2(endTimer)],
    wd:[q1(windL[0].v), q1(windL[1].v), q1(windL[2].v), q1(windL[3].v), gust.ph, q2(gust.t), gust.dir, q1(gust.str), q1(gust.x), gust.y0, gust.y1, q2(MOONST.phase), MOONST.side],
    fg:fogBanks.map(f=>[f.id, q1(f.x), q1(f.y), q1(f.rx), q1(f.ry), q2(f.d), q1(f.life), q2(f.age)]),
    lm:LAMPS.map(l=>[q2(l.out), q1(l.gas), q1(l.draw)]),
    fl:flareList.map(f=>[f.id, f.owner, q1(f.x), q1(f.y), q2(f.life)]),
    b:[encBalloon(p1), encBalloon(p2)],
    pr:projectiles.map(p=>[p.id, p.owner, q1(p.x), q1(p.y), q1(p.vx), q1(p.vy), q2(simTime-p.born)]),
    rk:rockets.map(m=>[m.id, m.owner, q1(m.x), q1(m.y), q2(m.ang), m.lit?1:0, q1(m.vx), q1(m.vy), q2(simTime-m.born)]),
    mo:mortars.map(m=>[m.id, m.owner, q1(m.x), q1(m.y), q1(m.vx), q1(m.vy), q2(simTime-m.born)]),
    bo:bombs.map(b=>[b.id, b.owner, q1(b.x), q1(b.y), q2(b.rot), q2(simTime-b.born)]),
    hp:harpoons.map(h=>[h.id, h.owner, h.dir, q1(h.len), HSTATES.indexOf(h.state), h.target ? h.target.id : 0]),
    sw:shockwaves.map(s=>[s.id, s.owner, q1(s.x), q1(s.y), q2(s.t), q2(s.delay), s.triggered?1:0, q1(s.radius)]),
  };
  if(events && events.length) snap.e = events;
  if(tearsFor){ const tr = {}; for(const id of tearsFor) tr[id] = encTears(id===1?p1:p2); snap.tr = tr; }
  return snap;
}

// ---- inputs: [seq, bits, steerX×100, weapon, boostX, boostY] ----
const IN_BITS = ['burner','vent','left','right','fire','ballast','harpoon','shock','patch','shield','boost','flare'];
const IN_EDGE_MASK = (1<<4)|(1<<5)|(1<<6)|(1<<7)|(1<<8)|(1<<9)|(1<<10)|(1<<11);
function encInput(seq, inp, weapon){
  let bits = 0;
  for(let i=0;i<IN_BITS.length;i++) if(inp[IN_BITS[i]]) bits |= 1<<i;
  return [seq, bits, Math.round(clamp(inp.steerX||0,-1,1)*100), Math.max(0, WEAPONS.indexOf(weapon)), Math.sign(inp.boostX||0), Math.sign(inp.boostY||0)];
}
function validInput(e){
  return Array.isArray(e) && e.length===6 && e.every(v=>typeof v==='number' && isFinite(v));
}
function decInput(e){
  const o = { seq:e[0] };
  for(let i=0;i<IN_BITS.length;i++) o[IN_BITS[i]] = !!(e[1] & (1<<i));
  o.steerX = clamp(e[2]/100, -1, 1);
  o.weapon = WEAPONS[e[3]|0] || 'rep';
  o.boostX = clamp(e[4]|0, -1, 1); o.boostY = clamp(e[5]|0, -1, 1);
  return o;
}

// world state carried by every snapshot (wind layers, gust, moon, fog, lamps, flares)
function decWorld(A, B, t){
  const a = A.wd, b = B.wd || a;
  if(a){
    for(let i=0;i<4;i++) windL[i].v = windL[i].to = lerp(a[i], b[i], t);
    gust.ph = b[4]; gust.t = b[5]; gust.dir = b[6]; gust.str = b[7]; gust.x = lerp(a[8], b[8], t); gust.y0 = b[9]; gust.y1 = b[10];
    MOONST.phase = b[11]; MOONST.side = b[12];
  }
  if(B.fg){
    const prev = new Map(); for(const f of (A.fg||[])) prev.set(f[0], f);
    fogBanks = B.fg.map(f1=>{ const f0 = prev.get(f1[0]) || f1; return { id:f1[0], x:lerp(f0[1],f1[1],t), y:lerp(f0[2],f1[2],t), rx:f1[3], ry:f1[4], d:f1[5], life:f1[6], age:lerp(f0[7],f1[7],t) }; });
  }
  if(B.lm){ if(LAMPS.length!==B.lm.length) buildLamps(); B.lm.forEach((v,i)=>{ const l = LAMPS[i]; if(!l) return; l.out = v[0]; l.gas = v[1]; l.draw = v[2]; }); }
  if(B.fl){
    const prev = new Map(); for(const f of (A.fl||[])) prev.set(f[0], f);
    flareList = B.fl.map(f1=>{ const f0 = prev.get(f1[0]) || f1; return { id:f1[0], owner:f1[1], x:lerp(f0[2],f1[2],t), y:lerp(f0[3],f1[3],t), vx:0, vy:0, life:f1[4] }; });
  }
}
