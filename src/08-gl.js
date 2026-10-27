// =====================================================================
//  WEBGL2 RENDERER
//  atmosphere (sky, moon halo, milky way, mountains, raymarched clouds)
//  → fog (volumetric ground mist, wind wisps, lit in-scatter, lamp cones)
//  → god rays (radial occlusion blur from the moon)
//  → composite (lighting of the albedo layer, emissives, stars, moon disc,
//               shockwave/heat distortion, lit rain)
//  → bloom (threshold + 3-level gaussian) → tonemap/grade/vignette/grain
// =====================================================================
const QUALITY = {
  high:   { label:'High',   atm:0.75, oct:5, lsteps:4, rays:48, bloom:3, rs:1,    csteps:26, clsteps:4, cres:0.42 },
  medium: { label:'Medium', atm:0.6,  oct:4, lsteps:3, rays:32, bloom:3, rs:0.9,  csteps:18, clsteps:3, cres:0.34 },
  low:    { label:'Low',    atm:0.34, oct:3, lsteps:2, rays:22, bloom:2, rs:0.72, csteps:11, clsteps:2, cres:0.26 },
};
const MAXL = 24, MAXLAMP = 8, MAXRIP = 6, MAXBANK = 6;

const SH_VS = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }`;

const SH_COMMON = `
precision highp float;
uniform vec2 uRes; uniform vec2 uTarget; uniform float uTime; uniform sampler2D uNoise;
out vec4 o;
vec2 worldP(){ vec2 uv = gl_FragCoord.xy/uTarget; return vec2(uv.x*uRes.x, (1.-uv.y)*uRes.y); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return textureLod(uNoise, (i+f+.5)/256., 0.).r; }
float fbm(vec2 p){
  float s = 0., a = .5;
  for(int i=0;i<OCT;i++){ s += a*noise(p); p = mat2(1.6,1.2,-1.2,1.6)*p + vec2(17.1,9.3); a *= .5; }
  return s/(1.-pow(.5,float(OCT)));
}
const vec3 MOONC = vec3(.62,.70,.98);
// ---- scene space: q = (x, height) in units of the arena height, y up ----
const float HOR = 0.30, FOV = 1.15, CH = 0.55;
vec2 toQ(vec2 p){ return vec2(p.x/uRes.y, 1. - p.y/uRes.y); }
vec3 camRay(vec2 q){ float asp = uRes.x/uRes.y; return normalize(vec3((q.x-asp*.5)*FOV, (q.y-HOR)*FOV, 1.)); }
float h11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float h31(vec3 p){ p = fract(p*.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.-2.*f); return mix(h11(i), h11(i+1.), f); }
// the sky is built in linear light; this is the same ACES curve + gamma the prototype used
vec3 disp(vec3 x){ x *= 1.9; x = clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); return pow(x, vec3(1./2.2)); }
float fbm1(float x, int o){ float s = 0., a = .5; for(int i=0;i<8;i++){ if(i>=o) break; s += a*n1(x); x = x*2.03+1.7; a *= .5; } return s; }
`;

// ---- 3D terrain: a raymarched, eroded heightfield, rendered ONCE per arena size ----
const SH_TERR = `
uniform float uSeed; uniform vec3 uMoon;
vec3 noised(vec2 x){ vec2 p = floor(x), w = fract(x);
  vec2 u = w*w*w*(w*(w*6.-15.)+10.), du = 30.*w*w*(w*(w-2.)+1.);
  float a = h21(p), b = h21(p+vec2(1,0)), c = h21(p+vec2(0,1)), d = h21(p+vec2(1,1));
  float k1 = b-a, k2 = c-a, k4 = a-b-c+d;
  return vec3(-1.+2.*(a+k1*u.x+k2*u.y+k4*u.x*u.y), 2.*du*vec2(k1+k4*u.y, k2+k4*u.x)); }
const mat2 m2 = mat2(.8,-.6,.6,.8);
float terr(vec2 x, int oct){
  vec2 p = x*.10 + vec2(uSeed*1.7, 3.1);
  float a = 0., b = 1.; vec2 d = vec2(0.);
  for(int i=0;i<12;i++){ if(i>=oct) break; vec3 n = noised(p); d += n.yz; a += b*n.x/(1.+dot(d,d)); b *= .5; p = m2*p*2.; }
  float m = smoothstep(9., 20., x.y);
  float hills = (a*.5+.5)*1.1*smoothstep(3.5, 9., x.y)*(1.-m*.6);
  float big = .55 + .45*sin(x.x*.09+1.3)*cos(x.x*.041-.4);
  return (pow(clamp(a*.5+.55, 0., 1.5), 1.7)*6.6*big)*m + hills - .4;
}
float n2h(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = worldP(), q = toQ(p);
  if(q.y > .62 || q.y < .12){ o = vec4(0.); return; }
  vec3 rd = camRay(q), ro = vec3(0., CH, 0.);
  vec3 L = camRay(toQ(uMoon.xy));
  float t = 1.5, hit = -1.;
  for(int i=0;i<220;i++){
    vec3 x = ro + rd*t;
    if(x.y > 8.5 && rd.y > 0.) break;
    float h = x.y - terr(x.xz, 8);
    if(h < .0015*t){ hit = t; break; }
    t += max(.42*h, .002*t + .004);
    if(t > 140.) break;
  }
  if(hit < 0.){ o = vec4(0.); return; }
  vec3 x = ro + rd*hit;
  float e = .0016*hit + .002;
  vec3 n = normalize(vec3(terr(x.xz-vec2(e,0.),11) - terr(x.xz+vec2(e,0.),11), 2.*e, terr(x.xz-vec2(0.,e),11) - terr(x.xz+vec2(0.,e),11)));
  float sh = 1., st = .05;
  for(int i=0;i<28;i++){ vec3 sp = x + L*st + n*.02; float hh = sp.y - terr(sp.xz, 6); sh = min(sh, 10.*hh/st); st += clamp(hh, .04, .6); if(sh < .001 || sp.y > 8.5) break; }
  sh = clamp(sh, 0., 1.); sh = sh*sh*(3.-2.*sh);
  float dif = clamp(dot(n, L), 0., 1.);
  float nz = n2h(x.xz*3.)*.5 + n2h(x.xz*11.)*.25;
  float snow = smoothstep(.62, .8, n.y + (x.y-3.3)*.30 + (nz-.35)*.55);
  float forest = smoothstep(2.3, 1.5, x.y + nz*.6)*smoothstep(.5, .75, n.y);
  vec3 alb = mix(vec3(.075,.07,.07), vec3(.018,.024,.022)*(.6+.8*n2h(x.xz*40.)), forest);
  alb = mix(alb, vec3(.78,.82,.9), snow);
  vec3 col = alb*(vec3(.80,.86,1.)*dif*sh*1.25 + vec3(.05,.06,.11)*(.55+.45*n.y) + vec3(.006,.0066,.009)*clamp(.5-n.y*.5,0.,1.));
  o = vec4(min(col, vec3(1.)), max(hit/140., .004));
}`;

// ---- volumetric clouds: a 3D deck raymarched toward the moon (low resolution, every frame) ----
const SH_CLOUD = `
uniform sampler2D uTerr, uNoise3; uniform vec3 uMoon; uniform float uCov, uBright, uStorm; uniform vec2 uCOff;
float n3(vec3 x){ vec3 p = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  vec2 uv = (p.xy + vec2(37.,17.)*p.z) + f.xy;
  vec2 rg = textureLod(uNoise3, (uv+.5)/256., 0.).yx;
  return mix(rg.x, rg.y, f.z); }
