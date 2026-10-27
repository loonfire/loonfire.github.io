# Loonfire — Balloon Wars

Armed hot-air balloon duels beneath the moon. Free, in the browser, on phones, tablets and PCs, with keyboard, touch or a controller.

* **Online Duel.** Ranked matchmaking by skill rating and ping, or casual for the fastest match. Real pilots first; a Wind Pilot AI is only ever *offered* while you wait. Private rooms with a 5-letter code for playing a friend.
* **Local Game · Same Wi-Fi.** Tap it on two devices on the same home Wi-Fi or phone hotspot and they find each other. Nobody types anything.
* **Fly vs. Wind Pilot** (four AI difficulties), **Two Players · One Screen** (keyboard, a tablet or two controllers) and **Watch AI vs. AI**.

The world: a raymarched night sky with volumetric clouds, a real moon that changes phase each match, 3D mountains, fog banks that hide pilots, wind that blows differently at every altitude, gusts, thermals, and three gas lamps (left, centre, right) you can refuel from or shoot.

```
index.html          the game (open it directly to play offline)
server/             the online game server (Node.js): matches, ranked matchmaking, ratings, local-game pairing
src/ + build.sh     sources; ./build.sh rebuilds index.html, the Pages site and server/
web/                icons, share image, robots.txt, sitemap.xml, bundled fonts (published next to the game)
render.yaml         one-click server hosting on Render
.github/workflows/  publishes the game to GitHub Pages
```

## Go live: one-time setup (about 15 minutes, free)

GitHub Pages hosts the page; the online server runs on Render's free tier; ratings live in a free Postgres database.

1. **Put this folder in a GitHub repo.** For the address `https://playloonfire.github.io`, create a GitHub **organization** called `playloonfire` and a repo in it called `playloonfire.github.io` (an organization or user named X gets the address `X.github.io`). Upload everything, including the hidden `.github` folder (`git push` is easiest).
   *Already have the old `playemberwind` repo?* Rename the organization and repo in GitHub's settings; GitHub redirects the old address for a while.
2. **Start the server on Render.** At render.com sign in with GitHub, then *New → Blueprint* and pick the repo. Copy the address it gives you, e.g. `https://loonfire-abcd.onrender.com`.
3. **Give ratings a home (recommended).** Render's free servers forget their files on every restart, so ranked ratings need a database:
   * **Supabase:** supabase.com → *New project* → *Project Settings → Database → Connection string → URI*, choose the **Session pooler** string, and put your database password into it.
   * **or Neon:** neon.tech → *New project* → copy the connection string.

   In Render, open the service → *Environment → Add environment variable*: `DATABASE_URL` = that string → *Save, rebuild and deploy*. The server creates its table by itself. (Without it, ratings work but reset whenever the server restarts.)
4. **Tell the game where the server is.** In GitHub: *Settings → Secrets and variables → Actions → Variables → New repository variable*: `LOONFIRE_SERVER` = the Render address with `wss://` instead of `https://` (e.g. `wss://loonfire-abcd.onrender.com`). The old `EMBERWIND_SERVER` variable still works.
5. **Turn on Pages.** *Settings → Pages → Source: GitHub Actions*, then *Actions → Deploy game to GitHub Pages → Run workflow* (it also runs on every push).
6. **Play.** Share `https://playloonfire.github.io`. The Render address is a complete copy of the game too.

### Good to know
* **Ranked:** everyone starts at 1000. Ratings move with each ranked match (bigger swings for your first ten). The search window widens the longer you wait: ±100, ±250, ±500, then anyone. When a match is found both pilots have 10 seconds to accept; if your opponent doesn't, you go straight back to the front of the queue. Private rooms and AI matches never change your rating. `GET /leaderboard` lists the top 20.
* **Free Render servers nap** after ~15 idle minutes; the page wakes the server as soon as it loads and shows "Waking up the game server…" while it starts (usually under a minute).
* **Local games** need the server only for the few seconds it takes to introduce the two devices; after that the game runs directly between them. If two devices don't find each other, each shows a 4-digit pair code.
* **Controllers:** plug one in any time; the menus switch to button prompts. A second controller joins as Pilot 2. Rebind any button in *Settings → Controls*.
* **Audio:** *Settings → Audio → Audio engine* switches between **Classic** and the **Spatial** engine (experimental): positioned 3D sound, fog muffling, mountain echo and live wind.
* **Updating:** edit `src/`, run `./build.sh`, commit, push. Pages and Render redeploy on push.

### Getting found on Google
The page carries everything search engines and link previews read: title, description, a share image (`web/og-image.png`), structured "free browser game" data, `robots.txt`, `sitemap.xml` and icons. Add Search Console's verification file to `web/`. For a custom domain, set the repository variable `SITE_URL` (e.g. `https://loonfire.gg`).

More on the server, matchmaking and netcode: `server/README.md`.

Fonts: Cinzel (Natanael Gama) and Rajdhani (Indian Type Foundry), SIL Open Font License — see `web/fonts/`.
