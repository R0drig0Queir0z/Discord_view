const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer, WebSocket } = require("ws");

const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_VIEWERS = 9;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CONTENT_TYPES = {
  "/": "text/html; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
};

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function createAppServer() {
  const rooms = new Map();
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;

    if (request.method === "GET" && pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    const contentType = CONTENT_TYPES[pathname];
    if (request.method !== "GET" || !contentType) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    fs.readFile(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname.slice(1)), (error, file) => {
      if (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("Unable to load the application");
        return;
      }

      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      response.end(file);
    });
  });
  const webSockets = new WebSocketServer({
    server,
    path: "/signal",
    maxPayload: 16 * 1024,
  });

  webSockets.on("connection", (socket) => {
    socket.on("message", (rawMessage) => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        send(socket, { type: "error", message: "Mensagem inválida." });
        return;
      }

      if (!message || typeof message.type !== "string") {
        send(socket, { type: "error", message: "Mensagem inválida." });
        return;
      }

      if (message.type === "create-room") {
        if (socket.roomId) {
          send(socket, { type: "error", message: "Esta conexão já está em uma sala." });
          return;
        }

        const roomId = crypto.randomBytes(16).toString("base64url");
        rooms.set(roomId, { host: socket, viewers: new Map() });
        socket.roomId = roomId;
        socket.role = "host";
        send(socket, { type: "room-created", roomId, maxPeople: MAX_VIEWERS + 1 });
        return;
      }

      if (message.type === "join-room") {
        if (socket.roomId || typeof message.roomId !== "string" || !ROOM_ID_PATTERN.test(message.roomId)) {
          send(socket, { type: "error", message: "Este link de transmissão não é válido." });
          return;
        }

        const room = rooms.get(message.roomId);
        if (!room || room.host.readyState !== WebSocket.OPEN) {
          send(socket, { type: "error", message: "Esta transmissão não está mais disponível." });
          return;
        }
        if (room.viewers.size >= MAX_VIEWERS) {
          send(socket, { type: "error", message: "Esta transmissão já atingiu o limite de 10 pessoas." });
          return;
        }

        const peerId = crypto.randomBytes(12).toString("base64url");
        room.viewers.set(peerId, socket);
        socket.roomId = message.roomId;
        socket.role = "viewer";
        socket.peerId = peerId;
        send(socket, { type: "room-joined", peerId, people: room.viewers.size + 1 });
        send(room.host, { type: "viewer-joined", peerId, people: room.viewers.size + 1 });
        return;
      }

      if (message.type === "signal") {
        const room = rooms.get(socket.roomId);
        if (!room || typeof message.signal !== "object" || message.signal === null) {
          send(socket, { type: "error", message: "Não foi possível encaminhar a conexão." });
          return;
        }

        let recipient;
        if (socket.role === "host" && typeof message.peerId === "string") {
          recipient = room.viewers.get(message.peerId);
        } else if (socket.role === "viewer" && message.peerId === "host") {
          recipient = room.host;
        }

        if (!recipient) {
          send(socket, { type: "error", message: "O outro participante não está mais conectado." });
          return;
        }
        send(recipient, {
          type: "signal",
          peerId: socket.role === "host" ? "host" : socket.peerId,
          signal: message.signal,
        });
        return;
      }

      if (message.type === "end-room" && socket.role === "host") {
        socket.close(1000, "Transmissão encerrada");
        return;
      }

      send(socket, { type: "error", message: "Ação desconhecida." });
    });

    socket.on("close", () => {
      if (!socket.roomId) return;

      const room = rooms.get(socket.roomId);
      if (!room) return;

      if (socket.role === "host") {
        rooms.delete(socket.roomId);
        for (const viewer of room.viewers.values()) {
          viewer.close(1000, "Transmissão encerrada");
        }
        return;
      }

      room.viewers.delete(socket.peerId);
      send(room.host, {
        type: "viewer-left",
        peerId: socket.peerId,
        people: room.viewers.size + 1,
      });
    });
  });

  return { server, webSockets, rooms };
}

if (require.main === module) {
  const { server } = createAppServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => {
    console.log(`Discord View está disponível em http://localhost:${port}`);
  });
}

module.exports = { createAppServer };
