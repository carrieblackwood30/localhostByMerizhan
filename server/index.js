
require("dotenv").config();

const WebSocket = require("ws");
const crypto = require("crypto");

const HOST = process.env.SERVER_HOST || "127.0.0.1";
const PORT = Number(process.env.SERVER_PORT || 3001);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 5);

const wss = new WebSocket.Server({
    host: HOST,
    port: PORT,
    maxPayload: 16 * 1024
});

const rooms = new Map();
const clients = new Map();

function send(socket, data) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

function generateRoomCode() {
    let code;

    do {
        code = crypto.randomBytes(3)
            .toString("hex")
            .toUpperCase();
    } while (rooms.has(code));

    return code;
}

function hashPassword(password, salt) {
    return crypto.scryptSync(password, salt, 32)
        .toString("hex");
}

function verifyPassword(password, room) {
    const hash = Buffer.from(
        hashPassword(password, room.salt),
        "hex"
    );

    const original = Buffer.from(room.passwordHash, "hex");

    return hash.length === original.length &&
        crypto.timingSafeEqual(hash, original);
}

function getPlayers(room) {
    return [...room.players.values()].map(player => ({
        id: player.id,
        name: player.name,
        isHost: player.id === room.hostId
    }));
}

function broadcast(room, data) {
    for (const player of room.players.values()) {
        send(player.socket, data);
    }
}

function broadcastRoomUpdate(room) {
    broadcast(room, {
        type: "room_update",
        room: {
            code: room.code,
            hostId: room.hostId,
            players: getPlayers(room),
            maxPlayers: MAX_PLAYERS
        }
    });
}

function createRoom(socket, message) {
    const name = String(message.name || "").trim();
    const password = String(message.password || "");

    if (!name || name.length > 24) {
        return send(socket, {
            type: "error",
            message: "Имя должно содержать от 1 до 24 символов"
        });
    }

    if (password.length < 6 || password.length > 64) {
        return send(socket, {
            type: "error",
            message: "Пароль должен содержать от 6 до 64 символов"
        });
    }

    if (clients.has(socket)) {
        return send(socket, {
            type: "error",
            message: "Вы уже подключены к комнате"
        });
    }

    const code = generateRoomCode();
    const salt = crypto.randomBytes(16).toString("hex");

    const player = {
        id: crypto.randomUUID(),
        name,
        socket
    };

    const room = {
        code,
        salt,
        passwordHash: hashPassword(password, salt),
        hostId: player.id,
        players: new Map([[player.id, player]])
    };

    rooms.set(code, room);
    clients.set(socket, { roomCode: code, playerId: player.id });

    send(socket, {
        type: "room_created",
        code,
        playerId: player.id
    });

    broadcastRoomUpdate(room);

    console.log(`[ROOM] Created: ${code}`);
}

function joinRoom(socket, message) {
    const code = String(message.code || "").toUpperCase();
    const password = String(message.password || "");
    const name = String(message.name || "").trim();

    const room = rooms.get(code);

    if (!room) {
        return send(socket, {
            type: "error",
            message: "Комната не найдена"
        });
    }

    if (clients.has(socket)) {
        return send(socket, {
            type: "error",
            message: "Вы уже подключены к комнате"
        });
    }

    if (!name || name.length > 24) {
        return send(socket, {
            type: "error",
            message: "Некорректное имя игрока"
        });
    }

    if (room.players.size >= MAX_PLAYERS) {
        return send(socket, {
            type: "error",
            message: "Комната заполнена"
        });
    }

    if (!verifyPassword(password, room)) {
        return send(socket, {
            type: "error",
            message: "Неверный пароль"
        });
    }

    const player = {
        id: crypto.randomUUID(),
        name,
        socket
    };

    room.players.set(player.id, player);
    clients.set(socket, {
        roomCode: code,
        playerId: player.id
    });

    send(socket, {
        type: "room_joined",
        code,
        playerId: player.id
    });

    broadcastRoomUpdate(room);

    console.log(`[ROOM] ${name} joined ${code}`);
}

function leaveRoom(socket) {
    const client = clients.get(socket);

    if (!client) return;

    clients.delete(socket);

    const room = rooms.get(client.roomCode);

    if (!room) return;

    const player = room.players.get(client.playerId);

    if (player) {
        console.log(
            `[ROOM] ${player.name} left ${room.code}`
        );
    }

    room.players.delete(client.playerId);

    if (room.players.size === 0) {
        rooms.delete(room.code);
        console.log(`[ROOM] Deleted: ${room.code}`);
        return;
    }

    if (room.hostId === client.playerId) {
        const nextHost = room.players.values().next().value;
        room.hostId = nextHost.id;
    }

    broadcastRoomUpdate(room);
}

wss.on("connection", (socket) => {
    console.log("[WS] Client connected");

    send(socket, {
        type: "connected",
        message: "Warcraft LAN Connect server online"
    });

    socket.on("message", (raw) => {
        let message;

        try {
            message = JSON.parse(raw.toString());
        } catch {
            return send(socket, {
                type: "error",
                message: "Некорректный JSON"
            });
        }

        if (!message || typeof message.type !== "string") {
            return send(socket, {
                type: "error",
                message: "Некорректный запрос"
            });
        }

        switch (message.type) {
            case "create_room":
                createRoom(socket, message);
                break;

            case "join_room":
                joinRoom(socket, message);
                break;

            case "leave_room":
                leaveRoom(socket);
                send(socket, { type: "left_room" });
                break;

            case "ping":
                send(socket, { type: "pong" });
                break;

            default:
                send(socket, {
                    type: "error",
                    message: "Неизвестная команда"
                });
        }
    });

    socket.on("close", () => {
        leaveRoom(socket);
        console.log("[WS] Client disconnected");
    });

    socket.on("error", (error) => {
        console.error("[WS ERROR]", error.message);
        leaveRoom(socket);
    });
});

wss.on("listening", () => {
    console.log("==================================");
    console.log(" WARCRAFT LAN CONNECT SERVER");
    console.log("==================================");
    console.log(`Status: ONLINE`);
    console.log(`Host: ${HOST}`);
    console.log(`Port: ${PORT}`);
    console.log(`Max players: ${MAX_PLAYERS}`);
    console.log("==================================");
});

wss.on("error", (error) => {
    console.error("[SERVER ERROR]", error.message);
});
