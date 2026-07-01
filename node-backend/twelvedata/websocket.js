const WebSocket = require("ws");

const API_KEY = process.env.TWELVE_DATA_API_KEY;

let socket = null;

function connect(onPrice) {
    if (!API_KEY) {
        console.log("❌ TWELVE_DATA_API_KEY missing, skipping WS connection");
        return;
    }

    socket = new WebSocket(
        `wss://ws.twelvedata.com/v1/quotes/price?apikey=${API_KEY}`
    );

    socket.on("open", () => {
        console.log("✅ TwelveData WebSocket Connected");

        socket.send(JSON.stringify({
            action: "subscribe",
            params: {
                symbols: "XAU/USD"
            }
        }));
    });

    socket.on("message", (msg) => {
        const data = JSON.parse(msg);
        if (data.event === "price") {
            onPrice(data);
        }
    });

    socket.on("close", () => {
        console.log("❌ TwelveData Connection Closed");
        setTimeout(() => {
            console.log("🔄 Reconnecting TwelveData...");
            connect(onPrice);
        }, 5000);
    });

    socket.on("error", (err) => {
        console.error("TwelveData WS Error:", err.message);
    });
}

module.exports = {
    connect
};
