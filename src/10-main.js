// =====================================================================
//  GAME FLOW
// =====================================================================
let brains = { 1:null, 2:null };
let controlsReturn = 'pauseScreen';
const glCanvas = $('gl'), fbCanvas = $('fallback');
let fbCtx = null;

function rebuildWorld(){
  resize2D();
  buildLamps(); buildGrass(); buildFireflies();
  if(GLR.ok) GLR.resize();
  else { fbCanvas.width = W; fbCanvas.height = H; }
}
function useFallback(on){
  glCanvas.style.display = on ? 'none' : 'block';
  fbCanvas.style.display = on ? 'block' : 'none';
  if(on){ fbCanvas.width = W; fbCanvas.height = H; fbCtx = fbCanvas.getContext('2d'); }
}
function resetGame(selectedMode, newMatch){
  mode = selectedMode;
  if(newMatch){ matchLen = settings.matchLen; scores = [0,0]; roundNo = 1; configureWorld(false); newMatchWorld(); }
  else roundNo++;
  newRound();
  if(mode!=='pvp' && mode!=='online') p2.setMaxHp(AI_DIFF[difficulty].hpMul);
  if(mode==='spectate') p1.setMaxHp(AI_DIFF[difficulty].hpMul);
  brains = { 1: mode==='spectate' ? new AIBrain(p1, difficulty) : null, 2: mode!=='pvp' ? new AIBrain(p2, difficulty) : null };
  lightnings=[]; particles=[]; blasts=[]; flares=[]; ripples=[]; floatTexts=[];
  paused=false;
  shakeMag=0; shakeTime=0; shakeOX=0; shakeOY=0; flashAlpha=0;
  clearKeys();
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  show('endScreen',false); show('pauseScreen',false); show('controlsScreen',false);
  $('pauseHint').style.display='block';
  const who = mode==='ai' ? 'ENGAGE! — Wind Pilot · '+AI_DIFF[difficulty].label : mode==='spectate' ? 'WIND PILOTS DUEL — '+AI_DIFF[difficulty].label : 'PILOTS, TAKE THE SKIES!';
  showBanner(matchLen>1 ? 'ROUND '+roundNo+' · '+who : who);
  qualityProbe.reset();
}
function startGame(m){
  // phones & tablets: go fullscreen + landscape when a match starts (needs the tap gesture)
  if(Touch.enabled() && !headless) enterFullscreen();
  show('startScreen',false); started = true; resetGame(m, true);
}
function returnToMenu(){
  if(mode==='lanhost'){ Lan.leave(); mode = 'online'; }
  if(mode==='online'){
    if(started || Net.phase!=='off') Net.leave();
    mode = 'ai';
    forcedRatio = null; applyAspect(true);
    $('restartBtn').style.display = ''; $('btnEndMenu').textContent = 'Main Menu';
  }
  started = false; paused = false; gameOver = false;
  Sfx.setBurner(false);
  show('pauseScreen',false); show('endScreen',false); show('controlsScreen',false);
  $('pauseHint').style.display='none';
  show('settingsScreen',false);
  show('startScreen',true);
  selectMode(menuMode, true);
  setTimeout(()=>{ const b = $('btnPlay'); if(document.body.classList.contains('padmode') && b) b.focus(); }, 0);
}
function toggleMenu(){
  if(!started || gameOver) return;
  paused = !paused;
  clearKeys();
  show('pauseScreen', paused);
  if(paused){
    Sfx.setBurner(false);
    const hull = 'Hull '+Math.round(p1.hp)+' vs '+Math.round(p2.hp);
    const series = matchLen>1 ? ' · Round '+roundNo+' ('+scores[0]+'–'+scores[1]+')' : '';
    const label = mode==='ai' ? 'Wind Pilot ('+AI_DIFF[difficulty].label+')' : mode==='spectate' ? 'Spectating '+AI_DIFF[difficulty].label+'s' : netMode() ? ((mode==='lanhost' || Net.lan) ? 'Local game vs ' : 'Online vs ')+netNameOf(3-netSeat()) : 'Local 2-Player';
    $('pauseSub').textContent = label + ' — ' + hull + series + (netMode() ? ' · the match keeps going while this menu is open' : '');
    $('btnRestart').style.display = netMode() ? 'none' : '';
    $('btnExitMenu').textContent = netMode() ? 'Leave Match (forfeit)' : 'Exit to Main Menu';
    syncAspectUI(); buildQualityRows(); syncOptionToggles();
  }
}
function fmtTime(s){ const m=Math.floor(s/60), r=Math.floor(s%60); return m+':'+String(r).padStart(2,'0'); }
function pilotName(id){ if(netMode()) return id===netSeat() ? 'YOU' : netNameOf(id).toUpperCase(); if(mode==='spectate') return 'WIND PILOT '+(id===1?'A':'B'); if(mode==='ai' && id===2) return 'THE WIND PILOT'; return 'PILOT '+id; }
function showEnd(){
  endShown = true;
  if($('endRating') && !netMode()) $('endRating').style.display = 'none';
  Sfx.setBurner(false);
  const need = Math.ceil(matchLen/2);
  const series = matchLen>1 ? ' · Score '+scores[0]+' – '+scores[1] : '';
  let title, sub;
  if(!winnerId){
    title = 'DRAW!'; sub = 'Both envelopes went down together.';
    $('restartBtn').textContent = matchOver ? 'Fly Again' : 'Replay Round';
  } else if(matchLen>1 && !matchOver){
    const you = netMode() && winnerId===netSeat();
    title = pilotName(winnerId)+(you?' TAKE':' TAKES')+' ROUND '+roundNo+'!'; sub = 'First to '+need+' wins the match.';
    $('restartBtn').textContent = 'Next Round';
  } else {
    const you = netMode() && winnerId===netSeat(), youLost = netMode() && !you;
    title = pilotName(winnerId)+(you?' WIN':' WINS')+(matchLen>1?' THE MATCH!':'!');
    const loser = pilotName(winnerId===1?2:1).toLowerCase().replace(/\b\w/g, c=>c.toUpperCase());
    sub = youLost ? 'You have been deflated.' : loser+' has been deflated.';
    $('restartBtn').textContent = 'Fly Again';
  }
  $('endTitle').textContent = title;
  $('endSub').textContent = sub+series+' · Round time '+fmtTime(roundTime);
  fillEndStats();
  $('pauseHint').style.display='none';
  show('endScreen',true);
}

