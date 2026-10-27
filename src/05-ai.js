// =====================================================================
//  WIND PILOT AI
//  Perception (reaction delay + motion extrapolation) → threat prediction
//  → utility planner (what to do) → controllers (how to fly) → kit
//  timing (when to act, and just as importantly, when to wait).
// =====================================================================
const AI_DIFF = {
  easy:   { key:'easy', label:'Cadet', hpMul:1.00, react:0.45, extrap:0.0, think:0.55, aimNoise:75, fireTol:34, trigger:0.4, defend:0.22,
            gain:1.5, gainX:0.9, heatLimit:101, combo:0, bait:0, mortarSolve:false, bombSolve:false, punish:0.3,
            windUse:false, shootDown:false, stormAware:0.4, patchAt:0.32, rocketGap:3.5, boostUse:0.15, smart:false, reserve:0, range:340,
            desc:'Slow reflexes, loose aim and no real plan. It overheats its guns and wanders into trouble. Good for learning.' },
  normal: { key:'normal', label:'Pilot', hpMul:1.00, react:0.24, extrap:0.5, think:0.32, aimNoise:24, fireTol:25, trigger:0.85, defend:0.55,
            gain:2.1, gainX:1.2, heatLimit:90, combo:0.45, bait:0, mortarSolve:true, bombSolve:true, punish:0.7,
            windUse:true, shootDown:false, stormAware:0.8, patchAt:0.42, rocketGap:2.2, boostUse:0.45, smart:true, reserve:14, range:330,
            desc:'A competent rival. Solves flak and bomb shots, manages its heat, dodges about half of what you throw.' },
  hard:   { key:'hard', label:'Ace', hpMul:1.00, react:0.14, extrap:0.8, think:0.2, aimNoise:9, fireTol:22, trigger:1, defend:0.82,
            gain:2.6, gainX:1.4, heatLimit:84, combo:0.85, bait:0.6, mortarSolve:true, bombSolve:true, punish:1,
            windUse:true, shootDown:true, stormAware:1, patchAt:0.48, rocketGap:1.6, boostUse:0.8, smart:true, reserve:24, range:320,
            desc:'Baits your shield before committing rockets, chains hook + shockwave, swats ordnance and punishes every patch.' },
  brutal: { key:'brutal', label:'Storm Ace', hpMul:1.12, react:0.07, extrap:1.0, think:0.12, aimNoise:3, fireTol:25, trigger:1, defend:0.95,
            gain:3.0, gainX:1.6, heatLimit:86, combo:1, bait:1, mortarSolve:true, bombSolve:true, punish:1,
            windUse:true, shootDown:true, stormAware:1, patchAt:0.5, rocketGap:1.2, boostUse:1, smart:true, reserve:26, range:310,
            desc:'Near-perfect reads, relentless pressure, a tougher envelope and no wasted fuel. Bring your best.' },
};

function hpR0(b){ return b.hp/b.maxHp; }
class AIBrain{
  constructor(me, key){
    this.me = me; this.key = key;
    this.hist = []; this.t = 0;
    this.plan = 'gunline'; this.intent = 'Sizing up the rival';
    this.flash = ''; this.flashT = 0;
    this.thinkT = 0; this.tx = me.x; this.ty = 360;
    this.dodge = null; this.decided = new WeakMap();
    this.aimJ = 0; this.aimJT = 0; this.lastRocket = -9;
    this.holdFire = false; this.boostReq = null; this.fireRepNow = false;
    this.lastEngage = 0; this.hpSeen = [me.hp, 0];
    this.blind = false; this.blindT = 0; this.lastSeen = null; this.ghostOff = null;
  }
  get D(){ return AI_DIFF[this.key]; }
  say(txt){ if(this.flash!==txt || this.flashT<0.3){ this.flash = txt; this.flashT = 1.1; } }
  label(){ return this.flashT>0 ? this.flash : this.intent; }

