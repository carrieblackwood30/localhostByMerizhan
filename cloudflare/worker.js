
const MAX_PLAYERS = 5;
const MAX_PAYLOAD = 16 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        status: "ONLINE",
        service: "Warcraft LAN Connect",
        maxPlayers: MAX_PLAYERS
      });
    }

    if (url.pathname !== "/ws") {
      return json({ error: "Not found" }, 404);
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket connection required" }, 426);
    }

    const id = env.ROOMS.idFromName("global-room-manager");
    const roomManager = env.ROOMS.get(id);

    return roomManager.fetch(request);
  }
};

export class RoomManager {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      roomCode: null,
      playerId: null
    });

    this.send(server, {
      type: "connected",
      message: "Warcraft LAN Connect server online"
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  send(socket, data) {
    try {
      socket.send(JSON.stringify(data));
    } catch (error) {
      console.error("WebSocket send error:", error);
    }
  }

  async webSocketMessage(socket, raw) {
    if (typeof raw !== "string" || raw.length > MAX_PAYLOAD) {
      return this.send(socket, {
        type: "error",
        message: "Некорректный запрос"
      });
    }

    let message;

    try {
      message = JSON.parse(raw);
    } catch {
      return this.send(socket, {
        type: "error",
        message: "Некорректный JSON"
      });
    }

    if (!message || typeof message.type !== "string") {
      return this.send(socket, {
        type: "error",
        message: "Некорректный запрос"
      });
    }

    switch (message.type) {
      case "create_room":
        await this.createRoom(socket, message);
        break;

      case "join_room":
        await this.joinRoom(socket, message);
        break;

      case "leave_room":
        await this.leaveRoom(socket);
        this.send(socket, { type: "left_room" });
        break;

      case "ping":
        this.send(socket, { type: "pong" });
        break;

      default:
        this.send(socket, {
          type: "error",
          message: "Неизвестная команда"
        });
    }
  }

  async generateRoomCode() {
    for (let i = 0; i < 20; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(3));
      const code = Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();

      if (!(await this.ctx.storage.get(`room:${code}`))) {
        return code;
      }
    }

    throw new Error("Не удалось создать код комнаты");
  }

  randomHex(length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async hashPassword(password, salt) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode(salt),
        iterations: 100000,
        hash: "SHA-256"
      },
      key,
      256
    );

    return Array.from(new Uint8Array(bits))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async verifyPassword(password, room) {
    const hash = await this.hashPassword(password, room.salt);

    if (hash.length !== room.passwordHash.length) {
      return false;
    }

    let difference = 0;

    for (let i = 0; i < hash.length; i++) {
      difference |= hash.charCodeAt(i) ^ room.passwordHash.charCodeAt(i);
    }

    return difference === 0;
  }

  getAttachment(socket) {
    try {
      return socket.deserializeAttachment() || {};
    } catch {
      return {};
    }
  }

  setAttachment(socket, data) {
    socket.serializeAttachment(data);
  }

  getPlayers(room) {
    return room.players.map(player => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId
    }));
  }

  async broadcast(room, data) {
    const sockets = this.ctx.getWebSockets();

    for (const socket of sockets) {
      const attachment = this.getAttachment(socket);

      if (attachment.roomCode === room.code) {
        this.send(socket, data);
      }
    }
  }

  async broadcastRoomUpdate(room) {
    await this.broadcast(room, {
      type: "room_update",
      room: {
        code: room.code,
        hostId: room.hostId,
        players: this.getPlayers(room),
        maxPlayers: MAX_PLAYERS
      }
    });
  }

  async createRoom(socket, message) {
    const attachment = this.getAttachment(socket);
    const name = String(message.name || "").trim();
    const password = String(message.password || "");

    if (!name || name.length > 24) {
      return this.send(socket, {
        type: "error",
        message: "Имя должно содержать от 1 до 24 символов"
      });
    }

    if (password.length < 6 || password.length > 64) {
      return this.send(socket, {
        type: "error",
        message: "Пароль должен содержать от 6 до 64 символов"
      });
    }

    if (attachment.roomCode) {
      return this.send(socket, {
        type: "error",
        message: "Вы уже подключены к комнате"
      });
    }

    const code = await this.generateRoomCode();
    const salt = this.randomHex(16);
    const player = {
      id: crypto.randomUUID(),
      name
    };

    const room = {
      code,
      salt,
      passwordHash: await this.hashPassword(password, salt),
      hostId: player.id,
      players: [player]
    };

    await this.ctx.storage.put(`room:${code}`, room);

    this.setAttachment(socket, {
      roomCode: code,
      playerId: player.id
    });

    this.send(socket, {
      type: "room_created",
      code,
      playerId: player.id
    });

    await this.broadcastRoomUpdate(room);

    console.log("[ROOM] Created:", code);
  }

  async joinRoom(socket, message) {
    const attachment = this.getAttachment(socket);
    const code = String(message.code || "").trim().toUpperCase();
    const password = String(message.password || "");
    const name = String(message.name || "").trim();

    if (attachment.roomCode) {
      return this.send(socket, {
        type: "error",
        message: "Вы уже подключены к комнате"
      });
    }

    const room = await this.ctx.storage.get(`room:${code}`);

    if (!room) {
      return this.send(socket, {
        type: "error",
        message: "Комната не найдена"
      });
    }

    if (!name || name.length > 24) {
      return this.send(socket, {
        type: "error",
        message: "Некорректное имя игрока"
      });
    }

    if (room.players.length >= MAX_PLAYERS) {
      return this.send(socket, {
        type: "error",
        message: "Комната заполнена"
      });
    }

    if (!(await this.verifyPassword(password, room))) {
      return this.send(socket, {
        type: "error",
        message: "Неверный пароль"
      });
    }

    const player = {
      id: crypto.randomUUID(),
      name
    };

    room.players.push(player);

    await this.ctx.storage.put(`room:${code}`, room);

    this.setAttachment(socket, {
      roomCode: code,
      playerId: player.id
    });

    this.send(socket, {
      type: "room_joined",
      code,
      playerId: player.id
    });

    await this.broadcastRoomUpdate(room);

    console.log("[ROOM]", name, "joined", code);
  }

  async leaveRoom(socket) {
    const attachment = this.getAttachment(socket);

    if (!attachment.roomCode || !attachment.playerId) {
      return;
    }

    const { roomCode, playerId } = attachment;

    this.setAttachment(socket, {
      roomCode: null,
      playerId: null
    });

    const key = `room:${roomCode}`;
    const room = await this.ctx.storage.get(key);

    if (!room) return;

    const player = room.players.find(item => item.id === playerId);

    room.players = room.players.filter(item => item.id !== playerId);

    if (player) {
      console.log("[ROOM]", player.name, "left", roomCode);
    }

    if (room.players.length === 0) {
      await this.ctx.storage.delete(key);
      console.log("[ROOM] Deleted:", roomCode);
      return;
    }

    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
    }

    await this.ctx.storage.put(key, room);
    await this.broadcastRoomUpdate(room);
  }

  async webSocketClose(socket) {
    await this.leaveRoom(socket);
  }

  async webSocketError(socket) {
    await this.leaveRoom(socket);
  }
}
