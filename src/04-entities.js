// =====================================================================
//  GAME STATE (declared early so every system can reference it)
// =====================================================================
let p1 = null, p2 = null;
let mode = 'ai';                 // 'ai' | 'pvp' | 'spectate' | 'online'
let gameOver = false, started = false, paused = false;
let winnerId = null;
let endTimer = 0, endShown = false, endHoverY = 340;
let matchLen = 1, scores = [0,0], roundNo = 1, matchOver = true, roundTime = 0;

let projectiles = [], rockets = [], mortars = [], bombs = [], harpoons = [], shockwaves = [];

// =====================================================================
//  TUNING — every weapon and ability in one place
// =====================================================================
const TUNE = {
  rep:     { interval:0.15, heat:10, dmg:1.9, speed:780, life:1.5, cool:40, coolDelay:0.28, unlock:30, spread:0.04 },
  rocket:  { ammo:2, regen:9, cd:0.9, fuel:12, dmg:22, radius:54, eject:0.2, speedMax:470, turn:2.7, life:4.4 },
  mortar:  { ammo:1, regen:12, cd:1.2, fuel:20, dmg:30, radius:84, vx:330, vy:-300, g:520, fuse:58, fuseMax:96, life:5 },
  bomb:    { ammo:3, regen:8, cd:0.35, dmg:26, radius:68, g:500, vy0:60, prox:56 },
  harpoon: { cd:3.6, fuel:14, dmg:6, speed:980, maxLen:560, tether:1.4, band:42 },
  shock:   { cd:5, fuel:18, dmg:16, radius:132, delay:0.22 },
  shield:  { cd:9, fuel:22, dur:2.0, absorb:0.8 },
  patch:   { charges:2, regen:22, time:1.3, heal:25, interrupt:8 },
  boost:   { cd:3.2, fuel:14, dur:0.35, impulse:540 },
  flare:   { cd:10, fuel:8, life:7, radius:210 },
  storm:   { dmg:18 }
};
const WEAPONS = ['rep','rocket','mortar'];
const WEAPON_LABEL = { rep:'REPEATER', rocket:'ROCKET', mortar:'FLAK' };

const PALETTES = {
  1: { main:'#1aa190', alt:'#ece3c9', band:'#e2ab45', cap:'#0d4b45', trim:'#7fe9dc', scarf:'#3fd6c4',
       tracer:[140,255,236], glowMain:0.55, glowAlt:1.0, name:'Teal' },
  2: { main:'#d4512f', alt:'#2b2f3b', band:'#f3c35d', cap:'#5a1d10', trim:'#ffb08a', scarf:'#ff7a4d',
       tracer:[255,186,96], glowMain:0.8, glowAlt:0.28, name:'Ember' }
};

// gun / harpoon mount (local offsets): a swivel deck gun on a strut beside the envelope
const MUZZLE_DY = 6, MUZZLE_DX = 40;

function hitTest(b, x, y, pad){
  if(dist(x,y,b.x,b.y-6) < 31+pad) return true;
  return Math.abs(x-b.x) < 15+pad && y > b.y+32-pad && y < b.y+53+pad;
}

