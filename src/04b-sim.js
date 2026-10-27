// =====================================================================
//  SHARED SIMULATION STEP
//  The same code runs in the browser (offline modes) and on the game
//  server (online matches). It only changes game state and raises fx().
// =====================================================================
function onDeath(b){
  fx('death', b.id);
  b.vy = -60; b.patching = false; b.shieldTimer = 0;
}
function applyActions(b, inp){
  if(inp.fire) fireWeapon(b);
  if(inp.ballast) dropBomb(b);
  if(inp.harpoon) fireHarpoon(b);
  if(inp.shock) ventBurst(b);
  if(inp.shield) activateShield(b);
  if(inp.patch) startPatch(b);
  if(inp.boost) boost(b, inp.boostX, inp.boostY);
  if(inp.flare) dropFlare(b);
}
// weather & sky options: offline from Settings, online always the standard set
function configureWorld(net){
  if(net){ WORLD.windScale = 1; WORLD.fogLevel = 1; WORLD.moonMode = 'tonight'; return; }
  WORLD.windScale = WIND_SCALES[settings.wind] || 1;
  WORLD.fogLevel = FOG_LEVELS[settings.fog]===undefined ? 1 : FOG_LEVELS[settings.fog];
  WORLD.moonMode = settings.moon || 'random';
}
// a fresh match: new moon, new winds, new weather
function newMatchWorld(){ rollMoon(); resetWind(); resetFog(); }
function newRound(){
  p1 = new Balloon(1, W*0.27, 1);
  p2 = new Balloon(2, W*0.73, -1);
  projectiles=[]; rockets=[]; mortars=[]; bombs=[]; harpoons=[]; shockwaves=[]; flareList=[];
  if(!LAMPS.length) buildLamps();
  resetLamps();
  gameOver=false; winnerId=null; endShown=false; roundTime=0; endTimer=0;
}
// runs once per step AFTER all damage, so a simultaneous kill is a true draw
function checkRoundOver(){
  if(gameOver) return;
  if(p1.alive && p2.alive) return;
  gameOver = true;
  winnerId = p1.alive ? 1 : (p2.alive ? 2 : null);
  if(winnerId) scores[winnerId-1]++;
  const need = Math.ceil(matchLen/2);
  matchOver = matchLen===1 || scores[0]>=need || scores[1]>=need;
  endTimer = 2.2; endShown = false;
  const s = winnerId===1 ? p1 : winnerId===2 ? p2 : null;
  endHoverY = s ? s.y : 340;
  p1.patching = false; p2.patching = false;
}
const NO_INPUT = {};
function simStep(dt, in1, in2){
  simTime += dt;
  windTime += dt;
  updateWeather(dt);
  updateWind(dt);
  updateFog(dt);
  updateBandOffsets(dt);
  ambientLightningTimer -= dt;
  if(ambientLightningTimer<=0){
    ambientLightningTimer = rand(2.5,6);
    if(Math.random() < 0.08+weatherIntensity*0.55){
      if(weatherIntensity>0.6 && Math.random()<0.25){ const gx = rand(60,W-60); fx('groundBolt', gx); lampDamage(gx, FLOOR_Y-90, 70, 0); }
      else fx('bolt', rand(60,W-60), rand(STORM_Y+10, STORM_Y+90));
    }
  }
  if(!p1) return;
  if(!gameOver){
    roundTime += dt;
    in1 = in1 || NO_INPUT; in2 = in2 || NO_INPUT;
    p1.update(dt,in1,p2);
    p2.update(dt,in2,p1);
    applyActions(p1,in1);
    applyActions(p2,in2);
    resolveBalloonContact();
  } else {
    for(const [b,o] of [[p1,p2],[p2,p1]]) b.update(dt, { burner: b.alive && b.y > endHoverY && b.fuel>0 }, o);
  }
  updateProjectiles(dt); updateRockets(dt); updateMortars(dt); updateBombs(dt);
  updateHarpoons(dt); updateShockwaves(dt); updateFlareList(dt);
  simLamps(dt);
  if(!gameOver) checkRoundOver();
  else endTimer -= dt;
}