  // ---------- perception ----------
  record(f){
    // fog: a hidden rival is tracked from where it was last seen, and the guess drifts
    const vis = visibilityOf(f);
    let x = f.x, y = f.y, vx = f.vx, vy = f.vy;
    if(vis < 0.35 && this.lastSeen){
      this.blindT += 1/120;
      const ls = this.lastSeen, age = simTime - ls.t;
      const k = Math.min(age, 2.5);
      if(!this.ghostOff || roll(0.02, 1/120)) this.ghostOff = { x:gaussRand()*30, y:gaussRand()*24 };
      x = clamp(ls.x + ls.vx*k*0.7 + this.ghostOff.x*Math.min(1,age), 40, W-40);
      y = clamp(ls.y + ls.vy*k*0.4 + this.ghostOff.y*Math.min(1,age), STORM_Y+10, GROUND_Y);
      vx = ls.vx*0.5; vy = ls.vy*0.3;
    } else {
      this.blindT = 0; this.ghostOff = null;
      this.lastSeen = { t:simTime, x:f.x, y:f.y, vx:f.vx, vy:f.vy };
    }
    this.blind = this.blindT > 0.25;
    this.hist.push({ t:simTime, x, y, vx, vy, hp:f.hp, maxHp:f.maxHp, alive:f.alive,
      shieldTimer:f.shieldTimer, shieldCd:f.shieldCd, shockCd:f.shockCd, harpoonCd:f.harpoonCd, heat:f.heat,
      overheated:f.overheated, patching:f.patching, stunSteer:f.stunSteer, fuel:f.fuel, rocketAmmo:f.rocketAmmo,
      mortarAmmo:f.mortarAmmo, bombAmmo:f.bombAmmo, boostCd:f.boostCd });
    while(this.hist.length>2 && simTime - this.hist[0].t > 1.2) this.hist.shift();
  }
  perceive(){
    const D = this.D, tgt = simTime - D.react;
    let s = this.hist[0];
    for(const h of this.hist){ if(h.t<=tgt) s = h; else break; }
    const k = D.extrap * (simTime - s.t);
    return Object.assign({}, s, { x: clamp(s.x + s.vx*k, 40, W-40), y: clamp(s.y + s.vy*k*0.8, STORM_Y+10, GROUND_Y) });
  }
  safeMinY(){ return STORM_DANGER + 20 + 75*weatherIntensity*this.D.stormAware; }

  // ---------- threat prediction ----------
  simClosest(x,y,vx,vy,g,maxT,tgt){
    const me = this.me; let best = 1e9, bt = 0;
    for(let t=0;t<=maxT;t+=1/30){
      const px = x+vx*t, py = y+vy*t+0.5*g*t*t;
      const tx = tgt ? tgt.x + tgt.vx*t*0.8 : me.x + me.vx*t;
      const ty = tgt ? tgt.y + tgt.vy*t*0.5 : me.y + me.vy*t*0.6;
      const d = Math.hypot(px-tx, py-ty);
      if(d<best){ best=d; bt=t; }
      if(py > FLOOR_Y) break;
    }
    return { dm:best, eta:bt };
  }
  scan(){
    const me = this.me, D = this.D, out = [];
    const mvx = me.vx, mvy = me.vy*0.6;
    for(const p of projectiles){
      if(p.owner===me.id || simTime-p.born < D.react*0.6) continue;
      const rx = p.x-me.x, ry = p.y-(me.y-4), vx = p.vx-mvx, vy = p.vy-mvy;
      const vv = vx*vx+vy*vy; if(vv<1) continue;
      const t = -(rx*vx+ry*vy)/vv; if(t<0 || t>1.0) continue;
      const dm = Math.hypot(rx+vx*t, ry+vy*t);
      if(dm < 40) out.push({ kind:'tracer', eta:t, dm, ref:p });
    }
    for(const r of rockets){
      if(r.owner===me.id || simTime-r.born < D.react) continue;
      const d = dist(r.x,r.y,me.x,me.y);
      const sp = Math.max(r.lit ? r.speed : 220, 220);
      const eta = Math.max(0, (d-42)/sp) + (r.lit ? 0 : Math.max(0, TUNE.rocket.eject - r.t));
      if(eta < 1.6) out.push({ kind:'rocket', eta, dm:0, ref:r });
    }
    for(const m of mortars){
      if(m.owner===me.id || simTime-m.born < D.react) continue;
      const s = this.simClosest(m.x,m.y,m.vx,m.vy,TUNE.mortar.g,1.6);
      if(s.dm < TUNE.mortar.fuseMax) out.push({ kind:'mortar', eta:s.eta, dm:s.dm, ref:m });
    }
    for(const b of bombs){
      if(b.owner===me.id || simTime-b.born < D.react) continue;
      const s = this.simClosest(b.x,b.y,b.vx,b.vy,TUNE.bomb.g,1.6);
      if(s.dm < TUNE.bomb.prox+12) out.push({ kind:'bomb', eta:s.eta, dm:s.dm, ref:b });
    }
    for(const h of harpoons){
      if(h.owner===me.id || h.state!=='fly') continue;
      const a = harpoonAnchor(h), tip = a.x + h.dir*h.len;
      if(Math.abs(a.y-me.y) < TUNE.harpoon.band+10 && Math.sign(me.x-tip)===h.dir){
        const eta = Math.max(0, Math.abs(me.x-tip)-20)/TUNE.harpoon.speed;
        if(eta < 0.8) out.push({ kind:'harpoon', eta, ref:h });
      }
    }
    return out;
  }
  solveMortar(F){
    const L = mortarLaunchVel(this.me);
    return this.simClosest(L.x, L.y, L.vx, L.vy, TUNE.mortar.g, 2.4, F).dm;
  }
  solveBomb(F){
    const me = this.me;
    return this.simClosest(me.x, me.y+58, me.vx*0.3, TUNE.bomb.vy0, TUNE.bomb.g, 1.8, F).dm;
  }

