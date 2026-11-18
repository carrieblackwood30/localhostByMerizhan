
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const WebSocket = require("ws");

let mainWindow;
let socket = null;

function sendToUI(event, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(event, data);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050,
        height: 720,
        minWidth: 850,
        minHeight: 600,
        backgroundColor: "#101712",
        title: "Warcraft LAN Connect",
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.loadFile(
        path.join(__dirname, "renderer", "index.html")
    );
}

function connectToServer() {
    return new Promise((resolve, reject) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            return resolve(true);
        }

        if (socket && socket.readyState === WebSocket.CONNECTING) {
            return reject(new Error("Подключение уже выполняется"));
        }

        socket = new WebSocket("ws://127.0.0.1:3001");

        const currentSocket = socket;

        currentSocket.once("open", () => {
            sendToUI("server-status", {
                connected: true
            });

            resolve(true);
        });

        currentSocket.on("message", (raw) => {
            try {
                const message = JSON.parse(raw.toString());
                sendToUI("server-message", message);
            } catch (error) {
                console.error("Invalid server message:", error);
            }
        });

        currentSocket.on("close", () => {
            if (socket === currentSocket) {
                socket = null;
                sendToUI("server-status", {
                    connected: false
                });
            }
        });

        currentSocket.on("error", (error) => {
            console.error("WebSocket error:", error.message);

            if (socket === currentSocket) {
                sendToUI("server-status", {
                    connected: false
                });
            }

            reject(error);
        });
    });
}

function sendCommand(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Нет соединения с сервером");
    }

    socket.send(JSON.stringify(message));
}

ipcMain.handle("server:connect", async () => {
    try {
        await connectToServer();
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});

ipcMain.handle("room:create", (_, data) => {
    try {
        sendCommand({
            type: "create_room",
            name: data.name,
            password: data.password
        });

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});

ipcMain.handle("room:join", (_, data) => {
    try {
        sendCommand({
            type: "join_room",
            name: data.name,
            code: data.code,
            password: data.password
        });

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});

ipcMain.handle("room:leave", () => {
    try {
        sendCommand({ type: "leave_room" });
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (socket) {
        socket.close();
    }

    if (process.platform !== "darwin") {
        app.quit();
    }
});
