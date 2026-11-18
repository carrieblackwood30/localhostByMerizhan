
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("warcraftAPI", {
    connect: () => ipcRenderer.invoke("server:connect"),

    createRoom: (data) =>
        ipcRenderer.invoke("room:create", data),

    joinRoom: (data) =>
        ipcRenderer.invoke("room:join", data),

    leaveRoom: () =>
        ipcRenderer.invoke("room:leave"),

    onServerStatus: (callback) => {
        ipcRenderer.on("server-status", (_, data) => callback(data));
    },

    onServerMessage: (callback) => {
        ipcRenderer.on("server-message", (_, data) => callback(data));
    }
});