float cloudD(vec3 p){
  vec3 w = vec3(uCOff.x, 0., uCOff.y);
  float hb = (p.y-2.3)/1.7;
  float prof = smoothstep(0.,.12,hb)*smoothstep(1.,.35,hb);
  if(prof <= 0.) return 0.;
  vec3 q = p*vec3(.36,.9,.26) + w*.36;
  float b = n3(q)*.5 + n3(q*2.03+1.3)*.25 + n3(q*4.1+2.7)*.125 + n3(q*8.3+5.1)*.0625;
  float lo = 1. - uCov;
  float d = smoothstep(lo-.05, lo+.22, b)*prof;
  if(d <= 0.) return 0.;
  float det = n3(p*1.9 + w*1.9)*.55 + n3(p*4.2 - w*2.)*.3;
  d -= det*.38*(1.-d);
  return max(d, 0.)*2.6;
}
void main(){
  vec2 uv = gl_FragCoord.xy/uTarget;
  vec2 p = vec2(uv.x*uRes.x, (1.-uv.y)*uRes.y), q = toQ(p);
  vec3 rd = camRay(q), Ld = camRay(toQ(uMoon.xy));
  vec3 col = vec3(0.); float Tr = 1.;
  float tdE = texture(uTerr, uv).a, td = tdE > .002 ? tdE*140. : -1.;
  if(rd.y > .002){
    float t0 = (2.3-CH)/rd.y, t1 = min((4.0-CH)/rd.y, 90.);
    if(td > 0.) t1 = min(t1, td);
    if(t0 < min(90., t1)){
      float dt = (t1-t0)/float(CSTEPS);
      float t = t0 + dt*h21(gl_FragCoord.xy + fract(uTime)*13.);
      float mu = dot(rd, Ld);
      float hg1 = (1.-.3025)/pow(1.+.3025-1.1*mu, 1.5), hg2 = (1.-.0225)/pow(1.+.0225+.3*mu, 1.5);
      float ph = mix(hg2, hg1, .5)*.07;
      for(int i=0;i<CSTEPS;i++){
        vec3 x = rd*t + vec3(0., CH, 0.);
        float d = cloudD(x);
        if(d > .003){
          float sl = 0.; vec3 lp = x;
          for(int j=0;j<CLSTEPS;j++){ float ls = .26*float(j+1)*(5./float(CLSTEPS+1)); lp += Ld*ls; sl += cloudD(lp)*ls; }
          float lt = exp(-sl*1.5), powder = 1. - exp(-d*4.);
          vec3 moonL = vec3(.86,.9,1.)*(lt*ph*powder*1.6);
          vec3 amb = mix(vec3(.0040,.0050,.0105), vec3(.0065,.0045,.0032), smoothstep(3.2, 2.3, x.y)*.7)*(1.5 - .5*uBright);
          float a = exp(-d*dt*.9);
          col += Tr*(moonL+amb)*(1.-a);
          Tr *= a;
          if(Tr < .02) break;
        }
        t += dt;
      }
      float fade = smoothstep(90., 30., t0);
      col *= fade; Tr = mix(1., Tr, fade);
    }
  }
  o = vec4(col*(1.-uStorm*.6), Tr);
}`;

const SH_ATM = `
uniform vec3 uMoon; uniform float uStorm; uniform vec4 uBolt; uniform float uFloor; uniform vec4 uBandOff; uniform float uFlash;
uniform sampler2D uTerr, uCloud; uniform float uPhase, uSide, uBright;
float stormDeck(vec2 p){
  if(p.y>340.) return 0.;
  vec2 q = vec2(p.x + uBandOff.x*1.3, p.y);
  float base = smoothstep(300.+40.*uStorm, 20., p.y);
  float n = fbm(q*vec2(.0042,.0085) + vec2(0., uTime*.012));
  float w = fbm(q*.011 + vec2(n*3., uTime*.025));
  float d = base*(0.62+0.5*uStorm) + n*0.55 + w*0.45 - 1.02 + 0.22*uStorm;
  return clamp(d*2.4, 0., 1.4);
}
// sky glow: a broad scatter around the moon plus a tight aureole that hugs only the lit part
vec3 skyCol(vec2 q, float k){
  vec2 mq = toQ(uMoon.xy); float rr = uMoon.z/uRes.y;
  float y = q.y;
  vec3 zen = vec3(.0025,.0042,.012), mid = vec3(.010,.014,.035), hor = vec3(.040,.042,.065);
  vec3 c = mix(hor, mid, smoothstep(HOR-.05, .62, y));
  c = mix(c, zen, smoothstep(.55, 1.05, y));
  c += vec3(.03,.017,.012)*exp(-max(y-HOR+.04, 0.)*14.)*.7;
  float fil = .5 + .5*cos((1.-uPhase)*3.14159);
  vec2 hc = mq + vec2(uSide*(1.-fil)*rr*.62, 0.);
  float dh = length(q-hc);
  float ang = (1.-uPhase)*3.14159, dl = 1e3;
  vec2 lq = (q-mq)*vec2(uSide, 1.);
  for(int i=0;i<17;i++){
    float th = (float(i)/16.-.5)*3.1; float yy = sin(th*.5)*rr; float w = sqrt(max(rr*rr-yy*yy, 0.));
    float x0 = -w*cos(ang), x1 = w;
    float dx = max(max(x0-lq.x, lq.x-x1), 0.); dl = min(dl, length(vec2(dx, lq.y-yy)));
  }
  float a1 = exp(-dl/(rr*.26))*.6*smoothstep(0., .15, fil+.02), a2 = exp(-dh/(rr*1.5))*.12, a3 = exp(-dh/(rr*7.))*.045;
  c += vec3(.80,.86,1.)*(a1+a2+a3)*k;
  return c;
}
void main(){
  vec2 p = worldP(), q = toQ(p);
  vec2 uv = gl_FragCoord.xy/uTarget;
  float k = uBright;
  vec3 sky = skyCol(q, k);
  vec4 tr = texture(uTerr, uv);
  vec4 cl = texture(uCloud, uv);
  vec2 mq = toQ(uMoon.xy);
  vec3 fogc = vec3(.020,.024,.045) + vec3(.80,.86,1.)*.03*k*smoothstep(1.3, 0., abs(q.x-mq.x));
  vec3 base = sky; float open = 1.;
  if(tr.a > .002){
    float fa = 1. - exp(-tr.a*140.*.022);
    base = mix(tr.rgb*k, fogc, clamp(fa*1.05, 0., .92)); open = 0.;
  }
  vec3 col = base*cl.a + cl.rgb*k;
  open *= cl.a;
  // haze over the valley floor, then moonlit mist behind the forest
  float m1 = smoothstep(.06, 0., abs(q.y-.26))*(.5 + .5*fbm(vec2(q.x*3.*800. - uBandOff.w*.4, q.y*20.*800.)*.00125));
  col = mix(col, fogc*1.3, m1*.30);
  float mn = fbm(vec2(q.x*4. - uBandOff.w*.0006, q.y*14. + uTime*.02));
  float mist = smoothstep(.255, .17, q.y)*smoothstep(.12, .19, q.y)*(.45 + .75*mn);
  vec3 mistc = vec3(.05,.058,.09)*(.5+k) + vec3(.80,.86,1.)*.05*k*exp(-abs(q.x-mq.x)*1.8);
  col = mix(col, mistc, clamp(mist*.75, 0., 1.));
  // the storm ceiling: a dark deck that thickens and flashes with the weather
  float sd = stormDeck(p);
  if(sd > .003){
    float alpha = (1. - exp(-sd*2.8))*(.35 + .65*uStorm);
    vec3 dark = mix(vec3(.022,.024,.05), vec3(.05,.045,.085), smoothstep(80.,420.,p.y));
    float bl = uBolt.z*exp(-length(p-uBolt.xy)/uBolt.w);
    vec3 cc = dark*(.6+.6*k) + vec3(.72,.8,1.)*bl + vec3(.05,.02,.08)*smoothstep(260.,110.,p.y)*uStorm + vec3(.6,.65,.85)*uFlash*.12;
    col = mix(col, cc, alpha); open *= 1. - alpha;
  }
  float bl2 = uBolt.z*exp(-length(p-uBolt.xy)/(uBolt.w*1.6));
  col += vec3(.72,.8,1.)*bl2*.35*(1. - cl.a);
  col += vec3(.6,.65,.85)*uFlash*.05;
  o = vec4(disp(col), open);
}`;

const SH_FOG = `
uniform vec4 uL[MAXL]; uniform vec3 uLC[MAXL]; uniform int uLN;
uniform vec4 uLamp[MAXLAMP]; uniform int uLampN;
uniform float uStorm, uFlash, uFloor; uniform vec4 uBandOff; uniform vec3 uMoon;
uniform vec4 uBank[MAXBANK]; uniform float uBankD[MAXBANK]; uniform int uBankN; uniform float uHaze, uBright, uDetail;
float bandOffAt(float y, out float fade){
  float y0, y1, off;
  if(y<230.){ y0=110.; y1=230.; off=uBandOff.x; }
  else if(y<380.){ y0=230.; y1=380.; off=uBandOff.y; }
  else if(y<520.){ y0=380.; y1=520.; off=uBandOff.z; }
  else { y0=520.; y1=720.; off=uBandOff.w; }
  fade = smoothstep(y0, y0+28., y)*smoothstep(y1, y1-28., y);
  return off;
}
void main(){
  vec2 p = worldP();
  float fade; float off = bandOffAt(p.y, fade);
  float ground = smoothstep(uFloor-210., uFloor+20., p.y);
  float n = fbm(vec2(p.x + uBandOff.w*1.2 + uTime*3., p.y*2.)*0.005);
  float n2 = fbm(vec2(p.x - uTime*8., p.y)*0.011 + 5.);
  float d = ground*(0.05 + 0.8*n*n)*(1. + uStorm*0.6);
  d += 0.03 + 0.03*n2;
  d += smoothstep(300.,90.,p.y)*0.22*uStorm*(0.4+n2);
  // high haze drifting past the moon — the god rays need something to scatter in
  float hz = smoothstep(uMoon.y-230., uMoon.y-40., p.y)*smoothstep(uMoon.y+300., uMoon.y+60., p.y);
  float hn = fbm(vec2(p.x*0.0032 + uTime*0.02 + uBandOff.x*0.0008, p.y*0.009) + 77.);
  d += hz*0.11*smoothstep(0.3, 0.75, hn)*(1. - 0.5*uStorm);
  float wisp = fbm(vec2((p.x + off*1.8)*0.0026, p.y*0.055) + 31.);
  d += fade*0.10*smoothstep(.6,.85,wisp)*(0.6+uStorm);
  // fog banks (the same shapes the simulation uses for visibility), with billowing edges
  float bank = 0.;
  for(int i=0;i<MAXBANK;i++){
    if(i>=uBankN) break;
    vec4 b = uBank[i]; vec2 u = (p-b.xy)/b.zw; float qq = dot(u,u);
    if(qq < 4.){
      float edge = fbm(p*vec2(.0042,.0075) + vec2(uTime*.03 + float(i)*7.3, float(i)*3.1));
      bank += uBankD[i]*exp(-qq*1.4)*mix(1., .45 + 1.1*edge, uDetail);
    }
  }
  d += bank*1.25 + uHaze*(0.35 + 0.4*n2);
  float dmf = length(p-uMoon.xy);
  vec3 L = vec3(.06,.075,.13)*(1. + uFlash*2.) + vec3(.08,.09,.14)*exp(-dmf/260.)
         + MOONC*(0.35*exp(-dmf/(uMoon.z*1.6)) + 0.14*exp(-dmf/(uMoon.z*4.5)))*(1.-0.6*uStorm);
  for(int i=0;i<MAXL;i++){ if(i>=uLN) break; vec4 l = uL[i]; vec2 v = p-l.xy; float r2 = dot(v,v)/(l.z*l.z); L += uLC[i]*l.w/(1.+r2*7.)*max(0.,1.-r2*0.1); }
  // lamp light: a soft halo plus a downward cone under the lantern roof — brighter inside fog
  for(int i=0;i<MAXLAMP;i++){ if(i>=uLampN) break; vec4 lm = uLamp[i]; vec2 v = p-lm.xy; float dl = length(v)+.001; float cone = smoothstep(.15,.75, v.y/dl);
    L += vec3(1.,.6,.3)*lm.z*(cone*exp(-dl/140.)*0.5*uDetail + exp(-dl/42.)*0.45)*(1. + bank*1.4); }
  L *= .55 + .55*uBright;
  float a = 1. - exp(-d*1.6);
  o = vec4(L*a*1.5, a);
}`;

const SH_RAYS = `
uniform sampler2D uAtm, uAlb; uniform vec3 uMoon; uniform float uRayK;
float src(vec2 uv){
  vec2 p = vec2(uv.x*uRes.x, (1.-uv.y)*uRes.y);
  float d = length(p-uMoon.xy);
  vec4 a = texture(uAtm,uv);
  float m = smoothstep(uMoon.z*1.05, uMoon.z*0.9, d)*0.25*a.a;
  // bright gaps & silver-lit cloud edges near the moon also cast shafts
  m += max(dot(a.rgb, vec3(.3,.5,.2)) - 0.62, 0.)*1.2*exp(-d/(uMoon.z*6.));
  // angular break-up so shafts fan out from the moon
  vec2 dir = normalize(p-uMoon.xy + vec2(0.001));             // periodic → no seam
  float beam = noise(dir*2.4 + vec2(uTime*0.04, 3.))*0.65 + noise(dir*6.5 + vec2(7., uTime*0.07))*0.35;
  m *= 0.5 + 0.85*smoothstep(0.3, 0.8, beam);
  return m*(1.-texture(uAlb,uv).a);
}
void main(){
  vec2 uv = gl_FragCoord.xy/uTarget;
  vec2 muv = vec2(uMoon.x/uRes.x, 1.-uMoon.y/uRes.y);
  vec2 dl = (uv-muv)/float(RS)*0.92;
  vec2 c = uv - dl*hash12(gl_FragCoord.xy + fract(uTime)*97.);
  float acc = 0., w = 1.;
  for(int i=0;i<RS;i++){ acc += src(c)*w; w *= 0.96; c -= dl; }
  o = vec4(vec3(.55,.63,.92)*acc/float(RS)*uRayK, 1.);
}`;

const SH_COMP = `
uniform sampler2D uAtm, uFog, uRays, uAlb, uEmi;
uniform vec3 uMoon; uniform float uStorm, uFlash, uRain, uSlant, uFloor, uEmiGain, uPhase, uSide, uBright;
uniform vec4 uL[MAXL]; uniform vec3 uLC[MAXL]; uniform int uLN;
uniform vec4 uRip[MAXRIP]; uniform int uRipN;
uniform vec4 uHeat[4]; uniform int uHeatN;
// sphere-mapped surface coords (lon, lat): features foreshorten toward the limb
float craterH(vec2 g, float seed, float dens, float rmul){
  vec2 i = floor(g), f = fract(g);
  float h = 0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 c = i + vec2(float(x),float(y));
    if(hash12(c + seed) > dens) continue;
    vec2 ctr = vec2(float(x),float(y)) + vec2(hash12(c+seed+3.1), hash12(c+seed+5.7));
    float r = rmul*(0.45 + 0.55*hash12(c+seed+9.3));
    float dd = length(f - ctr)/r;
    if(dd < 1.7){
      float bowl = dd < 1. ? (dd*dd - 1.)*0.55 : 0.;
      float rim = exp(-pow((dd-1.)/0.2, 2.))*0.3;
      float ejecta = dd > 1. ? exp(-(dd-1.)*3.)*0.06 : 0.;
      h += (bowl + rim + ejecta)*r;
    }
  }
  return h;
}
float mariaAt(vec2 uv){
  float m = fbm(uv*1.15 + vec2(5.2,1.7)) + 0.12*fbm(uv*3.1 + 8.);
  return smoothstep(.42,.56,m);
}
float moonHeight(vec2 uv){
  float mr = mariaAt(uv);
  float h = craterH(uv*2.4, 1.3, 0.3, 0.42)*1.5;                      // a few big walled plains
  h += craterH(uv*5.5, 7.9, 0.34, 0.34)*0.8*(1.-0.75*mr);
  h += craterH(uv*12., 4.4, 0.26, 0.3)*0.35*(1.-0.85*mr);             // maria are smooth lava plains
  h += (fbm(uv*9.+2.) - .5)*0.05*(1.-0.6*mr);
  return h;
}
float moonAlbedo(vec2 uv){
  float maria = mariaAt(uv)*(0.8 + 0.2*fbm(uv*4.+9.));
  float a = mix(1.0, 0.46, maria);
  a *= 0.9 + 0.2*fbm(uv*11. + 3.);
  // a young bright crater with a faint ray system (Tycho-like)
  vec2 t = uv - vec2(-0.25, -0.55);
  float ang = atan(t.y, t.x), rd = length(t);
  float rays = pow(max(0., noise(vec2(ang*7., 3.)) - 0.35)/0.65, 3.)*exp(-rd*1.6)*smoothstep(0.03,0.08,rd);
  a += rays*0.3 + exp(-rd*rd/0.002)*0.4;
  return a;
}
vec3 moonDisc(vec2 p){
  vec2 d = (p-uMoon.xy)/uMoon.z; float r = length(d);
  if(r>1.02) return vec3(0.);
  float z = sqrt(max(0.,1.-r*r));
  vec3 n = vec3(d.x, -d.y, z);
  vec2 uv = vec2(atan(n.x, n.z) + 0.18, asin(clamp(n.y,-1.,1.)) - 0.08);
  float e = 0.012;
  float h0 = moonHeight(uv), hu = moonHeight(uv+vec2(e,0.)), hv = moonHeight(uv+vec2(0.,e));
  vec3 Tu = vec3(cos(uv.x), 0., -sin(uv.x)), Tv = vec3(0., 1., 0.);
  vec3 nb = normalize(n - (Tu*(hu-h0) + Tv*(hv-h0))/e*0.3);
  // phase: the sun's direction swings from behind the moon (new) to behind us (full)
  float ang = (1.-uPhase)*3.14159;
  vec3 S = normalize(vec3(sin(ang)*uSide, .12, cos(ang)));
  float mu0 = dot(nb, S), mu = max(z, 0.05);
  float ls = max(mu0,0.)/(max(mu0,0.) + mu);          // Lommel–Seeliger: lunar regolith
  float lit = mix(ls*2.0, max(mu0,0.), 0.4)*smoothstep(-0.05, 0.07, dot(n,S));
  float alb = moonAlbedo(uv);
  vec3 c = vec3(1.0,.96,.9)*alb*lit*2.4;
  c += vec3(.30,.36,.5)*alb*0.004;                     // earthshine — barely there, so the dark side matches the sky
  return c;
}
float moonMask(vec2 p){ return smoothstep(1.03,.985,length(p-uMoon.xy)/uMoon.z); }
// stars: sparse, and only where the sky is really dark — the moon's glare, cloud, haze and a
// bright phase all wash them out gradually (no hard empty ring around the moon)
vec3 stars(vec2 p, float skyLum){
  vec2 g = p/3.2; vec2 i = floor(g); vec2 f = fract(g)-.5;
  float h = h21(i+17.);
  if(h < .9978) return vec3(0.);
  vec2 off = (vec2(h21(i+3.), h21(i+9.))-.5)*.7;
  float r = length(f-off);
  float mag = pow(h21(i+29.), 6.);
  float tw = .75 + .25*sin(uTime*3. + h*60.);
  float vis = smoothstep(.026, .005, skyLum)*(1. - .45*uBright);
  return mix(vec3(.80,.86,1.), vec3(1.,.88,.72), step(.7, fract(h*313.)))*exp(-r*r*14.)*(.15 + mag*2.2)*tw*vis*1.6;
}
// forest band and lakeside village, drawn sharp at full resolution in front of the valley mist
float H2(float x){ return .168 + .045*fbm1(x*2.2+7., 5); }
vec3 pines(vec2 q, float gy, float scale, float seed, float dens){
  float cw = .010*scale; float ci = floor(q.x/cw);
  float cov = 0., rim = 0.;
  for(int k=-2;k<=2;k++){
    float c = ci + float(k); float h = h11(c*1.37+seed);
    if(h > dens) continue;
    float x0 = (c + .5 + (h11(c+seed*3.)-.5)*.8)*cw;
    float th = (.028 + .03*h11(c*7.1+seed))*scale, tw = th*.30;
    float base = gy - .004*scale, t = (q.y-base)/th;
    if(t < 0. || t > 1.) continue;
    float sawv = fract(t*6.);
    float hw = tw*(1.-t)*(.62+.38*(1.-sawv)) + tw*.05;
    hw *= .9 + .25*n1(q.y*600./scale + c);
    float dx = q.x - x0, e = hw - abs(dx), px = 1./uRes.y;
    float a = smoothstep(-px, px, e);
    if(t < .08 && abs(dx) < tw*.06) a = 1.;
    cov = max(cov, a);
    if(a > 0. && dx*sign(uMoon.x/uRes.y - x0) > 0.) rim = max(rim, exp(-e/(.0016*scale))*a);
  }
  return vec3(cov, rim, 0.);
}
vec3 valleyBand(vec2 q, vec3 bg, out float cover){
  cover = 0.;
  float h2 = H2(q.x);
  if(q.y > h2 + .062) return bg;
  float k = uBright;
  vec3 pf = pines(q, h2, 1., 5., .85);
  vec3 c = bg;
  if(q.y < h2 || pf.x > 0.){
    vec3 grd = vec3(.006,.008,.016) + vec3(.80,.86,1.)*.006*k;
    vec3 tc = vec3(.004,.006,.012) + vec3(.80,.86,1.)*pf.y*.05*k;
    vec3 hc = q.y < h2 ? grd : tc;
    hc = mix(hc, tc, pf.x);
    c = disp(hc + mix(vec3(0.), vec3(.05,.058,.09)*(.5+k)*.35, smoothstep(h2-.0, h2-.05, q.y))); cover = 1.;
  }
  // village cottages on the valley floor (left) and a few cabins (right), windows lit
  float asp = uRes.x/uRes.y;
  float cwd = .05; float ci = floor(q.x/cwd);
  for(int kk=-1;kk<=1;kk++){
    float cc = ci + float(kk), hx = h11(cc*3.1+5.);
    float x0 = (cc+.5)*cwd + (hx-.5)*.012;
    float fx = x0/asp;
    bool inTown = (fx > .05 && fx < .34) || (fx > .72 && fx < .86 && hx > .45);
    if(!inTown) continue;
    float base = H2(x0) - .03 - .02*h11(cc*2.3);
    float w = .012 + .006*h11(cc+1.), hh = .015 + .01*h11(cc*5.);
    float dx = q.x - x0, y = q.y - base, roof = hh + (w - abs(dx))*.9;
    if(abs(dx) < w && y > 0. && y < roof){
      c = disp(vec3(.003,.004,.008)); cover = 1.;
      vec2 wp = vec2(dx/w, y/hh); vec2 cell = floor(vec2(wp.x*2.5, wp.y*2.2)); vec2 fr = fract(vec2(wp.x*2.5, wp.y*2.2));
      float on = step(.45, h21(cell+cc*7.));
      float win = on*step(.3,fr.x)*step(fr.x,.7)*step(.25,fr.y)*step(fr.y,.75)*step(y,hh*.9)*step(.15,y/hh);
      c += vec3(1.,.66,.34)*win*(0.9 + .2*h21(cell+cc))*(.85 + .15*sin(uTime*1.3 + cc));
    }
    float chx = x0 + w*.45;
    if(h11(cc*9.) > .4 && abs(q.x-chx) < .0022 && y > 0. && y < hh + w*.55){ c = disp(vec3(.003,.004,.008)); cover = 1.; }
  }
  return c;
}
float rainL(vec2 p, float sc, float sp){
  p.x += p.y*uSlant;
  float cw = 5.*sc;
  float h = hash12(vec2(floor(p.x/cw), sc*17.));
  if(h < 1. - 0.55*uRain) return 0.;
  float period = 230.*sc;
  float seg = fract((p.y - uTime*(950.+420.*h)*sp + h*1000.)/period);
  float s = smoothstep(0.,.02,seg)*(1.-smoothstep(.06,.16,seg));
  float xf = abs(fract(p.x/cw)-.5)*cw;
  return s*smoothstep(0.9*sc,0.,xf);
}
void main(){
  vec2 uv = gl_FragCoord.xy/uTarget;
  vec2 p = vec2(uv.x*uRes.x, (1.-uv.y)*uRes.y);
  vec2 off = vec2(0.);
  for(int i=0;i<MAXRIP;i++){ if(i>=uRipN) break; vec4 r = uRip[i]; vec2 d = p-r.xy; float dl = length(d)+.001; off += d/dl*exp(-pow((dl-r.z)/12.,2.))*r.w; }
  for(int i=0;i<4;i++){ if(i>=uHeatN) break; vec4 h = uHeat[i]; vec2 d = p-h.xy; float f = h.w*exp(-dot(d,d)/(h.z*h.z));
    if(f>0.01) off += (vec2(noise(p*0.2 + vec2(0., uTime*10.)), noise(p*0.2 + vec2(19., uTime*10.))) - .5)*f; }
  vec2 q = p + off;
  vec2 uv2 = vec2(q.x/uRes.x, 1. - q.y/uRes.y);
  vec4 atm = texture(uAtm, uv2);
  vec3 bg = atm.rgb;
  float open = atm.a;
  float mm = moonMask(q);
  vec3 bgl = pow(bg, vec3(2.2))/1.9; float skyLum = dot(bgl, vec3(.3,.5,.2));
  bg += stars(q, skyLum)*open*(1.-mm)*(1.-uStorm*.85);
  // the disc adds light; its dark side shows only the sky (and the faintest earthshine)
  float Tm = smoothstep(0.02, 0.95, open);
  if(mm>0.){ vec3 md = moonDisc(q); bg = max(bg, min(disp(bgl + md*.3*(.4 + .6*uBright)), vec3(.9))*mm*Tm + bg*(1.-mm*Tm)); }
  float bandCover; bg = valleyBand(toQ(q), bg, bandCover);
  vec4 al = texture(uAlb, uv2);
  vec3 L = vec3(.40,.45,.66)*(.6 + .55*uBright)*(1.+uFlash*0.9);
  for(int i=0;i<MAXL;i++){ if(i>=uLN) break; vec4 l = uL[i]; vec2 v = q-l.xy; float r2 = dot(v,v)/(l.z*l.z); L += uLC[i]*l.w/(1.+r2*5.)*max(0.,1.-r2*0.1); }
  L = L - max(L-vec3(0.9),0.)*0.6;            // soft shoulder: nearby lamps & fire can't bleach the albedo
  vec3 col = bg*(1.-al.a) + al.rgb*L;
  vec4 fg = texture(uFog, uv2);
  col = col*(1.-fg.a) + fg.rgb;
  col += texture(uEmi, uv2).rgb*uEmiGain*(1.-0.35*fg.a);
  col += texture(uRays, uv2).rgb*(0.45 + 2.2*fg.a)*(1.-0.9*moonMask(q))*uBright;
  if(uRain>0.01){
    float r = rainL(q,1.,1.) + rainL(q*1.7+vec2(31.,0.),0.6,0.7)*0.6;
    col += (L*0.35 + vec3(.15,.17,.25))*r*uRain*0.55;
  }
  o = vec4(col, 1.);
}`;

const SH_EXTRACT = `
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThr;
void main(){
  vec2 uv = gl_FragCoord.xy/uTarget;
  vec3 c = texture(uSrc, uv+uTexel*vec2(-.5,-.5)).rgb + texture(uSrc, uv+uTexel*vec2(.5,-.5)).rgb
         + texture(uSrc, uv+uTexel*vec2(-.5,.5)).rgb + texture(uSrc, uv+uTexel*vec2(.5,.5)).rgb;
  c *= .25;
  float l = max(max(c.r,c.g),c.b);
  o = vec4(c*max(0.,l-uThr)/max(l,1e-4), 1.);
}`;
const SH_DOWN = `
uniform sampler2D uSrc; uniform vec2 uTexel;
void main(){
  vec2 uv = gl_FragCoord.xy/uTarget;
  o = vec4((texture(uSrc, uv+uTexel*vec2(-1.,-1.)).rgb + texture(uSrc, uv+uTexel*vec2(1.,-1.)).rgb
          + texture(uSrc, uv+uTexel*vec2(-1.,1.)).rgb + texture(uSrc, uv+uTexel*vec2(1.,1.)).rgb)*.25, 1.);
}`;
const SH_BLUR = `
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  vec2 uv = gl_FragCoord.xy/uTarget;
  vec3 c = texture(uSrc,uv).rgb*0.227027;
  c += (texture(uSrc,uv+uDir*1.3846).rgb + texture(uSrc,uv-uDir*1.3846).rgb)*0.3162162;
  c += (texture(uSrc,uv+uDir*3.2308).rgb + texture(uSrc,uv-uDir*3.2308).rgb)*0.0702703;
  o = vec4(c,1.);
}`;
const SH_FINAL = `
uniform sampler2D uHDR, uB1, uB2, uB3; uniform vec3 uShake; uniform float uFlashW, uBloomK; uniform int uBloomN;
vec3 tm(vec3 x){ vec3 a = vec3(.7); vec3 y = a + (1.-a)*(1.-exp(-(x-a)/(1.-a))); return mix(x, y, step(a,x)); }
void main(){
  vec2 uv = gl_FragCoord.xy/uTarget;
  vec2 suv = (uv-.5)/uShake.z + .5 + uShake.xy;
  vec2 dir = suv-.5; float ca = dot(dir,dir)*0.0045;
  vec3 col = vec3(texture(uHDR, suv+dir*ca).r, texture(uHDR, suv).g, texture(uHDR, suv-dir*ca).b);
  vec3 bl = texture(uB1,suv).rgb*0.55 + texture(uB2,suv).rgb*0.75;
  if(uBloomN>2) bl += texture(uB3,suv).rgb*0.95;
  col += bl*uBloomK;
  col = tm(col);
  float lum = dot(col, vec3(.299,.587,.114));
  col = mix(vec3(lum), col, 1.08);
  col += vec3(-.004,.002,.012)*(1.-lum);
  vec2 vv = (uv-.5)*vec2(1.05,1.);
  col *= 1. - 0.42*pow(dot(vv,vv)*2.2, 1.35);
  col = mix(col, vec3(1.,.98,.93), uFlashW);
  col += (hash12(gl_FragCoord.xy + fract(uTime*7.)*311.) - .5)*0.022;
  o = vec4(clamp(col,0.,1.),1.);
}`;

const GLR = (function(){
  let gl = null, canvas = null, ok = false, hdr = false, Q = QUALITY[settings.quality] || QUALITY.high;
  const P = {}; let T = {}; let texAlb=null, texEmi=null, texNoise=null, texNoise3=null, texMtn=null, vao=null, buf=null;
  let terrRow = 0, terrKey = '';
  const bankBuf = new Float32Array(MAXBANK*4), bankD = new Float32Array(MAXBANK); let bankN = 0;
  const heatBuf = new Float32Array(16); let heatN = 0;
  let upW = 0, upH = 0;
  const lightBuf = new Float32Array(MAXL*4), lightCol = new Float32Array(MAXL*3);
  const lampBuf = new Float32Array(MAXLAMP*4), ripBuf = new Float32Array(MAXRIP*4);
  let lightN = 0, lampN = 0, ripN = 0;

  function compile(type, src){
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ const log = gl.getShaderInfoLog(s); console.error(log, src.split('\n').map((l,i)=>(i+1)+': '+l).join('\n')); throw new Error('shader: '+log); }
    return s;
  }
  function program(fs){
    const defs = `#version 300 es\n#define OCT ${Q.oct}\n#define LSTEPS ${Q.lsteps}\n#define RS ${Q.rays}\n#define MAXL ${MAXL}\n#define MAXLAMP ${MAXLAMP}\n#define MAXRIP ${MAXRIP}\n#define MAXBANK ${MAXBANK}\n#define CSTEPS ${Q.csteps}\n#define CLSTEPS ${Q.clsteps}\n`;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, SH_VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, defs + SH_COMMON + fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: '+gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for(let i=0;i<n;i++){ const info = gl.getActiveUniform(p,i); const nm = info.name.replace(/\[0\]$/,''); u[nm] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  function buildPrograms(){
    for(const k in P){ gl.deleteProgram(P[k].p); delete P[k]; }
    P.terr = program(SH_TERR); P.cloud = program(SH_CLOUD);
    P.atm = program(SH_ATM); P.fog = program(SH_FOG); P.rays = program(SH_RAYS); P.comp = program(SH_COMP);
    P.extract = program(SH_EXTRACT); P.down = program(SH_DOWN); P.blur = program(SH_BLUR); P.fin = program(SH_FINAL);
  }
  function target(w,h,float){
    w = Math.max(2,Math.round(w)); h = Math.max(2,Math.round(h));
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    if(float && hdr) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);
    else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }
  function freeTargets(){ for(const k in T){ gl.deleteTexture(T[k].tex); gl.deleteFramebuffer(T[k].fbo); } T = {}; }
  function buildTargets(){
    freeTargets();
    const a = Q.atm;
    T.atm = target(W*a, H*a, true); T.fog = target(W*a, H*a, true); T.rays = target(W*a, H*a, true);
    const tr = Math.min(1, Q.rs || 1);
    T.terr = target(W*tr, H*tr, false); T.cloud = target(W*Q.cres, H*Q.cres, true);
    terrRow = 0;
    const r = Q.rs || 1, w = W*r, h = H*r;
    T.hdr = target(w, h, true);
    T.b1 = target(w/2, h/2, true); T.b1t = target(w/2, h/2, true);
    T.b2 = target(w/4, h/4, true); T.b2t = target(w/4, h/4, true);
    T.b3 = target(w/8, h/8, true); T.b3t = target(w/8, h/8, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function makeTex(){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function init(cv){
    canvas = cv;
    try{ gl = cv.getContext('webgl2', { alpha:false, antialias:false, depth:false, stencil:false, premultipliedAlpha:false, powerPreference:'high-performance' }); }catch(e){ gl = null; }
    if(!gl) return false;
    try{
      hdr = !!gl.getExtension('EXT_color_buffer_float');
      buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      // value-noise source texture
      texNoise = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texNoise);
      const data = new Uint8Array(256*256); for(let i=0;i<data.length;i++) data[i] = (Math.random()*256)|0;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,256,256,0,gl.RED,gl.UNSIGNED_BYTE,data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      // RG noise for cheap 3D value noise (G = R shifted by (37,17))
      texNoise3 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texNoise3);
      const d3 = new Uint8Array(256*256*2);
      for(let y=0;y<256;y++) for(let x=0;x<256;x++){ const i = (y*256+x)*2; d3[i] = data[y*256+x]; d3[i+1] = data[((y+256-17)%256)*256 + (x+256-37)%256]; }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RG8,256,256,0,gl.RG,gl.UNSIGNED_BYTE,d3);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      texAlb = makeTex(); texEmi = makeTex();
      buildPrograms();
      ok = true;
      resize();
    }catch(e){ console.error(e); ok = false; }
    return ok;
  }
  function resize(){
    if(!ok) return;
    canvas.width = Math.round(W*(Q.rs||1)); canvas.height = Math.round(H*(Q.rs||1));
    buildTargets(); upW = 0; upH = 0;
    if(texMtn) gl.deleteTexture(texMtn);
    texMtn = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texMtn);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,W,1,0,gl.RGBA,gl.FLOAT,mountainProfile());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }
  function setQuality(key){
    Q = QUALITY[key] || QUALITY.high;
    if(!ok) return;
    try{
      buildPrograms(); buildTargets();
      canvas.width = Math.round(W*(Q.rs||1)); canvas.height = Math.round(H*(Q.rs||1));
      upW = 0; upH = 0; sizeLayers();
    }catch(e){ console.error(e); ok = false; }
  }
  function upload(tex, src){
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if(upW!==src.width || upH!==src.height) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);
    else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,src);
  }
  function bindTex(unit, tex, prog, name){
    gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    if(prog.u[name]) gl.uniform1i(prog.u[name], unit);
  }
  function pass(prog, tgt, setup){
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fbo : null);
    const w = tgt ? tgt.w : canvas.width, h = tgt ? tgt.h : canvas.height;
    gl.viewport(0,0,w,h);
    const u = prog.u;
    if(u.uRes) gl.uniform2f(u.uRes, W, H);
    if(u.uTarget) gl.uniform2f(u.uTarget, w, h);
    if(u.uTime) gl.uniform1f(u.uTime, windTime);
    bindTex(0, texNoise, prog, 'uNoise');
    setup(u, prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function setLights(u){
    if(u.uL){ gl.uniform4fv(u.uL, lightBuf); gl.uniform3fv(u.uLC, lightCol); gl.uniform1i(u.uLN, lightN); }
  }
  function render(F){
    if(!ok || gl.isContextLost()) return false;
    // pack lights
    lightN = Math.min(MAXL, F.lights.length);
    for(let i=0;i<lightN;i++){ const l = F.lights[i]; lightBuf.set([l[0],l[1],l[2],l[3]], i*4); lightCol.set([l[4],l[5],l[6]], i*3); }
    lampN = Math.min(MAXLAMP, F.lamps.length);
    for(let i=0;i<lampN;i++) lampBuf.set(F.lamps[i], i*4);
    ripN = Math.min(MAXRIP, F.ripples.length);
    for(let i=0;i<ripN;i++) ripBuf.set(F.ripples[i], i*4);

    upload(texAlb, albCanvas); upload(texEmi, emiCanvas);
    upW = albCanvas.width; upH = albCanvas.height;
    gl.disable(gl.BLEND);

    heatN = Math.min(4, F.heat.length);
    for(let i=0;i<heatN;i++) heatBuf.set(F.heat[i], i*4);
    // the mountains are raymarched once per arena size, a strip per frame (no hitch)
    const tk = W+'x'+H+':'+Math.round(F.moon.x/40)+':'+Math.round(F.moon.y/40);
    if(tk!==terrKey){ terrKey = tk; terrRow = 0; }
    if(terrRow < T.terr.h){
      const rows = Math.max(24, Math.ceil(T.terr.h/14));
      gl.enable(gl.SCISSOR_TEST); gl.scissor(0, terrRow, T.terr.w, rows);
      if(terrRow===0){ gl.bindFramebuffer(gl.FRAMEBUFFER, T.terr.fbo); gl.viewport(0,0,T.terr.w,T.terr.h); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
      pass(P.terr, T.terr, (u)=>{ gl.uniform3f(u.uMoon, F.moon.x, F.moon.y, F.moon.r); gl.uniform1f(u.uSeed, 0); });
      gl.disable(gl.SCISSOR_TEST);
      terrRow += rows;
    }
    if(settings.vclouds===false){ gl.bindFramebuffer(gl.FRAMEBUFFER, T.cloud.fbo); gl.viewport(0,0,T.cloud.w,T.cloud.h); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); }
    else pass(P.cloud, T.cloud, (u,p)=>{
      bindTex(6, T.terr.tex, p, 'uTerr'); bindTex(7, texNoise3, p, 'uNoise3');
      gl.uniform3f(u.uMoon, F.moon.x, F.moon.y, F.moon.r);
      gl.uniform1f(u.uCov, F.cov); gl.uniform1f(u.uBright, F.bright); gl.uniform1f(u.uStorm, F.storm);
      gl.uniform2f(u.uCOff, F.coff[0], F.coff[1]);
    });
    pass(P.atm, T.atm, (u,p)=>{
      bindTex(6, T.terr.tex, p, 'uTerr'); bindTex(7, T.cloud.tex, p, 'uCloud');
      gl.uniform1f(u.uPhase, F.phase); gl.uniform1f(u.uSide, F.side); gl.uniform1f(u.uBright, F.bright);
      gl.uniform3f(u.uMoon, F.moon.x, F.moon.y, F.moon.r);
      gl.uniform1f(u.uStorm, F.storm); gl.uniform4f(u.uBolt, F.bolt[0],F.bolt[1],F.bolt[2],F.bolt[3]);
      gl.uniform1f(u.uFloor, FLOOR_Y); gl.uniform4f(u.uBandOff, ...F.bandOff); gl.uniform1f(u.uFlash, F.flash);
    });
    pass(P.fog, T.fog, u=>{
      setLights(u);
      gl.uniform4fv(u.uLamp, lampBuf); gl.uniform1i(u.uLampN, lampN);
      gl.uniform1f(u.uStorm, F.storm); gl.uniform1f(u.uFlash, F.flash); gl.uniform1f(u.uFloor, FLOOR_Y);
      gl.uniform4f(u.uBandOff, ...F.bandOff); gl.uniform3f(u.uMoon, F.moon.x, F.moon.y, F.moon.r);
      bankN = Math.min(MAXBANK, F.banks.length);
      for(let i=0;i<bankN;i++){ const b = F.banks[i]; bankBuf.set([b[0],b[1],b[2],b[3]], i*4); bankD[i] = b[4]; }
      gl.uniform4fv(u.uBank, bankBuf); gl.uniform1fv(u.uBankD, bankD); gl.uniform1i(u.uBankN, bankN);
      gl.uniform1f(u.uHaze, F.haze); gl.uniform1f(u.uBright, F.bright); gl.uniform1f(u.uDetail, settings.vfog===false ? 0 : 1);
    });
    pass(P.rays, T.rays, (u,p)=>{
      bindTex(1, T.atm.tex, p, 'uAtm'); bindTex(2, texAlb, p, 'uAlb');
      gl.uniform3f(u.uMoon, F.moon.x, F.moon.y, F.moon.r); gl.uniform1f(u.uRayK, F.rayK);
    });
    pass(P.comp, T.hdr, (u,p)=>{
      bindTex(1, T.atm.tex, p, 'uAtm'); bindTex(2, T.fog.tex, p, 'uFog'); bindTex(3, T.rays.tex, p, 'uRays');
      bindTex(4, texAlb, p, 'uAlb'); bindTex(5, texEmi, p, 'uEmi');
      gl.uniform3f(u.uMoon, F.moon.x, F.moon.y, F.moon.r);
      gl.uniform1f(u.uStorm, F.storm); gl.uniform1f(u.uFlash, F.flash); gl.uniform1f(u.uRain, F.rain);
      gl.uniform1f(u.uSlant, F.slant); gl.uniform1f(u.uFloor, FLOOR_Y); gl.uniform1f(u.uEmiGain, hdr ? 1.7 : 1.25);
      gl.uniform1f(u.uPhase, F.phase); gl.uniform1f(u.uSide, F.side); gl.uniform1f(u.uBright, F.bright);
      setLights(u);
      gl.uniform4fv(u.uRip, ripBuf); gl.uniform1i(u.uRipN, ripN);
      gl.uniform4fv(u.uHeat, heatBuf); gl.uniform1i(u.uHeatN, heatN);
    });
    // bloom
    pass(P.extract, T.b1, (u,p)=>{ bindTex(1, T.hdr.tex, p, 'uSrc'); gl.uniform2f(u.uTexel, 1/T.hdr.w, 1/T.hdr.h); gl.uniform1f(u.uThr, hdr ? 0.85 : 0.72); });
    const blur = (a, tmp)=>{
      pass(P.blur, tmp, (u,p)=>{ bindTex(1, a.tex, p, 'uSrc'); gl.uniform2f(u.uDir, 1/a.w, 0); });
      pass(P.blur, a, (u,p)=>{ bindTex(1, tmp.tex, p, 'uSrc'); gl.uniform2f(u.uDir, 0, 1/a.h); });
    };
    blur(T.b1, T.b1t);
    pass(P.down, T.b2, (u,p)=>{ bindTex(1, T.b1.tex, p, 'uSrc'); gl.uniform2f(u.uTexel, 1/T.b1.w, 1/T.b1.h); });
    blur(T.b2, T.b2t);
    if(Q.bloom>2){
      pass(P.down, T.b3, (u,p)=>{ bindTex(1, T.b2.tex, p, 'uSrc'); gl.uniform2f(u.uTexel, 1/T.b2.w, 1/T.b2.h); });
      blur(T.b3, T.b3t);
    }
    pass(P.fin, null, (u,p)=>{
      bindTex(1, T.hdr.tex, p, 'uHDR'); bindTex(2, T.b1.tex, p, 'uB1'); bindTex(3, T.b2.tex, p, 'uB2'); bindTex(4, T.b3.tex, p, 'uB3');
      gl.uniform3f(u.uShake, F.shake[0], F.shake[1], F.shake[2]);
      gl.uniform1f(u.uFlashW, F.flashW); gl.uniform1f(u.uBloomK, 0.9); gl.uniform1i(u.uBloomN, Q.bloom);
    });
    return true;
  }
  return {
    init, resize, render, setQuality,
    get rs(){ return Q.rs || 1; },
    get ok(){ return ok && gl && !gl.isContextLost(); },
    get hdr(){ return hdr; },
    lose(){ ok = false; },
    restore(){ return init(canvas); }
  };
})();

