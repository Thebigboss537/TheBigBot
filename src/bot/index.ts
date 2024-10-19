import { TokenManager } from "../auth/tokenmanager";
import WebSocket from "ws";
import {
  savePrediction,
  clearPredictions,
  getWinners,
  getPredictionByUserId,
  editPrediction,
  saveWinnersPrediction,
  clearWinnersPredictions,
  getWinnersPrediction,
} from "../database";
import { config } from "../utils/config";
import { prediction } from "../interfaces/predictions";
import { Server } from "socket.io";


let datetimeStart: string = "";
let datetimeEnd: string = "";
let BOT_USER_ID: string = "";
const CLIENT_ID: string = config.CLIENTID || "";
let CHAT_CHANNEL_USER_ID = "";
let TWITCH_USERNAME: string = "";
const predictionRegex: RegExp = /^(\d{1,2})-(\d{1,2})$/;
const EVENTSUB_WEBSOCKET_URL: string = "wss://eventsub.wss.twitch.tv/ws";
let io: Server;
let lastShowPlayersTime = 0;
const SHOW_PLAYERS_COOLDOWN = 60000;

let start: boolean = false;

var websocketSessionID: string;
const tokenManager = new TokenManager();

let validToken: string;

interface WebSocketMessage {
  metadata: {
    message_type: string;
    subscription_type?: string;
  };
  payload: {
    session?: {
      id: string;
    };
    event?: {
      broadcaster_user_login: string;
      chatter_user_login: string;
      chatter_user_id: string;
      message: {
        text: string;
      };
      badges: {
        set_id: string;
        id: string;
        info: string;
      };
    };
  };
}

interface Badge {
  set_id: string;
  id: string;
  info: string;
}

type badges = Badge[];

let botWebSocket: WebSocket | null = null;
let botInterval: NodeJS.Timeout | null = null;
let botStatus: "running" | "stopped" = "stopped";

export async function initializeBot(
  twitchUsername: string,
  socketServer: Server
) {
  await waitForValidToken();

  io = socketServer;

  await getUserId(twitchUsername);

  TWITCH_USERNAME = twitchUsername;

  const websocketClient = startWebSocketClient();
  botWebSocket = websocketClient;

  // Start WebSocket client and register handlers
  await new Promise<void>((resolve) => {
    websocketClient.on("open", () => {
      console.log("WebSocket connection opened to " + EVENTSUB_WEBSOCKET_URL);
      resolve();
    });
  });

  // Set up interval for any recurring bot tasks
  botInterval = setInterval(() => {
    // Add any recurring tasks here
  }, 60000); // Run every minute, adjust as needed

  botStatus = "running";
  datetimeStart = new Date().toString();
  console.log(`Bot initialized and connected to ${twitchUsername} chat`);
}

export async function stopBot() {
  if (botWebSocket) {
    botWebSocket.close();
    botWebSocket = null;
  }

  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }

  CHAT_CHANNEL_USER_ID = "";
  TWITCH_USERNAME = "";

  botStatus = "stopped";
  datetimeEnd = new Date().toString();
  console.log("Bot stopped");
}

export async function getBotStatus(): Promise<"running" | "stopped"> {
  return botStatus;
}

export async function getBotInfo () {
  return {
    username: TWITCH_USERNAME,
    status: botStatus,
    datetimeStart,
    datetimeEnd
  }
}

