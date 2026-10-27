// =====================================================================
//  LOCAL GAME (same Wi-Fi / hotspot)
//  1. both devices tap Local Game and check in with the game server, which
//     pairs devices that share a network (same public address)
//  2. they open a direct WebRTC data channel over the local network and
//     the server steps out — gameplay never leaves your Wi-Fi
//  3. the first device hosts: it runs the real simulation (zero lag for
//     the host) and streams snapshots + events to the guest in exactly the
//     format the online server uses, so the guest reuses all of Net
// =====================================================================
const Lan = (function(){
  const ICE = [{ urls:'stun:stun.l.google.com:19302' }, { urls:'stun:stun.cloudflare.com:3478' }];
  let sock = null, pc = null, dc = null, role = null, peerName = '', phase = 'off';
  let wakeUntil = 0, retryTimer = null, connectTimer = null, pendingCands = [], myCode = '';
  let HS = null;                     // host-side match state
  let rtt = 0, pingT = 0;
  let guestTr = null;

  // ------------------------------------------------------------ UI
  function ui(main, sub, opts){
    opts = opts || {};
    $('lanMain').textContent = main;
    $('lanStatus').textContent = sub || '';
    $('lanStatus').classList.toggle('err', !!opts.err);
    $('lanRadar').style.display = opts.radar===false ? 'none' : '';
    $('lanCodeBox').style.display = opts.code ? '' : 'none';
    $('lanRetry').style.display = opts.retry ? '' : 'none';
    $('lanHint').style.display = opts.hint===false ? 'none' : '';
  }
  function open(){
    show('startScreen', false); show('onlineScreen', false); show('lanScreen', true);
    phase = 'search'; wakeUntil = 0; myCode = '';
    $('lanCodeIn').value = '';
    ui('Looking for another player on this network…', 'Flying as '+Net.ensureName());
    signal();
  }
  function back(){
    teardown();
    phase = 'off';
    show('lanScreen', false); show('startScreen', true);
  }
  function lost(why){
    teardown();
    phase = 'off';
    show('startScreen', false); show('lanScreen', true);
    ui(why || 'The other device disconnected.', '', { err:true, radar:false, retry:true, hint:false });
  }

  // ------------------------------------------------------------ discovery (via the game server)
  function signal(){
    clearTimeout(retryTimer);
    const url = Net.serverUrl();
    if(!url){ ui('Local games need the game server for a few seconds to find each other.', 'No server is set up for this page yet — see Online Duel → Advanced.', { err:true, radar:false, hint:false }); return; }
    let s;
    try{ s = new WebSocket(url); }catch(e){ ui('Couldn\'t reach the game server.', '', { err:true, radar:false, retry:true }); return; }
    sock = s;
    s.onopen = ()=>{ s.send(JSON.stringify({ t:'hello', v:NET_PROTO, name:Net.ensureName(), netKey: window.__lanTestKey })); };
    s.onmessage = ev=>{ let m; try{ m = JSON.parse(ev.data); }catch(e){ return; } onSignal(m); };
    s.onclose = ()=>{
      if(sock!==s) return;
      sock = null;
      if(phase==='search'){
        if(!wakeUntil) wakeUntil = performance.now() + 90000;
        if(performance.now() < wakeUntil){
          ui('Waking up the game server…', 'Free hosting naps when nobody\'s flying — this can take up to a minute.');
          retryTimer = setTimeout(()=>{ if(phase==='search') signal(); }, 2500);
        } else ui('Couldn\'t reach the game server.', 'Local games need internet for a few seconds to pair up. Check your connection.', { err:true, radar:false, retry:true });
      }
    };
  }
  function sigSend(m){ if(sock && sock.readyState===1) sock.send(JSON.stringify(m)); }
  function onSignal(m){
    switch(m.t){
      case 'welcome': wakeUntil = 0; sigSend({ t:'lanFind' }); return;
      case 'lanWaiting':
        myCode = m.code; $('lanMyCode').textContent = m.code;
        ui('Looking for another player on this network…', 'Flying as '+Net.ensureName(), { code:true });
        return;
      case 'lanNoCode': $('lanStatus').textContent = 'No device is waiting with that code.'; $('lanStatus').classList.add('err'); return;
      case 'lanPair':
        role = m.role; peerName = m.peer || 'Pilot'; phase = 'linking';
        ui('Found '+peerName+'!', 'Connecting directly over your network…', { hint:false });
        startRTC();
        return;
      case 'lanGone':
        if(phase==='linking'){ closeRTC(); phase = 'search'; ui('Looking for another player on this network…', peerName+' went away — still looking.', { code:true }); sigSend({ t:'lanFind' }); }
        return;
      case 'sig': onRTCSignal(m.d); return;
      case 'error': ui(m.msg, '', { err:true, radar:false, retry:true }); return;
    }
  }

  // ------------------------------------------------------------ direct link (WebRTC)
  async function startRTC(){
    closeRTC();
    pendingCands = [];
    try{ pc = new RTCPeerConnection({ iceServers:ICE }); }
    catch(e){ ui('This browser can\'t make direct connections.', 'Try Online Duel instead.', { err:true, radar:false, hint:false }); return; }
    const myPc = pc;
    pc.onicecandidate = e=>{ if(e.candidate && pc===myPc) sigSend({ t:'sig', d:{ c:e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = ()=>{
      if(pc!==myPc) return;
      if(pc.connectionState==='failed') linkFailed();
    };
    clearTimeout(connectTimer);
    connectTimer = setTimeout(()=>{ if(phase==='linking') linkFailed(); }, 15000);
    if(role==='host'){
      wireDC(pc.createDataChannel('emberwind', { ordered:true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sigSend({ t:'sig', d:{ sdp:pc.localDescription } });
    } else {
      pc.ondatachannel = e=>wireDC(e.channel);
    }
  }
  async function onRTCSignal(d){
    if(!pc || !d) return;
    try{
      if(d.sdp){
        await pc.setRemoteDescription(d.sdp);
        if(d.sdp.type==='offer'){
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          sigSend({ t:'sig', d:{ sdp:pc.localDescription } });
        }
        for(const c of pendingCands.splice(0)) await pc.addIceCandidate(c).catch(()=>{});
      } else if(d.c){
        if(pc.remoteDescription) await pc.addIceCandidate(d.c).catch(()=>{});
        else pendingCands.push(d.c);
      }
    }catch(e){ console.warn('rtc', e); }
  }
  function linkFailed(){
    closeRTC();
    phase = 'off';
    ui('Couldn\'t connect the two devices directly.', 'Some networks (guest/office Wi-Fi) block devices from talking to each other. A phone hotspot or home Wi-Fi usually works — or use Online Duel.', { err:true, radar:false, retry:true, hint:false });
    if(sock){ try{ sock.close(); }catch(e){} sock = null; }
  }
  function wireDC(ch){
    dc = ch;
    let opened = false;
    const early = [];                    // messages that beat the guest's hand-over to Net
    const onOpen = ()=>{
      if(opened) return; opened = true;
      clearTimeout(connectTimer);
      phase = 'linked';
      if(sock){ const s = sock; sock = null; try{ s.close(); }catch(e){} }    // the server's job is done
      if(role==='host') hostStart();
      else {
        ui('Connected to '+peerName+'!', 'Starting…', { radar:false, hint:false });
        guestTr = {
          get readyState(){ return ch.readyState==='open' ? 1 : 3; },
          send: s=>{ try{ ch.send(s); }catch(e){} },
          close: ()=>teardown(),
          onmessage:null, onclose:null,
        };
        Net.useTransport(guestTr);
        for(const m of early.splice(0)) guestTr.onmessage(m);
      }
    };
    ch.onopen = onOpen;
    ch.onmessage = ev=>{
      let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
      if(role==='host') hostHandle(m);
      else if(guestTr && guestTr.onmessage) guestTr.onmessage(m);
      else early.push(m);
    };
    if(ch.readyState==='open') setTimeout(onOpen, 0);
    ch.onclose = ()=>{
      if(dc!==ch) return;
      if(role==='host') hostPeerLost();
      else if(guestTr && guestTr.onclose) guestTr.onclose();
    };
  }
  function closeRTC(){
    clearTimeout(connectTimer);
    const d = dc, p = pc;
    dc = null; pc = null;
    try{ if(d) d.close(); }catch(e){}
    try{ if(p) p.close(); }catch(e){}
  }
  function teardown(){
    clearTimeout(retryTimer);
    if(sock){ const s = sock; sock = null; try{ s.close(); }catch(e){} }
    closeRTC();
    guestTr = null;
  }
  function dcSend(m){ if(dc && dc.readyState==='open'){ try{ dc.send(JSON.stringify(m)); }catch(e){} } }

  // ------------------------------------------------------------ host: runs the match
  const myName = ()=>Net.ensureName();
  function hostStart(){
    show('lanScreen', false);
    mode = 'lanhost'; started = true; paused = false;
    brains = { 1:null, 2:null };
    forcedRatio = NET_W/H;
    if(W !== NET_W) applyAspect(true);
    matchLen = 3; scores = [0,0]; roundNo = 1; matchOver = false;
    configureWorld(true); buildLamps(); newMatchWorld();
    HS = { tick:0, state:'countdown', timer:0, acc:0, inputs:[], held:null, ack:0, lastIn:0, rematch:[false,false], pending:[], tearsSent:{1:-1,2:-1}, names:[myName(), peerName], lastCount:-1, over:false };
    $('pauseHint').style.display = 'block';
    $('netPing').style.display = 'block';
    $('restartBtn').style.display = ''; $('btnEndMenu').textContent = 'Leave Match';
    beginRound();
    if(Touch.enabled()) enterFullscreen();
  }
  function beginRound(){
    newRound();
    lightnings=[]; particles=[]; blasts=[]; flares=[]; ripples=[]; floatTexts=[];
    shakeMag=0; shakeTime=0; shakeOX=0; shakeOY=0; flashAlpha=0;
    HS.state = 'countdown'; HS.timer = 3; HS.inputs = []; HS.held = null; HS.ack = 0; HS.pending = []; HS.tearsSent = {1:-1,2:-1}; HS.lastCount = -1;
    for(const id of ['endScreen','pauseScreen','controlsScreen']) show(id, false);
    clearKeys();
    dcSend({ t:'start', seat:2, W:NET_W, names:HS.names, matchLen, round:roundNo, scores:[scores[0],scores[1]], tick:HS.tick, cd:3, code:'LAN', token:'' });
    sendSnap(true);
    showBanner((matchLen>1 ? 'ROUND '+roundNo+' · ' : '')+'YOU ARE TEAL · left', 1.6);
    qualityProbe.reset();
  }
  function sendSnap(force){
    const dirty = [];
    for(const b of [p1,p2]) if(force || b.tearsV!==HS.tearsSent[b.id]){ dirty.push(b.id); HS.tearsSent[b.id] = b.tearsV; }
    dcSend(encodeSnapshot(HS.tick, [0, HS.ack], HS.pending.splice(0), dirty.length ? dirty : null));
  }
  function localInput(){
    if(paused) return {};
    const a = readHumanInput(1, p1), b = readHumanInput(2, p1);
    const o = {};
    for(const k of IN_BITS) o[k] = !!(a[k] || b[k]);
    o.steerX = a.steerX || b.steerX || 0;
    o.boostX = a.boost ? a.boostX : (b.boost ? b.boostX : 0);
    o.boostY = a.boost ? a.boostY : (b.boost ? b.boostY : 0);
    return o;
  }
  function popGuest(){
    const q = HS.inputs;
    while(q.length > 10){ const d = q.shift(); q[0][1] |= (d[1] & IN_EDGE_MASK); }
    if(q.length){
      const e = q.shift();
      HS.ack = e[0]; HS.held = [e[0], e[1] & ~IN_EDGE_MASK, e[2], e[3], e[4], e[5]]; HS.lastIn = performance.now();
      return decInput(e);
    }
    if(HS.held && performance.now() - HS.lastIn < 250) return decInput(HS.held);
    return null;
  }
  function hostHandle(m){
    if(!HS) return;
    switch(m.t){
      case 'in':
        if(HS.state!=='playing' || !Array.isArray(m.d)) return;
        for(const e of m.d.slice(0,24)){
          if(!validInput(e)) continue;
          if(e[0] <= (HS.inputs.length ? HS.inputs[HS.inputs.length-1][0] : HS.ack)) continue;
          HS.inputs.push(e);
        }
        if(HS.inputs.length > 60) HS.inputs.splice(0, HS.inputs.length-60);
        return;
      case 'ping': dcSend({ t:'pong', c:m.c, k:HS.tick }); return;
      case 'pong': rtt = performance.now() - m.c; return;
      case 'rematch':
        if(HS.state!=='matchEnd' || HS.over) return;
        HS.rematch[1] = true;
        dcSend({ t:'rematchWait', who:2, both:HS.rematch[0] && HS.rematch[1] });
        if(HS.rematch[0]) restartMatch();
        else $('restartBtn').textContent = 'Opponent wants a rematch — Accept';
        return;
      case 'leave': guestLeft(peerName+' left the match.'); return;
    }
  }
  function restartMatch(){ HS.rematch = [false,false]; scores = [0,0]; roundNo = 1; matchOver = false; newMatchWorld(); $('restartBtn').textContent = 'Rematch'; beginRound(); }
  function guestLeft(why){
    if(!HS || HS.over) return;
    const wasOver = HS.state==='matchEnd';
    HS.over = true; HS.state = 'matchEnd';
    if(!wasOver){ scores[0] = Math.ceil(matchLen/2); matchOver = true; winnerId = 1; showEnd(); $('endTitle').textContent = 'YOU WIN — BY FORFEIT'; }
    $('endSub').textContent = why;
    $('restartBtn').style.display = 'none';
    $('btnEndMenu').textContent = 'Main Menu';
    show('endScreen', true);
  }
  function hostPeerLost(){ if(mode==='lanhost') guestLeft(peerName+'\'s device disconnected.'); }
  function hostFrame(dt){
    if(!HS) return;
    pingT -= dt;
    if(pingT<=0){ pingT = 2; dcSend({ t:'ping', c:performance.now() }); }
    const pe = $('netPing'); if(pe){ const ms = Math.round(rtt); pe.textContent = (ms ? ms+' ms' : '— ms')+' · local'; pe.className = ms < 90 ? 'good' : ms < 180 ? 'ok' : 'bad'; }
    HS.acc += dt;
    let n = 0;
    while(HS.acc >= STEP && n < 30){
      HS.acc -= STEP; n++;
      HS.tick++;
      if(HS.state==='countdown'){
        simTime += STEP; windTime += STEP; updateWeather(STEP); updateBandOffsets(STEP);
        HS.inputs.length = 0;
        HS.timer -= STEP;
        const left = Math.ceil(HS.timer);
        if(left>0 && left!==HS.lastCount){ HS.lastCount = left; showBanner(String(left), 0.9); Sfx.ping(); }
        if(HS.timer<=0){ HS.state = 'playing'; dcSend({ t:'go', tick:HS.tick }); showBanner('FLY!', 1.2); Sfx.chime(); }
      } else {
        const playing = HS.state==='playing' && !gameOver;
        const in1 = playing ? localInput() : null;
        const in2 = playing ? popGuest() : null;
        if(in2 && in2.weapon && p2.alive) p2.weapon = in2.weapon;
        fxTap = [];
        simStep(STEP, in1, in2);
        for(const ev of fxTap) HS.pending.push([HS.tick, ...ev]);
        fxTap = null;
        if(HS.state==='playing' && gameOver && endTimer<=0) roundOver();
        else if(HS.state==='roundEnd'){ HS.timer -= STEP; if(HS.timer<=0){ roundNo++; beginRound(); } }
      }
      stepVisuals(STEP);
      if(HS.tick % NET_SNAP_EVERY === 0) sendSnap(false);
    }
    if(n >= 30) HS.acc = 0;
  }
  function roundOver(){
    HS.state = matchOver ? 'matchEnd' : 'roundEnd';
    HS.timer = 4;
    dcSend({ t:'roundEnd', winner:winnerId||0, scores:[scores[0],scores[1]], matchOver, round:roundNo, roundTime, stats:[p1.stats, p2.stats], next: matchOver ? 0 : 4 });
    showEnd();
    $('btnEndMenu').textContent = 'Leave Match';
    if(matchOver){ $('restartBtn').style.display = ''; $('restartBtn').textContent = 'Rematch'; }
    else { $('restartBtn').style.display = 'none'; $('endSub').textContent += ' · Next round in 4s'; }
  }

  // ------------------------------------------------------------ wiring & public
  function wire(){
    $('lanBack').addEventListener('click', back);
    $('lanRetry').addEventListener('click', open);
    const pair = ()=>{
      const c = $('lanCodeIn').value.replace(/\D/g,'');
      if(c.length!==4){ $('lanStatus').textContent = 'Pair codes are 4 digits.'; return; }
      if(c===myCode){ $('lanStatus').textContent = 'That\'s this device\'s code — enter the one on the other device.'; return; }
      sigSend({ t:'lanCode', code:c });
    };
    $('lanPairBtn').addEventListener('click', pair);
    $('lanCodeIn').addEventListener('keydown', e=>{ if(e.key==='Enter') pair(); });
  }
  return {
    wire, open, lost, hostFrame,
    nameOf(id){ return HS ? HS.names[id-1] : 'Pilot '+id; },
    get rtt(){ return rtt; },
    rematch(){
      if(!HS || HS.state!=='matchEnd' || HS.over) return;
      HS.rematch[0] = true;
      dcSend({ t:'rematchWait', who:1, both:HS.rematch[0] && HS.rematch[1] });
      if(HS.rematch[1]) restartMatch(); else $('restartBtn').textContent = 'Waiting for opponent…';
    },
    leave(){
      if(HS && !HS.over) dcSend({ t:'oppLeft', grace:0, final:true });
      HS = null;
      $('netPing').style.display = 'none';
      setTimeout(teardown, 200);
      phase = 'off';
    },
    debug(){ return { phase, role, peer:peerName, dc: dc && dc.readyState, ice: pc && pc.iceConnectionState, host: HS && { state:HS.state, tick:HS.tick, ack:HS.ack, q:HS.inputs.length } }; },
  };
})();
// helpers shared by the HUD and menus for any networked match (online or local)
function netMode(){ return mode==='online' || mode==='lanhost'; }
function netSeat(){ return mode==='lanhost' ? 1 : Net.seat; }
function netNameOf(id){ return mode==='lanhost' ? Lan.nameOf(id) : Net.nameOf(id); }
