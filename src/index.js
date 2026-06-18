const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { ArenaRoom } = require("./ArenaRoom.js");

const app = express();
app.use(cors());                                  // allow the game client to connect from any origin
app.get("/", (_req, res) => res.send("Daddy Shrimp arena server is running. 🦐"));

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("arena", ArenaRoom);

const port = Number(process.env.PORT) || 2567;
httpServer.listen(port, () => console.log(`[daddy-shrimp] arena server listening on :${port}`));
