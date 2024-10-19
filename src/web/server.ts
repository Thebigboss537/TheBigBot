import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import {
  getTopPredictions,
  getWinners,
  getWinnersPrediction,
  getUser,
  savePositionsAndVisibilityQueensleague,
  getPositionsAndVisibilityQueensleague,
  savePositionsAndVisibilityDedsafio,
  getPositionsAndVisibilityDedsafio,
  getDedsafio,
  saveDedsafio
} from "../database";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../utils/config";
import { TokenManager } from "../auth/tokenmanager";
import { authMiddleware, softAuthCheck } from "./authMiddleware";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { getBotStatus, initializeBot, stopBot, getBotInfo } from "../bot";
import cookieParser from "cookie-parser";

interface User {
  id: number;
  username: string;
  password: string;
}

let validToken: string = "";

const tokenManager = new TokenManager();

const JWT_SECRET = config.JWT_SECRET || "your-secret-key";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let currentOverlayType = 'blank'; // Por defecto

const teamLogos = {
  "Las Santas FC": "https://kingsleague.pro/_ipx/s_44x44/https://s3.eu-central-2.wasabisys.com/kama.sport/account/production/team/178367163.png",
  "Real Titan": "https://kingsleague.pro/_ipx/s_44x44/kama/production/team/113960080.png",
};

async function getAuth() {
  let response = await fetch("https://id.twitch.tv/oauth2/validate", {
    method: "GET",
    headers: {
      Authorization: "OAuth " + validToken,
    },
  });

  if (response.status != 200) {
    let data = await response.json();
    console.error("Token is not valid. /oauth2/validate returned status code " + response.status);
    console.error(data);
    throw new Error("Invalid token");
  }
  return await response.json();
}

export async function startWebServer(): Promise<http.Server> {
  const app: express.Application = express();
  const server: http.Server = http.createServer(app);
  const domain: string = config.DOMINIO || "localhost";
  const port: number = config.PORT ? parseInt(config.PORT) : 3000;

  console.log("Dominio:", domain);
  console.log("Puerto:", port);

  const io: Server = new Server(server, {
    cors: {
      origin: `https://${domain}`,
      methods: ["GET", "POST"],
    },
  });

  console.log("Starting web server for OBS overlay");
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "/views"));

  app.use(express.static(path.join(__dirname, "..", "public")));

  setupRoutes(app, io);
  setupSocketIO(io);

  server.listen(port, () => {
    console.log(`Server running on http://${domain}:${port}`);
    console.log(`Admin page available at http://${domain}:${port}/admin`);
  });
  return server;
}