// ---------- 2D fallback compositor (no WebGL2) ----------
let fbSky = null, fbTmp = null;
function compose2D(ctx){
  if(!fbSky || fbSky.width!==W){
    fbSky = document.createElement('canvas'); fbSky.width = W; fbSky.height = H;
    const g = fbSky.getContext('2d');
    const gr = g.createLinearGradient(0,0,0,FLOOR_Y);
    gr.addColorStop(0,'#03050f'); gr.addColorStop(0.55,'#0b0f2c'); gr.addColorStop(1,'#2b2347');
    g.fillStyle = gr; g.fillRect(0,0,W,H);
    for(let i=0;i<260*W/1200;i++){ g.fillStyle = `rgba(230,240,255,${rand(0.2,0.9)})`; g.fillRect(rand(0,W), rand(0,FLOOR_Y*0.6), 1.2, 1.2); }
    const m = moon();
    const hg = g.createRadialGradient(m.x,m.y,m.r*0.8,m.x,m.y,m.r*5);
    hg.addColorStop(0,'rgba(160,180,240,0.35)'); hg.addColorStop(1,'rgba(160,180,240,0)');
    g.fillStyle = hg; g.fillRect(0,0,W,H);
    const mg = g.createRadialGradient(m.x-m.r*0.3,m.y-m.r*0.3,m.r*0.1,m.x,m.y,m.r);
    mg.addColorStop(0,'#fffdf2'); mg.addColorStop(1,'#bdb9ad');
    g.fillStyle = mg; g.beginPath(); g.arc(m.x,m.y,m.r,0,Math.PI*2); g.fill();
    const prof = mountainProfile();
    ['#141a33','#0d1126','#080a17'].forEach((c,k)=>{
      g.fillStyle = c; g.beginPath(); g.moveTo(0,H);
      for(let x=0;x<W;x+=2) g.lineTo(x, prof[x*4+k]);
      g.lineTo(W,H); g.closePath(); g.fill();
    });
    fbTmp = document.createElement('canvas'); fbTmp.width = W; fbTmp.height = H;
  }
  ctx.save();
  ctx.translate(shakeOX, shakeOY);
  ctx.drawImage(fbSky,0,0);
  const t = fbTmp.getContext('2d');
  t.globalCompositeOperation = 'source-over'; t.clearRect(0,0,W,H); t.drawImage(albCanvas,0,0,W,H);
  t.globalCompositeOperation = 'source-atop'; t.fillStyle = 'rgba(12,16,48,0.5)'; t.fillRect(0,0,W,H);
  ctx.drawImage(fbTmp,0,0);
  ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(emiCanvas,0,0,W,H);
  ctx.restore();
  if(flashAlpha>0){ ctx.fillStyle = `rgba(255,250,235,${flashAlpha*0.8})`; ctx.fillRect(0,0,W,H); }
}

