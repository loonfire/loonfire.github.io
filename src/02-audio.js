// =====================================================================
//  SOUND — tiny WebAudio synth, no assets.
//  Two engines share one AudioContext:
//    Classic  — the original stereo-less mix (default)
//    Spatial  — EXPERIMENTAL: every sound is placed in the arena around
//               the listener's balloon (HRTF or stereo panning), muffled
//               by fog between you and it, echoes off the mountains,
//               and runs through a limiter so big moments never clip.
//               Wind and burners become live, positioned loops.
//  Switch in Settings → Audio. Audio problems never break the game:
//  every call is guarded, and the context recovers after a phone call,
//  a locked screen or a background tab.
// =====================================================================
const Sfx = (function(){
  let ac=null, master=null, noiseBuf=null, burn=null, rainG=null;
  let muted = !!settings.muted;
  const last = {};
  let pos = null;                          // position for the next sound (set by Sfx.at)
  // spatial graph
  let sp = null;                           // { bus, limiter, verb, verbIn, windSrc… }
  let listener = { x:600, y:400 };
  let voices = 0;
  const MAX_VOICES = 30;

  const vol = ()=> (settings.vol ? settings.vol.master : 80)/100;
  const sfxVol = ()=> (settings.vol ? settings.vol.sfx : 85)/100;
  const ambVol = ()=> (settings.vol ? settings.vol.music : 55)/100;
  const spatialOn = ()=> settings.audioEngine==='spatial' && !!sp;

  function loopNoise(filters, gainNode, dest){
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    let node = src;
    for(const f of filters){ node.connect(f); node = f; }
    node.connect(gainNode); gainNode.connect(dest || master); src.start(0, Math.random()*1.5);
    return src;
  }
  function masterLevel(){ return muted ? 0 : 0.55*vol()*1.18; }
  function init(){
    if(ac){ resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    try{ ac = new AC(); }catch(e){ ac=null; return; }
    try{
      master = ac.createGain(); master.gain.value = masterLevel(); master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate*2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
      const lp = ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=520;
      burn = ac.createGain(); burn.gain.value = 0;
      loopNoise([lp], burn);
      const hp = ac.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=1400;
      const lp2 = ac.createBiquadFilter(); lp2.type='lowpass'; lp2.frequency.value=7000;
      rainG = ac.createGain(); rainG.gain.value = 0;
      loopNoise([hp,lp2], rainG);
      if(ac.onstatechange===null) ac.onstatechange = ()=>{ if(ac.state!=='running' && !document.hidden) resume(); };
      if(settings.audioEngine==='spatial') buildSpatial();
    }catch(e){ ac = null; }
  }
  function resume(){ try{ if(ac && ac.state!=='running' && ac.state!=='closed') ac.resume(); }catch(e){} }
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) resume(); });

  // ---------------------------------------------------------- spatial graph
  function impulse(){
    // valley acoustics: a couple of distinct mountain echoes + a soft diffuse tail
    const len = Math.round(ac.sampleRate*2.4), buf = ac.createBuffer(2, len, ac.sampleRate);
    for(let ch=0; ch<2; ch++){
      const d = buf.getChannelData(ch);
      for(let i=0;i<len;i++){ const t = i/ac.sampleRate; d[i] = (Math.random()*2-1)*Math.exp(-t*2.6)*0.32*smoothstep(0, 0.03, t); }
      for(const [t0, a] of [[0.29+ch*0.03, 0.55], [0.47-ch*0.02, 0.38], [0.83+ch*0.04, 0.22]]){
        const s0 = Math.round(t0*ac.sampleRate);
        for(let i=0;i<900;i++) if(s0+i<len) d[s0+i] += (Math.random()*2-1)*a*Math.exp(-i/160);
      }
    }
    return buf;
  }
  function buildSpatial(){
    if(sp || !ac) return;
    try{
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.25;
      const bus = ac.createGain(); bus.gain.value = 1;
      bus.connect(limiter); limiter.connect(master);
      const verb = ac.createConvolver(); verb.buffer = impulse();
      const verbIn = ac.createGain(); verbIn.gain.value = settings.spatial && settings.spatial.reverb ? 1 : 0;
      const verbOut = ac.createGain(); verbOut.gain.value = 0.22;
      verbIn.connect(verb); verb.connect(verbOut); verbOut.connect(bus);
      // live wind: low band + whistle band, level follows the air at the listener
      const wl = ac.createBiquadFilter(); wl.type='bandpass'; wl.frequency.value=380; wl.Q.value=0.6;
      const windG = ac.createGain(); windG.gain.value = 0;
      loopNoise([wl], windG, bus);
      const wh = ac.createBiquadFilter(); wh.type='bandpass'; wh.frequency.value=1800; wh.Q.value=4;
      const whistG = ac.createGain(); whistG.gain.value = 0;
      loopNoise([wh], whistG, bus);
      // one positioned burner per balloon
      const burners = [0,1].map(()=>{
        const f = ac.createBiquadFilter(); f.type='lowpass'; f.frequency.value=560;
        const g = ac.createGain(); g.gain.value = 0;
        const pan = makePanner();
        loopNoise([f], g, pan.input); pan.output.connect(bus);
        return { g, pan, f };
      });
      sp = { bus, limiter, verb, verbIn, windG, whistG, wl, wh, burners };
    }catch(e){ sp = null; }
  }
  function makePanner(){
    if(settings.spatial && settings.spatial.hrtf && ac.createPanner){
      const p = ac.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 0.6; p.maxDistance = 40;
      return { input:p, output:p, set(x,y){ const X = (x-listener.x)/380, Y = -(y-listener.y)/380; if(p.positionX){ p.positionX.value = X; p.positionY.value = Y; p.positionZ.value = -0.8; } else p.setPosition(X, Y, -0.8); } };
    }
    const p = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
    const g = ac.createGain();
    p.connect(g);
    return { input:p, output:g, set(x,y){ const dx = x-listener.x, d = Math.hypot(dx, y-listener.y); if(p.pan) p.pan.value = clamp(dx/520, -1, 1); g.gain.value = 1/(1 + d/900); } };
  }
  // fog between the listener and the source muffles it
  function fogBetween(x, y){
    if(typeof fogAt!=='function') return 0;
    let s = 0; for(let i=1;i<=4;i++){ const t = i/5; s += fogAt(lerp(listener.x, x, t), lerp(listener.y, y, t)); }
    return clamp(s/4, 0, 1);
  }
  // where a one-shot sound goes: the master (classic) or a positioned chain (spatial)
  function out(dur){
    const p = pos; pos = null;
    if(!spatialOn() || !p || !isFinite(p.x)) return master;
    try{
      const pan = makePanner(); pan.set(p.x, p.y);
      const fog = fogBetween(p.x, p.y);
      let head = pan.input;
      if(fog > 0.05){ const lp = ac.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 16000*(1-fog*0.88) + 900; lp.connect(pan.input); head = lp; }
      pan.output.connect(sp.bus);
      const send = ac.createGain(); send.gain.value = 0.35 + Math.min(0.5, Math.hypot(p.x-listener.x, p.y-listener.y)/1600);
      pan.output.connect(send); send.connect(sp.verbIn);
      voices++; setTimeout(()=>{ voices = Math.max(0, voices-1); }, (dur+0.3)*1000);
      return head;
    }catch(e){ return master; }
  }
  function ok(name, gap){
    const t = performance.now();
    if(last[name] && t-last[name] < gap){ pos = null; return false; }
    last[name] = t; return true;
  }
  function guard(fn){ return function(){ try{ return fn.apply(null, arguments); }catch(e){ pos = null; } }; }
  function noise(dur, f0, f1, vol, type){
    if(!ac || muted){ pos = null; return; }
    if(spatialOn() && voices > MAX_VOICES){ pos = null; return; }
    const t = ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type||'lowpass';
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20,f1), t+dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol*sfxVol()/0.85, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    src.connect(f); f.connect(g); g.connect(out(dur));
    src.start(t, Math.random()*1.0, dur+0.05); src.stop(t+dur+0.05);
  }
  function tone(f0, f1, dur, type, vol, delay){
    if(!ac || muted){ pos = null; return; }
    const t = ac.currentTime + (delay||0);
    const o = ac.createOscillator(); o.type = type||'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20,f1), t+dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol*sfxVol()/0.85, t+0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(out(dur+(delay||0))); o.start(t); o.stop(t+dur+0.02);
  }
  // a sound made of several voices shares one position
  function multi(fn){ return guard(function(){ const p = pos; const args = arguments; const again = ()=>{ pos = p; }; fn(again, ...args); pos = null; }); }

  const api = {
    init, resume,
    isMuted: ()=>muted,
    ctxState: ()=>({ ctx: ac ? ac.state : 'none', spatial: !!sp, spatialOn: spatialOn(), voices }),
    at(x, y){ pos = (x===undefined || y===undefined) ? null : { x, y }; return api; },
    toggleMute(){
      muted = !muted; settings.muted = muted; saveSettings();
      if(master) master.gain.value = masterLevel();
      if(muted){ if(burn) burn.gain.value = 0; if(rainG) rainG.gain.value = 0; }
      return muted;
    },
    applySettings(){
      if(!ac) return;
      try{
        master.gain.value = masterLevel();
        if(settings.audioEngine==='spatial') buildSpatial();
        if(sp) sp.verbIn.gain.value = settings.spatial && settings.spatial.reverb ? 1 : 0;
        if(sp && !spatialOn()){ sp.windG.gain.value = 0; sp.whistG.gain.value = 0; sp.burners.forEach(b=>b.g.gain.value = 0); }
      }catch(e){}
    },
    get engine(){ return spatialOn() ? 'spatial' : 'classic'; },
    // per-frame: listener, positioned burners, live wind
    frame(L, balloons, burning){
      if(!ac) return;
      try{
        if(L){ listener.x = L.x; listener.y = L.y; }
        const amb = ambVol();
        if(!spatialOn()){
          if(burn) burn.gain.setTargetAtTime(burning && !muted ? 0.08*amb/0.55 : 0, ac.currentTime, 0.08);
          return;
        }
        if(burn) burn.gain.setTargetAtTime(0, ac.currentTime, 0.05);
        const t = ac.currentTime;
        balloons.forEach((b,i)=>{
          const B = sp.burners[i]; if(!B) return;
          const on = burning && b && b.alive && b.burnerOn && !muted;
          B.g.gain.setTargetAtTime(on ? 0.12*amb/0.55 : 0, t, 0.08);
          if(b){ B.pan.set(b.x, b.y); const fog = fogBetween(b.x, b.y); B.f.frequency.setTargetAtTime(560*(1-fog*0.6)+120, t, 0.2); }
        });
        const live = settings.spatial && settings.spatial.wind;
        const w = typeof windAtXY==='function' ? Math.abs(windAtXY(listener.x, listener.y)) : 0;
        const g = live && !muted ? clamp(w/140, 0, 1) : 0;
        sp.windG.gain.setTargetAtTime(g*0.05*amb/0.55, t, 0.4);
        sp.whistG.gain.setTargetAtTime(g*g*0.012*amb/0.55, t, 0.4);
        sp.wl.frequency.setTargetAtTime(300 + g*260, t, 0.5);
      }catch(e){}
    },
    setBurner(on){ if(!spatialOn() && burn && ac) burn.gain.setTargetAtTime(on&&!muted?0.08*ambVol()/0.55:0, ac.currentTime, 0.08); },
    setRain(v){ if(rainG && ac) rainG.gain.setTargetAtTime(muted?0:v*0.07*ambVol()/0.55, ac.currentTime, 0.6); },
    shot: multi((p)=>{ if(ok('shot',45)){ p(); tone(1300,380,0.07,'square',0.035); p(); noise(0.05,4000,1500,0.04,'bandpass'); } }),
    launch: multi((p)=>{ p(); tone(260,140,0.12,'triangle',0.08); p(); noise(0.15,900,300,0.08); }),
    ignite: multi((p)=>{ p(); noise(0.7,3200,700,0.13,'bandpass'); p(); tone(180,520,0.5,'sawtooth',0.03); }),
    thump: multi((p)=>{ p(); tone(110,38,0.32,'sine',0.28); p(); noise(0.22,900,200,0.12); }),
    boom: multi((p, size)=>{ if(!ok('boom',40)) return; const s=clamp(size||1,0.5,1.8); p(); noise(0.5+s*0.35,1500,90,0.32*s,'lowpass'); p(); tone(90,30,0.5,'sine',0.3*s); }),
    flak: multi((p)=>{ if(!ok('flak',60)) return; p(); noise(0.35,5000,600,0.22,'bandpass'); p(); tone(140,50,0.3,'sine',0.2); }),
    hit: multi((p)=>{ if(ok('hit',60)){ p(); noise(0.08,2600,700,0.08,'bandpass'); p(); tone(200,95,0.09,'triangle',0.07); } }),
    ping: multi((p)=>{ if(ok('ping',50)){ p(); tone(2200,1400,0.07,'sine',0.05); } }),
    thunder: multi((p)=>{ if(ok('thunder',250)){ p(); noise(2.0,560,50,0.42,'lowpass'); p(); noise(0.25,3000,500,0.15,'bandpass'); } }),
    rumble: multi((p)=>{ if(ok('rumble',900)){ p(); noise(2.6,240,40,0.12,'lowpass'); } }),
    shield: multi((p)=>{ p(); tone(300,900,0.35,'sine',0.11); p(); tone(450,1350,0.3,'sine',0.05,0.04); }),
    drop: multi((p)=>{ p(); tone(700,200,0.4,'triangle',0.09); }),
    zip: multi((p)=>{ p(); tone(1400,380,0.22,'sawtooth',0.05); }),
    tether: multi((p)=>{ p(); tone(420,120,0.3,'square',0.05); p(); noise(0.2,2000,600,0.06,'bandpass'); }),
    chime: multi((p)=>{ p(); tone(660,990,0.35,'sine',0.11); p(); tone(990,1320,0.35,'sine',0.06,0.08); }),
    whoomp: multi((p)=>{ p(); noise(0.4,800,90,0.32,'lowpass'); p(); tone(170,48,0.38,'sine',0.22); }),
    boost: multi((p)=>{ p(); noise(0.5,3500,500,0.2,'bandpass'); p(); tone(120,360,0.35,'sawtooth',0.045); }),
    overheat: multi((p)=>{ if(ok('oh',400)){ p(); noise(0.9,6000,1600,0.07,'highpass'); } }),
    glass: multi((p)=>{ if(ok('glass',120)){ p(); tone(3200,2400,0.12,'triangle',0.04); p(); tone(4100,3000,0.1,'triangle',0.03,0.03); } }),
    deny: multi((p)=>{ if(ok('deny',200)){ p(); tone(200,170,0.07,'square',0.03); } }),
    gust: multi((p, dir)=>{ if(ok('gust',1500)){ pos = { x: dir>0 ? -200 : W+200, y: listener.y }; noise(2.2, 300, 900, 0.09, 'bandpass'); } }),
    click: multi((p)=>{ if(ok('click',40)){ tone(1800,1500,0.03,'sine',0.025); } }),
  };
  return api;
})();
['pointerdown','keydown','touchend'].forEach(ev => window.addEventListener(ev, ()=>Sfx.init(), {passive:true}));
