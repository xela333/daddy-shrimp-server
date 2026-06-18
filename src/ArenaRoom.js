const { Room } = require("colyseus");
const { Schema, MapSchema, ArraySchema, defineTypes } = require("@colyseus/schema");

// ---------- world constants (server-authoritative) ----------
const WORLD = 2600, TOKENS = 90, BOT_FLOOR = 8, MAX_CLIENTS = 24;
const ROUND_SECONDS = 180, START_VALUE = 4, TICK_HZ = 20;
const rOf = v => 9 + Math.sqrt(Math.max(v, 0)) * 6;
const rand = (a, b) => a + Math.random() * (b - a);
const COLORS = ["#6aa9ff","#a98cff","#5ad1e0","#ffb454","#7bdc8f","#ff8fc7","#ff7d6b"];

// ---------- networked state ----------
class Player extends Schema {}
defineTypes(Player, { x:"number", y:"number", value:"number", name:"string", color:"string", alive:"boolean", isBot:"boolean" });
class Token extends Schema {}
defineTypes(Token, { x:"number", y:"number", v:"number", big:"boolean" });
class State extends Schema {}
defineTypes(State, { players:{map:Player}, tokens:[Token], timeLeft:"number", world:"number" });

class ArenaRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_CLIENTS;
    this.mode = options?.mode === "practice" ? "practice" : "live";
    this.setState(new State());
    this.state.players = new MapSchema();
    this.state.tokens = new ArraySchema();
    this.state.world = WORLD;
    this.state.timeLeft = ROUND_SECONDS;
    this.targets = {};   // sessionId/botId -> {x,y}
    this.botWander = {};  // botId -> phase

    for (let i = 0; i < TOKENS; i++) this.state.tokens.push(this.makeToken());
    this.fillBots();

    this.onMessage("input", (client, msg) => {
      const t = this.targets[client.sessionId];
      if (t && msg && typeof msg.x === "number" && typeof msg.y === "number") {
        t.x = Math.max(0, Math.min(WORLD, msg.x));
        t.y = Math.max(0, Math.min(WORLD, msg.y));
      }
    });

    this.setSimulationInterval((dt) => this.tick(dt), 1000 / TICK_HZ);
    this._sec = 0;
  }

  makeToken() {
    const big = Math.random() < 0.12;
    const tk = new Token(); tk.x = rand(0, WORLD); tk.y = rand(0, WORLD); tk.v = big ? rand(1, 3) : 0.1; tk.big = big;
    return tk;
  }
  addPlayer(id, name, isBot) {
    const p = new Player();
    p.x = rand(WORLD*0.3, WORLD*0.7); p.y = rand(WORLD*0.3, WORLD*0.7);
    p.value = START_VALUE; p.name = (name || (isBot ? "Shrimpbot" : "Shrimp")).slice(0, 16);
    p.color = COLORS[(Math.random()*COLORS.length)|0]; p.alive = true; p.isBot = !!isBot;
    this.state.players.set(id, p); this.targets[id] = { x: p.x, y: p.y };
    return p;
  }
  fillBots() {
    let n = 0; this.state.players.forEach(() => n++);
    let bi = 0;
    while (n < BOT_FLOOR) { const id = "bot_" + (bi++) + "_" + Date.now()%9999; this.addPlayer(id, null, true); this.botWander[id] = Math.random()*6.28; n++; }
  }

  onJoin(client, options) { this.addPlayer(client.sessionId, options?.name, false); }
  onLeave(client) { this.state.players.delete(client.sessionId); delete this.targets[client.sessionId]; }

  respawn(p) { p.alive = true; p.value = START_VALUE; p.x = rand(60, WORLD-60); p.y = rand(60, WORLD-60); }

  tick(dt) {
    const d = dt / 1000;
    // round timer
    this._sec += d;
    if (this._sec >= 1) { this._sec -= 1; this.state.timeLeft = Math.max(0, this.state.timeLeft - 1); if (this.state.timeLeft <= 0) this.endRound(); }

    const players = this.state.players;
    // bots: pick targets (chase smaller / flee bigger / wander)
    players.forEach((b, id) => {
      if (!b.isBot || !b.alive) return;
      const tgt = this.targets[id];
      this.botWander[id] = (this.botWander[id] || 0) + 0.03;
      let nx = b.x + Math.cos(this.botWander[id]) * 200, ny = b.y + Math.sin(this.botWander[id]*1.3) * 200;
      let best = 240*240, fx = 0, fy = 0;
      players.forEach((o) => { if (o === b || !o.alive) return; const dx=o.x-b.x, dy=o.y-b.y, dd=dx*dx+dy*dy;
        if (dd < best) { if (o.value < b.value*0.9) { nx = o.x; ny = o.y; } else if (o.value > b.value*1.1) { fx -= dx; fy -= dy; } } });
      tgt.x = Math.max(0, Math.min(WORLD, nx + fx)); tgt.y = Math.max(0, Math.min(WORLD, ny + fy));
    });

    // move all entities toward targets
    players.forEach((p, id) => {
      if (!p.alive) return;
      const pr = rOf(p.value), tgt = this.targets[id]; if (!tgt) return;
      const dx = tgt.x - p.x, dy = tgt.y - p.y, dd = Math.hypot(dx, dy) || 1;
      const speed = 220 * (22 / (pr*0.6 + 18));
      const stepv = Math.min(speed * d, dd);
      p.x = Math.max(pr, Math.min(WORLD-pr, p.x + (dx/dd)*stepv));
      p.y = Math.max(pr, Math.min(WORLD-pr, p.y + (dy/dd)*stepv));
    });

    // eat tokens
    const toks = this.state.tokens;
    players.forEach((p) => { if (!p.alive) return; const pr = rOf(p.value);
      for (let i = 0; i < toks.length; i++) { const tk = toks[i]; const dx=p.x-tk.x, dy=p.y-tk.y;
        if (dx*dx+dy*dy < pr*pr) { p.value += tk.v; const nt = this.makeToken(); tk.x=nt.x; tk.y=nt.y; tk.v=nt.v; tk.big=nt.big; } }
    });

    // player vs player (and bots) — eat smaller
    const arr = []; players.forEach((p, id) => arr.push([id, p]));
    for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr.length; j++) {
      if (i === j) continue; const a = arr[i][1], b = arr[j][1]; if (!a.alive || !b.alive) continue;
      const ar = rOf(a.value), br = rOf(b.value), dd = Math.hypot(a.x-b.x, a.y-b.y);
      if (dd < ar - br*0.4 && a.value > b.value*1.05) {
        a.value += b.value;                 // eater gains
        b.alive = false; b.value = 0;        // ALL-OR-NOTHING: eaten loses round score
        if (b.isBot) { setTimeout(() => this.respawn(b), 800); }
        else { this.clients.forEach(c => { if (c.sessionId === arr[j][0]) c.send("eaten", { by: a.name }); }); setTimeout(() => this.respawn(b), 1200); }
      }
    }
    this.fillBots();
  }

  endRound() {
    // bank survivors' tokens + grant participation credits (M1: persist to Supabase via service key)
    const results = [];
    this.state.players.forEach((p, id) => { if (!p.isBot) results.push({ id, name: p.name, banked: p.alive ? Math.round(p.value) : 0, survived: p.alive }); });
    this.persistResults(results);
    this.broadcast("roundEnd", { results });
    // reset for next round
    this.state.timeLeft = ROUND_SECONDS;
    this.state.players.forEach((p) => { p.value = START_VALUE; p.alive = true; });
  }

  // TODO M1: write to Supabase with SUPABASE_SECRET_KEY (server-only). Round score -> round_results
  // (banked, all-or-nothing). Founder Credits granted to ALL participants regardless of score.
  persistResults(results) {
    console.log(`[round] ${this.mode} banked:`, results.map(r => `${r.name}:${r.banked}${r.survived?"":"(died)"}`).join(", "));
  }
}

module.exports = { ArenaRoom };