// =====================================================================
//  BALLOON
// =====================================================================
class Balloon{
  constructor(id, x, facing){
    this.id=id; this.x=x; this.y=360; this.vx=0; this.vy=0;
    this.pal = PALETTES[id];
    this.facing=facing; this.r=36;
    this.maxHp=100; this.hp=100; this.fuel=100; this.maxFuel=100;
    this.heat=0; this.overheated=false; this.repCd=0; this.lastFire=-9;
    this.rocketAmmo=TUNE.rocket.ammo; this.rocketRegen=0; this.rocketCd=0;
    this.mortarAmmo=TUNE.mortar.ammo; this.mortarRegen=0; this.mortarCd=0;
    this.bombAmmo=TUNE.bomb.ammo; this.bombRegen=0; this.bombCd=0;
    this.weapon='rep';
    this.harpoonCd=0; this.shockCd=0; this.shieldCd=0; this.shieldTimer=0; this.shieldHit=0;
    this.patchCharges=TUNE.patch.charges; this.patchRegen=0; this.patching=false; this.patchTimer=0;
    this.boostCd=0; this.boostT=0; this.boostDir=1; this.boostVy=0; this.flareCd=0; this.refuelT=0;
    this.stunSteer=0; this.liftSurge=0; this.flash=0; this.stormTimer=0;
    this.burnerOn=false; this.burnerHeat=0; this.steer=0; this.ventOn=false; this.flameout=false;
    this.muzzle=0; this.alive=true; this.deadRot=0; this.grounded=false; this.deadT=0;
    this.tears=[]; this.tearsV=0;
    this.stats = { dmg:0, shots:0, hits:0, kit:0, blocked:0, by:{}, uses:{} };
    this.lastHitT = -9;
  }
  setMaxHp(mul){ this.maxHp = Math.round(100*mul); this.hp = this.maxHp; }
  takeDamage(amount, by, kind){
    if(!this.alive || gameOver || amount<=0) return 0;
    if(this.shieldTimer>0){
      const blocked = amount*TUNE.shield.absorb;
      amount -= blocked; this.stats.blocked += blocked;
      this.shieldHit = 0.25;
      if(blocked>6) fx('bfloat', this.id, -70, 'BLOCKED', '#bdf3ff');
      fx('sfx', 'ping', this.x, this.y);
    }
    this.hp = clamp(this.hp - amount, 0, this.maxHp);
    this.flash = 0.16; this.lastHitT = simTime;
    if(by && by!==this){ by.stats.dmg += amount; by.stats.by[kind] = (by.stats.by[kind]||0) + amount; }
    fx('sfx', 'hit', this.x, this.y);
    if(amount>=6 || Math.random()<0.18){
      this.tears.push({ ang:rand(0,Math.PI*2), rr:rand(0.15,0.8), s:clamp(rand(3,5)+amount*0.18,3,10),
        poly:Array.from({length:7},()=>0.55+0.55*Math.random()), flap:rand(-0.6,0.6) });
      if(this.tears.length>10) this.tears.shift();
      this.tearsV++;
    }
    if(this.patching && (amount >= TUNE.patch.interrupt || kind==='harpoon')){
      this.patching = false;
      fx('bfloat', this.id, -84, 'PATCH BROKEN', '#ffb08a');
    }
    if(this.hp<=0.05){ this.hp = 0; this.alive=false; onDeath(this); }
    return amount;
  }
  regen(ammoKey, timerKey, max, period, dt){
    if(this[ammoKey] < max){ this[timerKey] += dt; if(this[timerKey] > period){ this[timerKey]=0; this[ammoKey]++; } }
    else this[timerKey] = 0;
  }
  updateDead(dt){
    this.deadT += dt;
    this.burnerOn = false; this.burnerHeat = Math.max(0, this.burnerHeat - dt);
    if(this.grounded) return;
    this.vy = Math.min(this.vy + 380*dt, 380);
    this.vx += windAtXY(this.x, this.y)*dt*0.6;
    this.vx *= Math.pow(0.99, dt*60);
    this.x = clamp(this.x + this.vx*dt, 40, W-40);
    this.y += this.vy*dt;
    const target = (Math.PI/2.6)*this.facing;
    this.deadRot += (target-this.deadRot)*Math.min(1, dt*1.6);
    if(this.y>=GROUND_Y+8){
      this.y = GROUND_Y+8; this.grounded = true;
      explode({ x:this.x, y:FLOOR_Y-6, radius:90, dmg:0, owner:0, noDamage:true, big:true });
    }
  }
  update(dt, input, opp){
    if(!this.alive){ this.updateDead(dt); return; }
    const T = TUNE;
    this.regen('rocketAmmo','rocketRegen',T.rocket.ammo,T.rocket.regen,dt);
    this.regen('mortarAmmo','mortarRegen',T.mortar.ammo,T.mortar.regen,dt);
    this.regen('bombAmmo','bombRegen',T.bomb.ammo,T.bomb.regen,dt);
    this.regen('patchCharges','patchRegen',T.patch.charges,T.patch.regen,dt);
    for(const k of ['repCd','rocketCd','mortarCd','bombCd','harpoonCd','shockCd','shieldCd','shieldTimer','boostCd','stunSteer','liftSurge','flash','muzzle','shieldHit','flareCd','refuelT'])
      this[k] = Math.max(0, this[k]-dt);

    // repeater heat management
    if(simTime - this.lastFire > T.rep.coolDelay) this.heat = Math.max(0, this.heat - T.rep.cool*dt*(this.overheated?1.2:1));
    if(this.overheated){
      if(this.heat <= T.rep.unlock) this.overheated = false;
    }

    if(this.patching){
      this.patchTimer -= dt;
      if(this.patchTimer<=0){
        this.patching=false;
        this.hp = clamp(this.hp+T.patch.heal,0,this.maxHp);
        this.tears.splice(0, Math.min(this.tears.length, 5)); this.tearsV++;
        fx('patchDone', this.id);
      }
    }

    // ---- buoyancy ----
    // an empty tank snuffs the burner; it relights once the tank refills a little
    if(this.fuel<=0.01 && !this.flameout){ this.flameout = true; fx('bfloat', this.id, -74, 'FLAME-OUT', '#ffb08a'); }
    if(this.flameout && this.fuel >= 18) this.flameout = false;
    this.burnerOn = !!(input.burner && !this.flameout && !this.patching);
    this.fuel = clamp(this.fuel + (this.burnerOn?0:7.5)*dt, 0, this.maxFuel);
    this.burnerHeat += ((this.burnerOn?1:0) - this.burnerHeat)*Math.min(1, dt*(this.burnerOn?7:2.2));
    const gravity = 150 + (this.maxHp - this.hp)*0.6;
    const liftMul = this.liftSurge>0 ? 1.9 : 1;
    if(this.burnerOn){
      this.vy -= 430*liftMul*dt;
      this.fuel = clamp(this.fuel - 8.5*dt, 0, this.maxFuel);
    }
    this.ventOn = !!(input.vent && !this.patching);
    if(this.ventOn) this.vy += 300*dt;
    this.vy += gravity*dt;

    // ---- steering thrusters ----
    let steer = 0;
    if(!this.patching){
      if(input.steerX) steer = clamp(input.steerX, -1, 1);
      else { if(input.left) steer -= 1; if(input.right) steer += 1; }
    }
    this.steer = steer;
    const steerMul = this.stunSteer>0 ? 0.35 : 1;
    this.vx += steer*250*steerMul*dt;
    this.vx += windAtXY(this.x, this.y)*dt*0.6;
    this.vy -= thermalAt(this.x, this.y)*dt;          // rising warm air: free lift
    // ---- afterburner boost ----
    if(this.boostT>0){
      this.boostT -= dt;
      this.vx += this.boostDir*T.boost.impulse/T.boost.dur*dt;
      this.vy += this.boostVy*T.boost.impulse*0.55/T.boost.dur*dt;
    }
    const k = dt*60;
    this.vx *= Math.pow(0.985, k);
    this.vy *= Math.pow(0.995, k);
    const vmax = this.boostT>0 ? 480 : (Math.abs(this.vx)>260 ? Math.abs(this.vx)*0.985 : 260);
    this.vx = clamp(this.vx, -vmax, vmax);
    this.vy = clamp(this.vy, -340, 340);

    this.x += this.vx*dt;
    this.y += this.vy*dt;
    if(this.x<40){ this.x=40; this.vx=Math.abs(this.vx)*0.3; }
    if(this.x>W-40){ this.x=W-40; this.vx=-Math.abs(this.vx)*0.3; }
    if(this.y < STORM_Y+10){ this.y = STORM_Y+10; if(this.vy<0) this.vy=0; }
    if(this.y > GROUND_Y){
      if(this.vy>140) fx('land', this.x);
      this.y = GROUND_Y; this.vy = -Math.abs(this.vy)*0.35;
    }
    if(opp) this.facing = opp.x >= this.x ? 1 : -1;


    // the storm ceiling
    if(PREDICT) return;
    if(this.y < STORM_DANGER){
      this.stormTimer += dt;
      if(this.stormTimer > 1){
        this.stormTimer = 0;
        if(Math.random() < 0.06 + weatherIntensity*0.34){
          this.takeDamage(TUNE.storm.dmg, null, 'storm');
          fx('bolt', this.x, this.y);
        }
      }
    } else this.stormTimer = 0;
  }
}