  // ---------- planning ----------
  pickAltitude(F, off, tx){
    const me = this.me, D = this.D, lo = this.safeMinY(), hi = GROUND_Y-30;
    let best = null, bestS = -1e9;
    for(const c of [F.y-off, F.y+off]){
      if(c<lo || c>hi) continue;
      let s = -Math.abs(c-me.y)*0.003;
      if(c < F.y && me.bombAmmo>0) s += 0.3;                // height advantage enables bombs
      if(c < F.y && me.mortarAmmo>0) s += 0.1;
      if(D.windUse) s += windAt(c)*Math.sign(tx-me.x)*0.004; // ride the layer that carries us
      if(D.windUse && fogAt(me.x, c) > 0.5 && hpR0(me) < 0.5) s += 0.15;  // fog is cover when hurt
      if(c > hi-60 && me.fuel < 40) s -= 0.3;
      if(s>bestS){ bestS = s; best = c; }
    }
    return best===null ? clamp(F.y + (F.y < (lo+hi)/2 ? off : -off), lo, hi) : best;
  }
  keepX(F, range){
    const me = this.me;
    const side = me.x <= F.x ? -1 : 1;
    return clamp(F.x + side*range, 70, W-70);
  }
  replan(F){
    const me = this.me, D = this.D;
    const hpR = me.hp/me.maxHp, foeR = F.hp/F.maxHp;
    const minY = this.safeMinY();
    const U = {};
    const foeShield = F.shieldTimer > 0.1;

    U.gunline = 0.55 + (me.heat<40?0.15:-0.1) + (F.overheated?0.25:0) + (foeR<0.3?0.2:0)
              - (foeShield?0.6:0) - (me.overheated?0.55:0) + (hpR>foeR?0.1:-0.05);
    U.offset  = 0.3 + (me.overheated?0.55:0) + (me.heat>75?0.25:0) + (foeShield?0.5:0)
              + (!F.overheated && F.heat<50 && hpR<foeR ? 0.2 : 0);
    if(me.bombAmmo>0 && F.y-minY > 150 && me.fuel>35 && D.bombSolve)
      U.bomb = 0.22 + 0.11*me.bombAmmo + (me.y < F.y-60 ? 0.25 : 0) - Math.abs(F.x-me.x)/1600 - (D.smart && F.shockCd<=0 ? 0.15 : 0);
    if(me.mortarAmmo>0 && me.fuel>30)
      U.mortar = 0.42 + (foeShield?-0.4:0) + (Math.abs(F.vx)<60?0.1:0) + (D.mortarSolve?0.05:-0.2);
    if(D.combo>0 && me.harpoonCd<=0 && me.shockCd<=0.5 && me.fuel>45)
      U.combo = 0.42 + 0.15*D.combo + (F.shieldCd>0?0.12:-0.05) + (hpR>0.4?0.1:-0.2);
    if(me.patchCharges>0 && hpR < D.patchAt+0.08)
      U.retreat = 0.6 + (D.patchAt - hpR)*2.5;
    if(F.patching || F.stunSteer>0.4 || F.overheated)
      U.punish = 0.7 + D.punish*0.4;
    if(me.fuel < 25) U.refuel = 0.4 + (25-me.fuel)/25*0.6;
    // a lit lamp with gas in its main is a fuel station — worth the low, exposed hover
    const lamp = this.bestLamp(F);
    if(lamp && me.fuel < 45 && D.smart) U.lamp = 0.35 + (45-me.fuel)/45*0.6 - (Math.abs(F.x-lamp.x) < 220 ? 0.35 : 0) - (F.y > me.y+40 ? 0.1 : 0);
    if(this.blind && D.smart) U.offset += 0.15;

    // nobody has drawn blood for a while → stop circling and force the issue
    const idle = simTime - this.lastEngage;
    if(idle > 7){
      const k = clamp((idle-7)/6, 0, 1);
      U.gunline += 0.45*k; if(U.punish!==undefined) U.punish += 0.3*k;
      U.offset -= 0.3*k; if(U.retreat!==undefined && me.patchCharges===0) U.retreat -= 0.5*k;
      if(U.refuel!==undefined && me.fuel>12) U.refuel -= 0.3*k;
    }
    if(U[this.plan]!==undefined) U[this.plan] += 0.12;          // commitment / hysteresis
    if(D.key==='easy') for(const k in U) U[k] += rand(-0.25,0.25); // indecisive
    let best = 'gunline', bs = -1e9;
    for(const k in U) if(U[k]>bs){ bs = U[k]; best = k; }
    this.plan = best;

    switch(best){
      case 'gunline':
        this.ty = F.y + F.vy*0.4; this.tx = this.keepX(F, D.range);
        this.intent = 'Duelling on the gunline'; break;
      case 'offset':
        this.tx = this.keepX(F, 430); this.ty = this.pickAltitude(F, 95, this.tx);
        this.intent = me.overheated ? 'Off the line — guns cooling' : foeShield ? 'Waiting out their shield' : 'Off-axis, denying their line'; break;
      case 'bomb':
        this.ty = F.y - 150; this.tx = clamp(F.x + F.vx*0.7, 70, W-70);
        this.intent = 'Climbing for a bomb run'; break;
      case 'mortar':
        this.ty = F.y - 50; this.tx = this.keepX(F, 340);
        this.intent = 'Working a flak solution'; break;
      case 'combo':
        this.ty = F.y; this.tx = this.keepX(F, 290);
        this.intent = 'Setting up hook + shockwave'; break;
      case 'retreat': {
        const side = me.x <= F.x ? -1 : 1;
        this.tx = side<0 ? 70 : W-70; this.ty = this.pickAltitude(F, 140, this.tx);
        this.intent = 'Disengaging to patch';
        // smarter pilots patch inside a fog bank, away from the rival
        if(D.smart){
          let best = null, bs = -1e9;
          for(const f of fogBanks){ if(fogFade(f) < 0.6) continue; const s = Math.abs(f.x - F.x) - Math.abs(f.x - me.x)*0.5; if(s > bs){ bs = s; best = f; } }
          if(best && bs > 120){ this.tx = clamp(best.x, 70, W-70); this.ty = clamp(best.y, minY, GROUND_Y-40); this.intent = 'Slipping into the fog to patch'; }
        }
        break;
      }
      case 'punish':
        this.ty = F.y; this.tx = this.keepX(F, 230);
        this.intent = F.patching ? 'Punishing their patch' : F.overheated ? 'Pressing — their guns are hot' : 'Pressing a stunned rival'; break;
      case 'refuel':
        this.ty = clamp(Math.max(me.y, F.y+70), minY, GROUND_Y-40); this.tx = this.keepX(F, 450);
        this.intent = 'Coasting to refill fuel'; break;
      case 'lamp': {
        const l = this.bestLamp(F) || LAMPS[1], lp = lampLightPos(l);
        this.tx = l.x + (me.x < l.x ? -30 : 30); this.ty = clamp(lp.y - 34, minY, GROUND_Y-20);
        this.intent = 'Refuelling at the gas lamp'; break;
      }
    }
    if(F.y < STORM_DANGER+10 && weatherIntensity>0.4 && D.stormAware>0.5) this.intent = 'Letting the storm do the work';
  }