async function waitForValidToken(): Promise<void> {
  while (true) {
    try {
      validToken = await tokenManager.getValidToken();
      await getAuth(); // This will throw an error if the token is not valid
      console.log("Valid token obtained and authenticated.");
      break;
    } catch (error) {
      console.log(
        "No valid token available or authentication failed. Waiting for 30 seconds before retrying..."
      );
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
}

async function getAuth() {
  let response = await fetch("https://id.twitch.tv/oauth2/validate", {
    method: "GET",
    headers: {
      Authorization: "OAuth " + validToken,
    },
  });

  if (response.status != 200) {
    let data = await response.json();
    console.error(
      "Token is not valid. /oauth2/validate returned status code " +
        response.status
    );
    console.error(data);
    throw new Error("Invalid token");
  }
  BOT_USER_ID = (await response.json()).user_id;
  console.log("Validated token.");
}

function startWebSocketClient() {
  let websocketClient = new WebSocket(EVENTSUB_WEBSOCKET_URL);

  websocketClient.on("error", console.error);

  websocketClient.on("open", () => {
    console.log("WebSocket connection opened to " + EVENTSUB_WEBSOCKET_URL);
  });

  websocketClient.on("message", (data) => {
    handleWebSocketMessage(JSON.parse(data.toString()));
  });

  return websocketClient;
}

async function handleWebSocketMessage(data: WebSocketMessage): Promise<void> {
  switch (data.metadata.message_type) {
    case "session_welcome": // First message you get from the WebSocket server when connecting
      websocketSessionID = data.payload.session?.id ?? "";
      console.log("Received session_welcome. Session ID:", websocketSessionID);

      // Now that we have the session ID, we can register EventSub listeners
      await registerEventSubListeners();
      break;
    case "notification": // An EventSub notification has occurred, such as channel.chat.message
      switch (data.metadata.subscription_type) {
        case "channel.chat.message":
          const messageText = data.payload.event?.message.text.toString();
          console.log(`MSG usuario: <${data.payload.event?.chatter_user_login}>: ${messageText}`);

          let badgesUser: badges = Array.isArray(data.payload.event?.badges)
            ? data.payload.event?.badges
            : [];

          let isUserAuthorized: boolean =
            badgesUser.find(
              (badge) =>
                badge.set_id == "broadcaster" || badge.set_id == "moderator"
            ) == undefined
              ? false
              : true;

          if (start) {
            let match = data.payload.event?.message.text
              .toString()
              .match(predictionRegex);

            if (match) {
              const [, homeScore, awayScore] = match;

              let prediction: prediction = await getPredictionByUserId(
                data.payload.event?.chatter_user_id.toString() ?? ""
              );

              if (prediction) {
                await editPrediction(
                  prediction.id,
                  parseInt(homeScore),
                  parseInt(awayScore)
                );
              } else {
                await savePrediction(
                  data.payload.event?.chatter_user_id.toString() ?? "",
                  data.payload.event?.chatter_user_login.toString() ?? "",
                  parseInt(homeScore),
                  parseInt(awayScore)
                );
              }
            }
          }

          if (data.payload.event?.message.text.toString() == "!ping") {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage("pong");
          }

          if (data.payload.event?.message.text.toString() == "!help") {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage(
              "Comandos disponibles: \n !start - Iniciar proceso de guardar datos \n !stop - Detener proceso de guardar datos \n !clear - Limpiar base de datos \n !clearWinners - Limpiar base de datos de ganadores \n !scoreboard - Ver el scoreboard \n !winners [homeScore-awayScore] - Obtener ganadores"
            );
          }

          //iniciar proceso de guardar datos
          if (
            data.payload.event?.message.text.toString() == "!start" &&
            isUserAuthorized
          ) {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage("Iniciando proceso de guardar datos");
            start = true;
          }

          //detener proceso de guardar datos
          if (
            data.payload.event?.message.text.toString() == "!stop" &&
            isUserAuthorized
          ) {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage("Deteniendo proceso de guardar datos");
            start = false;
          }

          //limpiar base de datos
          if (
            data.payload.event?.message.text.toString() == "!clear" &&
            isUserAuthorized
          ) {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage("Limpiando base de datos");
            await clearPredictions();
          }

          if (
            data.payload.event?.message.text.toString() == "!clearWinners" &&
            isUserAuthorized
          ) {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage("Limpiando base de datos de ganadores");
            await clearWinnersPredictions();
          }

          if (data.payload.event?.message.text.toString() == "!scoreboard") {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage(
              "El scoreboard se encuentra en: https://thebigbot-dwgza9dccwh4cpaz.centralus-01.azurewebsites.net/ganadores"
            );
          }

          //obtener ganadores
          if (
            data.payload.event?.message.text.startsWith("!winners") &&
            isUserAuthorized
          ) {
            console.log(
              `MSG usuarioAtenticado: ${isUserAuthorized} #${data.payload.event?.broadcaster_user_login} <${data.payload.event?.chatter_user_login}> ${data.payload.event?.message.text}`
            );
            await sendChatMessage("Obteniendo ganadores");

            const fullMessage = data.payload.event.message.text;

            const scoresText = fullMessage.replace("!winners", "").trim();

            const [homeScore, awayScore] = scoresText.split("-").map(Number);

            const winners: prediction[] = await getWinners(
              homeScore,
              awayScore
            );

            for (let winner of winners) {
              await saveWinnersPrediction(
                winner.userId,
                winner.username,
                winner.homeScore,
                winner.awayScore,
                winner.timestamp
              );
            }

            let winnersPredictions = await getWinnersPrediction();

            let message = "Ganadores: ";

            for (let winner of winnersPredictions) {
              message += `${winner.username},`;
            }

            await sendWhisperMessage(
              message,
              data.payload.event?.chatter_user_id.toString() ?? ""
            );

            await sendChatMessage(
              "Ganadores obtenidos: https://thebigbot-dwgza9dccwh4cpaz.centralus-01.azurewebsites.net/ganadores"
            );
          }

          if (messageText && /^\s*!team\s*(\u200b|\u200c|\u200d|\ufeff|\u0020\udb40\udc00)?$/i.test(messageText)) {
            console.log(`MSG team: <${data.payload.event?.chatter_user_login}>: ${messageText}`);
            const currentTime = Date.now();
          
            if (currentTime - lastShowPlayersTime >= SHOW_PLAYERS_COOLDOWN) {
              console.log("Mostrando jugadores");
              io.to("dedsafio").emit("showPlayers");
              lastShowPlayersTime = currentTime;
            } else {
              const remainingTime = Math.ceil((SHOW_PLAYERS_COOLDOWN - (currentTime - lastShowPlayersTime)) / 1000);
              console.log(`Comando !team bloqueado. Tiempo restante: ${remainingTime} segundos`);
            }
          }

        break;
      }
    break;
  }
}

async function sendChatMessage(chatMessage: string): Promise<void> {
  let response = await fetch("https://api.twitch.tv/helix/chat/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + validToken,
      "Client-Id": CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: CHAT_CHANNEL_USER_ID,
      sender_id: BOT_USER_ID,
      message: chatMessage,
    }),
  });

  if (response.status != 200) {
    let data = await response.json();
    console.error("Failed to send chat message");
    console.error(data);
  } else {
    console.log("Sent chat message: " + chatMessage);
  }
}

