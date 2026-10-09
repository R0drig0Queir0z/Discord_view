const homeView = document.querySelector("#home-view");
const hostView = document.querySelector("#host-view");
const viewerView = document.querySelector("#viewer-view");
const pageUrl = new URL(window.location.href);
const roomFromLink = pageUrl.searchParams.get("room");

const rtcConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(window.VELA_ICE_SERVERS || []),
  ],
};

function connectSignalServer() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/signal`);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("Não foi possível conectar ao servidor. Tente novamente.")), { once: true });
    socket.addEventListener("close", () => reject(new Error("A conexão com o servidor foi encerrada.")), { once: true });
  });
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function closeStream(stream) {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
}

if (roomFromLink) {
  homeView.hidden = true;
  viewerView.hidden = false;
  startViewer(roomFromLink);
} else {
  homeView.hidden = false;
  hostView.hidden = true;
  document.querySelector("#start-button").addEventListener("click", startBroadcast);
}

async function startBroadcast() {
  const startButton = document.querySelector("#start-button");
  const homeError = document.querySelector("#home-error");
  homeError.hidden = true;
  startButton.disabled = true;

  if (!navigator.mediaDevices?.getDisplayMedia) {
    showError(homeError, "Este navegador não oferece compartilhamento de tela. Experimente a versão mais recente do Chrome, Edge ou Firefox.");
    startButton.disabled = false;
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const socket = await connectSignalServer();
    startHostSession(socket, stream);
  } catch (error) {
    closeStream(stream);
    if (error.name === "NotAllowedError") {
      showError(homeError, "Compartilhamento cancelado. Quando quiser, escolha uma tela e tente novamente.");
    } else {
      showError(homeError, error.message || "Não foi possível iniciar a transmissão. Tente novamente.");
    }
    startButton.disabled = false;
  }
}

function startHostSession(socket, stream) {
  const hostVideo = document.querySelector("#host-preview");
  const previewPlaceholder = document.querySelector(".preview-placeholder");
  const hostError = document.querySelector("#host-error");
  const peers = new Map();
  let roomId;
  let ending = false;

  homeView.hidden = true;
  hostView.hidden = false;
  hostVideo.srcObject = stream;
  previewPlaceholder.hidden = true;
  socket.send(JSON.stringify({ type: "create-room" }));

  document.querySelector("#stop-button").addEventListener("click", endSession, { once: true });
  document.querySelector("#copy-button").addEventListener("click", async () => {
    const input = document.querySelector("#share-link");
    input.select();
    input.setSelectionRange(0, input.value.length);
    try {
      await navigator.clipboard.writeText(input.value);
      document.querySelector("#copy-button span").textContent = "Link copiado!";
      window.setTimeout(() => {
        document.querySelector("#copy-button span").textContent = "Copiar link";
      }, 1800);
    } catch {
      showError(hostError, "Selecione o link e copie com Ctrl+C (ou ⌘C no Mac).");
    }
  });

  stream.getVideoTracks()[0].addEventListener("ended", endSession, { once: true });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "room-created") {
      roomId = message.roomId;
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set("room", roomId);
      const linkInput = document.querySelector("#share-link");
      linkInput.value = shareUrl.toString();
      document.querySelector("#people-count").textContent = "1";
      return;
    }

    if (message.type === "viewer-joined") {
      updatePeopleCount(message.people);
      try {
        await connectViewer(message.peerId);
      } catch {
        peers.get(message.peerId)?.connection.close();
        peers.delete(message.peerId);
        showError(hostError, "Não foi possível preparar a conexão com um participante. Tente novamente.");
      }
      return;
    }

    if (message.type === "viewer-left") {
      const peer = peers.get(message.peerId);
      peer?.connection.close();
      peers.delete(message.peerId);
      updatePeopleCount(message.people);
      return;
    }

    if (message.type === "signal" && message.peerId) {
      try {
        await receiveSignal(message.peerId, message.signal);
      } catch {
        showError(hostError, "A conexão com um participante falhou. Verifique a internet e tente novamente.");
      }
      return;
    }

    if (message.type === "error") showError(hostError, message.message);
  });

  socket.addEventListener("close", () => {
    if (!ending) {
      showError(hostError, "A conexão com a sala foi encerrada. Encerre e inicie uma nova transmissão.");
      finishSession();
    }
  });

  async function connectViewer(peerId) {
    const connection = new RTCPeerConnection(rtcConfiguration);
    const peer = { connection, pendingCandidates: [] };
    peers.set(peerId, peer);
    for (const track of stream.getTracks()) connection.addTrack(track, stream);

    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "signal", peerId, signal: { candidate: event.candidate } }));
      }
    });
    connection.addEventListener("connectionstatechange", () => {
      if (connection.connectionState === "failed") {
        showError(hostError, "Não foi possível conectar um participante. Verifique a conexão de internet.");
      }
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    socket.send(JSON.stringify({ type: "signal", peerId, signal: { description: connection.localDescription } }));
  }

  async function receiveSignal(peerId, signal) {
    const peer = peers.get(peerId);
    if (!peer) return;
    const { connection, pendingCandidates } = peer;

    if (signal.description) {
      await connection.setRemoteDescription(signal.description);
      for (const candidate of pendingCandidates.splice(0)) {
        await connection.addIceCandidate(candidate);
      }
      if (signal.description.type === "answer") return;
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.send(JSON.stringify({ type: "signal", peerId, signal: { description: connection.localDescription } }));
    } else if (signal.candidate) {
      if (connection.remoteDescription) {
        await connection.addIceCandidate(signal.candidate);
      } else {
        pendingCandidates.push(signal.candidate);
      }
    }
  }

  function updatePeopleCount(count) {
    document.querySelector("#people-count").textContent = String(count);
  }

  function endSession() {
    if (ending) return;
    ending = true;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "end-room" }));
      socket.close();
    }
    finishSession();
  }

  function finishSession() {
    for (const peer of peers.values()) peer.connection.close();
    peers.clear();
    closeStream(stream);
    hostVideo.srcObject = null;
    hostView.hidden = true;
    homeView.hidden = false;
    document.querySelector("#start-button").disabled = false;
    previewPlaceholder.hidden = false;
  }
}

async function startViewer(roomId) {
  const video = document.querySelector("#viewer-video");
  video.muted = true;
  const placeholder = document.querySelector("#viewer-placeholder");
  const status = document.querySelector("#viewer-status");
  const errorContainer = document.querySelector("#viewer-error");
  const audioButton = document.querySelector("#viewer-audio-button");
  const audioHint = document.querySelector("#viewer-audio-hint");
  let socket;
  let connection;
  let peerId;
  const pendingCandidates = [];

  video.addEventListener("volumechange", () => {
    if (!audioButton.hidden) {
      audioButton.textContent = video.muted ? "Ativar áudio" : "Silenciar áudio";
    }
  });

  audioButton.addEventListener("click", async () => {
    video.muted = !video.muted;
    try {
      await video.play();
    } catch {
      video.muted = true;
      audioHint.textContent = "Não foi possível reproduzir o áudio. Tente ativá-lo novamente.";
    }
  });

  function fail(message) {
    status.textContent = "Transmissão indisponível";
    placeholder.hidden = true;
    showError(errorContainer, message);
  }

  try {
    socket = await connectSignalServer();
    socket.send(JSON.stringify({ type: "join-room", roomId }));
  } catch (error) {
    fail(error.message || "Não foi possível conectar ao servidor. Tente novamente.");
    return;
  }

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "room-joined") {
      peerId = message.peerId;
      status.textContent = "Conectando com quem está transmitindo…";
      return;
    }

    if (message.type === "error") {
      fail(message.message);
      return;
    }

    if (message.type !== "signal" || message.peerId !== "host") return;

    try {
      if (message.signal.description) {
        await connection.setRemoteDescription(message.signal.description);
        for (const candidate of pendingCandidates.splice(0)) {
          await connection.addIceCandidate(candidate);
        }
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: "signal", peerId: "host", signal: { description: connection.localDescription } }));
      } else if (message.signal.candidate) {
        if (connection.remoteDescription) {
          await connection.addIceCandidate(message.signal.candidate);
        } else {
          pendingCandidates.push(message.signal.candidate);
        }
      }
    } catch {
      fail("Não foi possível estabelecer a conexão. Atualize a página para tentar de novo.");
    }
  });

  socket.addEventListener("close", () => {
    if (!errorContainer.hidden) return;
    status.textContent = "Transmissão encerrada";
    placeholder.hidden = false;
    placeholder.querySelector("strong").textContent = "A transmissão terminou";
    placeholder.querySelector("span:last-child").textContent = "Quem estava compartilhando encerrou a sala.";
    video.srcObject = null;
    connection?.close();
  });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== "room-joined" || connection) return;

    try {
      connection = new RTCPeerConnection(rtcConfiguration);
      connection.addEventListener("track", (trackEvent) => {
        video.srcObject = trackEvent.streams[0];
        video.muted = true;
        placeholder.hidden = true;
        status.textContent = "Você está assistindo à transmissão";
        if (trackEvent.track.kind === "audio") {
          audioButton.hidden = false;
          audioHint.textContent = "O navegador inicia sem som. Clique em “Ativar áudio” para ouvir.";
        }
      });
      connection.addEventListener("connectionstatechange", () => {
        if (connection.connectionState === "failed") {
          fail("A conexão de vídeo falhou. Verifique sua internet e tente abrir o link novamente.");
        }
      });
      connection.addEventListener("icecandidate", (candidateEvent) => {
        if (candidateEvent.candidate && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "signal", peerId: "host", signal: { candidate: candidateEvent.candidate } }));
        }
      });
    } catch {
      fail("Seu navegador não consegue reproduzir esta transmissão.");
    }
  });
}
