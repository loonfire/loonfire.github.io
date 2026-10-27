// lightweight hook for automated testing (headless AI-vs-AI simulation)
window.__emberwind = {
  start(m, diff){ if(diff) difficulty = diff; startGame(m||'spectate'); },
  set(k, v){ settings[k] = v; if(k==='quality') GLR.setQuality(v); if(k==='audioEngine' && Sfx.applySettings) Sfx.applySettings(); },
  gl(){ return { ok:GLR.ok, quality:settings.quality }; },
  audio(){ return { engine:settings.audioEngine, state: Sfx.ctxState ? Sfx.ctxState() : 'n/a' }; },
  menu(m){ selectMode(m, true); menuPlay(); },
  world(){ return { moon:MOONST, wind:windL.map(l=>l.v), gust:Object.assign({},gust), fog:fogBanks.length, lamps:LAMPS.map(l=>({x:l.x,out:l.out,gas:l.gas})) }; },
  fog(n){ for(let i=0;i<n;i++) spawnFogBank(true); fogBanks.forEach(f=>f.age=6); },
  sim(seconds){ headless = true; const n = Math.round(seconds/STEP); for(let i=0;i<n;i++){ stepWorld(STEP); if(gameOver && endTimer<=0) break; } headless = false; },
  state(){ return { t:roundTime, over:gameOver, winner:winnerId, p1:{hp:p1.hp, ...p1.stats}, p2:{hp:p2.hp, ...p2.stats}, weather:weatherState, plan1: brains[1]&&brains[1].plan, plan2: brains[2]&&brains[2].plan }; },
  setWeather(s, i){ weatherState = s; weatherIntensity = i; weatherTimer = 30; },
  paused(v){ paused = v; },
  clearFx(){ lightnings=[]; particles=[]; blasts=[]; flares=[]; ripples=[]; floatTexts=[]; projectiles=[]; rockets=[]; mortars=[]; bombs=[]; harpoons=[]; shockwaves=[]; resetLamps(); LAMPS.forEach(l=>l.glow=1); },
  net(){ return Net.debug(); },
  lan(){ return Lan.debug(); },
  netSend(m){ Net._send(m); },
  phase(){ return Net.phase; },
  setWindTime(t){ windTime = t; },
  get p1(){ return p1; }, get p2(){ return p2; },
};
window.__emberwind.batch = function(n, d1, d2, maxT){
  const res = [];
  for(let i=0;i<n;i++){
    difficulty = d2; startGame('spectate');
    brains[1] = new AIBrain(p1, d1); brains[2] = new AIBrain(p2, d2);
    p1.setMaxHp(AI_DIFF[d1].hpMul); p2.setMaxHp(AI_DIFF[d2].hpMul);
    headless = true;
    const steps = Math.round((maxT||180)/STEP);
    for(let k=0;k<steps && !gameOver;k++) stepWorld(STEP);
    headless = false;
    res.push({ t:roundTime, winner:winnerId, s1:p1.stats, s2:p2.stats, hp1:p1.hp, hp2:p2.hp });
  }
  returnToMenu();
  return res;
};
window.__emberwind.trace = function(d1, d2, tries){
  for(let i=0;i<(tries||10);i++){
    difficulty = d2; startGame('spectate');
    brains[1] = new AIBrain(p1, d1); brains[2] = new AIBrain(p2, d2);
    headless = true;
    const log = [];
    for(let k=0;k<Math.round(150/STEP) && !gameOver;k++){
      stepWorld(STEP);
      if(k % 240 === 0) log.push([Math.round(roundTime), brains[1].plan, Math.round(p1.x), Math.round(p1.y), Math.round(p1.hp), Math.round(p1.fuel), Math.round(p1.heat), brains[1].label(), '|', brains[2].plan, Math.round(p2.x), Math.round(p2.y), Math.round(p2.hp), Math.round(p2.fuel), Math.round(p2.heat), brains[2].label()].join(' '));
    }
    headless = false;
    if(!gameOver){ returnToMenu(); return log; }
  }
  returnToMenu(); return ['no stalemate found'];
};
window.__emberwind.perf = function(n){
  let t2 = 0, tg = 0;
  for(let i=0;i<n;i++){ stepWorld(STEP*4); const a = performance.now(); drawWorld2D(); const b = performance.now(); if(GLR.ok) GLR.render(gatherFrame()); const c = performance.now(); t2 += b-a; tg += c-b; }
  return { draw2d: (t2/n).toFixed(2), glSubmit: (tg/n).toFixed(2), particles: particles.length };
};