function setupRoutes(app: express.Application, io: Server) {
  app.get('/ping', (req, res) => {
    res.status(200).send('pong');
  });
  
  app.get("/", (req: express.Request, res: express.Response) => {
    //retornar al login
    res.redirect("/login");
  });

  app.get('/overlay', (req: express.Request, res: express.Response) => {
    res.render(`${currentOverlayType}-overlay`);
  });

  app.get("/admin-queensleague", softAuthCheck("admin-queensleague"), (req: express.Request, res: express.Response) => {
    res.render("admin-queensleague");
  });
  
  app.get("/admin-dedsafio", softAuthCheck("admin-dedsafio"), (req: express.Request, res: express.Response) => {
    res.render("admin-dedsafio");
  });

  app.post("/api/saveDedsafioTable", async (req: express.Request, res: express.Response) => {
    const { data } = req.body;
    try {
      await saveDedsafio(data);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving dedsafio table:", error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.get("/ganadores", async (req: express.Request, res: express.Response) => {
    try {
      const winners = await getWinnersPrediction();
      res.render("winners", { winners, teamLogos });
    } catch (error) {
      console.error("Error getting winners:", error);
      res.status(500).send("Error al obtener los ganadores: " + (error as Error).message);
    }
  });

  app.get("/login", (req, res) => {
    res.render("login");
  });

  app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    const user: User = await getUser(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token });
  });

  app.get("/start-auth", authMiddleware, (req, res) => {
    res.json({
      redirect_url: `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${config.CLIENTID}&redirect_uri=${config.DOMINIO}/auth/twitch/callback&scope=user:bot user:read:chat user:write:chat channel:bot user:manage:whispers`,
    });
  });

  app.get("/auth/twitch/callback", authMiddleware, async (req, res) => {
    const { code, state } = req.query;

    if (typeof code !== "string" || typeof state !== "string") {
      return res.status(400).send("Invalid authorization code or state");
    }

    try {
      await tokenManager.setInitialToken(code);
      res.send("<script>window.close();</script>");
    } catch (error) {
      console.error("Error setting initial token:", error);
      res.status(500).send("Error during authorization");
    }
  });

  app.post("/api/start-bot", authMiddleware, async (req, res) => {
    const { twitchUsername } = req.body;
    if (!twitchUsername) {
      return res.status(400).json({ success: false, message: "Twitch username is required" });
    }

    try {
      await initializeBot(twitchUsername, io);
      res.json({ success: true, message: "Bot started successfully" });
    } catch (error) {
      console.error("Error starting bot:", error);
      res.status(500).json({ success: false, message: "Failed to start bot" });
    }
  });

  app.post("/api/stop-bot", authMiddleware, async (req, res) => {
    try {
      await stopBot();
      res.json({ success: true, message: "Bot stopped successfully" });
    } catch (error) {
      console.error("Error stopping bot:", error);
      res.status(500).json({ success: false, message: "Failed to stop bot" });
    }
  });

  app.post("/verified_tokenBot", authMiddleware, async (req, res) => {
    try {
      validToken = await tokenManager.getValidToken();
      let responseBody = await getAuth();
      res.json(responseBody);
      console.log("Valid token obtained and authenticated.");
    } catch (error) {
      console.log("No valid token available or authentication failed");
      res.status(500).json({
        success: false,
        message: "No valid token available or authentication failed",
      });
    }
  });

  app.get("/bot_status", authMiddleware, async (req, res) => {
    try {
      const status = await getBotStatus();
      res.json({ status });
    } catch (error) {
      console.error("Error getting bot status:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/dashboard", async (req, res) => {
    res.render("dashboard");
  });

  app.post("/api/authenticate", async (req: express.Request, res: express.Response) => {
    const { token, adminType } = req.body;
    console.log("Authenticating token:", token);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
      
      // Aquí puedes añadir lógica adicional para verificar si el usuario tiene permisos para el tipo de admin especificado
      
      res.json({ 
        success: true, 
        user: { 
          username: decoded.username,
          // Añade cualquier otra información del usuario que necesites
        }
      });
    } catch (error) {
      console.error("Authentication failed:", error);
      res.status(401).json({ success: false, error: "Invalid token" });
    }
  });
}

function setupSocketIO(io: Server) {
  io.on("connection", (socket: Socket) => {
    console.log("New client connected");

    socket.on("joinRoom", (room) => {
      socket.join(room);
      console.log(`Client joined room: ${room}`);
      if(room !== 'blank'){
        sendData(socket, room);
      }
    });

    socket.on("leaveRoom", (room) => {
      socket.leave(room);
      console.log(`Client left room: ${room}`);
    });

    socket.on("changeOverlay", (type) => {
      console.log(`Changing overlay to: ${type}`);
      currentOverlayType = type;
      io.emit("reloadOverlay");
    });

    socket.on("showPlayers", () => {
      console.log('Emitiendo evento showPlayers a la sala dedsafio');
      io.to('dedsafio').emit('showPlayers');
    });

    socket.on("savePositions", async (data: { positions: any; token: string; type: string }) => {
      try {
        jwt.verify(data.token, JWT_SECRET);
        
        if (data.type === 'queensleague') {
          await savePositionsAndVisibilityQueensleague(data.positions);
        } else if (data.type === 'dedsafio') {
          await savePositionsAndVisibilityDedsafio(data.positions);
        } else {
          throw new Error('Invalid type');
        }
    
        console.log("Positions saved successfully");
        // Emitir a toda la sala correspondiente
        io.to(data.type).emit("positionsSaved", { success: true });
    
        // Actualizar las posiciones para todos los clientes en la sala
        io.to(data.type).emit("updatePositions", data.positions);
      } catch (error) {
        console.error("Error saving positions:", error);
        // En caso de error, emitir solo al socket que hizo la solicitud
        io.to(data.type).emit("positionsSaved", {
          success: false,
          error: (error as Error).message,
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  setInterval(() => broadcastUpdates(io), 5000);
}

async function broadcastUpdates(io: Server) {
  const rooms = ['queensleague', 'dedsafio', 'dashboard'];
  for (const room of rooms) {
    if ((io.sockets.adapter.rooms.get(room)?.size ?? 0) > 0) {
      const data = await getData(room);
      io.to(room).emit('update', data);
    }
  }
}

async function sendData(socket: Socket, room: string) {
  const data = await getData(room);
  socket.emit('update', data);
}

async function getData(type: string) {
  if (type === 'queensleague') {
    const [topPredictions, positionsAndVisibility] = await Promise.all([
      getTopPredictions(),
      getPositionsAndVisibilityQueensleague()
    ]);
    return { type: 'queensleague', predictions: topPredictions, positionsAndVisibility };
  } else if (type === 'dedsafio') {
    const [dedsafioData, positionsAndVisibility] = await Promise.all([
      getDedsafio(),
      getPositionsAndVisibilityDedsafio()
    ]);
    return { type: 'dedsafio', dedsafio: dedsafioData, positionsAndVisibility };
  } else if (type === 'dashboard') {
    const [dedsafioData, botinfo] = await Promise.all([
      getDedsafio(),
      await getBotInfo()
    ]);
    return { type: 'dashboard', users: dedsafioData, botinfo: botinfo, overlayType: currentOverlayType };
  } else {
    throw new Error('Invalid data type');
  } 
}