// =====================================================================
//  WEAPONS & ABILITIES
// =====================================================================
function use(s,k){ s.stats.uses[k] = (s.stats.uses[k]||0)+1; }
function muzzlePos(s){ return { x: s.x + s.facing*MUZZLE_DX, y: s.y + MUZZLE_DY }; }
function fireWeapon(s){
  if(!s.alive) return false;
  if(s.weapon==='rep') return fireRepeater(s);
  if(s.weapon==='rocket') return fireRocket(s);
  if(s.weapon==='mortar') return fireMortar(s);
  return false;
}
function fireRepeater(s){
  const T = TUNE.rep;
  if(s.repCd>0 || s.overheated || s.patching) return false;
  s.repCd = T.interval; s.heat += T.heat; s.lastFire = simTime; s.muzzle = 0.06;
  if(s.heat>=100){
    s.heat = 100; s.overheated = true;
    fx('sfx', 'overheat', s.x, s.y); fx('bfloat', s.id, -74, 'OVERHEAT', '#ffb08a');
  }
  const m = muzzlePos(s);
  const ang = (s.facing>0?0:Math.PI) + rand(-T.spread,T.spread);
  projectiles.push({ id:uid(), x:m.x, y:m.y, px:m.x, py:m.y, vx:Math.cos(ang)*T.speed + s.vx*0.25, vy:Math.sin(ang)*T.speed,
    owner:s.id, life:T.life, born:simTime, col:s.pal.tracer });
  s.stats.shots++;
  fx('shot', s.id);
  return true;
}
function fireRocket(s){
  const T = TUNE.rocket;
  if(s.rocketCd>0 || s.rocketAmmo<=0 || s.fuel<T.fuel || s.patching) return false;
  s.rocketCd = T.cd; s.rocketAmmo--; s.fuel -= T.fuel;
  const x = s.x + s.facing*20, y = s.y+34;
  rockets.push({ id:uid(), x, y, vx:s.facing*130 + s.vx*0.5, vy:45 + s.vy*0.3, ang:s.facing>0?0.25:Math.PI-0.25, speed:150,
    owner:s.id, t:0, lit:false, life:T.life, born:simTime });
  s.stats.shots++; s.stats.kit++; use(s,'rocket');
  fx('sfx', 'launch', s.x, s.y);
  return true;
}
function fireMortar(s){
  const T = TUNE.mortar;
  if(s.mortarCd>0 || s.mortarAmmo<=0 || s.fuel<T.fuel || s.patching) return false;
  s.mortarCd = T.cd; s.mortarAmmo--; s.fuel -= T.fuel;
  const x = s.x+s.facing*14, y = s.y+26;
  mortars.push({ id:uid(), x, y, vx:s.facing*T.vx + s.vx*0.5, vy:T.vy + s.vy*0.3, owner:s.id, life:T.life, born:simTime, prevD:1e9, armed:0.25 });
  s.stats.shots++; s.stats.kit++; use(s,'mortar');
  fx('mortarLaunch', s.id);
  return true;
}
function mortarLaunchVel(s){ return { x: s.x+s.facing*14, y: s.y+26, vx: s.facing*TUNE.mortar.vx + s.vx*0.5, vy: TUNE.mortar.vy + s.vy*0.3 }; }
function dropBomb(s){
  const T = TUNE.bomb;
  if(!s.alive || s.bombAmmo<=0 || s.bombCd>0 || s.patching) return false;
  s.bombAmmo--; s.bombCd = T.cd; s.liftSurge = 2.6;
  s.stats.kit++; use(s,'bomb');
  fx('sfx', 'drop', s.x, s.y);
  bombs.push({ id:uid(), x:s.x, y:s.y+58, vx:s.vx*0.3, vy:T.vy0, owner:s.id, life:3.2, born:simTime, rot:0, spin:rand(-4,4) });
  return true;
}
function fireHarpoon(s){
  const T = TUNE.harpoon;
  if(!s.alive || s.harpoonCd>0 || s.fuel<T.fuel || s.patching) return false;
  s.harpoonCd = T.cd; s.fuel -= T.fuel; s.stats.kit++; use(s,'harpoon');
  fx('sfx', 'zip', s.x, s.y);
  harpoons.push({ id:uid(), src:s, dir:s.facing, owner:s.id, len:0, state:'fly', t:0, target:null, born:simTime });
  return true;
}
function ventBurst(s){
  const T = TUNE.shock;
  if(!s.alive || s.shockCd>0 || s.fuel<T.fuel || s.patching) return false;
  s.shockCd = T.cd; s.fuel -= T.fuel; s.stats.kit++; use(s,'shock');
  s.vy += 50;
  fx('sfx', 'whoomp', s.x, s.y);
  shockwaves.push({ id:uid(), src:s, x:s.x, y:s.y, owner:s.id, t:0, delay:T.delay, radius:0, triggered:false });
  return true;
}
function startPatch(s){
  if(!s.alive || s.patchCharges<=0 || s.patching || s.hp>=s.maxHp) return false;
  s.patchCharges--; s.patching = true; s.patchTimer = TUNE.patch.time; s.stats.kit++; use(s,'patch');
  return true;
}
function activateShield(s){
  const T = TUNE.shield;
  if(!s.alive || s.shieldCd>0 || s.shieldTimer>0 || s.fuel<T.fuel || s.patching) return false;
  s.shieldCd = T.cd; s.fuel -= T.fuel; s.shieldTimer = T.dur; s.stats.kit++; use(s,'shield');
  fx('shield', s.id);
  return true;
}
function dropFlare(s){
  const T = TUNE.flare;
  if(!s.alive || s.flareCd>0 || s.fuel<T.fuel || s.patching) return false;
  s.flareCd = T.cd; s.fuel -= T.fuel; s.stats.kit++; use(s,'flare');
  flareList.push({ id:uid(), owner:s.id, x:s.x, y:s.y+56, vx:s.vx*0.3, vy:10, life:T.life });
  fx('flare', s.x, s.y+56);
  return true;
}
function boost(s, dirX, dirY){
  const T = TUNE.boost;
  if(!s.alive || s.boostCd>0 || s.fuel<T.fuel || s.patching) return false;
  s.boostCd = T.cd; s.fuel -= T.fuel; s.boostT = T.dur; s.stats.kit++; use(s,'boost');
  s.boostDir = dirX || (Math.abs(s.vx)>30 ? Math.sign(s.vx) : -s.facing);
  s.boostVy = dirY||0;
  fx('boost', s.id, s.boostDir);
  // a boost snaps any harpoon line hooked into this balloon
  for(const h of harpoons){
    if(h.state==='tether' && h.target===s){ h.state='retract'; h.t=0.22; fx('bfloat', s.id, -70, 'LINE SNAPPED', '#ffe0a0'); }
  }
  return true;
}

