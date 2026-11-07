const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ICE servers for WebRTC. Set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL on the host
// (e.g. Railway variables) to enable a TURN relay; TURN_URL may be comma-separated.
app.get("/ice-config", (req, res) => {
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(",").map((s) => s.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers });
});

// Matchmaking state
let waiting = null; // socket id of the user waiting for a partner
const partners = new Map(); // socket id -> partner socket id

function broadcastCount() {
  io.emit("online", io.engine.clientsCount);
}

function unpair(id, notify = true) {
  const partnerId = partners.get(id);
  if (!partnerId) return;
  partners.delete(id);
  partners.delete(partnerId);
  if (notify) io.to(partnerId).emit("partner-left");
}

function leaveQueue(id) {
  if (waiting === id) waiting = null;
}

io.on("connection", (socket) => {
  broadcastCount();

  socket.on("find", () => {
    // Drop any existing pairing/queue state first ("Next" button)
    unpair(socket.id);
    leaveQueue(socket.id);

    if (waiting && waiting !== socket.id && io.sockets.sockets.has(waiting)) {
      const other = waiting;
      waiting = null;
      partners.set(socket.id, other);
      partners.set(other, socket.id);
      // The newcomer creates the offer; the waiting user answers.
      io.to(socket.id).emit("matched", { initiator: true });
      io.to(other).emit("matched", { initiator: false });
    } else {
      waiting = socket.id;
      socket.emit("waiting");
    }
  });

  // Relay WebRTC signaling and chat only to the paired partner
  for (const evt of ["offer", "answer", "ice", "chat"]) {
    socket.on(evt, (data) => {
      const partnerId = partners.get(socket.id);
      if (partnerId) io.to(partnerId).emit(evt, data);
    });
  }

  socket.on("leave", () => {
    unpair(socket.id);
    leaveQueue(socket.id);
  });

  socket.on("disconnect", () => {
    unpair(socket.id);
    leaveQueue(socket.id);
    broadcastCount();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`vidCall running on http://localhost:${PORT}`));