// ---------- mountain silhouettes: ridged value-noise, deterministic ----------
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mountainProfile(){
  // distinct peaks (union of tapered triangles) + fine ridge detail
  const data = new Float32Array(W*4);
  const layers = [
    { spacing:300, base:660, hMin:100, hMax:250, wMin:150, wMax:280, detail:22, seed:11, peaky:1.35 },
    { spacing:200, base:680, hMin:45,  hMax:120, wMin:110, wMax:200, detail:12, seed:37, peaky:1.15 },
    { spacing:0,   base:696, hMin:0,   hMax:0,   wMin:0,   wMax:0,   detail:0,  seed:71, peaky:1 }];
  layers.forEach((L,k)=>{
    const rnd = mulberry32(L.seed + Math.round(W));
    const lat = new Float32Array(2048); for(let i=0;i<lat.length;i++) lat[i] = rnd();
    const vn = (u)=>{ const i = Math.floor(u), f = u-i, g = f*f*(3-2*f); const a = lat[(i%2048+2048)%2048], b = lat[((i+1)%2048+2048)%2048]; return a+(b-a)*g; };
    const peaks = [];
    if(L.spacing){
      for(let x=-L.spacing; x<W+L.spacing; x+=L.spacing*(0.7+rnd()*0.7)){
        const pk = { c:x, h:L.hMin+(L.hMax-L.hMin)*Math.pow(rnd(),0.8), w:L.wMin+(L.wMax-L.wMin)*rnd(), skew:0.6+rnd()*0.8, p:L.peaky*(0.8+rnd()*0.6) };
        peaks.push(pk);
        // shoulders and sub-summits keep the range from reading as a row of pyramids
        const ns = 1 + (rnd()*2|0);
        for(let j=0;j<ns;j++){ const side = rnd()<0.5?-1:1; peaks.push({ c:x+side*pk.w*(0.35+rnd()*0.4), h:pk.h*(0.45+rnd()*0.35), w:pk.w*(0.4+rnd()*0.3), skew:0.7+rnd()*0.6, p:L.peaky*(0.9+rnd()*0.5) }); }
      }
    }
    for(let x=0;x<W;x++){
      let top = 0;
      for(const pk of peaks){
        const dx = x-pk.c, w = dx<0 ? pk.w : pk.w*pk.skew;
        const t = Math.abs(dx)/w;
        if(t<1) top = Math.max(top, pk.h*Math.pow(1-t, pk.p));
      }
      let h;
      if(k<2){
        const det = (vn(x/22)-0.5)*0.6 + (vn(x/9+50)-0.5)*0.4;
        h = L.base - top - det*L.detail*(0.4 + top/L.hMax);
      } else {
        h = L.base - 26*vn(x/160) - 12*vn(x/55+30);
      }
      data[x*4+k] = h;
    }
  });
  return data;
}