// =====================================================================
//  EXPLOSIONS
// =====================================================================
function explode(o){
  const R = o.radius;
  // debris: 0 none · 1 metal · 2 earth
  fx('boom', o.x, o.y, R, o.big?1:0, o.hot||1, o.shake||0, o.debris||0);
  if(!PREDICT && o.kind!=='gas') lampDamage(o.x, o.y, R*0.9, o.owner);
  if(o.noDamage) return;
  const owner = o.owner===1 ? p1 : o.owner===2 ? p2 : null;
  for(const t of [p1,p2]){
    if(!t || !t.alive) continue;
    if(t.id===o.owner) continue;
    const d = dist(o.x,o.y,t.x,t.y);
    const reach = R + t.r*0.4;
    if(d < reach){
      const fall = clamp(1 - d/reach, 0, 1);
      const dealt = t.takeDamage(o.dmg*(0.35 + 0.65*fall), owner, o.kind);
      if(owner && dealt>0 && (o.kind==='rocket' || o.kind==='mortar')) owner.stats.hits++;
      const ang = Math.atan2(t.y-o.y, t.x-o.x);
      const kb = 90 + 150*fall;
      t.vx += Math.cos(ang)*kb;
      t.vy += Math.sin(ang)*kb*0.7 - 30;
    }
  }
}
function fizzle(x,y){ fx('fizzle', x, y); }
function foeOf(ownerId){ return ownerId===p1.id ? p2 : p1; }
function balloonById(id){ return id===1?p1:p2; }

