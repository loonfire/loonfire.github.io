// =====================================================================
//  PLAYER STORE — ratings for ranked matchmaking
//  · DATABASE_URL set (Postgres: Supabase, Neon, Render…) → kept there
//  · otherwise a JSON file (DATA_FILE, default ./data/players.json)
//    — fine locally; on free hosts it resets when the server restarts
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const START_RATING = 1000;
const hashKey = k => crypto.createHash('sha256').update(String(k||'')).digest('hex');

function tierOf(r){
  const tiers = ['Bronze','Silver','Gold','Platinum','Diamond'];
  const base = 800;
  if(r >= 1800) return { name:'Storm Ace', sub:'', next:null, floor:1800 };
  const i = Math.max(0, Math.min(4, Math.floor((r-base)/200)));
  const lo = base + i*200;
  const within = Math.max(0, r - lo);
  const step = Math.min(2, Math.floor(within/67));
  const div = ['III','II','I'][step];
  const nextAt = step<2 ? lo + (step+1)*67 : lo + 200;
  return { name: tiers[i]+' '+div, next: nextAt, floor: lo + step*67 };
}
function publicProfile(p){
  if(!p) return null;
  const t = tierOf(p.rating);
  return { rating:Math.round(p.rating), tier:t.name, next:t.next, floor:t.floor, games:p.games, wins:p.wins, losses:p.losses, streak:p.streak, recent:(p.recent||[]).slice(0,5), provisional:p.games < 10 };
}

// ---------- Elo with a bigger K while a player is new ----------
function eloUpdate(a, b, scoreA){
  const ea = 1/(1 + Math.pow(10, (b.rating - a.rating)/400));
  const ka = a.games < 10 ? 40 : 24, kb = b.games < 10 ? 40 : 24;
  const da = ka*(scoreA - ea), db = kb*((1-scoreA) - (1-ea));
  return { da: Math.round(da), db: Math.round(db) };
}

function createStore(opts){
  opts = opts || {};
  const url = opts.databaseUrl || process.env.DATABASE_URL || '';
  if(url){
    let pg;
    try{ pg = require('pg'); }catch(e){ console.warn('DATABASE_URL is set but the "pg" package is missing — using the file store'); return fileStore(opts); }
    return pgStore(pg, url);
  }
  return fileStore(opts);
}

function fileStore(opts){
  const file = opts.file || process.env.DATA_FILE || path.join(__dirname, 'data', 'players.json');
  let db = {};
  try{ db = JSON.parse(fs.readFileSync(file, 'utf8')); }catch(e){ db = {}; }
  let timer = null;
  function flush(){
    timer = null;
    try{ fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file+'.tmp', JSON.stringify(db)); fs.renameSync(file+'.tmp', file); }
    catch(e){ console.warn('player store: could not write', file, e.message); }
  }
  const later = ()=>{ if(!timer) timer = setTimeout(flush, 1500); };
  return {
    kind:'file',
    async get(pid){ return db[pid] ? Object.assign({}, db[pid]) : null; },
    async put(p){ db[p.pid] = Object.assign({}, p); later(); },
    async top(n){ return Object.values(db).filter(p=>p.games>=3).sort((a,b)=>b.rating-a.rating).slice(0, n||20); },
    async close(){ if(timer){ clearTimeout(timer); flush(); } },
  };
}

function pgStore(pg, url){
  const ssl = /sslmode=disable/.test(url) || /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized:false };
  const pool = new pg.Pool({ connectionString:url, ssl, max:4, idleTimeoutMillis:30000 });
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS loonfire_players(
      pid TEXT PRIMARY KEY, keyhash TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Pilot',
      rating REAL NOT NULL DEFAULT ${START_RATING}, games INT NOT NULL DEFAULT 0, wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0, streak INT NOT NULL DEFAULT 0, recent JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated TIMESTAMPTZ NOT NULL DEFAULT now())`).catch(e=>{ console.warn('player store: could not prepare the table —', e.message); });
  const row = r => r && { pid:r.pid, keyhash:r.keyhash, name:r.name, rating:+r.rating, games:r.games, wins:r.wins, losses:r.losses, streak:r.streak, recent:r.recent||[] };
  return {
    kind:'postgres',
    async get(pid){ await ready; const r = await pool.query('SELECT * FROM loonfire_players WHERE pid=$1', [pid]); return row(r.rows[0]); },
    async put(p){
      await ready;
      await pool.query(`INSERT INTO loonfire_players(pid,keyhash,name,rating,games,wins,losses,streak,recent,updated)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
        ON CONFLICT(pid) DO UPDATE SET name=$3, rating=$4, games=$5, wins=$6, losses=$7, streak=$8, recent=$9, updated=now()`,
        [p.pid, p.keyhash, p.name, p.rating, p.games, p.wins, p.losses, p.streak, JSON.stringify(p.recent||[])]);
    },
    async top(n){ await ready; const r = await pool.query('SELECT * FROM loonfire_players WHERE games>=3 ORDER BY rating DESC LIMIT $1', [n||20]); return r.rows.map(row); },
    async close(){ await pool.end(); },
  };
}

module.exports = { createStore, hashKey, tierOf, publicProfile, eloUpdate, START_RATING };