// =====================================================================
//  SIMULATION STEP (fixed dt)
// =====================================================================
function stepWorld(dt){
  let in1 = null, in2 = null;
  if(started && p1 && !gameOver){
    in1 = brains[1] ? brains[1].step(dt, p2) : readHumanInput(1,p1);
    in2 = brains[2] ? brains[2].step(dt, p1) : readHumanInput(2,p2);
  }
  simStep(dt, in1, in2);
  if(started && gameOver && !endShown && endTimer<=0 && !headless) showEnd();
  stepVisuals(dt);
}

// =====================================================================
//  RENDER + MAIN LOOP
// =====================================================================
let headless = false;
function render(){
  drawWorld2D();
  if(GLR.ok){
    if(!GLR.render(gatherFrame())){ useFallback(true); compose2D(fbCtx); }
  } else {
    if(!fbCtx) useFallback(true);
    compose2D(fbCtx);
  }
}
// gently lowers graphics quality if the machine can't keep up (once per level)
const qualityProbe = {
  t:0, n:0, sum:0,
  reset(){ this.t = 0; this.n = 0; this.sum = 0; },
  sample(frameMs){
    if(!settings.autoQuality || !started || paused || !GLR.ok) return;
    this.t += frameMs/1000;
    if(this.t < 2) return;
    this.n++; this.sum += frameMs;
    if(this.t > 6){
      const avg = this.sum/this.n;
      const order = ['high','medium','low'];
      const i = order.indexOf(settings.quality);
      if(avg > 24 && i < 2){
        settings.quality = order[i+1]; saveSettings(); GLR.setQuality(settings.quality); buildQualityRows();
        showBanner('Graphics → '+QUALITY[settings.quality].label+' for a smoother flight', 2.6);
        this.reset();
      } else { this.t = -1e9; }
    }
  }
};
let lastT = performance.now(), acc = 0, fpsT = 0, fpsN = 0;
function loop(now){
  // optional frame-rate cap (battery saver)
  const cap = settings.fpsCap==='30' ? 30 : settings.fpsCap==='60' ? 61 : 0;
  if(cap && now - lastT < 1000/cap - 2 && !headless){ requestAnimationFrame(loop); return; }
  let frame = (now-lastT)/1000;
  lastT = now;
  if(frame>0.1) frame = 0.1;
  if(mode==='lanhost' && started){
    Lan.hostFrame(frame);
  } else if(mode==='online' && started){
    Net.frame(frame);
  } else if(!paused){
    acc += frame;
    let n = 0;
    while(acc>=STEP && n<30){ stepWorld(STEP); acc -= STEP; n++; }
    if(n>=30) acc = 0;
  }
  if(!started) menuAmbience(frame);
  document.body.classList.toggle('in-match', !!(started && p1));
  render();
  if(started && p1) updateHud();
  const lp = hudPilot();
  Sfx.frame(lp ? { x:lp.x, y:lp.y } : { x:W/2, y:H*0.55 }, started && p1 ? [p1,p2] : [], started && !paused && !gameOver && p1 && (p1.burnerOn || p2.burnerOn));
  Sfx.setRain(paused ? 0 : smoothstep(0.35,0.9,weatherIntensity));
  updateWindGauge();
  updateAiTags();
  Touch.update();
  Pad.captureFrame();
  if(!started || paused || gameOver || $('settingsScreen').style.display==='flex') Pad.menuFrame(frame);
  if(bannerTimer>0){ bannerTimer -= frame; if(bannerTimer<=0) $('banner').style.opacity=0; }
  qualityProbe.sample(frame*1000);
  fpsT += frame; fpsN++;
  if(fpsT>0.5){ if(settings.showFps) $('fps').textContent = Math.round(fpsN/fpsT)+' fps · '+QUALITY[settings.quality].label+(GLR.ok?'':' · 2D'); fpsT = 0; fpsN = 0; }
  requestAnimationFrame(loop);
}