  bestLamp(F){
    const me = this.me; let best = null, bs = -1e9;
    for(const l of LAMPS){
      if(l.out>0 || l.gas < 25) continue;
      const s = -Math.abs(l.x - me.x) + Math.abs(l.x - F.x)*0.6 + l.gas;
      if(s > bs){ bs = s; best = l; }
    }
    return best;
  }
  // ---------- flight controllers (predictive, physics-aware) ----------
  drive(inp, tx, ty){
    const me = this.me, D = this.D;
    const g = 150 + (me.maxHp-me.hp)*0.6 - thermalAt(me.x, me.y);
    const lift = me.liftSurge>0 ? 1.9 : 1;
    const drag = -0.3*me.vy;
    const vmax = me.fuel < 25 ? 140 : 230;
    const vyDes = clamp((ty-me.y)*D.gain, -vmax, vmax);
    const aDes = (vyDes - me.vy)*4;
    // pick the action whose acceleration best matches the need, with a small
    // cost on burning fuel and on venting (venting now means burning later)
    const fuelCost = me.fuel < 30 ? 70 : 25;
    const opts = [{ a:g+drag, b:0, v:0, c:0 }, { a:300+g+drag, b:0, v:1, c:Math.abs(ty-me.y)>70 ? 10 : 55 }];
    if(!me.flameout) opts.push({ a:-430*lift+g+drag, b:1, v:0, c:fuelCost });
    let best = opts[0], be = 1e9;
    for(const o of opts){ const e = Math.abs(o.a-aDes) + o.c; if(e<be){ be=e; best=o; } }
    inp.burner = !!best.b; inp.vent = !!best.v;
    if(me.fuel < 14 && inp.burner && ty > me.y-40 && me.y < GROUND_Y-70) inp.burner = false;   // save the dregs

    const wind = windAtXY(me.x, me.y)*0.6, dragx = -0.9*me.vx;
    const steer = me.stunSteer>0 ? 0.35 : 1;
    const vxDes = clamp((tx-me.x)*D.gainX, -240, 240);
    const axDes = (vxDes - me.vx)*3;
    let bh = 0, bhe = 1e9;
    for(const h of [-1,0,1]){ const e = Math.abs(h*250*steer + wind + dragx - axDes); if(e<bhe){ bhe=e; bh=h; } }
    inp.left = bh<0; inp.right = bh>0;
  }

