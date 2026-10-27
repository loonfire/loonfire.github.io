// ---- server-side wrapper around one match's simulation (server bundle only) ----
fxSink = [];
let curTick = 0;
const bots = { 1:null, 2:null };          // seat → difficulty key of a server-run Wind Pilot
let brainsS = { 1:null, 2:null };
function freshRound(){ newRound(); for(const id of [1,2]) brainsS[id] = bots[id] ? new AIBrain(id===1?p1:p2, bots[id]) : null; }
const tearsSent = { 1:-1, 2:-1 };
const pending = [];                       // events since the last snapshot: [tick, name, ...args]
function collect(){ for(const ev of fxSink) pending.push([curTick, ...ev]); fxSink.length = 0; }
return {
  consts:{ NET_PROTO, NET_TICK, NET_SNAP_EVERY, NET_W, STEP, IN_EDGE_MASK },
  decInput, validInput,
  setBot(seat, key){ bots[seat] = key; },
  setup(w, len){ W = w; matchLen = len; matchOver = false; scores = [0,0]; roundNo = 1; buildLamps(); newMatchWorld(); freshRound(); tearsSent[1] = tearsSent[2] = -1; },
  nextRound(){ roundNo++; freshRound(); tearsSent[1] = tearsSent[2] = -1; },
  restartMatch(){ matchOver = false; scores = [0,0]; roundNo = 1; newMatchWorld(); freshRound(); tearsSent[1] = tearsSent[2] = -1; },
  idle(tick){ curTick = tick; simTime += STEP; windTime += STEP; updateWeather(STEP); updateWind(STEP); updateFog(STEP); updateBandOffsets(STEP); collect(); },
  step(tick, in1, in2){
    curTick = tick;
    if(!gameOver){
      if(brainsS[1]) in1 = brainsS[1].step(STEP, p2);
      if(brainsS[2]) in2 = brainsS[2].step(STEP, p1);
    }
    if(in1 && in1.weapon && p1.alive && !gameOver) p1.weapon = in1.weapon;
    if(in2 && in2.weapon && p2.alive && !gameOver) p2.weapon = in2.weapon;
    simStep(STEP, in1, in2);
    collect();
  },
  snapshot(tick, acks, forceTears){
    collect();
    const dirty = [];
    for(const b of [p1,p2]) if(forceTears || b.tearsV!==tearsSent[b.id]){ dirty.push(b.id); tearsSent[b.id] = b.tearsV; }
    const snap = encodeSnapshot(tick, acks, pending.splice(0), dirty.length ? dirty : null);
    return snap;
  },
  status(){ return { gameOver, winnerId, matchOver, scores:[scores[0],scores[1]], endTimer, roundNo, roundTime, matchLen }; },
  stats(){ return [p1.stats, p2.stats]; },
  debugHp(hp){ if(Array.isArray(hp)){ p1.hp = Math.min(p1.hp, +hp[0]||p1.hp); p2.hp = Math.min(p2.hp, +hp[1]||p2.hp); } },
  awardForfeit(winner){ scores[winner-1] = Math.ceil(matchLen/2); matchOver = true; },
};
