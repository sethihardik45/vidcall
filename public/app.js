const socket = io();

const $ = (id) => document.getElementById(id);
const landing = $("landing"), chat = $("chat");
const localVideo = $("localVideo"), remoteVideo = $("remoteVideo");
const statusEl = $("status"), messages = $("messages");
const chatInput = $("chatInput"), sendBtn = $("sendBtn");

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // For production, add a TURN server here so users behind strict NATs can connect:
    // { urls: "turn:your.turn.server:3478", username: "user", credential: "pass" },
  ],
};

let localStream = null;
let pc = null;
let pendingIce = [];

socket.on("online", (n) => ($("onlineCount").textContent = n));

function setStatus(text) {
  if (text) { statusEl.textContent = text; statusEl.classList.remove("hidden"); }
  else statusEl.classList.add("hidden");
}

function addMsg(text, cls) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = text;
  messages.appendChild(d);
  messages.scrollTop = messages.scrollHeight;
}

function setChatEnabled(on) {
  chatInput.disabled = !on;
  sendBtn.disabled = !on;
}

function closePeer() {
  if (pc) { pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null; pc.close(); pc = null; }
  remoteVideo.srcObject = null;
  pendingIce = [];
  setChatEnabled(false);
}

function createPeer() {
  closePeer();
  pc = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.onicecandidate = (e) => { if (e.candidate) socket.emit("ice", e.candidate); };
  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    setStatus("");
  };
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") { setStatus(""); setChatEnabled(true); }
    if (pc.connectionState === "failed") { setStatus("Connection failed. Click Next to try someone else."); }
  };
  return pc;
}

async function start() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    alert("We need camera and microphone access to connect you. Please allow it and try again.");
    return;
  }
  localVideo.srcObject = localStream;
  landing.classList.add("hidden");
  chat.classList.remove("hidden");
  findPartner();
}

function findPartner() {
  closePeer();
  messages.innerHTML = "";
  setStatus("Looking for someone to talk to…");
  socket.emit("find");
}

function stop() {
  socket.emit("leave");
  closePeer();
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  localVideo.srcObject = null;
  chat.classList.add("hidden");
  landing.classList.remove("hidden");
}

// --- Socket events ---
socket.on("waiting", () => setStatus("Looking for someone to talk to…"));

socket.on("matched", async ({ initiator }) => {
  setStatus("Stranger found! Connecting…");
  addMsg("You're now chatting with a stranger. Say hi!", "sys");
  createPeer();
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", offer);
  }
});

socket.on("offer", async (offer) => {
  if (!pc) return;
  await pc.setRemoteDescription(offer);
  await flushIce();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", answer);
});

socket.on("answer", async (answer) => {
  if (!pc) return;
  await pc.setRemoteDescription(answer);
  await flushIce();
});

socket.on("ice", async (candidate) => {
  if (!pc) return;
  if (pc.remoteDescription) {
    try { await pc.addIceCandidate(candidate); } catch (e) { console.warn(e); }
  } else {
    pendingIce.push(candidate); // arrived before the offer/answer
  }
});

async function flushIce() {
  for (const c of pendingIce) {
    try { await pc.addIceCandidate(c); } catch (e) { console.warn(e); }
  }
  pendingIce = [];
}

socket.on("partner-left", () => {
  closePeer();
  addMsg("Stranger disconnected.", "sys");
  setStatus("Stranger left. Click Next to meet someone new.");
});

socket.on("chat", (text) => addMsg(text, "them"));

// --- UI wiring ---
$("startBtn").onclick = start;
$("nextBtn").onclick = findPartner;
$("stopBtn").onclick = stop;

$("muteBtn").onclick = (e) => {
  const track = localStream && localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? "Mute" : "Unmute";
};
$("camBtn").onclick = (e) => {
  const track = localStream && localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  e.target.textContent = track.enabled ? "Camera off" : "Camera on";
};

$("chatForm").onsubmit = (e) => {
  e.preventDefault();
  const text = chatInput.value.trim().slice(0, 500);
  if (!text) return;
  socket.emit("chat", text);
  addMsg(text, "me");
  chatInput.value = "";
};
