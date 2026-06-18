const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { ArenaRoom } = require("./ArenaRoom.js");

const port = Number(process.env.PORT) || 2567;
const gameServer = new Server({ transport: new WebSocketTransport() });
gameServer.define("arena", ArenaRoom);
gameServer.listen(port).then(() => {
  console.log(`[daddy-shrimp] arena server listening on :${port}`);
}).catch((e) => { console.error(e); process.exit(1); });
