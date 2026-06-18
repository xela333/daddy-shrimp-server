const { Room } = require("colyseus");
const { Schema, MapSchema, ArraySchema, defineTypes } = require("@colyseus/schema");

const WORLD = 2600, TOKENS = 90, BOT_FLOOR = 8, MAX_CLIENTS = 24;
const ROUND_SECONDS = 120, START_VALUE = 4, TICK_HZ = 20, JELLY_R = 46;
const rOf = v => 9 + Math.sqrt(Math.max(v, 0)) * 6;
const rand = (a, b) => a + Math.random() * (b - a);
const COLORS = ["#6aa9ff","#a98cff","#5ad1e0","#ffb454","#7bdc8f","#ff8fc7","#ff7d6b"];

class Player extends Schema {}
defineTypes(Player, { x:"number", y:"number", value:"number", name:"string", color:"string", alive:"boolean", isBot:"boolean", hidden:"boolean", chomps:"number" });
class Token extends Schema {}
defineTypes(Token, { x:"number", y:"number", v:"number", big:"boolean" });
class Obstacle extends Schema {}
defineTypes(Obstacle, { x:"number", y:"number", r:"number", kind:"string", v:"number" }); // kind: rock|coral|urchin|anem
class Jelly extends Schema {}
defineTypes(Jelly, { x:"number", y:"number" });
class State extends Schema {}
defineTypes(State, { players:{map:Player}, tokens:[Token], obstacles:[Obstacle], jellies:[Jelly], timeLeft:"number", world:"number" });

class ArenaRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_CLIENTS;
    this.mode = options && options.mode === "practice" ? "practice" : "live";
    this.setState(new State());
    this.state.players = new MapSchema();
    this.state.tokens = new ArraySchema();
    this.state.obstacles = new ArraySchema();
    this.state.jellies = new ArraySchema();
    this.state.world = WORLD;
    this.state.timeLeft = ROUND_SECONDS;
    this.targets = {}; this.botWander = {}; this.jvel = []; this.cool = {}; this.bumpCd = {};

    for (let i=0;i<TOKENS;i++) this.state.tokens.push(this.makeToken());
    this.genObstacles();
    for (let i=0;i<10;i++){ const o=new Jelly(); o.x=rand(200,WORLD-200); o.y=rand(200,WORLD-200); this.state.jellies.push(o); const a=rand(0,6.28); this.jvel.push({vx:Math.cos(a)*40, vy:Math.sin(a)*40, ph:rand(0,6.28)}); }
    this.fillBots();

    this.onMessage("input",(client,msg)=>{ const t=this.targets[client.sessionId];
      if(t && msg && typeof msg.x==="number"){ t.x=Math.max(0,Math.min(WORLD,msg.x)); t.y=Math.max(0,Math.min(WORLD,msg.y)); } });
    this.setSimulationInterval(dt=>this.tick(dt), 1000/TICK_HZ);
    this._sec=0;
  }
  obst(kind, n, rmin, rmax, variants){ for(let i=0;i<n;i++){ const o=new Obstacle();
    o.x=rand(120,WORLD-120); o.y=rand(120,WORLD-120); o.r=rand(rmin,rmax); o.kind=kind; o.v=1+Math.floor(Math.random()*variants); this.state.obstacles.push(o); } }
  genObstacles(){
    const push=(x,y,r,kind,vv)=>{const o=new Obstacle();o.x=x;o.y=y;o.r=r;o.kind=kind;o.v=vv;this.state.obstacles.push(o);};
    for(let cc=0;cc<6;cc++){const cx=rand(280,WORLD-280),cy=rand(280,WORLD-280),n=3+Math.floor(rand(0,2));for(let k=0;k<n;k++)push(cx+rand(-160,160),cy+rand(-130,130),rand(42,64),"anem",1+Math.floor(Math.random()*3));}
    for(let cc=0;cc<5;cc++){const cx=rand(280,WORLD-280),cy=rand(280,WORLD-280),n=4+Math.floor(rand(0,4));for(let k=0;k<n;k++)push(cx+rand(-210,210),cy+rand(-170,170),rand(50,82),"kelp",1+Math.floor(Math.random()*5));}
    this.obst("rock",9,30,55,5); this.obst("coral",7,26,46,3); this.obst("urchin",7,24,38,2);
  }
  makeToken(){ const big=Math.random()<0.12; const tk=new Token(); tk.x=rand(0,WORLD); tk.y=rand(0,WORLD); tk.v=big?rand(1,3):0.1; tk.big=big; return tk; }
  addPlayer(id,name,isBot){ const p=new Player(); p.x=rand(WORLD*0.3,WORLD*0.7); p.y=rand(WORLD*0.3,WORLD*0.7);
    p.value=START_VALUE; p.name=(name||(isBot?"Shrimpbot":"Shrimp")).slice(0,16); p.color=COLORS[(Math.random()*COLORS.length)|0]; p.alive=true; p.isBot=!!isBot; p.hidden=false; p.chomps=0;
    this.state.players.set(id,p); this.targets[id]={x:p.x,y:p.y}; this.cool[id]=0; return p; }
  fillBots(){ let n=0; this.state.players.forEach(()=>n++); let bi=0;
    while(n<BOT_FLOOR){ const id="bot_"+(bi++)+"_"+(Date.now()%9999); this.addPlayer(id,null,true); this.botWander[id]=Math.random()*6.28; n++; } }
  onJoin(client,options){ this.addPlayer(client.sessionId, options&&options.name, false); }
  onLeave(client){ this.state.players.delete(client.sessionId); delete this.targets[client.sessionId]; delete this.cool[client.sessionId]; }
  respawn(p){ p.alive=true; p.value=START_VALUE; p.x=rand(60,WORLD-60); p.y=rand(60,WORLD-60); }

  // push entity out of solid obstacles; apply urchin sting; set hidden if small inside an anemone. returns nothing.
  hit(id,p,amt,kind){ if((this.cool[id]||0)>0)return; const before=p.value; p.value=Math.max(START_VALUE*0.5,p.value-amt); const lost=before-p.value; this.cool[id]=1.2;
    if(!p.isBot && lost>0.001) this.clients.forEach(c=>{ if(c.sessionId===id) c.send("sting",{amount:lost,kind:kind}); }); }
  bump(id,p){ if(p.isBot||(this.bumpCd[id]||0)>0)return; this.bumpCd[id]=0.35; this.clients.forEach(c=>{ if(c.sessionId===id) c.send("bump",{}); }); }
  resolveEnv(p, id, d){
    let hidden=false; const er=rOf(p.value);
    for(let i=0;i<this.state.obstacles.length;i++){ const o=this.state.obstacles[i];
      const dx=p.x-o.x, dy=p.y-o.y, dd=Math.hypot(dx,dy)||1;
      if(o.kind==="rock"||o.kind==="coral"){ const min=er*0.75+o.r*0.7; if(dd<min){ const push=min-dd; p.x+=dx/dd*push; p.y+=dy/dd*push; this.bump(id,p); } }
      else if(o.kind==="urchin"){ if(dd<er*0.7+o.r*0.55) this.hit(id,p,rand(0.1,1.0),"urchin"); }
      else if(o.kind==="anem"){ if(dd<o.r){ if(er<o.r*0.8) hidden=true; else this.hit(id,p,p.value*0.07,"anem"); } }
    }
    p.x=Math.max(er,Math.min(WORLD-er,p.x)); p.y=Math.max(er,Math.min(WORLD-er,p.y)); p.hidden=hidden;
  }

  tick(dt){ const d=dt/1000;
    this._sec+=d; if(this._sec>=1){ this._sec-=1; this.state.timeLeft=Math.max(0,this.state.timeLeft-1); if(this.state.timeLeft<=0) this.endRound(); }
    const players=this.state.players;
    // bots target
    players.forEach((b,id)=>{ if(!b.isBot||!b.alive)return; const tgt=this.targets[id]; this.botWander[id]=(this.botWander[id]||0)+0.03;
      let nx=b.x+Math.cos(this.botWander[id])*200, ny=b.y+Math.sin(this.botWander[id]*1.3)*200, best=240*240, fx=0, fy=0;
      players.forEach(o=>{ if(o===b||!o.alive||o.hidden)return; const dx=o.x-b.x,dy=o.y-b.y,dd=dx*dx+dy*dy;
        if(dd<best){ if(o.value<b.value*0.9){nx=o.x;ny=o.y;} else if(o.value>b.value*1.1){fx-=dx;fy-=dy;} } });
      tgt.x=Math.max(0,Math.min(WORLD,nx+fx)); tgt.y=Math.max(0,Math.min(WORLD,ny+fy)); });
    // move + env
    players.forEach((p,id)=>{ if(!p.alive)return; if(this.cool[id]>0)this.cool[id]-=d; if(this.bumpCd[id]>0)this.bumpCd[id]-=d;
      const pr=rOf(p.value), tgt=this.targets[id]; if(tgt){ const dx=tgt.x-p.x,dy=tgt.y-p.y,dd=Math.hypot(dx,dy)||1, sp=220*(22/(pr*0.6+18)); const st=Math.min(sp*d,dd); p.x+=dx/dd*st; p.y+=dy/dd*st; }
      this.resolveEnv(p,id,d); });
    // jellies move + sting
    for(let i=0;i<this.state.jellies.length;i++){ const j=this.state.jellies[i], v=this.jvel[i];
      j.x+=v.vx*d; j.y+=v.vy*d; if(j.x<80||j.x>WORLD-80)v.vx*=-1; if(j.y<80||j.y>WORLD-80)v.vy*=-1; j.x=Math.max(80,Math.min(WORLD-80,j.x)); j.y=Math.max(80,Math.min(WORLD-80,j.y));
      players.forEach((p,id)=>{ if(!p.alive)return; const er=rOf(p.value); if(Math.hypot(p.x-j.x,p.y-j.y)<JELLY_R+er*0.4) this.hit(id,p,rand(0.5,2),'jelly'); }); }
    // eat tokens
    const toks=this.state.tokens;
    players.forEach(p=>{ if(!p.alive)return; const pr=rOf(p.value);
      for(let i=0;i<toks.length;i++){ const tk=toks[i]; if((p.x-tk.x)**2+(p.y-tk.y)**2<pr*pr){ p.value+=tk.v; const nt=this.makeToken(); tk.x=nt.x;tk.y=nt.y;tk.v=nt.v;tk.big=nt.big; } } });
    // player vs player (hidden = safe)
    const arr=[]; players.forEach((p,id)=>arr.push([id,p]));
    for(let i=0;i<arr.length;i++)for(let j=0;j<arr.length;j++){ if(i===j)continue; const a=arr[i][1],b=arr[j][1]; if(!a.alive||!b.alive||b.hidden)continue;
      const ar=rOf(a.value),br=rOf(b.value),dd=Math.hypot(a.x-b.x,a.y-b.y);
      if(dd<ar-br*0.4 && a.value>b.value*1.05){ a.value+=b.value; a.chomps=(a.chomps||0)+1; b.alive=false; b.value=0;
        if(b.isBot){ setTimeout(()=>this.respawn(b),800); } else { this.clients.forEach(c=>{ if(c.sessionId===arr[j][0]) c.send("eaten",{by:a.name}); }); setTimeout(()=>this.respawn(b),1200); } } }
    this.fillBots();
  }
  endRound(){ const results=[]; this.state.players.forEach((p,id)=>{ if(!p.isBot) results.push({id,name:p.name,banked:p.alive?Math.round(p.value*100)/100:0,survived:p.alive}); });
    this.persistResults(results); this.broadcast("roundEnd",{results}); this.state.timeLeft=ROUND_SECONDS;
    this.state.players.forEach(p=>{ p.value=START_VALUE; p.alive=true; p.chomps=0; }); }
  persistResults(r){ console.log("[round] "+this.mode+" banked:", r.map(x=>x.name+":"+x.banked+(x.survived?"":"(died)")).join(", ")); }
}

module.exports = { ArenaRoom };
