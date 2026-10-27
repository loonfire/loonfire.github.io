// =====================================================================
//  CORE CONSTANTS
//  The world is always H tall; its WIDTH follows the aspect ratio, so a
//  wider ratio is a genuinely wider sky, never a stretch.
// =====================================================================
const H = 800;
let W = 1200;
const GROUND_Y = 650;          // lowest a balloon's centre may sit
const FLOOR_Y = 698;           // meadow horizon line
const ROAD_Y0 = 712, ROAD_Y1 = 744;
const STORM_Y = 110;           // hard ceiling (centre clamps to STORM_Y+10)
const STORM_DANGER = STORM_Y + 55;
const STEP = 1/120;            // fixed simulation step
const MIN_RATIO = 4/3, MAX_RATIO = 21/9;
const ASPECTS = { '4:3':4/3, '3:2':3/2, '16:9':16/9, '21:9':21/9 };
const ASPECT_ORDER = ['auto','4:3','3:2','16:9','21:9'];

const $ = id => document.getElementById(id);

function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
function lerp(a,b,t){ return a+(b-a)*t; }
function rand(a,b){ return a + Math.random()*(b-a); }
function dist(x1,y1,x2,y2){ return Math.hypot(x1-x2,y1-y2); }
function normAngle(a){ while(a>Math.PI) a-=Math.PI*2; while(a<-Math.PI) a+=Math.PI*2; return a; }
function smoothstep(e0,e1,x){ const t = clamp((x-e0)/(e1-e0),0,1); return t*t*(3-2*t); }
function gaussRand(){ const u = 1-Math.random(), v = Math.random(); return clamp(Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v), -2.5, 2.5); }
let uidCounter = 1;
function uid(){ return uidCounter++; }
// "probability p per 60 Hz frame" → per-step probability (step-size independent)
function roll(p, dt){
  if(p>=1) return true;
  if(p<=0) return false;
  return Math.random() < 1 - Math.pow(1-p, dt*60);
}
function hexToRgb(hex){ const n=parseInt(hex.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function rgbStr(c, a){ return a===undefined ? `rgb(${c[0]|0},${c[1]|0},${c[2]|0})` : `rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`; }
function scaleRgb(c,k){ return [clamp(c[0]*k,0,255), clamp(c[1]*k,0,255), clamp(c[2]*k,0,255)]; }
function mixRgb(a,b,t){ return [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)]; }

let simTime = 0;               // advances only while the simulation runs

// moon lives in the upper sky, opposite the menu buttons
// small and bright, like the real thing; it drifts slowly across the sky as the match goes on
function moon(){ const k = typeof windTime==='number' ? smoothstep(0, 900, windTime) : 0; return { x: W*(0.68 + 0.12*k), y: 205 - 40*k, r: 26 }; }
// light direction (screen space) coming FROM the moon toward the arena
const MOON_LIGHT = { x: 0.55, y: -0.45 };

// =====================================================================
//  SETTINGS (persisted)
// =====================================================================
const SETTINGS_KEY = 'emberwind.settings.v3';
const settings = { aspectMode:'auto', customRatio:1.6, muted:false, difficulty:'normal', matchLen:1,
                   quality:'high', autoQuality:true, aiLabels:false, showFps:false, touch:'auto',
                   netName:'', netServer:'', netLen:3,
                   wind:'realistic', fog:'variable', moon:'random', audioEngine:'classic', vol:{ master:85, music:55, sfx:85 },
                   spatial:{ hrtf:true, reverb:true, wind:true }, pad:{ vib:true, dead:15, invert:false, map:null }, windHud:true,
                   ranked:true, botAfter:60, showPing:true, rays:true, vclouds:true, vfog:true, motion:false, fpsCap:'60', menuMode:'online' };
function saveSettings(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){} }
(function loadSettings(){
  let stored = null;
  try{ stored = localStorage.getItem(SETTINGS_KEY); }catch(e){}
  if(!stored && typeof window!=='undefined' && window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches) settings.quality = 'medium';
  try{ Object.assign(settings, JSON.parse(stored||'{}')); }catch(e){}
  if(!['auto','on','off'].includes(settings.touch)) settings.touch = 'auto';
  if(![1,3,5].includes(settings.matchLen)) settings.matchLen = 1;
  if(!ASPECT_ORDER.concat(['custom']).includes(settings.aspectMode)) settings.aspectMode = 'auto';
  if(!['high','medium','low'].includes(settings.quality)) settings.quality = 'high';
  settings.customRatio = clamp(+settings.customRatio || 1.6, 1.25, 2.4);
  if(!['calm','light','realistic','gale'].includes(settings.wind)) settings.wind = 'realistic';
  if(!['clear','variable','dense'].includes(settings.fog)) settings.fog = 'variable';
  if(!['random','tonight','full'].includes(settings.moon)) settings.moon = 'random';
  if(!['classic','spatial'].includes(settings.audioEngine)) settings.audioEngine = 'classic';
  for(const [k,d] of [['vol',{master:85,music:55,sfx:85}],['spatial',{hrtf:true,reverb:true,wind:true}],['pad',{vib:true,dead:15,invert:false,map:null}]])
    settings[k] = Object.assign({}, d, (settings[k] && typeof settings[k]==='object') ? settings[k] : {});
})();

// =====================================================================
//  FX — discrete audiovisual events raised by the simulation.
//  Offline they play at once; on the server they are recorded and
//  broadcast; online clients replay them in step with interpolated time.
//  The simulation itself never touches particles, sound or the screen.
// =====================================================================
const FX_MUTE = [];
let fxSink = null;                 // null → play now · array → record · FX_MUTE → drop
let fxTap = null;                  // local-game host: play now AND keep a copy for the guest
let FX_IMPL = {};
function fx(name, a, b, c, d, e, f, g){
  if(fxSink===null){
    const h = FX_IMPL[name]; if(h) h(a, b, c, d, e, f, g);
    if(fxTap){ const ev = [name]; for(const v of [a,b,c,d,e,f,g]){ if(v===undefined) break; ev.push(typeof v==='number' ? Math.round(v*10)/10 : v); } fxTap.push(ev); }
  }
  else if(fxSink!==FX_MUTE){
    const ev = [name];
    for(const v of [a,b,c,d,e,f,g]){ if(v===undefined) break; ev.push(typeof v==='number' ? Math.round(v*10)/10 : v); }
    fxSink.push(ev);
  }
}
let PREDICT = false;               // client-side prediction replay: no damage, no storm, no events
