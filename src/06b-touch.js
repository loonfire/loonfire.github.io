// =====================================================================
//  TOUCH CONTROLS
//  Left thumb: floating stick — left/right steers (analog), push up to
//  burn (analog throttle), pull down to vent. Right thumb: FIRE (hold)
//  ringed by the kit. Two-player on one screen mirrors a set per side.
// =====================================================================
const TOUCH_BTNS = [
  // key, label, ring (0 = centre), kind
  ['fire',   'FIRE',   0, 'hold'],
  ['rocket', 'ROCKET', 1, 'tap'], ['mortar','FLAK',  1, 'tap'], ['boost', 'BOOST', 1, 'tap'],
  ['ballast','BOMB',   2, 'tap'], ['harpoon','HOOK', 2, 'tap'], ['shock', 'SHOCK', 2, 'tap'],
  ['shield', 'SHIELD', 2, 'tap'], ['patch', 'PATCH', 2, 'tap'], ['flare', 'FLARE', 2, 'tap'],
];
const Touch = (function(){
  const pads = { 1:mk(), 2:mk() };
  function mk(){ return { jx:0, jy:0, jId:null, cx:0, cy:0, held:{}, edge:{}, els:{}, zone:null, base:null, knob:null, gx:0, gy:0, R:60 }; }
  let layer = null, visible = false, layoutKey = '', lastInput = 'kbd';
  const coarse = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
  if(coarse) lastInput = 'touch';

  function enabled(){
    if(settings.touch==='on') return true;
    if(settings.touch==='off') return false;
    return lastInput==='touch';
  }
  function buzz(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }
  function safeInsets(){
    const p = $('safeProbe'); if(!p) return {l:0,r:0,t:0,b:0};
    const cs = getComputedStyle(p);
    return { l:parseFloat(cs.paddingLeft)||0, r:parseFloat(cs.paddingRight)||0, t:parseFloat(cs.paddingTop)||0, b:parseFloat(cs.paddingBottom)||0 };
  }

  function build(){
    layer = document.createElement('div');
    layer.id = 'touchLayer'; layer.className = 'tc';
    layer.setAttribute('aria-hidden','true');
    document.body.appendChild(layer);
    guardZoom();
    for(const id of [1,2]){
      const P = pads[id];
      P.zone = div('tc-zone p'+id);
      P.base = div('tc-base p'+id); P.knob = div('tc-knob');
      P.base.appendChild(P.knob);
      layer.appendChild(P.zone); layer.appendChild(P.base);
      wireStick(id);
      for(const [key,label,ring] of TOUCH_BTNS){
        const b = div('tc-btn p'+id+(ring===0?' big':''));
        b.innerHTML = `<span class="lb">${label}</span><span class="ct"></span>`;
        b.dataset.k = key;
        layer.appendChild(b);
        P.els[key] = { el:b, ct:b.querySelector('.ct'), cache:{} };
        wireBtn(id, key, b);
      }
    }
    const markTouch = e => { if(e.pointerType==='touch' || e.pointerType==='pen'){ if(lastInput!=='touch'){ lastInput = 'touch'; refreshMode(); } } };
    window.addEventListener('pointerdown', markTouch, true);
    window.addEventListener('keydown', e=>{ if(!['Escape','F3','Tab'].includes(e.code) && lastInput!=='kbd'){ lastInput = 'kbd'; refreshMode(); } }, true);
    window.addEventListener('resize', ()=>{ layoutKey = ''; });
    window.addEventListener('orientationchange', ()=>{ layoutKey = ''; });
    refreshMode();
  }
  // Phones treat fast repeated taps as double-tap-zoom and two thumbs as a pinch.
  // iOS Safari ignores user-scalable=no, so cancel those gestures ourselves.
  // (Our buttons use pointer events, which still fire when touch defaults are cancelled.)
  function guardZoom(){
    const block = e=>{ if(e.cancelable) e.preventDefault(); };
    for(const t of ['touchstart','touchmove','touchend','touchcancel']) layer.addEventListener(t, block, { passive:false });
    // pinch-zoom anywhere (Safari's own gesture events)
    for(const t of ['gesturestart','gesturechange','gestureend']) document.addEventListener(t, block, { passive:false });
    // while flying, nothing outside a menu should zoom or scroll the page
    const inMenu = el=>!!(el && el.closest && el.closest('.overlay, input, textarea, select'));
    document.addEventListener('touchstart', e=>{
      if(e.touches.length > 1 && !inMenu(e.target)) block(e);          // second finger → no pinch
    }, { passive:false });
    document.addEventListener('touchmove', e=>{
      if(e.touches.length > 1 || (started && !paused && !inMenu(e.target))) block(e);
    }, { passive:false });
    let lastEnd = 0;
    document.addEventListener('touchend', e=>{
      const now = performance.now();
      if(now - lastEnd < 350 && !inMenu(e.target)) block(e);            // second tap of a double-tap
      lastEnd = now;
    }, { passive:false });
    document.addEventListener('dblclick', block, { passive:false });
    // last resort: if the page did get zoomed, snap back to 1×
    const vv = window.visualViewport;
    const meta = document.querySelector('meta[name=viewport]');
    if(vv && meta){
      const base = meta.getAttribute('content');
      vv.addEventListener('resize', ()=>{
        if(vv.scale > 1.01){
          meta.setAttribute('content', base.replace('maximum-scale=1', 'maximum-scale=1.0'));
          setTimeout(()=>meta.setAttribute('content', base), 60);
        }
      });
    }
  }
  function div(cls){ const d = document.createElement('div'); d.className = cls; return d; }

  function wireStick(id){
    const P = pads[id], z = P.zone;
    const setKnob = ()=>{ P.knob.style.transform = `translate(${P.jx*P.R}px,${P.jy*P.R}px)`; };
    z.addEventListener('pointerdown', e=>{
      if(P.jId!==null) return;
      e.preventDefault();
      P.jId = e.pointerId;
      try{ z.setPointerCapture(e.pointerId); }catch(_){}
      const vw = window.innerWidth, vh = window.innerHeight;
      P.cx = clamp(e.clientX, P.R+6, vw-P.R-6); P.cy = clamp(e.clientY, P.R+6, vh-P.R-6);
      P.base.style.left = P.cx+'px'; P.base.style.top = P.cy+'px';
      P.base.classList.add('on');
      move(e);
    });
    const move = e=>{
      if(e.pointerId!==P.jId) return;
      let dx = (e.clientX-P.cx)/P.R, dy = (e.clientY-P.cy)/P.R;
      const m = Math.hypot(dx,dy);
      if(m>1){
        // drag past the rim and the base follows the thumb
        const over = (m-1)*P.R;
        P.cx += dx/m*over; P.cy += dy/m*over;
        P.base.style.left = P.cx+'px'; P.base.style.top = P.cy+'px';
        dx/=m; dy/=m;
      }
      P.jx = dx; P.jy = dy; setKnob();
    };
    const end = e=>{
      if(e.pointerId!==P.jId) return;
      P.jId = null; P.jx = 0; P.jy = 0; setKnob();
      P.base.classList.remove('on');
      P.base.style.left = P.gx+'px'; P.base.style.top = P.gy+'px';
    };
    z.addEventListener('pointermove', move);
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }
  function wireBtn(id, key, el){
    const P = pads[id];
    const down = e=>{
      e.preventDefault(); e.stopPropagation();
      try{ el.setPointerCapture(e.pointerId); }catch(_){}
      P.held[key] = true; P.edge[key] = true;
      el.classList.add('down');
      buzz(key==='fire' ? 6 : 12);
    };
    const up = ()=>{ P.held[key] = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e=>e.preventDefault());
  }

  // ------------------------------------------------------------- layout
  function layout(duo){
    const vw = window.innerWidth, vh = window.innerHeight;
    const ins = safeInsets();
    const key = [vw,vh,duo,ins.l,ins.r,ins.b].join(',');
    if(key===layoutKey) return;
    layoutKey = key;
    let u = clamp(Math.min(vw,vh)/100, 3.3, 5.6);
    if(duo) u *= 0.86;
    const Rf = 12*u, Rs = 6.2*u, gap = 1.6*u, m = 3*u + 4;
    const r1 = Rf + gap + Rs, r2 = r1 + 2*Rs + gap*1.6;
    const ring1 = [180,135,90], ring2 = [180,162,144,126,108,90];
    const yF = vh - ins.b - m - Rf;
    const clusterW = m + Rf + r2 + Rs;
    const place = (id, xF, dir)=>{
      const P = pads[id]; let i1 = 0, i2 = 0;
      for(const [k,,ring] of TOUCH_BTNS){
        const el = P.els[k].el;
        let x = xF, y = yF, R = Rs;
        if(ring===0) R = Rf;
        else {
          const a = (ring===1 ? ring1[i1++] : ring2[i2++])*Math.PI/180;
          const r = ring===1 ? r1 : r2;
          x = xF + (dir<0 ? Math.cos(a) : -Math.cos(a))*r;
          y = yF - Math.sin(a)*r;
        }
        el.style.width = el.style.height = (2*R)+'px';
        el.style.left = (x-R)+'px'; el.style.top = (y-R)+'px';
        el.style.fontSize = (ring===0 ? 3.0*u : 1.75*u)+'px';
      }
    };
    const Rj = 15*u;
    for(const id of [1,2]){ pads[id].R = Rj; pads[id].base.style.width = pads[id].base.style.height = (2*Rj)+'px'; pads[id].knob.style.width = pads[id].knob.style.height = (12*u)+'px'; }
    const topZ = Math.max(70, vh*0.16);
    const setZone = (P, x0, x1)=>{ Object.assign(P.zone.style, { left:x0+'px', width:Math.max(0,x1-x0)+'px', top:topZ+'px', height:(vh-topZ)+'px' }); };
    const ghost = (P, x)=>{ P.gx = x; P.gy = vh - ins.b - m - Rj; if(P.jId===null){ P.base.style.left = P.gx+'px'; P.base.style.top = P.gy+'px'; } };
    if(!duo){
      place(1, vw - ins.r - m - Rf, -1);
      setZone(pads[1], 0, Math.max(vw*0.5, vw - clusterW - ins.r - 10));
      ghost(pads[1], ins.l + m + Rj);
    } else {
      place(1, vw/2 - m - Rf - 2*u, -1);
      place(2, vw/2 + m + Rf + 2*u, +1);
      setZone(pads[1], 0, vw/2 - clusterW - 4*u);
      setZone(pads[2], vw/2 + clusterW + 4*u, vw);
      ghost(pads[1], ins.l + m + Rj);
      ghost(pads[2], vw - ins.r - m - Rj);
    }
  }

  // ------------------------------------------------------------- per frame
  function refreshMode(){
    const on = enabled();
    document.body.classList.toggle('touchmode', on);
    if(typeof updateTouchNote==='function') updateTouchNote();
  }
  function update(){
    if(!layer) return;
    const should = enabled() && started && !paused && !gameOver && mode!=='spectate' && p1;
    if(should!==visible){
      visible = should;
      layer.classList.toggle('show', visible);
      if(!visible) releaseAll();
    }
    document.body.classList.toggle('playing', !!(started && p1));
    if(!visible) return;
    const duo = mode==='pvp';
    layer.classList.toggle('duo', duo);
    layout(duo);
    syncButtons(1, p1);
    if(duo) syncButtons(2, p2);
  }
  function releaseAll(){
    for(const id of [1,2]){
      const P = pads[id];
      P.held = {}; P.edge = {}; P.jx = P.jy = 0; P.jId = null;
      P.base.classList.remove('on'); P.knob.style.transform = '';
      for(const k in P.els) P.els[k].el.classList.remove('down');
    }
  }
  function setState(E, p, ready, active, count, warn){
    const c = E.cache, q = Math.round(clamp(p,0,1)*40)/40;
    if(c.p!==q){ c.p = q; E.el.style.setProperty('--p', q); }
    if(c.r!==ready){ c.r = ready; E.el.classList.toggle('ready', ready); }
    if(c.a!==active){ c.a = active; E.el.classList.toggle('active', active); }
    if(c.w!==warn){ c.w = warn; E.el.classList.toggle('warn', warn); }
    const t = count===null ? '' : String(count);
    if(c.t!==t){ c.t = t; E.ct.textContent = t; }
  }
  function syncButtons(id, b){
    const P = pads[id], T = TUNE, e = P.els;
    const ammo = (n, cd, cdMax, regen, regenMax)=> n>0 ? cd/cdMax : 1 - regen/regenMax;
    setState(e.fire,    b.heat/100, !b.overheated, b.muzzle>0, null, b.overheated);
    setState(e.rocket,  ammo(b.rocketAmmo,b.rocketCd,T.rocket.cd,b.rocketRegen,T.rocket.regen), b.rocketAmmo>0 && b.rocketCd<=0 && b.fuel>=T.rocket.fuel, false, b.rocketAmmo, b.fuel<T.rocket.fuel);
    setState(e.mortar,  ammo(b.mortarAmmo,b.mortarCd,T.mortar.cd,b.mortarRegen,T.mortar.regen), b.mortarAmmo>0 && b.mortarCd<=0 && b.fuel>=T.mortar.fuel, false, b.mortarAmmo, b.fuel<T.mortar.fuel);
    setState(e.ballast, ammo(b.bombAmmo,b.bombCd,T.bomb.cd,b.bombRegen,T.bomb.regen), b.bombAmmo>0 && b.bombCd<=0, false, b.bombAmmo, false);
    setState(e.harpoon, b.harpoonCd/T.harpoon.cd, b.harpoonCd<=0 && b.fuel>=T.harpoon.fuel, false, null, b.fuel<T.harpoon.fuel);
    setState(e.shock,   b.shockCd/T.shock.cd, b.shockCd<=0 && b.fuel>=T.shock.fuel, false, null, b.fuel<T.shock.fuel);
    setState(e.shield,  b.shieldTimer>0 ? 0 : b.shieldCd/T.shield.cd, b.shieldCd<=0 && b.fuel>=T.shield.fuel, b.shieldTimer>0, null, b.fuel<T.shield.fuel);
    setState(e.boost,   b.boostCd/T.boost.cd, b.boostCd<=0 && b.fuel>=T.boost.fuel, b.boostT>0, null, b.fuel<T.boost.fuel);
    setState(e.patch,   b.patchCharges>0 ? 0 : 1 - b.patchRegen/T.patch.regen, b.patchCharges>0 && !b.patching && b.hp<b.maxHp, b.patching, b.patchCharges, false);
    setState(e.flare,   b.flareCd/T.flare.cd, b.flareCd<=0 && b.fuel>=T.flare.fuel, false, null, b.fuel<T.flare.fuel);
  }

  // ------------------------------------------------------------- input
  function read(id){
    if(!visible) return null;
    if(id===2 && mode!=='pvp') return null;
    const P = pads[id];
    const dz = 0.2;
    const ax = Math.abs(P.jx) < dz ? 0 : Math.sign(P.jx)*Math.min(1, (Math.abs(P.jx)-dz)/0.7);
    const up = -P.jy;
    const duty = up > 0.22 ? clamp((up-0.22)/0.6, 0, 1) : 0;
    const out = {
      stick: P.jId!==null,
      steerX: ax,
      burner: duty>=1 || (duty>0 && ((simTime*6)%1) < duty),
      vent: P.jy > 0.5,
      fireHeld: !!P.held.fire,
      edge: P.edge,
      boostX: Math.abs(P.jx)>0.3 ? Math.sign(P.jx) : 0,
      boostY: P.jy>0.5 ? 1 : (P.jy<-0.5 ? -1 : 0)
    };
    P.edge = {};
    return out;
  }
  return { build, update, read, enabled, refreshMode, get lastInput(){ return lastInput; } };
})();
