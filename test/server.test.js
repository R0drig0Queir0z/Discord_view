const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const WebSocket = require("ws");
const { createAppServer } = require("../server");

let application;
let address;
const sockets = [];

function openSocket() {
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/signal`);
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, 2000);

    function onMessage(rawMessage) {
      const message = JSON.parse(rawMessage.toString());
      if (message.type !== expectedType) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    }

    socket.on("message", onMessage);
  });
}

function nextClose(socket) {
  return new Promise((resolve) => socket.once("close", resolve));
}

before(async () => {
  application = createAppServer();
  await new Promise((resolve) => application.server.listen(0, "127.0.0.1", resolve));
  address = application.server.address();
});

after(async () => {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.close();
  }
  await new Promise((resolve) => application.webSockets.close(resolve));
  await new Promise((resolve) => application.server.close(resolve));
});

test("creates temporary rooms, relays signals, and caps the room at ten people", async () => {
  const host = await openSocket();
  const roomCreated = nextMessage(host, "room-created");
  host.send(JSON.stringify({ type: "create-room" }));
  const { roomId, maxPeople } = await roomCreated;
  assert.match(roomId, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(maxPeople, 10);

  const viewer = await openSocket();
  const joined = nextMessage(viewer, "room-joined");
  viewer.send(JSON.stringify({ type: "join-room", roomId }));
  const { peerId } = await joined;
  const hostJoined = await nextMessage(host, "viewer-joined");
  assert.equal(hostJoined.peerId, peerId);

  const offer = { description: { type: "offer", sdp: "example" } };
  const receivedOffer = nextMessage(viewer, "signal");
  host.send(JSON.stringify({ type: "signal", peerId, signal: offer }));
  assert.deepEqual((await receivedOffer).signal, offer);

  const answer = { description: { type: "answer", sdp: "reply" } };
  const receivedAnswer = nextMessage(host, "signal");
  viewer.send(JSON.stringify({ type: "signal", peerId: "host", signal: answer }));
  assert.deepEqual((await receivedAnswer).signal, answer);

  for (let count = 1; count < 9; count += 1) {
    const nextViewer = await openSocket();
    const nextJoined = nextMessage(nextViewer, "room-joined");
    nextViewer.send(JSON.stringify({ type: "join-room", roomId }));
    await nextJoined;
    await nextMessage(host, "viewer-joined");
  }

  const lastViewer = await openSocket();
  const fullError = nextMessage(lastViewer, "error");
  lastViewer.send(JSON.stringify({ type: "join-room", roomId }));
  assert.match((await fullError).message, /limite de 10 pessoas/);

  const viewerClosed = nextClose(viewer);
  host.send(JSON.stringify({ type: "end-room" }));
  await viewerClosed;

  const unavailableViewer = await openSocket();
  const unavailableError = nextMessage(unavailableViewer, "error");
  unavailableViewer.send(JSON.stringify({ type: "join-room", roomId }));
  assert.match((await unavailableError).message, /não está mais disponível/);
});
