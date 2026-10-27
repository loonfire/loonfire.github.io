// =====================================================================
//  HUD
// =====================================================================
const wrap = $('wrap');
function show(id, on){ $(id).style.display = on ? 'flex' : 'none'; }
let bannerTimer = 0;
function showBanner(text, dur){ const el = $('banner'); el.textContent = text; el.style.opacity = 1; bannerTimer = dur||2.2; }

const hudRefs = [null,null];
function buildHud(el){
  el.innerHTML = `
    <div class="name-tag"><span class="nm"></span><span class="diff-tag" style="display:none"></span><span class="score"></span></div>
    <div class="bar-row"><span class="bar-label">HULL</span><div class="bar-track"><div class="bar-fill fill-hp"></div></div></div>
    <div class="bar-row"><span class="bar-label">FUEL</span><div class="bar-track"><div class="bar-fill fill-fuel"></div></div></div>
    <div class="bar-row"><span class="bar-label">HEAT</span><div class="bar-track"><div class="bar-fill fill-heat"></div></div></div>
    <div class="chip-row wpns"><span class="wpn-chip"></span><span class="wpn-chip"></span><span class="wpn-chip"></span></div>
    <div class="chip-row abs"><span class="ab">HOOK</span><span class="ab">SHOCK</span><span class="ab">SHIELD</span><span class="ab">BOOST</span><span class="ab"></span></div>
    <div class="pips"><span>BOMBS</span><span class="pip"></span><span class="pip"></span><span class="pip"></span></div>`;
  return {
    name: el.querySelector('.nm'), diff: el.querySelector('.diff-tag'), score: el.querySelector('.score'),
    hp: el.querySelector('.fill-hp'), fuel: el.querySelector('.fill-fuel'), heat: el.querySelector('.fill-heat'),
    wpn: Array.from(el.querySelectorAll('.wpn-chip')), ab: Array.from(el.querySelectorAll('.ab')),
    pips: Array.from(el.querySelectorAll('.pip')), cache:{}
  };
}
function setText(el,t){ if(el.textContent!==t) el.textContent=t; }
function setW(r, key, el, v){ const s = v.toFixed(1)+'%'; if(r.cache[key]!==s){ r.cache[key]=s; el.style.width = s; } }
function setP(r, key, el, v){ const q = Math.round(v*40)/40; if(r.cache[key]!==q){ r.cache[key]=q; el.style.setProperty('--p', q); } }
function isAI(id){ return mode==='spectate' || (mode==='ai' && id===2); }
function hudApply(r, b){
  const online = netMode();
  setText(r.name, online ? netNameOf(b.id).toUpperCase() : mode==='spectate' ? 'WIND PILOT '+(b.id===1?'A':'B') : (isAI(b.id) ? 'WIND PILOT' : 'PILOT '+b.id));
  const ai = isAI(b.id), you = online && b.id===netSeat(), bot = online && Net.isBot(b.id);
  r.diff.style.display = ai || you || bot ? 'inline-block' : 'none';
  if(ai) setText(r.diff, AI_DIFF[difficulty].label);
  if(you) setText(r.diff, 'YOU');
  if(bot) setText(r.diff, 'AI');
  setText(r.score, matchLen>1 ? ('★'.repeat(scores[b.id-1]) || '☆') : '');
  setW(r,'hp', r.hp, clamp(b.hp/b.maxHp*100,0,100));
  setW(r,'fuel', r.fuel, clamp(b.fuel/b.maxFuel*100,0,100));
  setW(r,'heat', r.heat, clamp(b.heat,0,100));
  r.heat.classList.toggle('hot', b.overheated);
  setText(r.wpn[0], 'REPEATER');
  setText(r.wpn[1], 'ROCKET ×'+b.rocketAmmo);
  setText(r.wpn[2], 'FLAK ×'+b.mortarAmmo);
  r.wpn.forEach((c,i)=>c.classList.toggle('sel', b.weapon===WEAPONS[i]));
  const T = TUNE;
  const abs = [
    [b.harpoonCd/T.harpoon.cd, b.harpoonCd<=0, false],
    [b.shockCd/T.shock.cd, b.shockCd<=0, false],
    [b.shieldTimer>0 ? 0 : b.shieldCd/T.shield.cd, b.shieldCd<=0, b.shieldTimer>0],
    [b.boostCd/T.boost.cd, b.boostCd<=0, b.boostT>0],
    [b.patchCharges>0 ? 0 : 1 - b.patchRegen/T.patch.regen, b.patchCharges>0 && !b.patching, b.patching],
  ];
  abs.forEach(([p,ready,active],i)=>{ setP(r,'ab'+i,r.ab[i],clamp(p,0,1)); r.ab[i].classList.toggle('ready', ready); r.ab[i].classList.toggle('active', active); });
  setText(r.ab[4], 'PATCH ×'+b.patchCharges);
  r.pips.forEach((d,i)=>d.classList.toggle('on', i<b.bombAmmo));
}
function updateHud(){ hudApply(hudRefs[0],p1); hudApply(hudRefs[1],p2); }