// ---------- per-frame light list ----------
function gatherFrame(){
  const lights = [], lamps = [];
  for(const l of LAMPS){
    const f = lampFlicker(l);
    if(f<0.02) continue;
    const p = lampLightPos(l);
    lights.push([p.x, p.y+4, 130, 0.85*f, 1.0,0.68,0.38]);
    lamps.push([p.x, p.y+8, f, 0]);
  }
  if(started && p1){
    for(const b of [p1,p2]){
      if(b.alive){
        const h = b.burnerHeat;
        lights.push([b.x, b.y+22, 55+35*h, 0.12+0.45*h, 1.0,0.55,0.25]);
        if(b.boostT>0) lights.push([b.x - b.boostDir*30, b.y+44, 130, 1.5, 0.65,0.78,1.0]);
        else if(b.steer) lights.push([b.x - b.steer*24, b.y+44, 45, 0.35, 0.6,0.75,1.0]);
        if(b.shieldTimer>0) lights.push([b.x, b.y+4, 100, 0.35, 0.4,0.8,1.0]);
        if(b.patching) lights.push([b.x, b.y-8, 70, 0.5, 0.5,1.0,0.85]);
      } else if(b.y < GROUND_Y+20 || b.deadT < 6){
        lights.push([b.x, b.y, 150, 1.1*(0.85+0.15*Math.sin(windTime*13)), 1.0,0.5,0.2]);
      }
    }
    for(const m of rockets) if(m.lit) lights.push([m.x, m.y, 100, 1.0, 1.0,0.6,0.3]);
    for(const m of mortars) lights.push([m.x, m.y, 45, 0.3, 1.0,0.6,0.3]);
    let nt = 0;
    for(let i=projectiles.length-1;i>=0 && nt<6;i--,nt++){ const p = projectiles[i]; lights.push([p.x,p.y,45,0.45,p.col[0]/255,p.col[1]/255,p.col[2]/255]); }
  }
  for(const f of flares){ const k = f.life/f.max; lights.push([f.x,f.y,f.r,f.i*k*k,f.col[0],f.col[1],f.col[2]]); }
  lights.sort((a,b)=>b[3]*b[2]-a[3]*a[2]);

  // lightning: illuminates the cloud deck from inside
  let bolt = [sheet.x, sheet.y, sheet.i, 220];
  if(lightnings.length){
    const l = lightnings[lightnings.length-1];
    const t = l.life/l.max;
    const strobe = (t>0.75 || (t>0.4 && t<0.55) || t<0.15) ? 1 : 0.35;
    bolt = [l.path[0].x, l.path[0].y+40, 1.5*strobe*Math.min(1,t*1.6), 260];
  }
  const ripples2 = ripples.slice(-MAXRIP).map(r=>{ const k = r.life/r.max; return [r.x, r.y, r.r, r.strength*k]; });
  const heat = [];
  for(const b of blasts){ const k = b.life/b.max; heat.push([b.x, b.y-b.R*0.4, b.R*1.2, 7*k]); }
  if(started && p1) for(const b of [p1,p2]){
    if(b.alive && b.boostT>0) heat.push([b.x - b.boostDir*40, b.y+44, 34, 4]);
    if(!b.alive && b.deadT<8) heat.push([b.x, b.y-34, 40, 2.5]);
  }
  for(const m of rockets) if(m.lit) heat.push([m.x - Math.cos(m.ang)*22, m.y - Math.sin(m.ang)*22, 16, 2.5]);
  heat.sort((a,b)=>b[3]-a[3]);
  const zoom = 1 + (shakeMag*2.2)/W;
  return {
    lights, lamps, ripples: ripples2, heat, moon: moon(), bolt,
    storm: weatherIntensity, flash: ambientFlash*0.8, flashW: flashAlpha*0.6,
    rain: smoothstep(0.35, 0.9, weatherIntensity), slant: clamp(-windAt(GROUND_Y)/400, -0.25, 0.25),
    bandOff: [bandOffsets[0], bandOffsets[1], bandOffsets[2], bandOffsets[3]],
    rayK: settings.rays===false ? 0 : 1.0*(1-weatherIntensity*0.55),
    phase: MOONST.phase, side: MOONST.side, bright: moonBright(),
    cov: clamp(0.4 + weatherIntensity*0.32 + (WORLD.fogLevel>=2 ? 0.08 : 0), 0, 0.85),
    coff: [-bandOffsets[0]*0.006, windTime*0.12],
    banks: fogBanks.map(f=>[f.x, f.y, f.rx, f.ry, f.d*fogFade(f)]),
    haze: WORLD.fogLevel>=2 ? 0.12 : 0,
    shake: [shakeOX/W, -shakeOY/H, zoom]
  };
}
