
const $ = (id) => document.getElementById(id);

let currentRoom = null;
let currentPlayerId = null;

function showError(message) {
    $("errorMessage").textContent = message || "";
}

function showRoom(code) {
    currentRoom = code;

    $("roomCodeDisplay").textContent = code;
    $("roomPanel").classList.remove("hidden");
    $("createForm").classList.add("hidden");
    $("joinForm").classList.add("hidden");
    $("createTab").classList.remove("active");
    $("joinTab").classList.remove("active");
}

function updatePlayers(room) {
    if (!room) return;

    $("playerCount").textContent =
        `${room.players.length} / ${room.maxPlayers}`;

    const list = $("playersList");
    list.replaceChildren();

    room.players.forEach(player => {
        const row = document.createElement("div");
        row.className = "player";

        const name = document.createElement("span");
        name.textContent = player.name;

        const role = document.createElement("span");
        role.className = "host-label";
        role.textContent = player.isHost ? "ХОСТ" : "ИГРОК";

        row.append(name, role);
        list.appendChild(row);
    });
}

$("createTab").addEventListener("click", () => {
    $("createForm").classList.remove("hidden");
    $("joinForm").classList.add("hidden");
    $("createTab").classList.add("active");
    $("joinTab").classList.remove("active");
    showError("");
});

$("joinTab").addEventListener("click", () => {
    $("joinForm").classList.remove("hidden");
    $("createForm").classList.add("hidden");
    $("joinTab").classList.add("active");
    $("createTab").classList.remove("active");
    showError("");
});

$("createButton").addEventListener("click", async () => {
    showError("");

    const name = $("playerName").value.trim();
    const password = $("roomPassword").value;

    if (!name || password.length < 6) {
        return showError("Введите имя и пароль от 6 символов");
    }

    const result = await window.warcraftAPI.createRoom({
        name,
        password
    });

    if (!result.success) {
        showError(result.error);
    }
});

$("joinButton").addEventListener("click", async () => {
    showError("");

    const name = $("joinName").value.trim();
    const code = $("roomCode").value.trim().toUpperCase();
    const password = $("joinPassword").value;

    if (!name || code.length !== 6 || !password) {
        return showError("Проверьте имя, код и пароль");
    }

    const result = await window.warcraftAPI.joinRoom({
        name,
        code,
        password
    });

    if (!result.success) {
        showError(result.error);
    }
});

$("leaveButton").addEventListener("click", async () => {
    const result = await window.warcraftAPI.leaveRoom();

    if (!result.success) {
        showError(result.error);
    }

    currentRoom = null;
    currentPlayerId = null;

    $("roomPanel").classList.add("hidden");
    $("createForm").classList.remove("hidden");
    showError("");
});

$("copyCode").addEventListener("click", async () => {
    if (!currentRoom) return;

    try {
        await navigator.clipboard.writeText(currentRoom);
        $("copyCode").textContent = "Скопировано!";
    } catch {
        showError("Не удалось скопировать код");
    }
});

window.warcraftAPI.onServerStatus(status => {
    const dot = $("statusDot");
    const label = $("serverStatus");

    dot.classList.toggle("online", status.connected);

    label.textContent = status.connected
        ? "Сервер подключён"
        : "Нет соединения";
});

window.warcraftAPI.onServerMessage(message => {
    switch (message.type) {
        case "connected":
            showError("");
            break;

        case "room_created":
        case "room_joined":
            currentPlayerId = message.playerId;
            showRoom(message.code);
            break;

        case "room_update":
            updatePlayers(message.room);
            break;

        case "left_room":
            currentRoom = null;
            currentPlayerId = null;
            $("roomPanel").classList.add("hidden");
            $("createForm").classList.remove("hidden");
            break;

        case "error":
            showError(message.message);
            break;
    }
});

async function initialize() {
    const result = await window.warcraftAPI.connect();

    if (!result.success) {
        showError("Не удалось подключиться к серверу. Запустите сервер.");
    }
}

initialize();
