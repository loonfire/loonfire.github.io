// =====================================================================
//  MAIN MENU · SETTINGS · HUD EXTRAS (wind ribbon, alerts)
// =====================================================================
const ICON = {
  online:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  local:'<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19.2" r="1.1" fill="currentColor"/>',
  ai:'<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  pvp:'<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M3 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5M14 14.6c2.6-.6 5.4.9 6.5 4.4"/>',
  watch:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const MENU_MODES = [
  { id:'online', btn:'btnOnline', title:'Online Duel', short:'Online', hint:'Ranked by skill and ping · real pilots first', play:'Quick Play', sub:'Online · finds a fair opponent for you' },
  { id:'local',  btn:'btnLan',    title:'Local Game · Same Wi-Fi', short:'Same Wi-Fi', hint:'Two devices, one network — nothing to type', play:'Play Local Game', sub:'Looks for a player on your Wi-Fi' },
  { id:'ai',     btn:'btnAI',     title:'Fly vs. Wind Pilot', short:'vs. AI', hint:'Four pilots, from Cadet to Storm Ace', play:'Fly vs. Wind Pilot', sub:'Single player' },
  { id:'pvp',    btn:'btnPVP',    title:'Two Players · One Screen', short:'2 Players', hint:'Share a keyboard, a tablet or two controllers', play:'Start 2-Player', sub:'Same device · split controls' },
  { id:'watch',  btn:'btnSpec',   title:'Watch AI vs. AI', short:'Watch', hint:'Sit back and learn the tricks', play:'Watch a Duel', sub:'Spectate two Wind Pilots' },
];
let menuMode = MENU_MODES.some(m=>m.id===settings.menuMode) ? settings.menuMode : 'online';
function buildModeList(){
  const host = $('modeList'); host.innerHTML = '';
  for(const m of MENU_MODES){
    const b = document.createElement('button');
    b.className = 'mode'; b.id = m.btn; b.dataset.mode = m.id;
    b.innerHTML = `<span class="mi"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[m.id]}</svg></span><span class="mt"><b><span class="long">${m.title}</span><span class="short">${m.short}</span></b><small>${m.hint}</small></span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`;
    // first click selects, clicking the selected mode again starts it
    b.addEventListener('click', ()=>{ if(menuMode===m.id) menuPlay(); else selectMode(m.id); });
    b.addEventListener('dblclick', e=>{ e.preventDefault(); });
    host.appendChild(b);
  }
  selectMode(menuMode, true);
}
function selectMode(id, quiet){
  menuMode = id; settings.menuMode = id; saveSettings();
  const m = MENU_MODES.find(x=>x.id===id);
  document.querySelectorAll('#modeList .mode').forEach(b=>b.setAttribute('aria-pressed', b.dataset.mode===id ? 'true' : 'false'));
  setText($('playLabel'), m.play);
  let sub = m.sub;
  if(id==='online') sub = onlineCount!==null ? onlineCount+' pilots online · '+(settings.ranked!==false ? 'ranked' : 'casual') : m.sub;
  if(id==='ai' || id==='watch') sub = m.sub+' · '+AI_DIFF[difficulty].label;
  setText($('playSub'), sub);
  $('diffInline').classList.toggle('show', id==='ai' || id==='watch');
  if(!quiet) Sfx.click && Sfx.click();
}
let onlineCount = null;
function menuPlay(){
  Sfx.init();
  if(menuMode==='online') Net.openLobby();
  else if(menuMode==='local') Lan.open();
  else if(menuMode==='ai') startGame('ai');
  else if(menuMode==='pvp') startGame('pvp');
  else startGame('spectate');
}
// cheap lobby headcount for the Quick Play button (server /healthz, CORS-enabled)
function refreshOnlineCount(){
  try{
    const url = Net.serverUrl && Net.serverUrl();
    if(!url || typeof fetch!=='function') return;
    const http = url.replace(/^ws/, 'http').replace(/\/ws\/?$/, '') + '/healthz';
    fetch(http, { cache:'no-store' }).then(r=>r.json()).then(j=>{ onlineCount = Math.max(1, j.clients||0); if(menuMode==='online') selectMode('online', true); }).catch(()=>{});
  }catch(e){}
}

// ---- tonight's moon on the menu ----
function moonPhaseLabel(p, side){
  if(p > 0.97) return 'Full moon';
  if(p < 0.12) return 'New moon';
  if(p >= 0.4 && p <= 0.6) return side>0 ? 'First quarter' : 'Last quarter';
  return (side>0 ? 'Waxing ' : 'Waning ') + (p < 0.4 ? 'crescent' : 'gibbous');
}
function moonIconSvg(p, side){
  const r = 11, cx = 15, cy = 15, ang = (1-p)*Math.PI, rx = Math.abs(Math.cos(ang))*r;
  const lit = side>0 ? 1 : 0;
  // lit limb arc + terminator ellipse
  const gib = Math.cos(ang) > 0;
  const sweepT = side>0 ? (gib ? 1 : 0) : (gib ? 0 : 1);
  const d = `M${cx} ${cy-r}A${r} ${r} 0 0 ${lit} ${cx} ${cy+r}A${rx.toFixed(2)} ${r} 0 0 ${sweepT} ${cx} ${cy-r}Z`;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#141a30" opacity=".55"/><path d="${d}" fill="#f4f1e6"/>`;
}
function updateTonight(){
  const r = realMoonPhase();
  $('tonightIcon').innerHTML = moonIconSvg(r.phase, r.side);
  const bright = r.phase > 0.7 ? 'bright night' : r.phase < 0.3 ? 'dark night' : 'dim night';
  setText($('tonightText'), moonPhaseLabel(r.phase, r.side)+' · '+bright);
}

// ---- decorative balloons drifting behind the menu ----
let menuBalloons = null;
function menuAmbience(dt){
  if(started){ menuBalloons = null; return; }
  if(!menuBalloons){
    menuBalloons = [new Balloon(1, W*0.62, -1), new Balloon(2, W*0.84, -1)];
    menuBalloons[0].y = 300; menuBalloons[1].y = 380; menuBalloons[1].facing = -1;
    menuBalloons.forEach((b,i)=>{ b._ty = [290, 370][i]; b._ph = i*2.1; });
  }
  for(const b of menuBalloons){
    b._ph += dt*0.3;
    const ty = b._ty + Math.sin(b._ph)*26;
    const inp = { burner: b.y > ty && b.vy > -30, left: b.x > W*0.9, right: b.x < W*0.56 };
    b.fuel = 100;
    b.update(dt, inp, null);
    b.facing = -1;
  }
}

// =====================================================================
//  SETTINGS
// =====================================================================
const SET_TABS = [
  ['graphics','Graphics'], ['audio','Audio', true], ['controls','Controls', true], ['gameplay','Gameplay', true], ['online','Online'],
];
let setTab = 'graphics', setReturn = 'startScreen';
function openSettings(from, tab){
  setReturn = from || 'startScreen';
  if(tab) setTab = tab;
  show(setReturn, false);
  show('settingsScreen', true);
  buildSettings();
  const t = document.querySelector('#setTabs [aria-selected="true"]'); if(t) t.focus();
}
function closeSettings(){
  Pad.cancelCapture();
  show('settingsScreen', false);
  show(setReturn, true);
  if(setReturn==='startScreen') selectMode(menuMode, true);
}
function setRow(o){
  const row = document.createElement('div');
  row.className = 'set-row' + (o.exp ? ' exp' : '') + (o.disabled ? ' dis' : '');
  row.innerHTML = `<span class="sl"><b>${o.label}${o.exp ? '<span class="tag-exp">EXPERIMENTAL</span>' : ''}</b>${o.desc ? `<small>${o.desc}</small>` : ''}</span>`;
  if(o.control) row.appendChild(o.control);
  return row;
}
function toggleCtl(on, fn, label, disabled){
  const b = document.createElement('button'); b.className = 'tg'; b.setAttribute('role','switch'); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('aria-label', label);
  if(disabled) b.disabled = true;
  b.addEventListener('click', ()=>{ fn(b.getAttribute('aria-checked')!=='true'); buildSettings(true); });
  return b;
}
function segCtl(opts, cur, fn, label){
  const d = document.createElement('div'); d.className = 'seg'; d.setAttribute('role','group'); d.setAttribute('aria-label', label);
  for(const [v, l] of opts){
    const b = document.createElement('button'); b.textContent = l; b.setAttribute('aria-pressed', v===cur ? 'true' : 'false');
    b.addEventListener('click', ()=>{ fn(v); buildSettings(true); });
    d.appendChild(b);
  }
  return d;
}
function sliderCtl(val, fn, label, min, max, unit){
  const d = document.createElement('span'); d.style.cssText = 'display:flex;align-items:center;gap:10px';
  const r = document.createElement('input'); r.type = 'range'; r.min = min||0; r.max = max||100; r.step = 1; r.value = val; r.setAttribute('aria-label', label);
  const v = document.createElement('span'); v.className = 'val'; v.textContent = val+(unit||'%');
  r.addEventListener('input', ()=>{ v.textContent = r.value+(unit||'%'); fn(+r.value); });
  d.appendChild(r); d.appendChild(v);
  return d;
}
function infoCtl(text, color){ const s = document.createElement('span'); s.className = 'info'; s.style.color = color; s.innerHTML = '<i></i>'+escHtml(text); return s; }
function setSave(){ saveSettings(); }
function buildSettings(keepFocus){
  const focusKey = keepFocus && document.activeElement ? (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent) : null;
  const tabs = $('setTabs');
  tabs.querySelectorAll('button').forEach(b=>b.remove());
  for(const [id, label, isNew] of SET_TABS){
    const b = document.createElement('button');
    b.setAttribute('role','tab'); b.dataset.tab = id; b.setAttribute('aria-selected', id===setTab ? 'true' : 'false');
    b.innerHTML = `<i></i>${label}${isNew ? '<span class="new">NEW</span>' : ''}`;
    b.addEventListener('click', ()=>{ setTab = id; buildSettings(); });
    tabs.appendChild(b);
  }
  const rows = $('setRows'); rows.innerHTML = '';
  const add = o => rows.appendChild(setRow(o));
  const sec = t => { const d = document.createElement('div'); d.className = 'set-sec'; d.textContent = t; rows.appendChild(d); };
  const S = settings;
  if(setTab==='graphics'){
    setText($('setTitle'), 'Graphics');
    setText($('setSub'), GLR.ok ? ('WebGL2 · '+(GLR.hdr ? 'HDR' : 'LDR')+' · '+QUALITY[S.quality].label+(S.autoQuality ? ' (auto)' : '')) : 'WebGL2 unavailable — simplified 2D renderer');
    add({ label:'Quality', desc:'Auto lowers it if your device can\'t keep up', control:segCtl([['low','Low'],['medium','Medium'],['high','High'],['auto','Auto']], S.autoQuality ? 'auto' : S.quality, v=>{
      if(v==='auto'){ S.autoQuality = true; } else { S.autoQuality = false; S.quality = v; GLR.setQuality(v); }
      setSave(); }, 'Quality') });
    add({ label:'Volumetric clouds', desc:'Raymarched, lit by the moon, drifting with the wind', control:toggleCtl(S.vclouds!==false, v=>{ S.vclouds = v; setSave(); }, 'Volumetric clouds') });
    add({ label:'Fog & lamp light', desc:'Billowing fog-bank edges and light cones under the lamps', control:toggleCtl(S.vfog!==false, v=>{ S.vfog = v; setSave(); }, 'Fog detail') });
    add({ label:'Moon rays', desc:'Shafts of moonlight through gaps in the clouds', control:toggleCtl(S.rays!==false, v=>{ S.rays = v; setSave(); }, 'Moon rays') });
    add({ label:'Frame rate', desc:'Cap it to save battery on phones and laptops', control:segCtl([['30','30'],['60','60'],['max','Max']], S.fpsCap||'60', v=>{ S.fpsCap = v; setSave(); }, 'Frame rate') });
    add({ label:'Reduce motion', desc:'Calmer camera shake and fewer screen flashes', control:toggleCtl(!!S.motion, v=>{ S.motion = v; setSave(); }, 'Reduce motion') });
    add({ label:'Show frame rate', control:toggleCtl(!!S.showFps, v=>{ S.showFps = v; setSave(); syncOptionToggles(); }, 'Show frame rate') });
    const ar = document.createElement('div'); rows.appendChild(ar); buildAspectControl(ar); syncAspectUI();
  } else if(setTab==='audio'){
    setText($('setTitle'), 'Audio');
    setText($('setSub'), 'Engine: '+(S.audioEngine==='spatial' ? 'Spatial (experimental)' : 'Classic'));
    add({ label:'Sound', control:toggleCtl(!Sfx.isMuted(), v=>{ if(v===Sfx.isMuted()){ Sfx.init(); Sfx.toggleMute(); updateMuteFab(); } }, 'Sound') });
    add({ label:'Master volume', control:sliderCtl(S.vol.master, v=>{ S.vol.master = v; setSave(); Sfx.applySettings(); }, 'Master volume') });
    add({ label:'Effects', desc:'Guns, blasts, burners and kit', control:sliderCtl(S.vol.sfx, v=>{ S.vol.sfx = v; setSave(); }, 'Effects volume') });
    add({ label:'Ambience', desc:'Wind, rain and the burner hum', control:sliderCtl(S.vol.music, v=>{ S.vol.music = v; setSave(); }, 'Ambience volume') });
    add({ label:'Audio engine', exp:true, desc:'Classic is the original sound. Spatial is the new engine — switch back any time.', control:segCtl([['classic','Classic'],['spatial','Spatial']], S.audioEngine, v=>{ S.audioEngine = v; setSave(); Sfx.init(); Sfx.applySettings(); }, 'Audio engine') });
    const off = S.audioEngine!=='spatial';
    add({ label:'3D positional sound', disabled:off, desc: off ? 'Needs the Spatial engine' : 'Hear the rival left, right, above or below you (best on headphones)', control:toggleCtl(S.spatial.hrtf, v=>{ S.spatial.hrtf = v; setSave(); }, '3D positional sound', off) });
    add({ label:'Valley echo', disabled:off, desc: off ? 'Needs the Spatial engine' : 'Shots and blasts echo off the mountains', control:toggleCtl(S.spatial.reverb, v=>{ S.spatial.reverb = v; setSave(); Sfx.applySettings(); }, 'Valley echo', off) });
    add({ label:'Living wind', disabled:off, desc: off ? 'Needs the Spatial engine' : 'The wind you hear follows the real gusts at your height', control:toggleCtl(S.spatial.wind, v=>{ S.spatial.wind = v; setSave(); }, 'Living wind', off) });
  } else if(setTab==='controls'){
    setText($('setTitle'), 'Controls');
    setText($('setSub'), 'Plug in a controller any time — it just works');
    Pad.assign();
    for(const slot of [1,2]){
      const i = Pad.slots[slot];
      add({ label:'Controller '+slot, desc: i!==null ? Pad.name(i)+' · Pilot '+slot : (slot===1 ? 'Connect a controller and press any button' : 'Press any button on a second controller to join as Pilot 2'),
        control:infoCtl(i!==null ? 'Connected' : 'Waiting', i!==null ? '#6fe3a5' : '#a9b2d0') });
    }
    add({ label:'Vibration', desc:'Rumble on hits, gusts and blasts (where the browser supports it)', control:toggleCtl(S.pad.vib, v=>{ S.pad.vib = v; setSave(); if(v) rumblePads(0.6, 0.15); }, 'Vibration') });
    add({ label:'Stick dead zone', desc:'Raise it if your balloon drifts on its own', control:sliderCtl(S.pad.dead, v=>{ S.pad.dead = v; setSave(); }, 'Dead zone', 4, 40) });
    add({ label:'Invert altitude stick', desc:'Push up to vent, pull down to burn', control:toggleCtl(S.pad.invert, v=>{ S.pad.invert = v; setSave(); }, 'Invert altitude') });
    sec('Controller buttons — select one, then press the new button');
    const M = Object.assign({}, PAD_DEFAULT, S.pad.map||{});
    for(const [act, label] of PAD_ACTIONS){
      const b = document.createElement('button'); b.className = 'bind'; b.textContent = PAD_BTN_NAME[M[act]] || ('Button '+M[act]); b.setAttribute('aria-label', 'Rebind '+label);
      b.addEventListener('click', ()=>{
        b.classList.add('wait'); b.textContent = 'Press…';
        Pad.capture(act, n=>{
          b.classList.remove('wait');
          if(n===null){ buildSettings(true); return; }
          S.pad.map = Object.assign({}, S.pad.map||{}, { [act]:n }); setSave(); fillPadMap(); buildSettings(true);
        });
      });
      add({ label, control:b });
    }
    const reset = document.createElement('button'); reset.className = 'bind'; reset.textContent = 'Reset';
    reset.addEventListener('click', ()=>{ S.pad.map = null; setSave(); fillPadMap(); buildSettings(true); });
    add({ label:'Default buttons', desc:'Put every action back where it started', control:reset });
    sec('Keyboard & touch');
    add({ label:'Touch controls', control:segCtl([['auto','Auto'],['on','On'],['off','Off']], S.touch, v=>{ S.touch = v; setSave(); Touch.refreshMode(); }, 'Touch controls') });
    add({ label:'Show AI intent', desc:'Labels what each Wind Pilot is thinking (F3)', control:toggleCtl(!!S.aiLabels, v=>{ S.aiLabels = v; setSave(); }, 'Show AI intent') });
  } else if(setTab==='gameplay'){
    setText($('setTitle'), 'Gameplay');
    setText($('setSub'), 'Weather and sky for offline matches · online uses the standard set');
    add({ label:'Wind', desc:'Realistic: each altitude blows its own way, with gusts and thermals', control:segCtl([['calm','Calm'],['light','Light'],['realistic','Realistic'],['gale','Gale']], S.wind, v=>{ S.wind = v; setSave(); }, 'Wind') });
    add({ label:'Fog & visibility', desc:'Variable: fog banks roll through and hide pilots', control:segCtl([['clear','Clear'],['variable','Variable'],['dense','Dense']], S.fog, v=>{ S.fog = v; setSave(); }, 'Fog') });
    add({ label:'Moon', desc:'The phase sets how bright the whole night is', control:segCtl([['random','Random'],['tonight','Tonight'],['full','Full']], S.moon, v=>{ S.moon = v; setSave(); }, 'Moon') });
    add({ label:'Match length', control:segCtl([[1,'Single'],[3,'Best of 3'],[5,'Best of 5']], S.matchLen, v=>{ S.matchLen = v; setSave(); buildMatchRow(); }, 'Match length') });
    add({ label:'Wind ribbon on HUD', desc:'Shows the wind at each altitude, and which layer you\'re in', control:toggleCtl(S.windHud!==false, v=>{ S.windHud = v; setSave(); document.body.classList.toggle('no-windhud', !v); }, 'Wind ribbon') });
  } else {
    setText($('setTitle'), 'Online');
    setText($('setSub'), 'Callsign: '+(S.netName || Net.ensureName()));
    const nm = document.createElement('input'); nm.className = 'net-server'; nm.style.cssText = 'width:200px;margin:0'; nm.maxLength = 16; nm.value = S.netName || Net.ensureName(); nm.setAttribute('aria-label','Callsign');
    nm.addEventListener('change', ()=>{ S.netName = nm.value.trim().slice(0,16) || S.netName; setSave(); });
    add({ label:'Callsign', desc:'What other pilots see', control:nm });
    add({ label:'Ranked matchmaking', desc:'Matched by skill rating and ping, and your rating moves. Casual is faster and ignores rating.', control:toggleCtl(S.ranked!==false, v=>{ S.ranked = v; setSave(); }, 'Ranked matchmaking') });
    add({ label:'Offer a Wind Pilot after', desc:'If nobody is found, you\'re offered a clearly labelled AI match — never slipped in', control:segCtl([[30,'30 s'],[60,'60 s'],[0,'Never']], S.botAfter, v=>{ S.botAfter = v; setSave(); }, 'Bot offer') });
    add({ label:'Show ping in matches', control:toggleCtl(S.showPing!==false, v=>{ S.showPing = v; setSave(); }, 'Show ping') });
    const sv = document.createElement('input'); sv.className = 'net-server'; sv.style.cssText = 'width:300px;margin:0'; sv.placeholder = Net.serverUrl() || 'wss://loonfire.example.com'; sv.value = S.netServer || ''; sv.setAttribute('aria-label','Game server');
    sv.addEventListener('change', ()=>{ S.netServer = sv.value.trim(); setSave(); });
    add({ label:'Game server', desc:'Leave blank to use the built-in server', control:sv });
  }
  if(focusKey){
    const el = Array.from(document.querySelectorAll('#settingsScreen button, #settingsScreen input')).find(e=>(e.getAttribute('aria-label') || e.textContent)===focusKey);
    if(el) el.focus();
  }
}
function fillPadMap(){
  const el = $('padMap'); if(!el) return;
  const M = Object.assign({}, PAD_DEFAULT, (settings.pad && settings.pad.map) || {});
  const rows = [['Left stick','Steer · up burns · down vents'], ['D-pad ↑ / ↓','Burner / vent']].concat(PAD_ACTIONS.map(([a,l])=>[PAD_BTN_NAME[M[a]] || ('Button '+M[a]), l]));
  rows.push(['Right stick ← / →','Switch weapon']);
  el.innerHTML = '<div style="grid-column:1/-1;border:none"><b style="color:var(--teal);letter-spacing:.14em;font-size:11px">CONTROLLER · pad 1 → Pilot 1, pad 2 → Pilot 2</b></div>' +
    rows.map(([k,v])=>`<div><span>${escHtml(v)}</span><b>${escHtml(k)}</b></div>`).join('');
}
function syncPadUi(){
  Pad.assign();
  const i = Pad.slots[1];
  setText($('padName'), i!==null ? 'Controller 1' : 'Controller');
  if($('settingsScreen').style.display==='flex' && setTab==='controls' && !Pad.capturing) buildSettings(true);
}

// =====================================================================
//  HUD: wind ribbon (one cell per altitude layer) + alerts
// =====================================================================
const KMH = 0.25;                 // 1 px/s of drift ≈ 0.25 km/h
const ribbonCells = [];
function buildWindRibbon(){
  const host = $('windGauge'); host.innerHTML = ''; ribbonCells.length = 0;
  WIND_ALT.forEach((y, i)=>{
    const el = document.createElement('div'); el.className = 'wr-cell';
    el.style.top = (y/H*100)+'%';
    el.innerHTML = '<svg viewBox="0 0 22 14" aria-hidden="true"><path d="M2 7h17M13 2l6 5-6 5"/></svg><span class="v"></span><small></small>';
    host.appendChild(el);
    ribbonCells.push({ el, svg:el.querySelector('svg'), v:el.querySelector('.v'), s:el.querySelector('small'), dir:0 });
  });
  document.body.classList.toggle('no-windhud', settings.windHud===false);
}
function hudPilot(){
  if(!started || !p1) return null;
  if(netMode()) return netSeat()===1 ? p1 : p2;
  if(mode==='ai' || mode==='pvp') return p1;
  return null;
}
function updateWindRibbon(){
  const me = hudPilot();
  let myLayer = -1;
  if(me){ let best = 1e9; WIND_ALT.forEach((y,i)=>{ const d = Math.abs(me.y - y); if(d < best){ best = d; myLayer = i; } }); }
  ribbonCells.forEach((c, i)=>{
    const w = windAt(WIND_ALT[i]), kmh = Math.round(Math.abs(w)*KMH);
    const dir = w >= 0 ? 0 : 180;
    if(c.dir!==dir){ c.dir = dir; c.svg.style.transform = 'rotate('+dir+'deg)'; }
    setText(c.v, String(kmh));
    const gustHere = gust.ph>0 && WIND_ALT[i] >= gust.y0-30 && WIND_ALT[i] <= gust.y1+30;
    setText(c.s, i===myLayer ? 'km/h · you' : gustHere ? 'km/h · gust' : 'km/h');
    c.el.classList.toggle('you', i===myLayer);
    c.el.classList.toggle('gust', gustHere);
  });
  const wt = $('weatherTag');
  const label = { calm:'Calm skies', building:'Storm building', storm:'Thunderstorm', clearing:'Clearing' }[weatherState];
  setText(wt, label);
  wt.classList.toggle('storm', weatherState==='storm' || weatherState==='building');
  // alerts
  const gw = gustWarning();
  const gEl = $('alGust');
  if(gw >= 0 && started){ setText(gEl, 'Gust from the '+(gust.dir>0 ? 'west' : 'east')+' in '+Math.max(1, Math.ceil(gw))+' s'); gEl.classList.add('on'); }
  else if(gust.ph===2 && started){ setText(gEl, 'Gust passing '+(gust.dir>0 ? '→' : '←')); gEl.classList.add('on'); }
  else gEl.classList.remove('on');
  const hidden = me && me.alive && visibilityOf(me) < 0.4;
  $('alFog').classList.toggle('on', !!hidden);
  $('alFuel').classList.toggle('on', !!(me && me.alive && me.refuelT > 0));
}