// =====================================================================
//  PROJECTILE UPDATES
// =====================================================================
function updateProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){
    const pr = projectiles[i];
    pr.px = pr.x; pr.py = pr.y;
    pr.x += pr.vx*dt; pr.y += pr.vy*dt;
    pr.life -= dt;
    const target = foeOf(pr.owner);
    let gone = false;
    if(target.alive && hitTest(target, pr.x, pr.y, 3)){
      // tracers lose punch over distance — closing in is a real decision
      const fall = clamp(1.25 - (TUNE.rep.life - pr.life)*TUNE.rep.speed/900, 0.5, 1);
      const dealt = target.takeDamage(TUNE.rep.dmg*fall, balloonById(pr.owner), 'rep');
      if(dealt>0 || target.shieldTimer>0) balloonById(pr.owner).stats.hits++;
      fx('tracerHit', pr.x, pr.y, pr.vx>0?1:-1, target.shieldTimer>0?1:0);
      gone = true;
    }
    // a tracer through the lamp glass bursts the gas main
    if(!gone && pr.y > FLOOR_Y-170){
      for(const l of LAMPS){
        if(l.out>0) continue;
        const lp = lampLightPos(l);
        if(Math.abs(pr.x-lp.x) < 11 && Math.abs(pr.y-lp.y) < 14){ breakLamp(l, pr.owner); gone = true; break; }
      }
    }
    // tracers can shoot down enemy ordnance in flight
    if(!gone){
      for(const arr of [rockets, mortars, bombs]){
        for(let j=arr.length-1;j>=0;j--){
          const e = arr[j];
          if(e.owner!==pr.owner && dist(pr.x,pr.y,e.x,e.y) < 13){
            arr.splice(j,1); fizzle(e.x,e.y); fx('float', e.x, e.y-20, 'SHOT DOWN', '#fff0c0'); gone = true; break;
          }
        }
        if(gone) break;
      }
    }
    if(gone || pr.life<=0 || pr.x<-20 || pr.x>W+20 || pr.y>FLOOR_Y+20){
      if(!gone && pr.y>FLOOR_Y) fx('tracerGround', pr.x);
      projectiles.splice(i,1);
    }
  }
}
function updateRockets(dt){
  const T = TUNE.rocket;
  for(let i=rockets.length-1;i>=0;i--){
    const m = rockets[i];
    m.t += dt; m.life -= dt;
    const target = foeOf(m.owner);
    if(!m.lit){
      m.vy += 220*dt; m.vx *= Math.pow(0.98,dt*60);
      m.ang = Math.atan2(m.vy, m.vx);
      if(m.t >= T.eject){
        m.lit = true; m.speed = Math.max(200, Math.hypot(m.vx,m.vy));
        m.ang = Math.atan2(target.y - m.y, target.x - m.x)*0.35 + m.ang*0.65;
        fx('ignite', m.x, m.y);
      }
    } else {
      if(m.blind === undefined) m.blind = 0;
      m.blind = visibilityOf(target) < 0.3 ? m.blind + dt : 0;
      if(target.alive && m.blind < 0.15){
        // proportional lead on the target
        const tt = clamp(dist(m.x,m.y,target.x,target.y)/m.speed, 0, 1.2);
        const ax = target.x + target.vx*tt*0.6, ay = target.y + target.vy*tt*0.6;
        const desired = Math.atan2(ay-m.y, ax-m.x);
        const diff = normAngle(desired - m.ang);
        const maxTurn = T.turn*dt;
        m.ang += clamp(diff, -maxTurn, maxTurn);
      }
      m.speed = Math.min(m.speed + 300*dt, T.speedMax);
      m.vx = Math.cos(m.ang)*m.speed; m.vy = Math.sin(m.ang)*m.speed;
    }
    m.x += m.vx*dt; m.y += m.vy*dt;
    const hit = target.alive && hitTest(target, m.x, m.y, 6);
    if(hit) explode({ x:m.x, y:m.y, radius:T.radius, dmg:T.dmg, owner:m.owner, kind:'rocket', debris:1 });
    if(hit || m.life<=0 || m.x<-40 || m.x>W+40 || m.y<-40 || m.y>FLOOR_Y){
      if(!hit) explode({ x:m.x, y:Math.min(m.y,FLOOR_Y), radius:T.radius*0.7, dmg:T.dmg*0.5, owner:m.owner, kind:'rocket' });
      rockets.splice(i,1);
    }
  }
}
function updateMortars(dt){
  const T = TUNE.mortar;
  for(let i=mortars.length-1;i>=0;i--){
    const mo = mortars[i];
    mo.vy += T.g*dt;
    mo.x += mo.vx*dt; mo.y += mo.vy*dt;
    mo.life -= dt; mo.armed -= dt;
    const target = foeOf(mo.owner);
    let det = false, near = false;
    if(target.alive && mo.armed<=0){
      const d = dist(mo.x,mo.y,target.x,target.y);
      // proximity fuse: inside the fuse radius, or at closest approach within the outer ring
      if(d < T.fuse) { det = true; near = true; }
      else if(d < T.fuseMax && d > mo.prevD){ det = true; near = true; }
      mo.prevD = d;
    }
    if(mo.y>FLOOR_Y-4 || mo.life<=0 || mo.x<-40 || mo.x>W+40) det = true;
    if(det){
      const ey = Math.min(mo.y, FLOOR_Y-4);
      explode({ x:mo.x, y:ey, radius:T.radius, dmg:T.dmg, owner:mo.owner, kind:'mortar', shake:12, big:near, debris:mo.y>=FLOOR_Y-6?2:0 });
      fx('flak', mo.x, ey);
      mortars.splice(i,1);
    }
  }
}
function updateBombs(dt){
  const T = TUNE.bomb;
  for(let i=bombs.length-1;i>=0;i--){
    const b = bombs[i];
    b.vy += T.g*dt;
    b.x += b.vx*dt; b.y += b.vy*dt;
    b.rot += b.spin*dt; b.life -= dt;
    const target = foeOf(b.owner);
    const hit = target.alive && dist(b.x,b.y,target.x,target.y) < T.prox;
    if(hit || b.life<=0 || b.y>FLOOR_Y-2){
      const ey = Math.min(b.y, FLOOR_Y-2);
      explode({ x:b.x, y:ey, radius:T.radius, dmg:T.dmg, owner:b.owner, kind:'bomb', debris: b.y>=FLOOR_Y-4?2:0 });
      bombs.splice(i,1);
    }
  }
}
function harpoonAnchor(h){ return { x: h.src.x + h.dir*MUZZLE_DX, y: h.src.y + MUZZLE_DY }; }
function updateHarpoons(dt){
  const T = TUNE.harpoon;
  for(let i=harpoons.length-1;i>=0;i--){
    const h = harpoons[i];
    const a = harpoonAnchor(h);
    if(h.state==='fly'){
      const prevTip = a.x + h.dir*h.len;
      h.len += T.speed*dt;
      const tipX = a.x + h.dir*h.len;
      const target = foeOf(h.owner);
      const lo = Math.min(prevTip, tipX), hi = Math.max(prevTip, tipX);
      if(target.alive && target.x+20 >= lo && target.x-20 <= hi && Math.abs(target.y - a.y) < T.band){
        target.takeDamage(T.dmg, h.src, 'harpoon');
        if(target.shieldTimer>0){
          h.state='retract'; h.t=0.2; fx('hookBlock', target.x - h.dir*30, a.y);
        } else {
          h.state='tether'; h.t = T.tether; h.target = target;
          target.stunSteer = Math.max(target.stunSteer, 0.6);
          fx('hooked', target.id, h.dir);
        }
      } else if(h.len >= T.maxLen) { h.state='retract'; h.t=0.2; }
    } else if(h.state==='tether'){
      h.t -= dt;
      const tg = h.target;
      if(h.t<=0 || !tg.alive || !h.src.alive){ h.state='retract'; h.t=0.2; continue; }
      const dx = h.src.x - tg.x, dy = h.src.y - tg.y, d = Math.hypot(dx,dy)||1;
      if(d > 85){
        const nx = dx/d, ny = dy/d;
        tg.vx += nx*580*dt; tg.vy += ny*420*dt;
        h.src.vx -= nx*120*dt; h.src.vy -= ny*90*dt;
      }
      tg.stunSteer = Math.max(tg.stunSteer, 0.15);
      h.len = d;
    } else {
      h.t -= dt;
      h.len = Math.max(0, h.len - 2400*dt);
      if(h.t<=0) harpoons.splice(i,1);
    }
  }
}
function updateShockwaves(dt){
  const T = TUNE.shock;
  for(let i=shockwaves.length-1;i>=0;i--){
    const s = shockwaves[i];
    s.t += dt;
    if(!s.triggered){ s.x = s.src.x; s.y = s.src.y; }
    if(!s.triggered && s.t>=s.delay){
      s.triggered = true; s.radius = 10;
      fx('shockwave', s.x, s.y);
      // releases the owner's tether (the reel-in → blast combo)
      for(const h of harpoons) if(h.src===s.src && h.state==='tether'){ h.state='retract'; h.t=0.2; }
      // swats enemy ordnance out of the sky
      const owner = s.owner;
      for(const arr of [projectiles, rockets, mortars, bombs]){
        for(let j=arr.length-1;j>=0;j--){
          const e = arr[j];
          if(e.owner!==owner && dist(s.x,s.y,e.x,e.y) < T.radius){
            arr.splice(j,1);
            if(arr!==projectiles){ fizzle(e.x,e.y); s.src.stats.blocked += 10; }
          }
        }
      }
      for(const h of harpoons) if(h.owner!==owner && h.state==='fly'){ h.state='retract'; h.t=0.2; }
      for(const t of [p1,p2]){
        if(!t.alive || t.id===owner) continue;
        if(dist(s.x,s.y,t.x,t.y) < T.radius){
          t.takeDamage(T.dmg, s.src, 'shock');
          const ang = Math.atan2(t.y-s.y, t.x-s.x);
          t.vx += Math.cos(ang)*240; t.vy += Math.sin(ang)*170 - 60;
        }
      }
    }
    if(s.triggered){ s.radius += 520*dt; if(s.radius>T.radius+30) shockwaves.splice(i,1); }
  }
}
// balloons bump instead of passing through each other
function resolveBalloonContact(){
  if(!p1.alive || !p2.alive) return;
  const dx = p2.x-p1.x, dy = p2.y-p1.y, d = Math.hypot(dx,dy);
  const minD = 64;
  if(d < minD && d>0.01){
    const nx=dx/d, ny=dy/d, push=(minD-d)*0.5;
    p1.x -= nx*push; p1.y -= ny*push; p2.x += nx*push; p2.y += ny*push;
    const rv = (p2.vx-p1.vx)*nx + (p2.vy-p1.vy)*ny;
    if(rv<0){ p1.vx += nx*rv*0.6; p1.vy += ny*rv*0.6; p2.vx -= nx*rv*0.6; p2.vy -= ny*rv*0.6; }
  }
}