  // ---------- main tick ----------
  step(dt, foe){
    const me = this.me, D = this.D;
    this.t += dt;
    this.flashT = Math.max(0, this.flashT-dt);
    this.record(foe);
    if(me.hp < this.hpSeen[0]-0.01 || foe.hp < this.hpSeen[1]-0.01) this.lastEngage = simTime;
    this.hpSeen[0] = me.hp; this.hpSeen[1] = foe.hp;
    const inp = { burner:false, vent:false, left:false, right:false, fire:false, ballast:false, harpoon:false, shock:false, patch:false, shield:false, boost:false, flare:false, boostX:0, boostY:0 };
    if(me.patching) return inp;
    const F = this.perceive();
    const threats = this.scan();

    this.thinkT -= dt;
    if(this.thinkT<=0){ this.thinkT = D.think*rand(0.8,1.2); this.replan(F); }
    // belief error about the rival's altitude: weaker pilots track (and shoot at) the wrong height
    this.aimJT -= dt;
    if(this.aimJT<=0){ this.aimJT = rand(0.5,1.0)*(0.4 + D.aimNoise/40); this.aimJ = gaussRand()*D.aimNoise*0.6; }

    this.boostReq = null; this.fireRepNow = false;
    this.defend(dt, inp, F, threats);
    this.useKit(dt, inp, F, threats);

    // movement (dodges override the plan briefly)
    let tx = this.tx, ty = this.ty;
    if(this.plan==='bomb'||this.plan==='punish'||this.plan==='gunline'||this.plan==='combo'){
      this.tx = this.plan==='bomb' ? clamp(F.x + F.vx*0.7, 70, W-70) : this.keepX(F, this.plan==='punish'?230:this.plan==='combo'?290:D.range);
      tx = this.tx;
      if(this.plan!=='bomb') ty = F.y + F.vy*0.35 + this.aimJ;
    }
    if(this.dodge){
      this.dodge.t -= dt;
      if(this.dodge.v) ty = me.y + this.dodge.v*140;
      if(this.dodge.h) tx = me.x + this.dodge.h*220;
      if(this.dodge.t<=0) this.dodge = null;
    }
    ty = clamp(ty, this.safeMinY(), GROUND_Y-30);
    this.drive(inp, tx, ty);
    if(me.y > GROUND_Y-45 && me.vy > 30 && !me.flameout){ inp.burner = true; inp.vent = false; }
    if(me.y < STORM_DANGER+6 && weatherIntensity>0.2 && D.stormAware>0.5){ inp.burner = false; }

    if(this.boostReq){ inp.boost = true; inp.boostX = this.boostReq.x; inp.boostY = this.boostReq.y; }
    return inp;
  }

