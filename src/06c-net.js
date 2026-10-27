// =====================================================================
//  ONLINE PLAY — client
//  • your balloon is predicted locally from your inputs and reconciled
//    against the server (replaying unacknowledged inputs, then smoothing
//    any correction)
//  • everything else is interpolated ~100 ms in the past between 30 Hz
//    server snapshots, and server events (explosions, hits, sounds) are
//    replayed exactly when they happened on that timeline
//  • your Repeater tracers and muzzle flash appear instantly; the
//    server's copies of them are hidden
// =====================================================================
const Net = (function(){
  let ws = null, connState = 'idle', welcomeOk = false, waking = false;
  let seat = 0, names = ['Pilot','Pilot'], roomCode = null;
  let phase = 'off';                 // off | lobby | countdown | playing | roundEnd | matchEnd | paused
  let lanMode = false;               // guest of a local (same-network) game: messages arrive over WebRTC
  let wantClose = false, reconnectUntil = 0, reconnectTimer = null, onReady = null, lobbyRetryUntil = 0, botSeat = 0;
  let snaps = [], latest = null, clockBase = null, jitter = 0;
  let evQueue = [], tearsCache = {1:[],2:[]};
  let seq = 0, hist = [], outbox = [], acc = 0, simAcc = 0;
  let pred = null, predReady = false, offX = 0, offY = 0, needRecon = false;
  let localWeapon = 'rep', ghostCd = 0, ghosts = [], ghostId = 0;
  let selfObj = null, oppObj = null, selfServer = null;
  let rtt = 0, pingT = 0, countdownEnd = 0, lastCountShown = -1;
  let noticeTimer = 0, oppGraceEnd = 0, lastDisplay = null, roundEndMsg = null, forfeitShown = false;
  const TOKEN_KEY = 'emberwind.net.token';
  // a persistent, private pilot identity: the key never leaves this browser except to prove it's you
  function identity(){
    const ls = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} } };
    let pid = ls.get('loonfire.pid'), pkey = ls.get('loonfire.pkey');
    const rnd = n => { const a = new Uint8Array(n); (window.crypto||{getRandomValues:x=>{ for(let i=0;i<x.length;i++) x[i]=Math.random()*256|0; return x; }}).getRandomValues(a); return Array.from(a, b=>b.toString(16).padStart(2,'0')).join(''); };
    if(!pid || !pkey){ pid = 'p'+rnd(12); pkey = rnd(24); ls.set('loonfire.pid', pid); ls.set('loonfire.pkey', pkey); }
    return { pid, pkey, reset(){ ls.set('loonfire.pid', ''); ls.set('loonfire.pkey', ''); } };
  }
  let profile = null, foundTimer = null, waitStart = 0, waitTick = null, storeKind = '';
  const BI_DEADROT = B_KEYS.indexOf('deadRot'), BI_BURNHEAT = B_KEYS.indexOf('burnerHeat');
  const ss = { get(k){ try{ return sessionStorage.getItem(k); }catch(e){ return null; } },
               set(k,v){ try{ v===null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k,v); }catch(e){} } };

  // ------------------------------------------------------------ connection
  // the build can bake in the game server (EMBERWIND_SERVER=… ./build.sh), so a page on
  // GitHub Pages (or anywhere) connects with zero setup
  const BAKED = '__EMBERWIND_SERVER__';
  function bakedServer(){ return BAKED.indexOf('__')===0 ? '' : normUrl(BAKED); }
  function defaultServer(){
    const b = bakedServer();
    if(b) return b;
    if((location.protocol==='http:' || location.protocol==='https:') && !/\.github\.io$/i.test(location.hostname))
      return (location.protocol==='https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return '';
  }
  function httpBase(wsUrl){ try{ const u = new URL(wsUrl); u.protocol = u.protocol==='wss:' ? 'https:' : 'http:'; u.pathname = ''; u.search = ''; return u.toString().replace(/\/$/,''); }catch(e){ return ''; } }
  // free hosts nap when idle: knock as soon as the page loads so it's awake by the time you tap Online
  function wake(cb){
    const base = httpBase(serverUrl());
    if(!base || location.protocol==='file:' && !/^https?:/.test(base)) return;
    try{ fetch(base+'/healthz', { mode:'cors', cache:'no-store' }).then(r=>r.json()).then(j=>{ if(cb) cb(j); }).catch(()=>{}); }catch(e){}
  }
  function normUrl(u){
    u = String(u||'').trim();
    if(!u) return '';
    if(/^https?:\/\//i.test(u)) u = u.replace(/^http/i, 'ws');
    if(!/^wss?:\/\//i.test(u)) u = (location.protocol==='https:' ? 'wss://' : 'ws://') + u;
    try{ const x = new URL(u); if(x.pathname==='/' || x.pathname==='') x.pathname = '/ws'; return x.toString(); }catch(e){ return ''; }
  }
  function serverUrl(){ return normUrl(settings.netServer) || defaultServer(); }
  function sendMsg(m){ if(ws && ws.readyState===1) ws.send(JSON.stringify(m)); }
  function connect(then){
    if(then!==undefined) onReady = then || null;
    if(ws && ws.readyState===1 && welcomeOk){ const f = onReady; onReady = null; if(f) f(); return; }
    if(ws && (ws.readyState===0 || (ws.readyState===1 && !welcomeOk))) return;     // already on its way: onReady fires on welcome
    const url = serverUrl();
    if(!url){ lobbyStatus('Enter the address of a Loonfire server below to play online.', true); openServerBox(); return; }
    connState = 'connecting'; welcomeOk = false;
    lobbyStatus('Connecting to '+url.replace(/^wss?:\/\//,'').replace(/\/ws$/,'')+'…');
    let sock;
    try{ sock = new WebSocket(url); }catch(e){ lobbyStatus('That server address isn\'t valid.', true); openServerBox(); return; }
    ws = sock; wantClose = false;
    sock.onopen = ()=>{ connState = 'open'; const id = identity(); sendMsg({ t:'hello', v:NET_PROTO, name:settings.netName||'', token: ss.get(TOKEN_KEY) || undefined, pid:id.pid, pkey:id.pkey }); };
    sock.onmessage = ev=>{ let m; try{ m = JSON.parse(ev.data); }catch(e){ return; } handle(m); };
    sock.onerror = ()=>{};
    sock.onclose = ()=>{
      if(ws!==sock) return;
      ws = null; welcomeOk = false; connState = 'closed';
      if(!wantClose && inMatch()){
        if(!reconnectUntil) reconnectUntil = performance.now() + 20000;
        notice('Connection lost — reconnecting…', 0);
        if(performance.now() < reconnectUntil){ clearTimeout(reconnectTimer); reconnectTimer = setTimeout(()=>connect(), 1500); }
        else { notice('', 0); matchLost('Lost connection to the server.'); }
      } else if(!wantClose && phase==='lobby'){
        // probably a free host waking up: keep knocking for a minute and a half
        if(!lobbyRetryUntil) lobbyRetryUntil = performance.now() + 90000;
        if(performance.now() < lobbyRetryUntil){
          waking = true; setLobbyBusy('Waking up the game server…');
          $('netQueueInfo').textContent = 'Free hosting naps when nobody\'s flying — this can take up to a minute.';
          clearTimeout(reconnectTimer); reconnectTimer = setTimeout(()=>{ if(phase==='lobby') connect(); }, 2500);
        } else {
          lobbyRetryUntil = 0; waking = false;
          lobbyStatus('Couldn\'t reach the game server. Check your connection and try again.', true); setLobbyBusy(null);
        }
      }
    };
  }
  function inMatch(){ return ['countdown','playing','roundEnd','matchEnd','paused'].includes(phase); }
  function disconnect(){
    wantClose = true; clearTimeout(reconnectTimer); reconnectUntil = 0;
    if(ws){ try{ ws.close(); }catch(e){} }
    ws = null; welcomeOk = false;
  }

  // ------------------------------------------------------------ messages
  function handle(m){
    switch(m.t){
      case 'welcome':
        welcomeOk = true; lobbyRetryUntil = 0; const wasWaking = waking; waking = false;
        if(reconnectUntil && !m.resumed){ reconnectUntil = 0; notice('',0); ss.set(TOKEN_KEY, null); matchLost('The match ended while you were away.'); return; }
        reconnectUntil = 0;
        if(!m.resumed){ ss.set(TOKEN_KEY, null); if(phase==='lobby'){ if(wasWaking) setLobbyBusy(null); lobbyStatus('Connected. Pick how you want to fly.'); } const f = onReady; onReady = null; if(f) f(); }
        return;
      case 'queued': onQueued(m); return;
      case 'profile': profile = m.p; storeKind = m.store || ''; renderProfile(); return;
      case 'identity': if(m.reset){ identity().reset(); profile = null; renderProfile(); } return;
      case 'found': onFound(m); return;
      case 'accepted':
        if(m.who!==seatGuess){ setText($('netFoundNote'), m.both ? 'Both ready — launching…' : 'Your opponent is ready'); }
        return;
      case 'requeued': clearFound(); showSearch(); lobbyStatus('Your opponent didn\'t accept — you\'re back at the front of the queue.'); return;
      case 'rating': onRating(m); return;
      case 'room': roomCode = m.code; setLobbyBusy('Waiting for your opponent to join…', m.code); return;
      case 'cancelled':
        clearFound(); setLobbyBusy(null);
        lobbyStatus(m.reason==='timeout' ? 'The match wasn\'t accepted in time.' : m.reason==='declined' ? 'Match declined.' : m.reason==='left' ? 'Your opponent left.' : 'Cancelled.');
        return;
      case 'error':
        if(inMatch()) showBanner(m.msg, 3); else { lobbyStatus(m.msg, true); setLobbyBusy(null); }
        if(m.fatal) disconnect();
        return;
      case 'start': clearFound(); stopWaitClock(); enterMatch(m); return;
      case 'go': phase = 'playing'; hist = []; showBanner('FLY!', 1.2); Sfx.chime(); return;
      case 's': onSnapshot(m); return;
      case 'roundEnd': onRoundEnd(m); return;
      case 'matchEnd': onMatchEnd(m); return;
      case 'rematchWait':
        if(!m.both) $('restartBtn').textContent = m.who===seat ? 'Waiting for opponent…' : 'Opponent wants a rematch — Accept';
        return;
      case 'oppLeft':
        if(m.final){ oppGraceEnd = 0; notice('', 0); if(phase!=='matchEnd') matchLost(names[2-seat]+' left the match.'); else { $('restartBtn').style.display = 'none'; if(!forfeitShown) $('endSub').textContent += ' · '+names[2-seat]+' left.'; } }
        else { oppGraceEnd = performance.now() + m.grace*1000; phase = phase==='matchEnd' ? phase : 'paused'; }
        return;
      case 'oppBack': oppGraceEnd = 0; notice(names[2-seat]+' is back!', 2); if(phase==='paused') phase = 'playing'; return;
      case 'pong': rtt = performance.now() - m.c; return;
      case 'ping': sendMsg({ t:'pong', c:m.c }); return;
      case 'left': return;
    }
  }
  function enterMatch(m){
    seat = m.seat; names = m.names; roomCode = m.code; botSeat = m.bot || 0;
    if(m.token) ss.set(TOKEN_KEY, m.token);
    reconnectUntil = 0; notice('', 0);
    const fresh = !m.resumed || mode!=='online' || !started;
    mode = 'online'; started = true; paused = false; matchLen = m.matchLen; scores = m.scores.slice(); roundNo = m.round;
    brains = { 1:null, 2:null };
    configureWorld(true);
    forcedRatio = m.W/H;
    if(W !== m.W) applyAspect(true);
    newRound();
    selfObj = seat===1 ? p1 : p2; oppObj = seat===1 ? p2 : p1;
    selfServer = new Balloon(seat, 0, 1);
    pred = new Balloon(seat, selfObj.x, selfObj.facing); predReady = false;
    snaps = []; latest = null; clockBase = null; evQueue = []; tearsCache = {1:[],2:[]};
    seq = 0; hist = []; outbox = []; acc = 0; ghosts = []; offX = offY = 0; lastDisplay = null;
    localWeapon = 'rep'; roundEndMsg = null; forfeitShown = false;
    if(fresh || !m.resumed){
      lightnings=[]; particles=[]; blasts=[]; flares=[]; ripples=[]; floatTexts=[];
      shakeMag=0; shakeTime=0; shakeOX=0; shakeOY=0; flashAlpha=0;
    }
    clearKeys();
    for(const id of ['startScreen','onlineScreen','lanScreen','endScreen','pauseScreen','controlsScreen']) show(id, false);
    $('pauseHint').style.display = 'block';
    $('netPing').style.display = 'block';
    if(m.resumed){
      phase = m.state==='countdown' ? 'countdown' : m.state==='paused' ? 'paused' : m.state || 'playing';
      showBanner('Reconnected', 1.6);
    } else {
      phase = 'countdown';
      countdownEnd = performance.now() + m.cd*1000; lastCountShown = -1;
      const side = seat===1 ? 'TEAL · left' : 'EMBER · right';
      showBanner((matchLen>1 ? 'ROUND '+roundNo+' · ' : '')+(botSeat && roundNo===1 ? 'NO ONE ONLINE — SPARRING A WIND PILOT · ' : '')+'YOU ARE '+side, 2.4);
    }
    qualityProbe.reset();
    if(Touch.enabled()) enterFullscreen();
  }
  function onSnapshot(s){
    s.recv = performance.now();
    const sample = s.k - s.recv*NET_TICK/1000;
    if(clockBase===null || Math.abs(sample-clockBase) > 60) clockBase = sample;
    else {
      const d = sample - clockBase;
      jitter += (Math.abs(d) - jitter)*0.05;
      clockBase += d*(d > 0 ? 0.2 : 0.03);        // early arrivals pull the clock forward quickly
    }
    if(s.tr) for(const id in s.tr) tearsCache[id] = decTears(s.tr[id]);
    if(s.e) for(const e of s.e) evQueue.push(e);
    snaps.push(s);
    if(snaps.length > 45) snaps.splice(0, snaps.length-45);
    latest = s; needRecon = true;
  }
  function onRoundEnd(m){
    roundEndMsg = m;
    phase = m.matchOver ? 'matchEnd' : 'roundEnd';
    scores = m.scores.slice(); matchOver = m.matchOver; winnerId = m.winner || null; roundNo = m.round; roundTime = m.roundTime;
    p1.stats = m.stats[0]; p2.stats = m.stats[1];
    showEnd();
    $('btnEndMenu').textContent = 'Leave Match';
    if(m.matchOver){ $('restartBtn').style.display = ''; $('restartBtn').textContent = 'Rematch'; }
    else { $('restartBtn').style.display = 'none'; $('endSub').textContent += ' · Next round in '+m.next+'s'; }
  }
  function onMatchEnd(m){
    phase = 'matchEnd';
    if(m.reason==='forfeit'){
      scores = m.scores.slice(); matchOver = true; winnerId = m.winner;
      if(m.stats){ p1.stats = m.stats[0]; p2.stats = m.stats[1]; }
      showEnd();
      $('endTitle').textContent = m.winner===seat ? 'YOU WIN — BY FORFEIT' : 'MATCH FORFEITED';
      $('endSub').textContent = m.winner===seat ? names[2-seat]+(m.how==='left' ? ' left the match.' : ' didn\'t come back in time.') : 'You left the match.';
      forfeitShown = true;
      $('restartBtn').style.display = 'none';
      $('btnEndMenu').textContent = 'Main Menu';
      ss.set(TOKEN_KEY, null);
    }
  }
  function matchLost(why){
    if(lanMode){ phase = 'off'; lanMode = false; returnToMenu(); Lan.lost(why); return; }
    phase = 'off'; ss.set(TOKEN_KEY, null);
    returnToMenu();
    openLobby();
    lobbyStatus(why, true);
  }

  // ------------------------------------------------------------ per frame
  function readLocal(){
    if(paused) return {};
    const proxy = { weapon: localWeapon };
    const a = readHumanInput(1, proxy), b = readHumanInput(2, proxy);
    localWeapon = proxy.weapon;
    const o = {};
    for(const k of IN_BITS) o[k] = !!(a[k] || b[k]);
    o.steerX = a.steerX || b.steerX || 0;
    o.boostX = a.boost ? a.boostX : (b.boost ? b.boostX : 0);
    o.boostY = a.boost ? a.boostY : (b.boost ? b.boostY : 0);
    return o;
  }
  function serverTickNow(){ return performance.now()*NET_TICK/1000 + clockBase; }
  function interpTicks(){ return lanMode ? clamp(6 + jitter*2.5, 6, 24) : clamp(10 + jitter*2.5, 10, 30); }
  function localShot(inp){
    // cosmetic: show your Repeater tracer the moment you fire
    ghostCd = Math.max(0, ghostCd - STEP);
    if(!inp.fire || localWeapon!=='rep' || ghostCd>0 || pred.overheated || pred.patching || !pred.alive || !selfObj) return;
    ghostCd = TUNE.rep.interval;
    const m = muzzlePos(selfObj);
    const ang = (selfObj.facing>0 ? 0 : Math.PI) + rand(-TUNE.rep.spread, TUNE.rep.spread);
    ghosts.push({ id:'g'+(++ghostId), owner:seat, x:m.x, y:m.y, vx:Math.cos(ang)*TUNE.rep.speed + selfObj.vx*0.25, vy:Math.sin(ang)*TUNE.rep.speed, life:TUNE.rep.life, col:PALETTES[seat].tracer });
    FX_IMPL.shot(seat);
  }
  function predictStep(e, opp){
    PREDICT = true; fxSink = FX_MUTE;
    try{ pred.update(STEP, decInput(e), opp); } finally { PREDICT = false; fxSink = null; }
  }
  function reconcile(){
    const s = latest, i = seat-1;
    const bx = pred.x, by = pred.y;
    decBalloon(s.b[i], pred);
    pred.tears = tearsCache[seat] || [];
    pred.weapon = localWeapon;
    const ack = s.a[i];
    while(hist.length && hist[0][0] <= ack) hist.shift();
    const live = phase==='playing' && pred.alive && !s.w[8];
    if(live){ const opp = { x: s.b[1-i][0] }; for(const e of hist) predictStep(e, opp); }
    if(predReady && live){
      offX += bx - pred.x; offY += by - pred.y;
      if(Math.hypot(offX, offY) > 140){ offX = 0; offY = 0; }
    }
    predReady = true;
  }
  function lerpAng(a, b, t){ return a + normAngle(b-a)*t; }
  function applyInterpolated(rt){
    let s0 = null, s1 = null;
    for(let i=0;i<snaps.length;i++){ if(snaps[i].k <= rt) s0 = snaps[i]; else { s1 = snaps[i]; break; } }
    if(!s0){ s0 = snaps[0]; s1 = null; }
    const t = s1 ? clamp((rt - s0.k)/(s1.k - s0.k), 0, 1) : 0;
    const A = s0, B = s1 || s0;
    // world
    windTime = lerp(A.w[0], B.w[0], t);
    weatherIntensity = lerp(A.w[1], B.w[1], t);
    weatherState = WSTATES[B.w[2]] || 'calm';
    for(let k=0;k<4;k++) bandOffsets[k] = lerp(A.w[3+k], B.w[3+k], t);
    decWorld(A, B, t);
    roundTime = B.w[7]; gameOver = !!latest.w[8]; winnerId = latest.w[9] || null; endTimer = latest.w[10];
    // balloons
    for(let i=0;i<2;i++){
      const id = i+1, obj = id===seat ? selfServer : (id===1 ? p1 : p2);
      decBalloon(B.b[i], obj);
      for(const k of [0,1,2,3]){ const key = B_KEYS[k]; obj[key] = lerp(A.b[i][k], B.b[i][k], t); }
      obj.deadRot = lerpAng(A.b[i][BI_DEADROT], B.b[i][BI_DEADROT], t);
      obj.burnerHeat = lerp(A.b[i][BI_BURNHEAT], B.b[i][BI_BURNHEAT], t);
      obj.tears = tearsCache[id] || [];
    }
    // your balloon: predicted while flying, otherwise the server's view
    const predicting = phase==='playing' && pred && pred.alive && predReady && !gameOver;
    const stats = selfObj.stats;
    if(predicting){
      Object.assign(selfObj, pred);
      selfObj.x = pred.x + offX; selfObj.y = pred.y + offY;
    } else {
      Object.assign(selfObj, selfServer);
      if(lastDisplay){ const jx = lastDisplay.x - selfObj.x, jy = lastDisplay.y - selfObj.y; if(Math.hypot(jx,jy) < 140 && (Math.abs(offX)+Math.abs(offY))===0 && lastDisplay.pred){ offX = jx; offY = jy; } }
      selfObj.x += offX; selfObj.y += offY;
    }
    selfObj.stats = stats; selfObj.pal = PALETTES[seat]; selfObj.id = seat;
    lastDisplay = { x:selfObj.x, y:selfObj.y, pred:predicting };
    // pull your own fresh ordnance onto your gun, easing to the true path
    const dX = selfObj.x - selfServer.x, dY = selfObj.y - selfServer.y;
    const pull = age => clamp(1 - age/0.45, 0, 1);
    const pair = (key, build)=>{
      const out = [], prev = new Map();
      for(const e of A[key]) prev.set(e[0], e);
      for(const e1 of B[key]){ const e0 = prev.get(e1[0]); out.push(build(e0 || e1, e1)); }
      return out;
    };
    const L = (a, b, i)=> lerp(a[i], b[i], t);
    const mine = (o, age)=>{ if(o.owner===seat){ const w = pull(age); o.x += dX*w; o.y += dY*w; } return o; };
    projectiles = pair('pr', (a,b)=>({ id:b[0], owner:b[1], x:L(a,b,2), y:L(a,b,3), vx:b[4], vy:b[5], col:PALETTES[b[1]].tracer }))
      .filter(p=>p.owner!==seat).concat(ghosts);
    rockets = pair('rk', (a,b)=>mine({ id:b[0], owner:b[1], x:L(a,b,2), y:L(a,b,3), ang:lerpAng(a[4], b[4], t), lit:!!b[5], vx:b[6], vy:b[7] }, b[8]));
    mortars = pair('mo', (a,b)=>mine({ id:b[0], owner:b[1], x:L(a,b,2), y:L(a,b,3), vx:b[4], vy:b[5] }, b[6]));
    bombs = pair('bo', (a,b)=>mine({ id:b[0], owner:b[1], x:L(a,b,2), y:L(a,b,3), rot:b[4] }, b[5]));
    harpoons = pair('hp', (a,b)=>({ id:b[0], owner:b[1], src:balloonById(b[1]), dir:b[2], len:L(a,b,3), state:HSTATES[b[4]]||'fly', target:b[5] ? balloonById(b[5]) : null }));
    shockwaves = pair('sw', (a,b)=>{
      const o = { id:b[0], owner:b[1], src:balloonById(b[1]), x:L(a,b,2), y:L(a,b,3), t:b[4], delay:b[5], triggered:!!b[6], radius:L(a,b,7) };
      if(!o.triggered){ o.x = o.src.x; o.y = o.src.y; }
      return o;
    });
  }
  function playEvents(rt){
    let n = 0;
    while(evQueue.length && evQueue[0][0] <= rt && n < 200){
      const e = evQueue.shift(); n++;
      if(e[1]==='shot' && e[2]===seat) continue;          // already shown locally
      const h = FX_IMPL[e[1]];
      if(h) h(e[2], e[3], e[4], e[5], e[6], e[7], e[8]);
    }
    if(evQueue.length > 600) evQueue.splice(0, evQueue.length-600);
  }
  function updateGhosts(dt){
    for(let i=ghosts.length-1;i>=0;i--){
      const g = ghosts[i];
      g.x += g.vx*dt; g.y += g.vy*dt; g.life -= dt;
      const hit = oppObj && oppObj.alive && hitTest(oppObj, g.x, g.y, 3);
      if(hit || g.life<=0 || g.x<-20 || g.x>W+20 || g.y>FLOOR_Y+20) ghosts.splice(i,1);
    }
  }
  function frame(dt){
    // ping / clock
    pingT -= dt;
    if(pingT<=0){ pingT = 2; sendMsg({ t:'ping', c:performance.now() }); }
    updateNetHud();
    if(!latest || clockBase===null){ stepVisuals(dt); return; }
    if(phase==='countdown'){
      const left = Math.ceil((countdownEnd - performance.now())/1000);
      if(left>0 && left!==lastCountShown && left<=3){ lastCountShown = left; showBanner(String(left), 0.9); Sfx.ping(); }
    }
    if(needRecon){ reconcile(); needRecon = false; }
    // inputs & prediction at the simulation rate
    acc += dt;
    let n = 0;
    const live = phase==='playing' && predReady && pred.alive && !gameOver;
    const opp = { x: oppObj ? oppObj.x : W/2 };
    while(acc >= STEP && n < 30){
      acc -= STEP; n++;
      simTime += STEP;
      if(!live) continue;
      const inp = readLocal();
      const e = encInput(++seq, inp, localWeapon);
      hist.push(e); outbox.push(e);
      predictStep(e, opp);
      localShot(inp);
    }
    if(n >= 30) acc = 0;
    while(outbox.length){ sendMsg({ t:'in', d:outbox.splice(0, 20) }); }
    if(hist.length > 720) hist.splice(0, hist.length-720);
    // smooth away prediction corrections
    const k = Math.exp(-dt*9);
    offX *= k; offY *= k;
    if(Math.abs(offX) < 0.05) offX = 0;
    if(Math.abs(offY) < 0.05) offY = 0;
    const rt = serverTickNow() - interpTicks();
    applyInterpolated(rt);
    playEvents(rt);
    updateGhosts(dt);
    stepVisuals(dt);
  }

  // ------------------------------------------------------------ HUD bits
  function notice(text, secs){
    const el = $('netNotice'); if(!el) return;
    el.textContent = text; el.style.display = text ? 'block' : 'none';
    noticeTimer = secs || 0;
  }
  function updateNetHud(){
    const el = $('netPing');
    if(el){
      const ms = Math.round(rtt);
      el.textContent = ms ? ms+' ms' : '— ms';
      el.className = ms < 90 ? 'good' : ms < 180 ? 'ok' : 'bad';
    }
    if(oppGraceEnd){
      const left = Math.max(0, Math.ceil((oppGraceEnd - performance.now())/1000));
      notice(names[2-seat]+' lost connection — waiting '+left+'s', 0);
    }
    if(noticeTimer>0){ noticeTimer -= 1/60; if(noticeTimer<=0) notice('', 0); }
  }

  // ------------------------------------------------------------ lobby UI
  function lobbyStatus(text, isErr){ const el = $('netStatus'); if(el){ el.textContent = text; el.classList.toggle('err', !!isErr); } }
  function openServerBox(){ const d = $('netServerBox'); if(d) d.open = true; }
  // lobby views: idle (find a match) · wait (searching / connecting) · found (accept?) · room (private code)
  let seatGuess = 0;
  function view(v){
    $('netChoose').style.display = v==='idle' ? 'block' : 'none';
    $('netWait').style.display = v==='wait' ? 'block' : 'none';
    $('netFound').style.display = v==='found' ? 'block' : 'none';
    $('netRoomBox').style.display = v==='room' ? 'block' : 'none';
  }
  function setLobbyBusy(text, code){
    if(code){ view('room'); $('netRoomCode').textContent = code; $('netLink').value = roomLink(code); return; }
    if(!text){ view('idle'); stopWaitClock(); syncIdle(); return; }
    view('wait');
    $('netWaitText').textContent = text;
    $('netSteps').innerHTML = ''; $('netQueueInfo').textContent = '';
    $('netBotNow').style.display = 'none';
  }
  const STEP_TXT = {
    ranked:[['0–10 s','Rating ±100'],['10–25 s','Rating ±250'],['25–45 s','Rating ±500'],['45 s +','Any rating · casual opponents too']],
    casual:[['now','Anyone looking for a casual duel'],['45 s +','Ranked pilots who have waited too']],
  };
  function fmtT(s){ s = Math.max(0, Math.floor(s)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
  function startWaitClock(){ if(waitTick) return; waitStart = performance.now(); waitTick = setInterval(()=>{ setText($('netElapsed'), fmtT((performance.now()-waitStart)/1000)); }, 250); }
  function stopWaitClock(){ if(waitTick){ clearInterval(waitTick); waitTick = null; } }
  function showSearch(){ view('wait'); startWaitClock(); }
  function onQueued(m){
    showSearch();
    if(typeof m.waited==='number') waitStart = performance.now() - m.waited*1000;
    const ranked = !!m.ranked, steps = ranked ? STEP_TXT.ranked : STEP_TXT.casual;
    const cur = ranked ? m.stage : (m.waited >= 45 ? 1 : 0);
    $('netWaitText').textContent = ranked ? ['Finding a fair opponent…','Widening the search…','Widening further…','Taking the best pilot available…'][cur] || 'Searching…' : 'Finding an opponent…';
    $('netSteps').innerHTML = steps.map(([w,t],i)=>`<div class="ol-step ${i<cur?'done':i===cur?'cur':''}"><i>${i<cur?'✓':i===cur?'•':''}</i><em>${w}</em><span>${t}</span></div>`).join('');
    const others = Math.max(0, m.online-1);
    let info = others ? others+' other pilot'+(others===1?'':'s')+' online · '+Math.max(0,m.searching-1)+' searching' : 'You\'re the only pilot online right now';
    if(!ranked && settings.ranked!==false && !profile) info += ' · ratings unavailable — flying casual';
    if(m.botIn > 0) info += ' · a Wind Pilot will be offered in '+m.botIn+'s';
    $('netQueueInfo').textContent = info;
    $('netBotNow').style.display = m.botOffer ? '' : 'none';
    setOnline(m.online);
  }
  function onFound(m){
    stopWaitClock(); view('found'); seatGuess = m.seat || 0;
    const opp = m.opp || {}, op = opp.profile, me = m.me || profile;
    setText($('netFoundMe'), settings.netName || 'You'); setText($('netFoundOpp'), opp.name || 'Pilot');
    setText($('netFoundMeR'), me ? (m.ranked ? me.rating+' · '+me.tier : 'Casual') : 'Casual');
    setText($('netFoundOppR'), op ? (m.ranked ? op.rating+' · '+op.tier : 'Casual') : 'Casual');
    setText($('netFoundNote'), (m.ranked ? 'Ranked' : 'Casual')+' · best of 3'+(m.ranked && me && op ? ' · '+(Math.abs(me.rating-op.rating) < 120 ? 'fair match' : me.rating > op.rating ? 'you\'re favoured' : 'you\'re the underdog') : ''));
    let left = m.timeout || 10;
    const arc = $('netCountArc');
    const tick = ()=>{ setText($('netCount'), String(Math.max(0,left))); arc.style.strokeDashoffset = String(327*(1 - left/(m.timeout||10))); };
    tick(); clearFound(true);
    foundTimer = setInterval(()=>{ left--; tick(); if(left<=0) clearFound(); }, 1000);
    Sfx.chime(); rumblePads(0.5, 0.25);
    try{ if(document.hidden && 'Notification' in window && Notification.permission==='granted') new Notification('Loonfire — opponent found', { body:'Accept within '+(m.timeout||10)+' seconds' }); }catch(e){}
    $('netAccept').disabled = false; setText($('netAccept'), 'Accept');
    setTimeout(()=>{ if(document.body.classList.contains('padmode')) $('netAccept').focus(); }, 0);
  }
  function clearFound(keepView){ if(foundTimer){ clearInterval(foundTimer); foundTimer = null; } }
  function onRating(m){
    profile = m.profile; renderProfile();
    const el = $('endRating');
    if(el){ el.style.display = 'block'; el.className = 'rating-line '+(m.delta>0 ? 'up' : m.delta<0 ? 'down' : ''); el.textContent = 'Rating '+m.before+' → '+m.after+' ('+(m.delta>0?'+':'')+m.delta+') · '+m.profile.tier; }
  }
  function setOnline(n){ const c = $('netOnlineChip'); if(c && n) c.querySelector('span').textContent = n+' pilot'+(n===1?'':'s')+' online'+(storeKind ? ' · ratings '+(storeKind==='postgres' ? 'saved' : 'on this server') : ''); }
  function renderProfile(){
    const p = profile;
    setText($('netRating'), p ? String(p.rating) : '—');
    setText($('netTier'), p ? p.tier + (p.provisional ? ' · placement' : '') : 'Unranked');
    const bar = $('netTierBar');
    if(p && p.next){ bar.style.width = clamp((p.rating - p.floor)/(p.next - p.floor)*100, 3, 100)+'%'; setText($('netTierNote'), (p.next - p.rating)+' to the next rank'); }
    else { bar.style.width = p ? '100%' : '0%'; setText($('netTierNote'), p ? 'Top rank' : 'Play ranked matches to earn a rating.'); }
    setText($('netWL'), p ? p.wins+' W · '+p.losses+' L' : '0 W · 0 L');
    setText($('netStreak'), p && p.streak ? (p.streak>0 ? 'Win streak '+p.streak : 'Lost '+(-p.streak)) : '');
    const rec = $('netRecent');
    if(p && p.recent && p.recent.length) rec.innerHTML = p.recent.map(r=>`<div class="m"><span>vs ${escHtml(r.opp)}</span><span class="${r.r==='W'?'w':r.r==='L'?'l':'d'}">${r.r==='W'?'Won':r.r==='L'?'Lost':'Drew'} ${escHtml(r.s)} · ${r.d>0?'+':''}${r.d}</span></div>`).join('');
    else rec.innerHTML = '<div class="ol-sub" style="text-align:left">No ranked matches yet.</div>';
  }
  function syncIdle(){
    const ranked = settings.ranked!==false;
    document.querySelectorAll('#netQueueSeg button').forEach(b=>b.setAttribute('aria-pressed', (b.dataset.q==='ranked')===ranked ? 'true' : 'false'));
    setText($('netIdleNote'), ranked ? 'Ranked: matched by skill rating and ping, and your rating moves. Real pilots first; a Wind Pilot is only ever offered.' : 'Casual: the fastest match available, no rating change.');
  }
  function roomLink(code){
    const base = (location.protocol==='file:' ? '' : location.origin + location.pathname);
    let q = '?room='+code;
    if(settings.netServer && normUrl(settings.netServer)!==defaultServer()) q += '&server='+encodeURIComponent(settings.netServer);
    return (base || 'loonfire') + q;
  }
  const CALLSIGNS = ['Ember','Gale','Cinder','Zephyr','Comet','Drift','Falcon','Kite','Lantern','Nimbus','Squall','Vesper','Wisp','Thistle','Sparrow','Halo'];
  function ensureName(){
    if(!settings.netName){ settings.netName = CALLSIGNS[(Math.random()*CALLSIGNS.length)|0]+' '+(10+((Math.random()*90)|0)); saveSettings(); }
    return settings.netName;
  }
  function quickMatch(){
    saveForm();
    setLobbyBusy('Finding you an opponent…');
    startWaitClock();
    connect(()=>sendMsg({ t:'quick', name:settings.netName, ranked: settings.ranked!==false, botAfter: settings.botAfter===undefined ? 60 : settings.botAfter }));
  }
  function joinRoom(code){
    saveForm();
    setLobbyBusy('Joining room '+code+'…');
    $('netQueueInfo').textContent = '';
    $('netBotNow').style.display = 'none';
    connect(()=>sendMsg({ t:'join', code, name:settings.netName }));
  }
  function openLobby(inviteCode){
    phase = 'lobby'; lobbyRetryUntil = 0;
    show('startScreen', false); show('onlineScreen', true);
    $('netName').value = ensureName();
    $('netServer').value = settings.netServer || '';
    $('netServerHint').textContent = defaultServer() ? 'Leave blank to use the built-in game server.' : 'Enter your Loonfire server\'s address (e.g. wss://loonfire.onrender.com).';
    buildNetLenRow(); syncIdle(); renderProfile();
    wake(j=>{ if(j && j.clients) { storeKind = j.store || storeKind; setOnline(j.clients); } });
    lobbyStatus('Flying as '+settings.netName+' · tap your name to change it');
    if(!serverUrl()){ setLobbyBusy(null); openServerBox(); lobbyStatus('Add a game server address below to play online.', true); return; }
    // straight in: an invite joins its room, otherwise matchmaking starts (a dropped match resumes either way)
    if(typeof inviteCode==='string' && inviteCode) joinRoom(inviteCode);
    else { setLobbyBusy(null); connect(()=>{}); }
  }
  function closeLobby(){
    clearFound(); stopWaitClock();
    if(phase==='lobby'){ sendMsg({ t:'cancel' }); disconnect(); phase = 'off'; }
    show('onlineScreen', false); show('startScreen', true);
  }
  function buildNetLenRow(){
    const row = $('netLenRow'); row.innerHTML = '';
    [[1,'Single'],[3,'Best of 3'],[5,'Best of 5']].forEach(([n,l])=>{
      const b = document.createElement('button');
      b.setAttribute('aria-pressed', (settings.netLen||3)===n ? 'true' : 'false');
      b.textContent = l;
      b.addEventListener('click', ()=>{ settings.netLen = n; saveSettings(); buildNetLenRow(); });
      row.appendChild(b);
    });
  }
  function saveForm(){
    settings.netName = $('netName').value.trim().slice(0,16) || settings.netName;
    settings.netServer = $('netServer').value.trim();
    saveSettings();
  }
  function wire(){
    $('netBack').addEventListener('click', closeLobby);
    $('netQuick').addEventListener('click', quickMatch);
    $('netBotNow').addEventListener('click', ()=>{ sendMsg({ t:'botNow' }); $('netWaitText').textContent = 'Calling in a Wind Pilot…'; });
    $('netCancelQ').addEventListener('click', ()=>{ sendMsg({ t:'cancel' }); setLobbyBusy(null); lobbyStatus('Search cancelled.'); });
    $('netAccept').addEventListener('click', ()=>{ sendMsg({ t:'accept' }); $('netAccept').disabled = true; setText($('netAccept'), 'Waiting…'); setText($('netFoundNote'), 'Waiting for your opponent to accept…'); });
    $('netDecline').addEventListener('click', ()=>{ sendMsg({ t:'decline' }); clearFound(); setLobbyBusy(null); lobbyStatus('Match declined.'); });
    document.querySelectorAll('#netQueueSeg button').forEach(b=>b.addEventListener('click', ()=>{
      settings.ranked = b.dataset.q==='ranked'; saveSettings(); syncIdle();
      if($('netWait').style.display==='block'){ sendMsg({ t:'cancel' }); quickMatch(); }
    }));
    $('netFriend').addEventListener('click', ()=>{ sendMsg({ t:'cancel' }); setLobbyBusy(null); lobbyStatus('Create a room and send the code, or enter a friend\'s code.'); });
    $('netName').addEventListener('change', ()=>{ saveForm(); sendMsg({ t:'name', name:settings.netName }); lobbyStatus('Flying as '+(settings.netName||ensureName())); });
    wake();
    $('netCreate').addEventListener('click', ()=>{ saveForm(); connect(()=>sendMsg({ t:'create', len:settings.netLen||3, name:settings.netName })); });
    const join = ()=>{
      const code = $('netCode').value.toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(code.length!==5){ lobbyStatus('Room codes are 5 letters or numbers.', true); return; }
      joinRoom(code);
    };
    $('netJoin').addEventListener('click', join);
    $('netCode').addEventListener('keydown', e=>{ if(e.key==='Enter') join(); });
    $('netCancel').addEventListener('click', ()=>{ sendMsg({ t:'cancel' }); setLobbyBusy(null); lobbyStatus('Room closed.'); });
    $('netCopy').addEventListener('click', async ()=>{
      const link = $('netLink').value;
      try{
        if(navigator.share && Touch.enabled()){ await navigator.share({ title:'Loonfire duel', text:'Duel me in Loonfire — room '+roomCode, url:link }); return; }
        await navigator.clipboard.writeText(link); $('netCopy').textContent = 'Copied!';
      }catch(e){ $('netLink').select(); document.execCommand && document.execCommand('copy'); $('netCopy').textContent = 'Copied!'; }
      setTimeout(()=>{ $('netCopy').textContent = 'Copy invite link'; }, 1600);
    });
    // invite links: ?room=CODE (&server=…)
    const qs = new URLSearchParams(location.search);
    if(qs.get('server')){ settings.netServer = qs.get('server'); saveSettings(); }
    const code = (qs.get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(code.length===5){ $('netCode').value = code; openLobby(code); }
  }

  // ------------------------------------------------------------ public
  return {
    wire, frame, openLobby,
    get phase(){ return phase; }, get seat(){ return seat; },
    isOnline(){ return mode==='online' && started; },
    nameOf(id){ return names[id-1] || ('Pilot '+id); },
    isBot(id){ return mode==='online' && botSeat===id; },
    rematch(){ sendMsg({ t:'rematch' }); $('restartBtn').textContent = 'Waiting for opponent…'; },
    leave(){
      if(inMatch()) sendMsg({ t:'leave' });
      ss.set(TOKEN_KEY, null);
      phase = 'off'; oppGraceEnd = 0; notice('', 0);
      $('netPing').style.display = 'none';
      setTimeout(()=>{ disconnect(); lanMode = false; }, 150);
    },
    _send: m=>sendMsg(m),
    serverUrl, ensureName,
    get lan(){ return lanMode; },
    // play a local game whose host talks to us over a direct link (see Lan)
    useTransport(tr){
      disconnect();
      lanMode = true; wantClose = false; ws = tr; welcomeOk = true; phase = 'lobby';
      tr.onmessage = m=>{ if(ws===tr) handle(m); };
      tr.onclose = ()=>{ if(ws!==tr) return; ws = null; if(!wantClose && inMatch()) matchLost('The other device disconnected.'); };
    },
    debug(){ return { phase, seat, rtt, hist:hist.length, snaps:snaps.length, offX, offY, interp:interpTicks(), clockBase, ghosts:ghosts.length, ev:evQueue.length,
      self: selfObj && { x:selfObj.x, y:selfObj.y }, server: selfServer && { x:selfServer.x, y:selfServer.y }, pred: pred && { x:pred.x, y:pred.y, hp:pred.hp } }; },
  };
})();