function buildWindGauge(){ buildWindRibbon(); }
function updateWindGauge(){ updateWindRibbon(); }
function updateAiTags(){
  for(const id of [1,2]){
    const el = $('aiTag'+id);
    const brain = brains[id];
    const b = id===1 ? p1 : p2;
    const on = settings.aiLabels && started && brain && b && b.alive && !gameOver;
    el.style.display = on ? 'block' : 'none';
    if(!on) continue;
    el.style.left = (b.x/W*100)+'%';
    el.style.top = ((b.y-62)/H*100)+'%';
    const txt = brain.label();
    if(el.dataset.t !== txt){ el.dataset.t = txt; el.innerHTML = '<b>'+brain.plan.toUpperCase()+'</b>'+txt; }
  }
}

// =====================================================================
//  ASPECT RATIO (the arena genuinely widens; never stretched)
// =====================================================================
let forcedRatio = null;           // online matches use the server's arena shape
function targetRatio(){
  if(forcedRatio) return forcedRatio;
  const m = settings.aspectMode;
  if(m==='auto') return clamp(window.innerWidth/Math.max(1,window.innerHeight), MIN_RATIO, MAX_RATIO);
  if(m==='custom') return settings.customRatio;
  return ASPECTS[m] || 1.5;
}
function layout(){
  const vw = window.innerWidth, vh = window.innerHeight;
  const ratio = W/H;
  let w = vw, h = vw/ratio;
  if(h>vh){ h = vh; w = vh*ratio; }
  wrap.style.width = Math.floor(w)+'px';
  wrap.style.height = Math.floor(h)+'px';
  wrap.style.setProperty('--s', clamp(h/800, 0.72, 1.5).toFixed(3));
  wrap.style.setProperty('--pz', clamp(h/760, 0.6, 1.15).toFixed(3));
}
function applyAspect(force){
  const newW = Math.round(H*targetRatio()/2)*2;
  if(!force && Math.abs(newW-W)<4){ layout(); syncAspectUI(); return; }
  const oldW = W;
  W = newW;
  rebuildWorld();
  if(p1 && oldW!==W) rescaleWorldX(W/oldW);
  layout();
  syncAspectUI();
}
function rescaleWorldX(f){
  for(const b of [p1,p2]) if(b) b.x = clamp(b.x*f, 40, W-40);
  for(const arr of [projectiles,rockets,mortars,bombs]) for(const e of arr) e.x *= f;
  for(const s of shockwaves) s.x *= f;
  harpoons = []; lightnings = []; particles = []; blasts = []; flares = []; ripples = [];
}
function setAspectMode(m, customValue){
  settings.aspectMode = m;
  if(m==='custom') settings.customRatio = clamp(customValue, 1.25, 2.4);
  saveSettings();
  applyAspect(false);
}
function cycleAspect(){
  const cur = ASPECT_ORDER.indexOf(settings.aspectMode);
  setAspectMode(ASPECT_ORDER[(cur+1)%ASPECT_ORDER.length]);
  showBanner('Arena '+W+'×'+H+' · '+(settings.aspectMode==='auto'?'Auto':settings.aspectMode));
}
const aspectHosts = [];
function buildAspectControl(host){
  host.innerHTML = `
    <div class="section-label">Display — Aspect Ratio</div>
    <div class="diff-row ar-row"></div>
    <div class="ar-slider"><span>Narrow</span><input type="range" min="1.25" max="2.4" step="0.01" aria-label="Custom aspect ratio"><span>Ultrawide</span></div>
    <div class="diff-desc ar-info"></div>`;
  const row = host.querySelector('.ar-row');
  ASPECT_ORDER.forEach(key=>{
    const b = document.createElement('button');
    b.className = 'diff-btn'; b.dataset.ar = key;
    b.textContent = key==='auto' ? 'Auto (fit window)' : key;
    b.addEventListener('click', ()=>setAspectMode(key));
    row.appendChild(b);
  });
  const fs = document.createElement('button');
  fs.className = 'diff-btn'; fs.textContent = '⛶ Fullscreen';
  if(!fullscreenSupported()) fs.style.display = 'none';
  fs.addEventListener('click', toggleFullscreen);
  row.appendChild(fs);
  host.querySelector('input').addEventListener('input', e=>setAspectMode('custom', parseFloat(e.target.value)));
  aspectHosts.push(host);
}
function syncAspectUI(){
  for(let i=aspectHosts.length-1;i>=0;i--) if(!aspectHosts[i].isConnected) aspectHosts.splice(i,1);
  for(const host of aspectHosts){
    host.querySelectorAll('button[data-ar]').forEach(b=>b.classList.toggle('active', b.dataset.ar===settings.aspectMode));
    const slider = host.querySelector('input');
    if(document.activeElement!==slider) slider.value = (W/H).toFixed(2);
    host.querySelector('.ar-info').textContent = 'Arena '+W+' × '+H+' · '+(W/H).toFixed(2)+':1 — a wider ratio gives you a wider sky to fight in.';
  }
}
function fullscreenSupported(){ const el = document.documentElement; return !!(el.requestFullscreen || el.webkitRequestFullscreen); }
function isFullscreen(){ return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function lockLandscape(){
  try{ if(screen.orientation && screen.orientation.lock){ const p = screen.orientation.lock('landscape'); if(p && p.catch) p.catch(()=>{}); } }catch(e){}
}
function enterFullscreen(){
  if(!fullscreenSupported() || isFullscreen()) return;
  try{
    const el = document.documentElement;
    const p = (el.requestFullscreen||el.webkitRequestFullscreen).call(el, { navigationUI:'hide' });
    if(p && p.then) p.then(lockLandscape).catch(()=>{}); else lockLandscape();
  }catch(e){}
}
function toggleFullscreen(){
  try{
    const d = document;
    if(isFullscreen()){ const p = (d.exitFullscreen||d.webkitExitFullscreen).call(d); if(p && p.catch) p.catch(()=>{}); }
    else enterFullscreen();
  }catch(e){}
}
function updateTouchNote(){
  const n = $('touchNote'); if(!n) return;
  const portrait = window.innerHeight > window.innerWidth;
  if(Touch.enabled() && portrait){ n.textContent = '↻ Turn your device sideways — Loonfire plays best in landscape.'; n.style.display = 'block'; }
  else n.style.display = 'none';
}
window.addEventListener('resize', ()=>{ if(typeof Touch!=='undefined') updateTouchNote(); });
let resizeTimer = null;
window.addEventListener('resize', ()=>{
  layout();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{ if(settings.aspectMode==='auto') applyAspect(false); }, 140);
});