  // ---------- reactive defence ----------
  defend(dt, inp, F, threats){
    const me = this.me, D = this.D;
    const T = TUNE;
    const heavy = threats.filter(t=>t.kind==='rocket'||t.kind==='mortar'||t.kind==='bomb').sort((a,b)=>a.eta-b.eta);
    const h0 = heavy[0];
    if(h0){
      if(!this.decided.has(h0.ref)) this.decided.set(h0.ref, Math.random() < D.defend);
      if(this.decided.get(h0.ref) && !h0.ref._ans){
        const shockOk = me.shockCd<=0 && me.fuel>=T.shock.fuel;
        const shieldOk = me.shieldCd<=0 && me.shieldTimer<=0 && me.fuel>=T.shield.fuel;
        const boostOk = me.boostCd<=0 && me.fuel>=T.boost.fuel;
        if(me.shieldTimer>0.4){ /* already covered */ }
        else if(shockOk && h0.eta > T.shock.delay-0.05 && h0.eta < T.shock.delay+0.2){
          inp.shock = true; h0.ref._ans = true; this.say('Shockwave — swatting it away');
        } else if(D.shootDown && h0.kind==='rocket' && h0.ref.lit && !me.overheated && Math.abs(h0.ref.y-(me.y+MUZZLE_DY))<9 && Math.sign(h0.ref.x-me.x)===me.facing && h0.eta>0.15){
          this.fireRepNow = true; this.say('Shooting the rocket down');
        } else if(h0.eta < 0.3 && shieldOk && !(shockOk && h0.eta > T.shock.delay-0.05)){
          inp.shield = true; h0.ref._ans = true; this.say('Shield up');
        } else if(h0.eta < 0.42 && boostOk && D.boostUse>0.3){
          const dx = Math.sign(me.x - h0.ref.x) || -me.facing;
          this.boostReq = { x:dx, y: h0.kind==='bomb' ? 0 : (h0.ref.y > me.y ? -1 : 1) };
          h0.ref._ans = true; this.say('Afterburner dodge');
        } else if(h0.eta < 0.9 && !this.dodge){
          if(h0.kind==='bomb') this.dodge = { t:0.6, v:0, h: Math.sign(me.x - h0.ref.x) || 1 };
          else this.dodge = { t:0.5, v: h0.ref.y > me.y ? -1 : 1, h:0 };
          this.say('Evading');
        }
      }
    }
    // incoming harpoon line
    const hp = threats.find(t=>t.kind==='harpoon');
    if(hp){
      if(!this.decided.has(hp.ref)) this.decided.set(hp.ref, Math.random() < D.defend);
      if(this.decided.get(hp.ref) && !hp.ref._ans){
        if(me.shockCd<=0 && me.fuel>=T.shock.fuel && hp.eta > T.shock.delay-0.03 && D.smart){ inp.shock = true; hp.ref._ans = true; this.say('Blasting their line'); }
        else if(!this.dodge){ this.dodge = { t:0.4, v: (me.y < (this.safeMinY()+GROUND_Y)/2) ? 1 : -1, h:0 }; hp.ref._ans = true; }
      }
    }
    // hooked by the rival with their shockwave ready → snap the line
    const hooked = harpoons.find(h=>h.target===me && h.state==='tether');
    if(hooked && D.smart){
      if(me.boostCd<=0 && me.fuel>=T.boost.fuel && (F.shockCd<0.6 || me.hp<40)){
        this.boostReq = { x: Math.sign(me.x - F.x) || 1, y:0 }; this.say('Snapping the hook line');
      } else if(F.shockCd<0.3 && me.shieldCd<=0 && me.shieldTimer<=0 && me.fuel>=T.shield.fuel && dist(me.x,me.y,F.x,F.y)<180){
        inp.shield = true; this.say('Bracing — shield');
      }
    }
    // tracer streams: trade if we're winning the exchange, jink if not
    const tr = threats.filter(t=>t.kind==='tracer' && t.eta<0.6);
    if(tr.length>=2 && !inp.shield && me.shieldTimer<=0){
      const winning = D.smart && !me.overheated && me.heat < D.heatLimit-15 && Math.abs(F.y-me.y)<30 && me.hp >= F.hp*0.9;
      const shieldOk = me.shieldCd<=0 && me.fuel>=T.shield.fuel+8;
      const losing = me.overheated || me.heat > 60 || !winning;
      if(tr.length>=2 && me.hp/me.maxHp < 0.9 && losing && shieldOk && D.smart && roll(D.defend*0.15,dt)){ inp.shield = true; this.say('Shield vs. the barrage'); }
      else if(!winning && !this.dodge && roll(D.defend*0.12, dt)){
        const lo = this.safeMinY(), hi = GROUND_Y-40;
        let v = me.bombAmmo>0 ? -1 : (Math.random()<0.5?-1:1);
        if(me.y-110 < lo) v = 1; else if(me.y+110 > hi) v = -1;
        this.dodge = { t:0.55, v, h:0 }; this.say('Jinking off their line');
      }
    }
  }