async function sendWhisperMessage(
  chatMessage: string,
  to_user_id: string
): Promise<void> {
  console.log("Enviando mensaje al chat: " + chatMessage);
  let response = await fetch(
    `https://api.twitch.tv/helix/whispers?from_user_id=${BOT_USER_ID}&to_user_id=${to_user_id}`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + validToken,
        "Client-Id": CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: chatMessage,
      }),
    }
  );

  if (response.status != 204) {
    let data = await response.json();
    console.error("Failed to send chat message");
    console.error(data);
  } else {
    console.log("Sent chat message: " + chatMessage);
  }
}

async function getUserId(username: string): Promise<void> {
  console.log("Obteniendo ID de usuario del canal:", username);
  console.log("Obteniendo ID de usuario del canal:", validToken);
  console.log("Obteniendo ID de usuario del canal:", CLIENT_ID);
  console.log(
    "Obteniendo url:",
    `https://api.twitch.tv/helix/users?login=${username}`
  );
  let response = await fetch(
    `https://api.twitch.tv/helix/users?login=${username}`,
    {
      method: "GET",
      headers: {
        Authorization: "Bearer " + validToken,
        "Client-Id": CLIENT_ID,
      },
    }
  );

  if (response.status != 200) {
    let data = await response.json();
    console.error(
      "Failed to get user ID. API call returned status code " + response.status
    );
    console.error(data);
    throw new Error("Failed to get user ID");
  } else {
    CHAT_CHANNEL_USER_ID = (await response.json()).data[0].id;
    console.log("Channel user ID obtained:", CHAT_CHANNEL_USER_ID);
  }
}

async function registerEventSubListeners() {
  console.log("Attempting to register EventSub listeners...");

  try {
    let response = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + validToken,
          "Client-Id": CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: CHAT_CHANNEL_USER_ID,
            user_id: BOT_USER_ID,
          },
          transport: {
            method: "websocket",
            session_id: websocketSessionID,
          },
        }),
      }
    );

    const responseBody = await response.json();

    if (response.status !== 202) {
      console.error(
        "Failed to subscribe to channel.chat.message. API call returned status code " +
          response.status
      );
      console.error("Response body:", responseBody);

      if (responseBody.message) {
        console.error("Error message from Twitch:", responseBody.message);
      }

      throw new Error(
        `Failed to subscribe to channel.chat.message: ${response.status} ${response.statusText}`
      );
    } else {
      console.log(
        `Successfully subscribed to channel.chat.message [${responseBody.data[0].id}]`
      );
    }
  } catch (error) {
    console.error("Error in registerEventSubListeners:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
    }
    throw error;
  }
}
