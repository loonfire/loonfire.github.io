# Loonfire — online multiplayer server

One small Node.js service that does two jobs:

* **`https://your-host/`** serves the game page (`public/index.html`).
* **`wss://your-host/ws`** runs online matches and ranked matchmaking, and introduces devices on the same network for *Local Game*. The server is *authoritative*: it runs the real game simulation for every match at 120 Hz. Players only send their controls, so nobody can cheat by editing their copy of the page.

Dependencies: [`ws`](https://github.com/websockets/ws) and [`pg`](https://node-postgres.com) (only used when `DATABASE_URL` is set). Matches are held in memory, so run **one** instance. One CPU core handles several hundred matches at once.

**Ratings** are stored in Postgres when `DATABASE_URL` is set (Supabase, Neon, Render Postgres…; the table `loonfire_players` is created automatically). Otherwise they go to a JSON file (`DATA_FILE`, default `server/data/players.json`), which free hosts wipe on restart.

## Run it locally

```bash
cd server
npm install
npm start                    # → http://localhost:8080
```

Open `http://localhost:8080` in two browser windows (or on two devices on your Wi-Fi via your computer's LAN IP). In each, pick **Online Duel → Find a match** and accept when the opponent appears. Or **Create room** in one and join with the code or link in the other.

To feel what real-world lag does to the netcode:

```bash
LAG_MS=60 npm start          # adds 60 ms each way (120 ms round trip)
```

## Put it on the internet

Any host that runs Node 18+ and allows WebSockets works. HTTPS is provided by all of these, and the game automatically uses `wss://` on an `https://` page.

| Host | Steps |
|---|---|
| **Render** (free tier) | Push the whole project to a GitHub repo → Render → *New → Blueprint* → pick the repo (uses `render.yaml` at the repo root). Free instances sleep when idle and take ~30–60 s to wake. |
| **Fly.io** | `fly launch --copy-config` here, then `fly deploy`, then `fly scale count 1`. The config uses the Sydney region. |
| **Railway / Koyeb / any VPS** | Deploy the folder with the `Dockerfile`, or run `npm ci --omit=dev && node server.js` behind your reverse proxy (it must pass WebSocket upgrades). |

Then share `https://your-host/`. Invite links look like `https://your-host/?room=ABCDE`.

### Hosting the page somewhere else

If the game page lives elsewhere (GitHub Pages, itch.io, a local file), open **Settings → Online → Game server** and enter `wss://your-host` (or `your-host`). Invite links made from that page carry the server address along automatically. To restrict which sites may connect, set `ALLOWED_ORIGINS`.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | HTTP/WebSocket port |
| `ALLOWED_ORIGINS` | *(any)* | Comma-separated page origins allowed to connect, e.g. `https://you.github.io` |
| `MAX_ROOMS` / `MAX_CLIENTS` | `500` / `2000` | Capacity limits |
| `GRACE_S` | `20` | Seconds a dropped player has to reconnect before forfeiting |
| `BETWEEN_ROUNDS_S` | `4` | Pause between rounds |
| `DATABASE_URL` | *(none)* | Postgres connection string for ratings (recommended in production) |
| `DATA_FILE` | `data/players.json` | Where ratings go when there's no database |
| `CONFIRM_S` | `10` | Seconds both pilots have to accept a found match (`0` = start at once) |
| `BOT_AUTO_S` | `0` | If set, start a Wind Pilot match automatically after this many seconds of searching. By default a bot is only offered to the player (they choose 30 s, 60 s or never in Settings) |
| `BOT_LEVEL` | `normal` | Bot difficulty: `easy`, `normal`, `hard`, `brutal` |
| `TRUST_PROXY` | on | Read the client's address from `X-Forwarded-For` (right-most entry, which your host's proxy adds). Set `0` if the server is exposed directly with no proxy in front |
| `LAG_MS` | `0` | Artificial one-way latency (testing only) |
| `TEST_HOOKS` | off | Enables test-only messages. Never set this in production |

`GET /healthz` returns `{ ok, rooms, clients, queue, store }`. `GET /leaderboard` returns the top 20 rated pilots (3+ games).

## Matchmaking

* **Identity.** Each browser keeps a random pilot id and a secret key (local storage). The server stores only a hash of the key, so a rating can't be claimed by someone who merely knows the id.
* **Ranked** pairs the two closest ratings within a window that widens with the longer wait: ±100 (0–10 s), ±250 (10–25 s), ±500 (25–45 s), then anyone. **Casual** pairs first-come, first-served; a ranked pilot who has waited 45 s also takes a casual opponent (unrated).
* **Accept step.** Both get `found {seat, ranked, opp, me, timeout}` and reply `accept` or `decline`. If one doesn't accept in time (or declines), the other goes back to the front of the queue (`requeued`).
* **Ratings** use Elo (K 40 for the first ten games, then 24). Forfeits count as losses. After a ranked match each player gets `rating {before, after, delta, profile}`.

## How the netcode works

* **Shared code.** `sim.js` is generated by `../build.sh` from the same source files the browser runs (`01-core`, `03-world`, `04-entities`, `04b-sim`, `04c-codec`): wind layers, gusts, thermals, fog banks, lamps and flares included. Client and server physics can't drift apart. Edit `../src`, run `../build.sh`, and redeploy.
* **Inputs, not positions.** Each client sends one tiny input record per 1/120 s step (held controls plus one-shot actions). The server queues them, applies one per step, and never loses a one-shot action, even when it has to catch up.
* **Snapshots and events.** At 30 Hz the server broadcasts compact state, plus every explosion, hit, sound and lightning strike that happened in between, each stamped with its tick. It uses about 15 KB/s per player before compression.
* **Your balloon is predicted.** It responds instantly to your controls. When a snapshot arrives the client rewinds to the server's state, replays the inputs the server hasn't processed yet, and smooths out any difference (you'll only notice when something unexpected shoves you, like a collision or a blast).
* **Everything else is interpolated** about 100 ms in the past, so it moves smoothly even on jittery connections. Effects are replayed on that same timeline, so explosions line up with what you see.
* **Your own shots feel instant.** Repeater tracers and muzzle flashes appear immediately; your fresh rockets, flak and bombs start at your gun and ease onto the server's path.
* **Dropped connections.** If a phone sleeps or Wi-Fi blips, the match pauses for both players for up to `GRACE_S`, and the client reconnects automatically (a page reload works too). After that, the remaining player wins by forfeit.

### Local games (same network)

Browsers can't scan a network or accept connections, so *Local Game* uses the server only as a matchmaker. Devices that reach it from the same public address are on the same network: the same IPv4 address, or for IPv6 the same /64 prefix. The server pairs the first two and relays their WebRTC handshake. A direct, encrypted data channel then opens between the devices over the LAN, and the server drops out. The first device to arrive hosts: it runs the simulation itself (zero lag for the host) and streams snapshots and events to the guest in the same format this server uses, so the guest keeps its prediction and interpolation. Messages: `lanFind`, `lanCode {code}` (4-digit fallback), `lanCancel`, and `sig {d}` (relayed only between paired devices); replies are `lanWaiting {code}`, `lanPair {role, peer}`, `lanNoCode` and `lanGone`.

### Messages

Client → server: `hello {v, name, token?, pid, pkey}`, `quick {ranked, botAfter, name}`, `accept`, `decline`, `create {len}`, `join {code}`, `name {name}`, `cancel`, `in {d:[[seq,bits,steer,weapon,bx,by],…]}`, `rematch`, `leave`, `ping {c}`.

Client → server (matchmaking): `botNow` takes the offered Wind Pilot match.

Server → client: `welcome`, `profile {p}`, `queued {online, searching, waited, stage, window, ranked, botOffer, botIn}`, `found`, `accepted`, `requeued`, `rating`, `room {code}`, `start {seat, W, names, round, scores, cd, token}`, `go`, `s` (snapshot), `roundEnd`, `matchEnd`, `rematchWait`, `oppLeft {grace}`, `oppBack`, `pong`, `error`.
