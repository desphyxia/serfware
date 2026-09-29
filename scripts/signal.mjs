// Tiny WebRTC signalling server for Seedfall development. Rooms pair one host with guests and
// relay offer/answer messages; game traffic never passes through here.
// Usage: npm run signal   (PORT=8787 by default)
import { WebSocketServer } from "ws";

export function startSignalServer(port = Number(process.env.PORT ?? 8787)) {
  const wss = new WebSocketServer({ port });
  const rooms = new Map(); // room -> { host, clients: Map<id, ws> }
  let nextId = 1;

  const send = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));

  wss.on("connection", (ws) => {
    ws.id = `c${nextId++}`;
    ws.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === "host") {
        const room = String(m.room || "");
        if (rooms.has(room)) return send(ws, { type: "error", message: "That room is already hosted." });
        rooms.set(room, { host: ws, clients: new Map() });
        ws.room = room;
        ws.role = "host";
      } else if (m.type === "join") {
        const room = rooms.get(String(m.room || ""));
        if (!room) return send(ws, { type: "error", message: "No lobby with that room code." });
        room.clients.set(ws.id, ws);
        ws.room = String(m.room);
        ws.role = "guest";
        send(room.host, { type: "joined", client: ws.id, name: m.name });
      } else if (m.type === "signal") {
        const room = rooms.get(ws.room);
        if (!room) return;
        const target = m.to === "host" ? room.host : room.clients.get(m.to);
        send(target, { type: "signal", from: ws.role === "host" ? "host" : ws.id, data: m.data });
      }
    });
    ws.on("close", () => {
      const room = rooms.get(ws.room);
      if (!room) return;
      if (ws.role === "host") rooms.delete(ws.room);
      else room.clients.delete(ws.id);
    });
  });
  return wss;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wss = startSignalServer();
  console.log(`Seedfall signalling server on ws://localhost:${wss.options.port}`);
}
