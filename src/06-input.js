// =====================================================================
//  INPUT (keyboard + controllers + touch)
// =====================================================================
const BIND = {
  1:{burner:'KeyW',vent:'KeyS',left:'KeyA',right:'KeyD',fire:'Space',ballast:'KeyE',harpoon:'KeyQ',shock:'KeyF',patch:'KeyR',shield:'KeyG',boost:'ShiftLeft',flare:'KeyT',w1:'Digit1',w2:'Digit2',w3:'Digit3'},
  2:{burner:'ArrowUp',vent:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',fire:'KeyM',ballast:'KeyN',harpoon:'KeyB',shock:'KeyV',patch:'KeyC',shield:'KeyH',boost:'ShiftRight',flare:'KeyU',w1:'KeyJ',w2:'KeyK',w3:'KeyL'}
};
let keys = {}, keysEdge = {};
function clearKeys(){ keys = {}; keysEdge = {}; }
function consumeEdge(code){ const v = !!keysEdge[code]; keysEdge[code]=false; return v; }

window.addEventListener('keydown', e=>{
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  if(e.code==='Escape'){
    e.preventDefault();
    if(e.repeat) return;
    if($('settingsScreen').style.display==='flex'){ if(Pad.capturing) Pad.cancelCapture(); closeSettings(); }
    else if($('controlsScreen').style.display==='flex'){ show('controlsScreen',false); show(controlsReturn,true); }
    else if($('onlineScreen').style.display==='flex'){ $('netBack').click(); }
    else if($('lanScreen').style.display==='flex'){ $('lanBack').click(); }
    else toggleMenu();
    return;
  }
  if((e.code==='Enter' || e.code==='NumpadEnter') && !started && $('startScreen').style.display==='flex'){
    const ae = document.activeElement;
    if(!ae || ae===document.body || !(ae.tagName==='BUTTON' || ae.tagName==='INPUT')){ e.preventDefault(); menuPlay(); return; }
  }
  if(e.code==='F3'){ e.preventDefault(); settings.aiLabels = !settings.aiLabels; saveSettings(); syncOptionToggles(); return; }
  if(e.repeat) return;
  if(!keys[e.code]) keysEdge[e.code] = true;
  keys[e.code] = true;
});
window.addEventListener('keyup', e=>{ keys[e.code]=false; });
function onFocusLost(){
  clearKeys();
  if(started && !gameOver && !paused && mode!=='spectate') toggleMenu();
}
window.addEventListener('blur', onFocusLost);
document.addEventListener('visibilitychange', ()=>{ if(document.hidden) onFocusLost(); });

function readHumanInput(id, b){
  const k = BIND[id];
  const pad = Pad.read(id);
  if(consumeEdge(k.w1)) b.weapon='rep';
  if(consumeEdge(k.w2)) b.weapon='rocket';
  if(consumeEdge(k.w3)) b.weapon='mortar';
  if(pad.w) b.weapon = WEAPONS[(WEAPONS.indexOf(b.weapon)+pad.w+WEAPONS.length)%WEAPONS.length];
  const fireEdge = consumeEdge(k.fire) || pad.fire;
  const fireHeld = !!keys[k.fire] || pad.fireHeld;
  const inp = {
    burner: !!keys[k.burner] || pad.burner, vent: !!keys[k.vent] || pad.vent,
    left: !!keys[k.left] || pad.left, right: !!keys[k.right] || pad.right,
    fire: fireEdge || (fireHeld && b.weapon==='rep'),
    ballast: consumeEdge(k.ballast) || pad.ballast,
    harpoon: consumeEdge(k.harpoon) || pad.harpoon,
    shock: consumeEdge(k.shock) || pad.shock,
    patch: consumeEdge(k.patch) || pad.patch,
    shield: consumeEdge(k.shield) || pad.shield,
    boost: consumeEdge(k.boost) || pad.boost,
    flare: consumeEdge(k.flare) || pad.flare
  };
  if(pad.pause && started && !gameOver) setTimeout(toggleMenu, 0);
  if(pad.steerX && !inp.steerX) inp.steerX = pad.steerX;
  inp.boostX = (inp.right?1:0) - (inp.left?1:0);
  inp.boostY = (inp.vent?1:0) - (inp.burner?1:0);
  if(pad.boost && pad.steerX) inp.boostX = Math.abs(pad.steerX) > 0.3 ? Math.sign(pad.steerX) : inp.boostX;
  const t = Touch.read(id);
  if(t){
    const e = t.edge;
    if(e.rocket){ b.weapon = 'rocket'; inp.fire = true; }
    else if(e.mortar){ b.weapon = 'mortar'; inp.fire = true; }
    else if(t.fireHeld || e.fire){ b.weapon = 'rep'; inp.fire = true; }
    if(t.steerX) inp.steerX = t.steerX;
    inp.burner = inp.burner || t.burner;
    inp.vent = inp.vent || t.vent;
    inp.ballast = inp.ballast || !!e.ballast;
    inp.harpoon = inp.harpoon || !!e.harpoon;
    inp.shock = inp.shock || !!e.shock;
    inp.patch = inp.patch || !!e.patch;
    inp.shield = inp.shield || !!e.shield;
    inp.flare = inp.flare || !!e.flare;
    if(e.boost){ inp.boost = true; inp.boostX = t.boostX; inp.boostY = t.boostY; }
  }
  return inp;
}
