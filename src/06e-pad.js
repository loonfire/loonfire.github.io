// =====================================================================
//  CONTROLLERS (Gamepad API, "standard" mapping)
//  · plug in any time: the first pad flies Pilot 1, a second pad joins
//    as Pilot 2 in a one-screen duel
//  · menus are fully navigable: D-pad / stick moves, A selects, B backs
//    out, LB / RB switch settings tabs, Menu pauses
//  · rumble on hits, gusts and blasts (where the browser supports it)
//  · every action can be rebound in Settings → Controls
// =====================================================================
const PAD_ACTIONS = [
  ['fire','Fire (hold for Repeater)'], ['fire2','Fire (alternate)'], ['ballast','Drop bomb'], ['harpoon','Harpoon'],
  ['shield','Aegis shield'], ['shock','Vent shockwave'], ['patch','Patch kit'], ['boost','Afterburner boost'],
  ['flare','Drop flare'], ['wPrev','Previous weapon'], ['wNext','Next weapon'], ['pause','Pause menu'],
];
const PAD_DEFAULT = { fire:0, fire2:7, ballast:2, harpoon:1, shield:3, shock:4, patch:5, boost:6, flare:11, wPrev:14, wNext:15, pause:9 };
const PAD_BTN_NAME = ['A','B','X','Y','LB','RB','LT','RT','View','Menu','L-stick','R-stick','D-pad ↑','D-pad ↓','D-pad ←','D-pad →','Home'];
const Pad = (function(){
  const prev = {};                     // pad index → previous button states
  const slots = { 1:null, 2:null };    // pilot → gamepad index
  let lastUse = 0, navT = 0, navDir = '', capture = null, rsFlick = {};
  const map = ()=> Object.assign({}, PAD_DEFAULT, (settings.pad && settings.pad.map) || {});
  function list(){ try{ return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []; }catch(e){ return []; } }
  function get(i){ if(i===null || i===undefined) return null; try{ const g = navigator.getGamepads ? navigator.getGamepads()[i] : null; return g && g.connected!==false ? g : null; }catch(e){ return null; } }
  function assign(){
    const pads = list();
    for(const s of [1,2]) if(slots[s]!==null && !get(slots[s])) slots[s] = null;
    for(const g of pads){
      if(slots[1]===g.index || slots[2]===g.index) continue;
      if(slots[1]===null) slots[1] = g.index;
      else if(slots[2]===null) slots[2] = g.index;
    }
  }
  const pressed = (g, n)=> !!(g && g.buttons[n] && (g.buttons[n].pressed || g.buttons[n].value > 0.5));
  // an edge is consumed the moment it is read, so several sim steps in one frame never double-fire
  function edgeOf(g, n){ const p = prev[g.index] || (prev[g.index] = {}); const now = pressed(g, n); const e = now && !p[n]; p[n] = now; return e; }
  function endFrame(){}
  function dz(v){ const d = ((settings.pad && settings.pad.dead) || 15)/100; return Math.abs(v) < d ? 0 : Math.sign(v)*(Math.abs(v)-d)/(1-d); }
  function anyActivity(g){ if(!g) return false; for(let n=0;n<g.buttons.length;n++) if(pressed(g,n)) return true; return (g.axes||[]).some(a=>Math.abs(a)>0.5); }

  // ---- gameplay: one pilot's controls from their pad ----
  function read(id){
    const out = { any:false, burner:false, vent:false, steerX:0, left:false, right:false, fire:false, fireHeld:false, ballast:false, harpoon:false,
                  shock:false, patch:false, shield:false, boost:false, flare:false, w:0, pause:false };
    // in single-pilot modes any pad flies Pilot 1
    let g = get(slots[id]);
    if(!g && id===1 && mode!=='pvp'){ const ps = list(); g = ps[0] || null; }
    if(!g || (id===2 && mode!=='pvp')) return out;
    const M = map();
    const e = n => edgeOf(g, n), h = n => pressed(g, n);
    const ax = dz(g.axes[0]||0), ayRaw = dz(g.axes[1]||0);
    const ay = settings.pad && settings.pad.invert ? -ayRaw : ayRaw;
    out.steerX = ax;
    out.left = ax < -0.4; out.right = ax > 0.4;
    out.burner = ay < -0.35 || h(12); out.vent = ay > 0.35 || h(13);
    out.fireHeld = h(M.fire) || h(M.fire2);
    out.fire = e(M.fire) || e(M.fire2);
    out.ballast = e(M.ballast); out.harpoon = e(M.harpoon); out.shock = e(M.shock);
    out.patch = e(M.patch); out.shield = e(M.shield); out.boost = e(M.boost); out.flare = e(M.flare);
    if(e(M.wPrev)) out.w = -1;
    if(e(M.wNext)) out.w = 1;
    // right stick flick also cycles weapons
    const rx = g.axes[2]||0, f = rsFlick[g.index]||0;
    if(Math.abs(rx) > 0.7 && !f){ out.w = rx>0 ? 1 : -1; rsFlick[g.index] = 1; }
    else if(Math.abs(rx) < 0.3) rsFlick[g.index] = 0;
    out.pause = e(M.pause);
    out.any = anyActivity(g);
    if(out.any) markPad();
    return out;
  }
  function markPad(){ lastUse = performance.now(); if(!document.body.classList.contains('padmode')) document.body.classList.add('padmode'); }

  // ---- menus: spatial focus navigation in the visible overlay ----
  function visibleOverlay(){
    const ids = ['settingsScreen','controlsScreen','pauseScreen','endScreen','onlineScreen','lanScreen','startScreen'];
    for(const id of ids){ const el = $(id); if(el && el.style.display!=='none' && el.offsetParent!==null) return el; }
    return null;
  }
  function focusables(root){
    return Array.from(root.querySelectorAll('button, [tabindex="0"], input:not([type=hidden]), summary')).filter(el=>{
      if(el.disabled) return false;
      const r = el.getBoundingClientRect(); if(r.width<2 || r.height<2) return false;
      const cs = getComputedStyle(el); return cs.visibility!=='hidden' && cs.display!=='none';
    });
  }
  function move(dir){
    const root = visibleOverlay(); if(!root) return;
    const els = focusables(root); if(!els.length) return;
    const cur = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
    if(!cur){ (root.querySelector('[data-default]') || els[0]).focus(); return; }
    const a = cur.getBoundingClientRect(), ax = a.left+a.width/2, ay = a.top+a.height/2;
    let best = null, bs = 1e9;
    for(const el of els){
      if(el===cur) continue;
      const r = el.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2, dx = x-ax, dy = y-ay;
      const along = dir==='up' ? -dy : dir==='down' ? dy : dir==='left' ? -dx : dx;
      const across = dir==='up'||dir==='down' ? Math.abs(dx) : Math.abs(dy);
      if(along <= 2) continue;
      const s = along + across*2.2;
      if(s < bs){ bs = s; best = el; }
    }
    if(best){ best.focus(); best.scrollIntoView && best.scrollIntoView({ block:'nearest' }); Sfx.click && Sfx.click(); }
  }
  function menuBack(root){
    const b = root.querySelector('[data-back]');
    if(b){ b.click(); return; }
    window.dispatchEvent(new KeyboardEvent('keydown', { code:'Escape', key:'Escape', bubbles:true }));
  }
  function menuFrame(dt){
    const root = visibleOverlay();
    const pads = list();
    if(!root || !pads.length) return false;
    let dir = '', a = false, b = false, lb = false, rb = false, used = false;
    for(const g of pads){
      const x = g.axes[0]||0, y = g.axes[1]||0;
      if(pressed(g,12) || y < -0.55) dir = 'up';
      else if(pressed(g,13) || y > 0.55) dir = 'down';
      else if(pressed(g,14) || x < -0.55) dir = 'left';
      else if(pressed(g,15) || x > 0.55) dir = 'right';
      if(edgeOf(g,0)) a = true;
      if(edgeOf(g,1)) b = true;
      if(edgeOf(g,4)) lb = true;
      if(edgeOf(g,5)) rb = true;
      if(anyActivity(g)) used = true;
    }
    if(used) markPad();
    if(capture) return true;
    navT -= dt;
    if(dir && (dir!==navDir || navT<=0)){ move(dir); navT = dir===navDir ? 0.13 : 0.32; }
    navDir = dir;
    if(a){
      const el = document.activeElement;
      if(el && root.contains(el)){ if(el.tagName==='INPUT' && el.type==='range'){} else el.click(); }
      else move('down');
    }
    if(b) menuBack(root);
    if(lb || rb){ const tabs = root.querySelectorAll('[data-tab]'); if(tabs.length){ const arr = Array.from(tabs); let i = arr.findIndex(t=>t.getAttribute('aria-selected')==='true'); i = (i + (rb?1:-1) + arr.length) % arr.length; arr[i].click(); arr[i].focus(); } }
    // range sliders: left/right nudges
    const el = document.activeElement;
    if(el && el.tagName==='INPUT' && el.type==='range' && (dir==='left'||dir==='right') && navT===0.32){
      el.value = +el.value + (dir==='right'?1:-1)*(+el.step||1)*5; el.dispatchEvent(new Event('input', { bubbles:true }));
    }
    return true;
  }

  // ---- rebinding: wait for the next button press ----
  function captureFrame(){
    if(!capture) return;
    for(const g of list()){
      for(let n=0;n<g.buttons.length;n++){
        if(edgeOf(g, n)){
          const cb = capture; capture = null;
          if(n===1 && cb.action!=='harpoon' && cb.allowCancel){ cb.done(null); return; }
          cb.done(n); return;
        }
      }
    }
  }

  // ---- rumble ----
  function rumbleIdx(i, strong, dur){
    if(!settings.pad || !settings.pad.vib) return;
    const g = get(i); if(!g) return;
    try{
      const va = g.vibrationActuator;
      if(va && va.playEffect) va.playEffect(va.type || 'dual-rumble', { duration:Math.round(dur*1000), strongMagnitude:clamp(strong,0,1), weakMagnitude:clamp(strong*0.7,0,1) }).catch(()=>{});
      else if(g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(clamp(strong,0,1), dur*1000);
    }catch(e){}
  }
  function localPilots(){
    if(!started || !p1) return [];
    if(mode==='online' || mode==='lanhost'){ const s = typeof netSeat==='function' ? netSeat() : 1; return [[s, 1]]; }
    if(mode==='pvp') return [[1,1],[2,2]];
    if(mode==='ai') return [[1,1]];
    return [];
  }
  function slotIndex(slot){ if(slots[slot]!==null) return slots[slot]; if(slot===1 && mode!=='pvp'){ const ps = list(); return ps[0] ? ps[0].index : null; } return null; }

  window.addEventListener('gamepadconnected', e=>{
    assign();
    const n = slots[1]===e.gamepad.index ? 1 : slots[2]===e.gamepad.index ? 2 : 0;
    if(typeof showBanner==='function') showBanner('Controller connected'+(n ? ' · Pilot '+n : ''), 1.8);
    markPad();
    if(typeof syncPadUi==='function') syncPadUi();
  });
  window.addEventListener('gamepaddisconnected', e=>{
    const was = slots[1]===e.gamepad.index ? 1 : slots[2]===e.gamepad.index ? 2 : 0;
    assign();
    if(was && started && !gameOver && !paused && (mode==='ai' || mode==='pvp')) { if(typeof toggleMenu==='function') toggleMenu(); }
    if(typeof showBanner==='function') showBanner('Controller disconnected'+(was ? ' · Pilot '+was : ''), 2.2);
    if(typeof syncPadUi==='function') syncPadUi();
  });
  ['mousemove','mousedown','keydown','touchstart'].forEach(ev=>window.addEventListener(ev, ()=>{
    if(performance.now() - lastUse > 400) document.body.classList.remove('padmode');
  }, { passive:true }));

  return {
    read, menuFrame, assign, endFrame, captureFrame,
    slots, list, get, slotIndex, localPilots,
    capture(action, done){ capture = { action, done, allowCancel:true }; },
    cancelCapture(){ capture = null; },
    get capturing(){ return !!capture; },
    rumbleSlot(slot, s, d){ const i = slotIndex(slot); if(i!==null) rumbleIdx(i, s, d); },
    name(i){ const g = get(i); if(!g) return ''; return (g.id||'Controller').replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim().slice(0,32) || 'Controller'; },
  };
})();
// rumble helpers used by the client fx
function rumblePads(s, d){ for(const [id, slot] of Pad.localPilots()) Pad.rumbleSlot(slot, s, d); }
function rumbleFor(id, s, d){ for(const [pid, slot] of Pad.localPilots()) if(pid===id) Pad.rumbleSlot(slot, s, d); }
function rumbleNear(x, y, R){
  for(const [id, slot] of Pad.localPilots()){
    const b = id===1 ? p1 : p2; if(!b || !b.alive) continue;
    const d = dist(x, y, b.x, b.y);
    if(d < R*2.6) Pad.rumbleSlot(slot, clamp(1 - d/(R*2.6), 0.15, 1)*0.9, 0.18 + R/400);
  }
}
