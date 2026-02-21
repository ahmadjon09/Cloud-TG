import "dotenv/config";
import { connectDB } from "./db.js";
import { startServer } from "./server.js";
import { startBot } from "./bot.js";
import axios from "axios";


const keepServerAlive = () => {
    if (!process.env.BASE_URL) {
        console.warn('⚠️ BASE_URL is not set. Skipping ping.')
        return
    }

    setInterval(() => {
        axios
            .get(`${process.env.BASE_URL}/hello`)
            .then(() => console.log('🔄 Server active'))
            .catch(err => console.log('⚠️ Ping failed:', err.message))
    }, 10 * 60 * 1000)
}

keepServerAlive()
await connectDB(process.env.MONGO_URI);
startServer();
startBot();