  // ---------- offensive kit & resource discipline ----------
  useKit(dt, inp, F, threats){
    const me = this.me, D = this.D, T = TUNE;
    const warm = this.t > 0.6 + D.react;
    if(!warm){ this.intent = 'Sizing up the rival'; return; }
    const dx = F.x-me.x, adx = Math.abs(dx);
    const facingOk = (dx>=0?1:-1) === me.facing;
    const foeShield = F.shieldTimer > 0.1;
    const reserve = D.reserve;   // fuel kept back for shield / shockwave / dodges
    const enemyOrd = rockets.some(e=>e.owner!==me.id) || mortars.some(e=>e.owner!==me.id) || bombs.some(e=>e.owner!==me.id);

    // --- patch kit: only when safe (or shielded) and with altitude to spare ---
    const hpR = me.hp/me.maxHp;
    const tethered = harpoons.some(h=>h.target===me && h.state==='tether');
    if(me.patchCharges>0 && !me.patching && hpR < D.patchAt && me.hp < me.maxHp-15 && !inp.shield){
      const fallRoom = me.y > GROUND_Y-8 || me.y + 150 + Math.max(0,me.vy)*1.3 < GROUND_Y;
      const quiet = !tethered && threats.length===0 && !enemyOrd;
      const safe = quiet && (adx>380 || F.overheated || F.stunSteer>0.3 || F.patching || Math.abs(F.y-me.y)>120 || !D.smart);
      const shielded = me.shieldTimer > 0.9;
      if(fallRoom && (safe || shielded || (hpR<0.15 && quiet))){ inp.patch = true; this.say(shielded ? 'Patching under the shield' : 'Patching while it\'s quiet'); return; }
      if(D.bait>0.5 && fallRoom && me.shieldCd<=0 && me.shieldTimer<=0 && me.fuel>=T.shield.fuel+5 && hpR < D.patchAt*0.8 && !tethered && adx<420){
        inp.shield = true; this.say('Shield first, then patch'); return;
      }
    }

    // --- shockwave: point-blank or reel-in combo ---
    const myTether = harpoons.find(h=>h.src===me && h.state==='tether');
    if(!inp.shock && me.shockCd<=0 && me.fuel>=T.shock.fuel && F.alive){
      const pd = dist(F.x+F.vx*0.22, F.y+F.vy*0.22, me.x+me.vx*0.22, me.y+me.vy*0.22);
      if(pd < T.shock.radius-22 && !foeShield && roll(0.15 + D.defend*0.4, dt)){ inp.shock = true; this.say(myTether ? 'Reeled in — shockwave!' : 'Point-blank shockwave'); }
    }
    if(myTether) { this.tx = me.x; this.ty = me.y; }   // let the line do the work

    // --- harpoon ---
    const hT = adx / T.harpoon.speed;
    const pfy = F.y + F.vy*hT*0.7;
    if(!inp.harpoon && me.harpoonCd<=0 && me.fuel>=T.harpoon.fuel+reserve && facingOk && adx < T.harpoon.maxLen-30 && Math.abs(pfy-me.y) < T.harpoon.band-12 && !foeShield){
      const comboReady = me.shockCd<=0.3 && me.fuel >= T.harpoon.fuel + T.shock.fuel;
      let want;
      if(F.patching) want = 1;
      else if(comboReady && D.combo>0) want = D.combo*(this.plan==='combo'||this.plan==='punish' ? 1 : 0.5);
      else want = D.smart ? 0.06 : 0.3;
      if(roll(want*0.3, dt)){ inp.harpoon = true; this.say(F.patching ? 'Hook to break their patch' : comboReady ? 'Hook — reeling them in' : 'Harpoon'); }
    }

    // --- flare: light up a rival hiding in the fog ---
    if(this.blind && me.flareCd<=0 && me.fuel >= T.flare.fuel + reserve*0.5 && adx < 520 && (D.smart ? this.blindT > 0.6 : roll(0.05, dt))){
      inp.flare = true; this.say('Flare — lighting up the fog');
    }
    // --- rocket: commit when their shield can't answer it ---
    if(!inp.fire && !this.blind && me.rocketAmmo>0 && me.rocketCd<=0 && me.fuel>=T.rocket.fuel+reserve && adx>180 && simTime-this.lastRocket > D.rocketGap && !foeShield){
      let want;
      if(F.patching) want = 1;
      else if(F.hp < 26) want = 0.9;
      else if(D.bait>0){
        const shieldDown = F.shieldCd > 1.2 || F.fuel < T.shield.fuel;
        want = shieldDown ? 0.85 : 0.03 + 0.1*(1-D.bait);
        if(F.shockCd<=0.3 && adx<320) want *= 0.25;
        if(me.rocketAmmo>=T.rocket.ammo) want += 0.08;
        if(!shieldDown && F.shieldCd<=0) this.intent = this.intent==='Duelling on the gunline' ? 'Baiting their shield' : this.intent;
      } else want = 0.3 + (me.rocketAmmo>=T.rocket.ammo ? 0.2 : 0);
      if(roll(want*0.06, dt)){ me.weapon='rocket'; inp.fire = true; this.lastRocket = simTime; this.say(F.patching ? 'Rocket on the patcher' : F.shieldCd>1.2 ? 'Shield is down — rocket away' : 'Rocket away'); }
    }

    // --- flak mortar: fire only with a ballistic solution ---
    if(!inp.fire && me.mortarAmmo>0 && me.mortarCd<=0 && me.fuel>=T.mortar.fuel+reserve && !foeShield && adx>110){
      if(D.mortarSolve){
        const m = this.solveMortar(F);
        if(m < (this.plan==='mortar' ? 52 : 40) && roll(0.5,dt)){ me.weapon='mortar'; inp.fire = true; this.say('Flak away — solution locked'); }
      } else if(adx>250 && adx<480 && roll(0.012,dt)){ me.weapon='mortar'; inp.fire = true; }
    }

    // --- drop bomb (solved), or ballast for emergency lift ---
    if(me.bombAmmo>0 && me.bombCd<=0){
      if(me.y < F.y-40){
        if(D.bombSolve){ if(this.solveBomb(F) < T.bomb.prox-14){ inp.ballast = true; this.say('Bombs away'); } }
        else if(adx<55 && roll(0.05,dt)) inp.ballast = true;
      }
      if(!inp.ballast && D.smart && me.y > GROUND_Y-70 && me.vy > 110){ inp.ballast = true; this.say('Ballast — emergency lift'); }
    }

    // --- afterburner reposition ---
    if(!this.boostReq && me.boostCd<=0 && me.fuel>45+D.reserve && D.boostUse>0){
      const gap = this.tx - me.x;
      if(Math.abs(gap) > 360 && Math.sign(gap)*me.vx < 120 && roll(D.boostUse*0.02, dt)){ this.boostReq = { x:Math.sign(gap), y:0 }; this.say('Afterburner reposition'); }
    }

    // --- repeater: aimed bursts with heat discipline ---
    if(!inp.fire){
      const tof = adx / T.rep.speed;
      const predY = F.y + F.vy*tof*0.85 + this.aimJ;
      const err = Math.abs(predY - (me.y + MUZZLE_DY));
      const limit = (F.hp < 20 || this.plan==='punish') ? 97 : D.heatLimit;
      if(me.heat >= limit) this.holdFire = true;
      if(this.holdFire && me.heat < limit-38) this.holdFire = false;
      const shieldOk = !foeShield || D.key==='easy' || (D.bait>0 && F.shieldTimer<0.35);
      const blindTol = this.blind ? (D.smart ? 0.35 : 0.8) : 1;
      if(this.fireRepNow && !me.overheated){ me.weapon='rep'; inp.fire = true; }
      else if(facingOk && !me.overheated && !this.holdFire && adx<950 && err<D.fireTol*blindTol && shieldOk && me.repCd<=0 && (!this.blind || roll(0.5, dt))){
        this.trigWait = Math.max(0, (this.trigWait||0) - dt);
        if(this.trigWait<=0){
          if(Math.random() < D.trigger){ me.weapon='rep'; inp.fire = true; }
          else this.trigWait = 0.3;          // a hesitant trigger finger
        }
      }
      else if(this.holdFire && err<D.fireTol && facingOk && this.flashT<=0) this.say('Holding fire — cooling');
      else if(foeShield && err<D.fireTol && this.flashT<=0 && D.smart) this.say('Holding fire — they\'re shielded');
    }
  }
}