// =====================================================================
//  MENUS
// =====================================================================
const CONTROL_ROWS = [
  ['Burner / Vent',['W','S'],['↑','↓']],
  ['Drift Left / Right',['A','D'],['←','→']],
  ['Fire (hold for Repeater)',['Space'],['M']],
  ['Repeater / Rocket / Flak',['1','2','3'],['J','K','L']],
  ['Afterburner Boost',['L-Shift'],['R-Shift']],
  ['Drop Bomb',['E'],['N']],
  ['Harpoon',['Q'],['B']],
  ['Vent Shockwave',['F'],['V']],
  ['Patch Kit',['R'],['C']],
  ['Aegis Shield',['G'],['H']],
];
function fillControls(){
  const html = (idx, cls, title) => `<div class="${cls}"><h3>${title}</h3>` +
    CONTROL_ROWS.map(r=>`<div class="row"><span class="lbl">${r[0]}</span>${r[idx].map(k=>`<span class="key">${k}</span>`).join('')}</div>`).join('') + `</div>`;
  document.querySelectorAll('.controls-fill').forEach(el=>{ el.innerHTML = html(1,'p1','Pilot 1 — Teal') + html(2,'p2','Pilot 2 — Ember'); });
}
let difficulty = AI_DIFF[settings.difficulty] ? settings.difficulty : 'normal';
let pendingMode = 'ai';
function buildDifficultyRow(){
  const row = $('diffRow'); row.innerHTML = '';
  Object.values(AI_DIFF).forEach(d=>{
    const btn = document.createElement('button');
    btn.textContent = d.label; btn.setAttribute('aria-pressed', d.key===difficulty ? 'true' : 'false');
    btn.addEventListener('click', ()=>{ difficulty = d.key; settings.difficulty = d.key; saveSettings(); buildDifficultyRow(); selectMode(menuMode, true); });
    row.appendChild(btn);
  });
  $('diffDesc').textContent = AI_DIFF[difficulty].desc;
}
function buildMatchRow(){
  const row = $('matchRow'); row.innerHTML = '';
  [[1,'Single round'],[3,'Best of 3'],[5,'Best of 5']].forEach(([n,label])=>{
    const b = document.createElement('button');
    b.textContent = label; b.setAttribute('aria-pressed', settings.matchLen===n ? 'true' : 'false');
    b.addEventListener('click', ()=>{ settings.matchLen = n; saveSettings(); buildMatchRow(); });
    row.appendChild(b);
  });
}
function buildQualityRows(){
  if($('settingsScreen') && $('settingsScreen').style.display==='flex' && setTab==='graphics') buildSettings(true);
}
function syncOptionToggles(){
  $('fps').style.display = settings.showFps ? 'block' : 'none';
  if($('settingsScreen') && $('settingsScreen').style.display==='flex') buildSettings(true);
}
function updateMuteFab(){ $('muteFab').textContent = Sfx.isMuted() ? '✕' : '♪'; $('muteFab').title = Sfx.isMuted() ? 'Sound off' : 'Sound on'; const m = $('btnSoundMain'); if(m) m.classList.toggle('off', Sfx.isMuted()); }
function escHtml(t){ return String(t).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fillEndStats(){
  const row = (b, cls, title) => {
    const acc = b.stats.shots ? Math.min(100, Math.round(b.stats.hits/b.stats.shots*100)) : 0;
    return `<div class="col ${cls}"><h4>${title}</h4>
      <div><span>Damage dealt</span><span>${Math.round(b.stats.dmg)}</span></div>
      <div><span>Accuracy</span><span>${acc}%</span></div>
      <div><span>Damage blocked</span><span>${Math.round(b.stats.blocked)}</span></div>
      <div><span>Kit used</span><span>${b.stats.kit}</span></div></div>`;
  };
  let n1 = mode==='spectate' ? 'Wind Pilot A' : 'Pilot 1';
  let n2 = mode==='pvp' ? 'Pilot 2' : (mode==='spectate' ? 'Wind Pilot B' : 'Wind Pilot');
  if(netMode()){ n1 = netNameOf(1)+(netSeat()===1?' (you)':''); n2 = netNameOf(2)+(netSeat()===2?' (you)':''); }
  $('endStats').innerHTML = row(p1,'p1',escHtml(n1)) + row(p2,'p2',escHtml(n2));
}
