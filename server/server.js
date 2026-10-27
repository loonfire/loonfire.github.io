// =====================================================================
//  LOONFIRE GAME SERVER
//  Authoritative online play: the server runs the real simulation for
//  every match at 120 Hz, applies each pilot's inputs, and broadcasts
//  30 Hz snapshots plus the audiovisual events that happened in between.
//
//  Also serves the game page itself (public/index.html), so one deploy
//  gives you https://your-host/ (the game) and wss://your-host/ws (play).
// =====================================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const createSim = require('./sim.js');
const { createStore, hashKey, publicProfile, eloUpdate, tierOf, START_RATING } = require('./store.js');
const store = createStore();

const PORT = +process.env.PORT || 8080;
const LAG_MS = +process.env.LAG_MS || 0;           // artificial one-way latency, for testing netcode
const MAX_ROOMS = +process.env.MAX_ROOMS || 500;
const MAX_CLIENTS = +process.env.MAX_CLIENTS || 2000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
const GRACE_S = +process.env.GRACE_S || 20;                                 // reconnect window before a forfeit
const COUNTDOWN_S = 3;
const BETWEEN_ROUNDS_S = +process.env.BETWEEN_ROUNDS_S || 4;
const BOT_AUTO_S = +(process.env.BOT_AUTO_S || process.env.BOT_AFTER_S_AUTO || 0);   // >0: start a bot match automatically after this wait (default: only offered)
const CONFIRM_S = process.env.CONFIRM_S===undefined ? 10 : +process.env.CONFIRM_S;        // both pilots accept a found match (0 = start at once)
const BOT_LEVEL = process.env.BOT_LEVEL || 'normal';

const probe = createSim();                          // constants from the shared code
const { NET_PROTO, NET_TICK, NET_SNAP_EVERY, NET_W, STEP } = probe.consts;
const decInput = probe.decInput, validInput = probe.validInput, IN_EDGE_MASK = probe.consts.IN_EDGE_MASK;

const TRUST_PROXY = process.env.TRUST_PROXY !== '0';      // Render/Fly/Railway put the real client IP in X-Forwarded-For
const log = (...a)=>{ if(process.env.QUIET!=='1') console.log(new Date().toISOString(), ...a); };

// ------------------------------------------------------------------ HTTP
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.json':'application/json' };
const server = http.createServer((req, res)=>{
  const url = new URL(req.url, 'http://x');
  if(url.pathname==='/healthz'){
    res.writeHead(200, {'content-type':'application/json', 'access-control-allow-origin':'*', 'cache-control':'no-store'});
    return res.end(JSON.stringify({ ok:true, rooms:rooms.size, clients:clients.size, queue:queue.length, store:store.kind }));
  }
  if(url.pathname==='/leaderboard'){
    store.top(20).then(list=>{
      res.writeHead(200, {'content-type':'application/json', 'access-control-allow-origin':'*', 'cache-control':'no-store'});
      res.end(JSON.stringify(list.map(p=>({ name:p.name, rating:Math.round(p.rating), tier:tierOf(p.rating).name, games:p.games, wins:p.wins }))));
    }).catch(()=>{ res.writeHead(500); res.end('[]'); });
    return;
  }
  let file = url.pathname==='/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC, file);
  if(!full.startsWith(PUBLIC)){ res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data)=>{
    if(err){ res.writeHead(404, {'content-type':'text/plain'}); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control':'no-cache' });
    res.end(data);
  });
});