// =====================================================================
//  UI WIRING & BOOT
// =====================================================================
fillControls();
buildDifficultyRow();
buildMatchRow();
hudRefs[0] = buildHud($('hudP1'));
hudRefs[1] = buildHud($('hudP2'));
buildWindGauge();
updateMuteFab();
Touch.build();
Net.wire();
Lan.wire();
updateTouchNote();
if(!fullscreenSupported()) $('fsFab').style.display = 'none';

buildModeList();
updateTonight();
fillPadMap();
refreshOnlineCount(); setInterval(()=>{ if(!started) refreshOnlineCount(); }, 30000);
$('btnPlay').addEventListener('click', menuPlay);
$('btnSettings').addEventListener('click', ()=>openSettings('startScreen'));
$('btnControlsMain').addEventListener('click', ()=>{ show('startScreen',false); show('controlsScreen',true); controlsReturn = 'startScreen'; });
$('btnSoundMain').addEventListener('click', ()=>{ Sfx.init(); Sfx.toggleMute(); updateMuteFab(); });
$('btnFsMain').addEventListener('click', toggleFullscreen);
$('btnPauseSettings').addEventListener('click', ()=>openSettings('pauseScreen'));
$('btnSettingsClose').addEventListener('click', closeSettings);
$('restartBtn').addEventListener('click', ()=>{ if(mode==='lanhost') Lan.rematch(); else if(mode==='online') Net.rematch(); else resetGame(mode, matchOver); });
$('btnEndMenu').addEventListener('click', returnToMenu);
$('btnResume').addEventListener('click', toggleMenu);
$('btnRestart').addEventListener('click', ()=>resetGame(mode, true));
$('btnExitMenu').addEventListener('click', returnToMenu);
$('btnControls').addEventListener('click', ()=>{ show('pauseScreen',false); show('controlsScreen',true); controlsReturn = 'pauseScreen'; });
$('btnControlsBack').addEventListener('click', ()=>{ show('controlsScreen',false); show(controlsReturn,true); });
$('menuFab').addEventListener('click', e=>{ e.currentTarget.blur(); if(started && !gameOver) toggleMenu(); });
// a thumb may still be on the stick: multi-touch never produces a click, so answer the touch itself
$('menuFab').addEventListener('touchstart', e=>{ e.preventDefault(); e.stopPropagation(); if(started && !gameOver) toggleMenu(); }, { passive:false });
$('arFab').addEventListener('click', e=>{ e.currentTarget.blur(); cycleAspect(); });
$('fsFab').addEventListener('click', e=>{ e.currentTarget.blur(); toggleFullscreen(); });
$('muteFab').addEventListener('click', e=>{ e.currentTarget.blur(); Sfx.init(); Sfx.toggleMute(); updateMuteFab(); });

glCanvas.addEventListener('webglcontextlost', e=>{ e.preventDefault(); GLR.lose(); useFallback(true); });
glCanvas.addEventListener('webglcontextrestored', ()=>{ if(GLR.restore()){ useFallback(false); GLR.resize(); } });

if(!GLR.init(glCanvas)) useFallback(true);
applyAspect(true);
buildQualityRows();
syncOptionToggles();
requestAnimationFrame(t=>{ lastT = t; loop(t); });

