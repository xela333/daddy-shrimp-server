# Run the Daddy Shrimp multiplayer server

## Local (test with 2 browser tabs)
1. `cd server && npm install`
2. `npm start`   → "arena server listening on :2567"
3. Open `frontend/online.html` in two tabs/devices. They share one live arena (you + bots + the other tab).

## Deploy to Render (free Hobby)
1. Push this repo to GitHub.
2. Render → New → Web Service → pick the repo → **Root Directory: `server`**.
3. Build command: `npm install`  ·  Start command: `npm start`.
4. Add env vars later for M1 banking: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server-only).
5. Render gives you `https://<name>.onrender.com`. The client connects over `wss://<name>.onrender.com`.
   Open the deployed client as `online.html?ws=wss://<name>.onrender.com`, or hard-code WS_URL.

Do NOT commit node_modules or .env (see .gitignore). Render runs `npm install` itself.