// ------------------------------------------------------------------ state
const clients = new Map();        // id → client
const sessions = new Map();       // token → { room, seat }
const rooms = new Map();          // code → room
let queue = [];                   // quick-match waiting list
let nextClientId = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(){
  for(let tries=0; tries<50; tries++){
    let c = ''; for(let i=0;i<5;i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if(!rooms.has(c)) return c;
  }
  return null;
}
function cleanName(n){
  n = String(n||'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,16);
  return n || 'Pilot';
}
function send(c, msg){
  if(!c || !c.ws || c.ws.readyState!==1) return;
  const data = typeof msg==='string' ? msg : JSON.stringify(msg);
  if(LAG_MS) setTimeout(()=>{ if(c.ws.readyState===1) c.ws.send(data); }, LAG_MS);
  else c.ws.send(data);
}

// ------------------------------------------------------------------ rooms
function newRoom(opts){
  const code = makeCode();
  if(!code) return null;
  const room = {
    code, private:!!opts.private, matchLen:[1,3,5].includes(opts.len) ? opts.len : 3,
    seats:[null,null],            // client ids
    names:['Pilot','Pilot'], tokens:[null,null],
    sim:null, state:'waiting', timer:0, tick:0,
    inputs:[[],[]], held:[null,null], acks:[0,0], lastIn:[0,0],
    rematch:[false,false], disconnectedAt:[0,0], created:Date.now(), bot:0,
  };
  rooms.set(code, room);
  return room;
}
function seatClient(room, c, seat){
  room.seats[seat] = c.id; room.names[seat] = c.name;
  const token = crypto.randomBytes(16).toString('hex');
  room.tokens[seat] = token;
  sessions.set(token, { code:room.code, seat });
  c.room = room.code; c.seat = seat;
  return token;
}
function roomClients(room){ return room.seats.map(id=>id ? clients.get(id) : null); }
function broadcast(room, msg){ const data = JSON.stringify(msg); for(const c of roomClients(room)) send(c, data); }
function startMatch(room){
  room.pids = roomClients(room).map(c=>c && c.player ? c.pid : null);
  room.rated = false;
  room.sim = createSim();
  if(room.bot) room.sim.setBot(room.bot, BOT_LEVEL);
  room.sim.setup(NET_W, room.matchLen);
  room.rematch = [false,false];
  beginRound(room);
}
function beginRound(room){
  room.state = 'countdown'; room.timer = COUNTDOWN_S;
  room.inputs = [[],[]]; room.held = [null,null]; room.acks = [0,0];
  const st = room.sim.status();
  roomClients(room).forEach((c, i)=>send(c, {
    t:'start', seat:i+1, W:NET_W, names:room.names, matchLen:room.matchLen, round:st.roundNo, scores:st.scores,
    tick:room.tick, cd:COUNTDOWN_S, code:room.code, token:room.tokens[i], bot:room.bot
  }));
  sendSnapshot(room, true);
  log('round', st.roundNo, 'starts in', room.code);
}
function endMatch(room, reason, winner, how){
  room.state = 'matchEnd';
  if(reason==='forfeit') settleRatings(room, winner);
  const st = room.sim ? room.sim.status() : { scores:[0,0] };
  broadcast(room, { t:'matchEnd', reason, winner, how:how||'', scores:st.scores, stats: room.sim ? room.sim.stats() : null });
}
function destroyRoom(room, why){
  for(const t of room.tokens) if(t) sessions.delete(t);
  for(const c of roomClients(room)) if(c){ c.room = null; c.seat = 0; }
  rooms.delete(room.code);
  log('room', room.code, 'closed:', why);
}
function leaveRoom(c, why){
  const room = c.room && rooms.get(c.room);
  if(!room) return;
  const seat = c.seat;
  room.seats[seat] = null;
  const other = clients.get(room.seats[1-seat]);
  if(room.state==='confirm'){ room.seats[seat] = null; room.confirm[seat] = false; room.confirm[1-seat] = true; cancelConfirm(room, 'left'); return; }
  if(room.state==='waiting' || !room.sim){ destroyRoom(room, 'host left'); return; }
  if(room.state!=='matchEnd' && other){
    room.sim.awardForfeit(2-seat);
    endMatch(room, 'forfeit', 2-seat, 'left');
    send(other, { t:'oppLeft', grace:0, final:true });
  } else if(other) send(other, { t:'oppLeft', grace:0, final:true });
  destroyRoom(room, why||'player left');
}

// ------------------------------------------------------------------ simulation loop
let lastHr = process.hrtime.bigint(), acc = 0;
function popInput(room, seat){
  const q = room.inputs[seat];
  // a big backlog means this client got ahead: catch up, but never lose a one-shot action
  while(q.length > 10){ const d = q.shift(); q[0][1] |= (d[1] & IN_EDGE_MASK); }
  if(q.length){
    const e = q.shift();
    room.acks[seat] = e[0];
    room.held[seat] = [e[0], e[1] & ~IN_EDGE_MASK, e[2], e[3], e[4], e[5]];
    room.lastIn[seat] = Date.now();
    return decInput(e);
  }
  // nothing arrived this step: keep the held controls briefly, then let go
  if(room.held[seat] && Date.now() - room.lastIn[seat] < 250) return decInput(room.held[seat]);
  return null;
}
function sendSnapshot(room, full){
  const snap = room.sim.snapshot(room.tick, room.acks.slice(), !!full);
  broadcast(room, snap);
}
function stepRoom(room){
  room.tick++;
  const sim = room.sim;
  if(room.state==='countdown'){
    sim.idle(room.tick);
    room.inputs[0].length = 0; room.inputs[1].length = 0;
    room.timer -= STEP;
    if(room.timer<=0){ room.state = 'playing'; broadcast(room, { t:'go', tick:room.tick }); }
  } else if(room.state==='playing' || room.state==='roundEnd' || room.state==='matchEnd'){
    const playing = room.state==='playing';
    const in1 = playing && room.bot!==1 ? popInput(room, 0) : null;
    const in2 = playing && room.bot!==2 ? popInput(room, 1) : null;
    sim.step(room.tick, in1, in2);
    const st = sim.status();
    if(playing && st.gameOver && st.endTimer<=0){
      room.state = st.matchOver ? 'matchEnd' : 'roundEnd';
      room.timer = BETWEEN_ROUNDS_S;
      if(st.matchOver) settleRatings(room, st.winnerId || 0);
      broadcast(room, { t:'roundEnd', winner:st.winnerId||0, scores:st.scores, matchOver:st.matchOver, round:st.roundNo,
        roundTime:st.roundTime, stats:sim.stats(), next: st.matchOver ? 0 : BETWEEN_ROUNDS_S });
    } else if(room.state==='roundEnd'){
      room.timer -= STEP;
      if(room.timer<=0){ sim.nextRound(); beginRound(room); return; }
    }
  } else if(room.state==='paused'){
    sim.idle(room.tick);
    const who = room.disconnectedAt.findIndex(t=>t>0);
    if(who>=0 && Date.now() - room.disconnectedAt[who] > GRACE_S*1000){
      room.sim.awardForfeit(2-who);
      endMatch(room, 'forfeit', 2-who, 'timeout');
      destroyRoom(room, 'reconnect timeout');
      return;
    }
  }
  if(room.tick % NET_SNAP_EVERY === 0 && room.sim) sendSnapshot(room, false);
}
function loop(){
  const now = process.hrtime.bigint();
  acc += Number(now - lastHr)/1e9; lastHr = now;
  if(acc > 0.25) acc = 0.25;                       // never spiral after a stall
  while(acc >= STEP){
    acc -= STEP;
    for(const room of rooms.values()){
      if(!room.sim) continue;
      try{ stepRoom(room); }
      catch(err){ log('room crashed', room.code, err); broadcast(room, { t:'error', msg:'The match hit a server error and was closed.' }); destroyRoom(room, 'crash'); }
    }
  }
  setTimeout(loop, 2);
}

// ------------------------------------------------------------------ local games (same network)
// Devices behind one Wi-Fi router or phone hotspot share a public address, so the server can
// introduce them; they then talk directly over the local network (WebRTC) and the server
// steps out. IPv6 devices are grouped by their /64 prefix (one home network).
function networkKey(req){
  let ip = '';
  const xff = req.headers['x-forwarded-for'];
  if(TRUST_PROXY && xff) ip = String(xff).split(',').map(s=>s.trim()).filter(Boolean).pop() || '';   // right-most = added by our proxy
  if(!ip) ip = req.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/i, '');
  if(ip.includes(':')){                                  // IPv6 → first 4 hextets
    const parts = ip.split('%')[0].split(':');
    const full = []; let i = 0;
    for(const p of parts){ if(p===''){ const fill = 8 - parts.filter(Boolean).length; if(!full._filled){ for(let k=0;k<fill;k++) full.push('0'); full._filled = true; } } else full.push(p); }
    ip = full.slice(0,4).join(':') + '::/64';
  }
  if(ip==='127.0.0.1' || ip==='::1' || ip.startsWith('0:0:0:0')) ip = 'loopback';
  return ip;
}
const lanWait = new Map();          // client id → { key, code, since }
function lanCode(){
  for(let i=0;i<50;i++){ const c = String(crypto.randomInt(1000, 10000)); if(![...lanWait.values()].some(w=>w.code===c)) return c; }
  return String(crypto.randomInt(1000, 10000));
}
function lanPair(host, guest){
  lanWait.delete(host.id); lanWait.delete(guest.id);
  host.lanPeer = guest.id; guest.lanPeer = host.id;
  send(host,  { t:'lanPair', role:'host',  peer:guest.name });
  send(guest, { t:'lanPair', role:'guest', peer:host.name });
  log('local pair', host.name, '+', guest.name, 'on', host.netKey);
}
function lanUnpair(c, why){
  lanWait.delete(c.id);
  const peer = c.lanPeer && clients.get(c.lanPeer);
  if(peer && peer.lanPeer===c.id){ peer.lanPeer = 0; if(why) send(peer, { t:'lanGone' }); }
  c.lanPeer = 0;
}

// ------------------------------------------------------------------ matchmaking
// Ranked: pair by skill rating, widening the window the longer you wait.
// Casual: first come, first served. A ranked pilot who has waited 45 s will
// also take a casual opponent (unrated). Bots are only ever offered.
const STAGES = [ { upTo:10, window:100 }, { upTo:25, window:250 }, { upTo:45, window:500 }, { upTo:Infinity, window:Infinity } ];
function stageOf(waitS){ for(let i=0;i<STAGES.length;i++) if(waitS < STAGES[i].upTo) return i; return STAGES.length-1; }
function ratingOf(c){ return c.player ? c.player.rating : START_RATING; }
function waited(c){ return (Date.now() - (c.queuedAt||Date.now()))/1000; }
function queueInfo(c){
  const w = waited(c), st = stageOf(w);
  const ranked = queue.filter(id=>{ const o = clients.get(id); return o && isRanked(o); }).length;
  return { t:'queued', online:clients.size, searching:queue.length, rankedSearching:ranked, waited:Math.floor(w), stage:st,
           window: isFinite(STAGES[st].window) ? STAGES[st].window : -1, ranked:isRanked(c),
           botOffer: c.botAfter > 0 && w >= c.botAfter, botIn: c.botAfter > 0 ? Math.max(0, Math.ceil(c.botAfter - w)) : -1 };
}
function startBotMatch(c){
  if(rooms.size >= MAX_ROOMS){ send(c, { t:'error', msg:'The server is full — try again shortly.' }); return; }
  const room = newRoom({ private:false, len:3 });
  room.bot = 2; room.names[1] = 'Wind Pilot';
  seatClient(room, c, 0);
  log('bot match', room.code, 'for', c.name);
  startMatch(room);
}
const isRanked = c => !!(c.qRanked && c.player);          // a pilot without a rating record flies casual
function compatible(a, b){
  const wa = waited(a), wb = waited(b);
  const ra = isRanked(a), rb = isRanked(b);
  if(ra && rb){
    const w = STAGES[stageOf(Math.max(wa, wb))].window;
    const d = Math.abs(ratingOf(a) - ratingOf(b));
    return d <= w ? { ranked:true, score:d } : null;
  }
  if(!ra && !rb) return { ranked:false, score:0 };
  const r = ra ? a : b;                      // mixed: once the ranked pilot has waited long enough, fly casual
  return waited(r) >= 45 ? { ranked:false, score:1000 } : null;
}
function pairUp(a, b, ranked){
  queue = queue.filter(id=>id!==a.id && id!==b.id);
  const room = newRoom({ private:false, len:3 });
  room.ranked = ranked;
  seatClient(room, a, 0); seatClient(room, b, 1);
  room.since = [a.queuedAt, b.queuedAt];
  log((ranked ? 'ranked' : 'casual')+' match', room.code, a.name, Math.round(ratingOf(a)), 'vs', b.name, Math.round(ratingOf(b)));
  if(CONFIRM_S > 0){
    room.state = 'confirm'; room.confirm = [false,false]; room.confirmUntil = Date.now() + CONFIRM_S*1000;
    [a,b].forEach((c,i)=>{
      const o = i ? a : b;
      send(c, { t:'found', seat:i+1, ranked, timeout:CONFIRM_S, opp:{ name:o.name, profile: publicProfile(o.player) }, me: publicProfile(c.player) });
    });
  } else startMatch(room);
}
function requeue(c, since){
  if(!c || c.room) return;
  c.queuedAt = since || Date.now();
  if(!queue.includes(c.id)) queue.unshift(c.id);
  send(c, { t:'requeued' });
  send(c, queueInfo(c));
}
function cancelConfirm(room, why){
  const cs = roomClients(room);
  const since = room.since || [0,0];
  destroyRoom(room, 'confirm '+why);
  cs.forEach((c, i)=>{
    if(!c) return;
    if(room.confirm && room.confirm[i]) requeue(c, since[i]);       // ready pilots go straight back to the front of the queue
    else send(c, { t:'cancelled', reason:why });
  });
}
function matchmake(){
  queue = queue.filter(id=>{ const c = clients.get(id); return c && !c.room; });
  const order = queue.map(id=>clients.get(id)).sort((a,b)=>a.queuedAt-b.queuedAt);
  const used = new Set();
  for(let i=0;i<order.length && rooms.size < MAX_ROOMS;i++){
    const a = order[i]; if(used.has(a.id)) continue;
    let best = null, bs = Infinity, bestRanked = false;
    for(let j=i+1;j<order.length;j++){
      const b = order[j]; if(used.has(b.id)) continue;
      const m = compatible(a, b);
      if(m && m.score < bs){ bs = m.score; best = b; bestRanked = m.ranked; }
    }
    if(best){ used.add(a.id); used.add(best.id); pairUp(a, best, bestRanked); }
  }
  if(BOT_AUTO_S > 0){
    for(const id of queue.slice()){
      const c = clients.get(id);
      if(c && waited(c) >= BOT_AUTO_S){ queue = queue.filter(q=>q!==id); startBotMatch(c); }
    }
  }
}
setInterval(()=>{
  if(process.env.TEST_HOOKS==='1' && queue.length) log('queue', queue.map(id=>{ const c = clients.get(id); return c ? c.name+(isRanked(c)?'(R'+Math.round(ratingOf(c))+')':'(C)')+' '+Math.round(waited(c))+'s' : '?'; }).join(', '));
  matchmake();
  for(const id of queue){ const c = clients.get(id); if(c) send(c, queueInfo(c)); }
  for(const room of rooms.values()) if(room.state==='confirm' && Date.now() > room.confirmUntil) cancelConfirm(room, 'timeout');
}, 1000);

// ------------------------------------------------------------------ ratings
async function settleRatings(room, winnerSeat){
  if(!room.ranked || room.bot || room.rated) return;
  room.rated = true;
  const cs = roomClients(room);
  const pids = room.pids || [];
  if(!pids[0] || !pids[1]) return;
  try{
    const [A, B] = await Promise.all([store.get(pids[0]), store.get(pids[1])]);
    if(!A || !B) return;
    const st = room.sim ? room.sim.status() : { scores:[0,0] };
    const score = winnerSeat===1 ? 1 : winnerSeat===2 ? 0 : 0.5;
    const { da, db } = eloUpdate(A, B, score);
    const before = [Math.round(A.rating), Math.round(B.rating)];
    const apply = (P, d, won, oppName, myS, opS)=>{
      P.rating = Math.max(100, P.rating + d); P.games++;
      if(won===1){ P.wins++; P.streak = P.streak > 0 ? P.streak+1 : 1; }
      else if(won===0){ P.losses++; P.streak = P.streak < 0 ? P.streak-1 : -1; }
      P.recent = [{ opp:oppName, r: won===1 ? 'W' : won===0 ? 'L' : 'D', s: myS+'–'+opS, d }].concat(P.recent||[]).slice(0,5);
    };
    apply(A, da, score===1 ? 1 : score===0 ? 0 : 0.5, room.names[1], st.scores[0], st.scores[1]);
    apply(B, db, score===0 ? 1 : score===1 ? 0 : 0.5, room.names[0], st.scores[1], st.scores[0]);
    await Promise.all([store.put(A), store.put(B)]);
    [A, B].forEach((P, i)=>{
      const c = cs[i] || [...clients.values()].find(x=>x.pid===P.pid);
      if(c){ c.player = P; send(c, { t:'rating', before:before[i], after:Math.round(P.rating), delta: i ? db : da, profile: publicProfile(P) }); }
    });
    log('rated', room.code, A.name, before[0], '→', Math.round(A.rating), '|', B.name, before[1], '→', Math.round(B.rating));
  }catch(e){ log('rating update failed', e.message); }
}
async function loadPlayer(c, pid, pkey){
  if(typeof pid!=='string' || !/^[A-Za-z0-9_-]{8,40}$/.test(pid) || typeof pkey!=='string' || pkey.length < 16){ c.player = null; return; }
  try{
    let p = await store.get(pid);
    const kh = hashKey(pkey);
    if(!p){ p = { pid, keyhash:kh, name:c.name, rating:START_RATING, games:0, wins:0, losses:0, streak:0, recent:[] }; await store.put(p); }
    else if(p.keyhash!==kh){ c.player = null; send(c, { t:'identity', reset:true }); return; }
    if(p.name!==c.name){ p.name = c.name; store.put(p).catch(()=>{}); }
    c.pid = pid; c.player = p;
    send(c, { t:'profile', p: publicProfile(p), store:store.kind });
  }catch(e){ c.player = null; log('player load failed', e.message); }
}

// ------------------------------------------------------------------ messages
function handle(c, msg){
  if(!msg || typeof msg.t!=='string') return;
  if(process.env.TEST_HOOKS==='1' && process.env.TRACE==='1' && msg.t!=='in' && msg.t!=='ping') log('msg', c.id, c.name, msg.t);
  if(msg.t==='ping'){ send(c, { t:'pong', c:msg.c, k: c.room && rooms.get(c.room) ? rooms.get(c.room).tick : 0 }); return; }
  if(msg.t==='hello'){
    if(msg.v!==NET_PROTO){ send(c, { t:'error', fatal:true, msg:'This game page is out of date — refresh to update.' }); return; }
    c.name = cleanName(msg.name);
    c.ready = loadPlayer(c, msg.pid, msg.pkey);
    if(process.env.TEST_HOOKS==='1' && typeof msg.netKey==='string') c.netKey = msg.netKey.slice(0,40);   // tests: pretend to be elsewhere
    // resuming after a dropped connection?
    const sess = msg.token && sessions.get(msg.token);
    const room = sess && rooms.get(sess.code);
    if(room && room.sim && room.tokens[sess.seat]===msg.token && room.seats[sess.seat]===null){
      room.seats[sess.seat] = c.id; c.room = room.code; c.seat = sess.seat;
      room.disconnectedAt[sess.seat] = 0;
      room.acks[sess.seat] = 0; room.inputs[sess.seat] = []; room.held[sess.seat] = null;
      send(c, { t:'welcome', id:c.id, resumed:true });
      const other = clients.get(room.seats[1-sess.seat]);
      send(other, { t:'oppBack' });
      if(room.state==='paused'){ room.state = room.resumeState || 'playing'; }
      const st = room.sim.status();
      send(c, { t:'start', seat:sess.seat+1, W:NET_W, names:room.names, matchLen:room.matchLen, round:st.roundNo, scores:st.scores,
        tick:room.tick, cd:0, code:room.code, token:msg.token, resumed:true, state:room.state });
      sendSnapshot(room, true);
      log('resumed', c.name, 'in', room.code);
      return;
    }
    send(c, { t:'welcome', id:c.id, resumed:false });
    return;
  }
  if(msg.t==='in'){
    const room = c.room && rooms.get(c.room);
    if(!room || room.state!=='playing' || !Array.isArray(msg.d)) return;
    const q = room.inputs[c.seat];
    for(const e of msg.d.slice(0, 24)){
      if(!validInput(e)) continue;
      if(e[0] <= (q.length ? q[q.length-1][0] : room.acks[c.seat])) continue;    // stale / duplicate
      q.push(e);
    }
    if(q.length > 60) q.splice(0, q.length-60);
    return;
  }
  if(typeof msg.name==='string' && ['quick','create','join','name'].includes(msg.t)){
    c.name = cleanName(msg.name);
    if(c.player && c.player.name!==c.name){ c.player.name = c.name; store.put(c.player).catch(()=>{}); }
    if(msg.t==='name') return;
  }
  if(msg.t==='quick'){
    if(c.room) return;
    queue = queue.filter(id=>clients.has(id) && id!==c.id);
    c.queuedAt = Date.now();
    c.qRanked = msg.ranked!==false;
    c.botAfter = [0,30,60].includes(+msg.botAfter) ? +msg.botAfter : 60;
    Promise.resolve(c.ready).then(()=>{
      if(c.room || !clients.has(c.id)) return;
      queue.push(c.id);
      matchmake();
      if(queue.includes(c.id)) send(c, queueInfo(c));
    });
    return;
  }
  if(msg.t==='accept' || msg.t==='decline'){
    const room = c.room && rooms.get(c.room);
    if(!room || room.state!=='confirm') return;
    if(msg.t==='decline'){ room.confirm[c.seat] = false; room.confirm[1-c.seat] = true; cancelConfirm(room, 'declined'); return; }
    room.confirm[c.seat] = true;
    broadcast(room, { t:'accepted', who:c.seat+1, both: room.confirm[0] && room.confirm[1] });
    if(room.confirm[0] && room.confirm[1]){ room.state = 'waiting'; startMatch(room); }
    return;
  }
  if(msg.t==='lanFind'){
    if(c.room) return;
    lanUnpair(c);
    queue = queue.filter(id=>id!==c.id);
    // someone already waiting on this network? → introduce them
    for(const [id, w] of lanWait){
      const other = clients.get(id);
      if(other && id!==c.id && w.key===c.netKey && !other.room){ lanPair(other, c); return; }
    }
    const code = lanCode();
    lanWait.set(c.id, { key:c.netKey, code, since:Date.now() });
    send(c, { t:'lanWaiting', code });
    return;
  }
  if(msg.t==='lanCode'){                      // backup: pair by the 4-digit code shown on the other device
    const code = String(msg.code||'').replace(/\D/g,'').slice(0,4);
    for(const [id, w] of lanWait){
      const other = clients.get(id);
      if(other && id!==c.id && w.code===code){ lanPair(other, c); return; }
    }
    send(c, { t:'lanNoCode' });
    return;
  }
  if(msg.t==='lanCancel'){ lanUnpair(c, true); return; }
  if(msg.t==='sig'){                          // WebRTC offer / answer / ICE, relayed to the paired device only
    const peer = c.lanPeer && clients.get(c.lanPeer);
    if(peer && peer.lanPeer===c.id && msg.d && JSON.stringify(msg.d).length < 6000) send(peer, { t:'sig', d:msg.d });
    return;
  }
  if(msg.t==='botNow'){
    if(c.room) return;
    queue = queue.filter(id=>id!==c.id);
    startBotMatch(c);
    return;
  }
  if(msg.t==='create'){
    if(c.room) return;
    if(rooms.size >= MAX_ROOMS){ send(c, { t:'error', msg:'The server is full — try again shortly.' }); return; }
    queue = queue.filter(id=>id!==c.id);
    const room = newRoom({ private:true, len:+msg.len });
    seatClient(room, c, 0);
    send(c, { t:'room', code:room.code, len:room.matchLen });
    log('room created', room.code, 'by', c.name);
    return;
  }
  if(msg.t==='join'){
    if(c.room) return;
    const code = String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
    const room = rooms.get(code);
    if(!room || room.state!=='waiting' || room.seats[1]!==null){ send(c, { t:'error', msg: room ? 'That room is already in a match.' : 'No room with code '+(code||'—')+'.' }); return; }
    queue = queue.filter(id=>id!==c.id);
    seatClient(room, c, 1);
    log('joined', room.code, c.name);
    startMatch(room);
    return;
  }
  if(msg.t==='cancel'){
    queue = queue.filter(id=>id!==c.id);
    const room = c.room && rooms.get(c.room);
    if(room && room.state==='waiting') destroyRoom(room, 'cancelled');
    else if(room && room.state==='confirm'){ room.confirm[c.seat] = false; room.confirm[1-c.seat] = true; cancelConfirm(room, 'cancelled'); return; }
    send(c, { t:'cancelled' });
    return;
  }
  if(msg.t==='rematch'){
    const room = c.room && rooms.get(c.room);
    if(!room || room.state!=='matchEnd' || !room.sim) return;
    room.rematch[c.seat] = true;
    if(room.bot) room.rematch[room.bot-1] = true;          // the Wind Pilot is always up for another go
    broadcast(room, { t:'rematchWait', who:c.seat+1, both: room.rematch[0] && room.rematch[1] });
    if(room.rematch[0] && room.rematch[1]){ room.sim.restartMatch(); room.rematch = [false,false]; room.rated = false; beginRound(room); }
    return;
  }
  if(msg.t==='leave'){ leaveRoom(c, 'left'); send(c, { t:'left' }); return; }
  // test-only: TEST_HOOKS=1 lets automated tests set hull values
  if(msg.t==='debugHp' && process.env.TEST_HOOKS==='1'){
    const room = c.room && rooms.get(c.room);
    if(room && room.sim) room.sim.debugHp(msg.hp);
    return;
  }
}

// ------------------------------------------------------------------ sockets
const wss = new WebSocketServer({
  server, path:'/ws', maxPayload: 8*1024,
  perMessageDeflate: { threshold: 256, zlibDeflateOptions:{ level:3 }, serverNoContextTakeover:false, clientNoContextTakeover:true },
  verifyClient: (info, cb)=>{
    if(clients.size >= MAX_CLIENTS) return cb(false, 503, 'Server full');
    if(ORIGINS.length && !ORIGINS.includes(info.origin)) return cb(false, 403, 'Origin not allowed');
    cb(true);
  }
});
wss.on('connection', (ws, req)=>{
  const c = { id: nextClientId++, ws, name:'Pilot', room:null, seat:0, alive:true, msgs:0, window:Date.now(), netKey:networkKey(req), lanPeer:0 };
  clients.set(c.id, c);
  ws.on('pong', ()=>{ c.alive = true; });
  ws.on('message', (data)=>{
    // simple flood guard: 240 messages / second is far above normal play (~60)
    const now = Date.now();
    if(now - c.window > 1000){ c.window = now; c.msgs = 0; }
    if(++c.msgs > 240) return;
    let msg; try{ msg = JSON.parse(data); }catch(e){ return; }
    if(LAG_MS) setTimeout(()=>handle(c, msg), LAG_MS); else handle(c, msg);
  });
  ws.on('close', ()=>{
    if(process.env.TRACE==='1') log('close', c.id, c.name);
    lanUnpair(c, true);
    clients.delete(c.id);
    queue = queue.filter(id=>id!==c.id);
    const room = c.room && rooms.get(c.room);
    if(!room) return;
    if(room.state==='confirm'){ room.seats[c.seat] = null; room.confirm[c.seat] = false; room.confirm[1-c.seat] = true; cancelConfirm(room, 'left'); return; }
    if(room.state==='waiting' || !room.sim){ destroyRoom(room, 'host disconnected'); return; }
    if(room.state==='matchEnd'){ leaveRoom(c, 'disconnected after match'); return; }
    // keep the seat open for a reconnect
    room.seats[c.seat] = null;
    room.disconnectedAt[c.seat] = Date.now();
    if(room.state!=='paused') room.resumeState = room.state;
    room.state = 'paused';
    const other = clients.get(room.seats[1-c.seat]);
    if(other) send(other, { t:'oppLeft', grace:GRACE_S });
    else if(!room.bot) destroyRoom(room, 'both disconnected');
    log('disconnected', c.name, 'from', room.code);
  });
});
// drop dead sockets (phones that slept, flaky Wi-Fi)
setInterval(()=>{
  for(const c of clients.values()){
    if(!c.alive){ try{ c.ws.terminate(); }catch(e){} continue; }
    c.alive = false; try{ c.ws.ping(); }catch(e){}
  }
  // tidy private rooms nobody joined
  for(const room of rooms.values()) if(room.state==='waiting' && Date.now()-room.created > 30*60*1000) destroyRoom(room, 'expired');
}, 10000);

server.listen(PORT, ()=>{ log('Loonfire server on :'+PORT+' · ratings: '+store.kind+(LAG_MS?' · simulated lag '+LAG_MS+' ms each way':'')); loop(); });
process.on('SIGTERM', ()=>{ Promise.resolve(store.close()).finally(()=>process.exit(0)); });
module.exports = { server, rooms, clients };
