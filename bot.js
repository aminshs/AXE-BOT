
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import pino from "pino";
import fs from "fs";

const OWNER_NUMBER = (process.env.OWNER_NUMBER || "").replace(/\D/g, "");
const PAIRING_NUMBER = (process.env.PAIRING_NUMBER || "").replace(/\D/g, "");
const AUTH_DIR = process.env.AUTH_DIR || "./auth_info";

let botMode = "public";
let pairingRequested = false;

function getNumber(jid = "") {
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}

function getText(message) {
  const msg = message.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ""
  ).trim();
}

async function startBot() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } =
    await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["AXE BOT", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  if (!state.creds.registered && PAIRING_NUMBER && !pairingRequested) {
    pairingRequested = true;

    try {
      const code = await sock.requestPairingCode(PAIRING_NUMBER);
      console.log("AXE BOT PAIRING CODE:", code);
      console.log("Enter this code in WhatsApp > Linked Devices.");
    } catch (error) {
      pairingRequested = false;
      console.error("Pairing code error:", error);
    }
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("AXE BOT connected successfully!");
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        console.log("WhatsApp logged out. Delete old session before pairing again.");
        return;
      }

      console.log("Connection lost. Reconnecting...");
      setTimeout(startBot, 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) {
      try {
        if (!m.message) continue;

        const jid = m.key.remoteJid;
        if (!jid || jid === "status@broadcast") continue;

        const text = getText(m);
        if (!text.startsWith(".")) continue;

        const sender = m.key.participant || jid;
        const isOwner =
          OWNER_NUMBER !== "" &&
          getNumber(sender) === OWNER_NUMBER;

        const command = text.toLowerCase().trim();

        // .profile is available in private mode to everyone.
        if (botMode === "private" &&
            !isOwner &&
            !command.startsWith(".profile")) {
          continue;
        }

        // React to every accepted command.
        await sock.sendMessage(jid, {
          react: { text: "✅", key: m.key }
        });

        if (command === ".menu") {
          await sock.sendMessage(jid, {
            text:
`👾𝐀𝐗𝐄 𝐁𝐎𝐓👾

OWNER
.my profile
.mode private
.mode public

GENERAL
.profile

More commands will be added as we build the bot.`
          });
        }

        else if (command === ".mode private" ||
                 command === ".mode public") {
          if (!isOwner) {
            await sock.sendMessage(jid, {
              text: "OWNER ONLY!"
            });
            continue;
          }

          botMode = command.endsWith("private")
            ? "private"
            : "public";

          await sock.sendMessage(jid, {
            text: `AXE BOT mode changed to: ${botMode.toUpperCase()}`
          });
        }

        else if (command === ".my profile") {
          if (!isOwner) {
            await sock.sendMessage(jid, {
              text: "OWNER ONLY!"
            });
            continue;
          }

          const number = getNumber(sock.user?.id || "");

          await sock.sendMessage(jid, {
            text:
`👾 AXE BOT OWNER PROFILE

Name: ${sock.user?.name || "Unknown"}
Number: ${number || "Unknown"}`
          });
        }

        else if (command === ".profile") {
          const quoted =
            m.message?.extendedTextMessage?.contextInfo?.participant;

          if (!quoted) {
            await sock.sendMessage(jid, {
              text: "Reply to a member's message with .profile"
            });
            continue;
          }

          let groupName = "Unknown";

          if (jid.endsWith("@g.us")) {
            const metadata = await sock.groupMetadata(jid);
            const member = metadata.participants.find(
              p => p.id === quoted
            );

            groupName =
              member?.notify ||
              member?.name ||
              "Unknown";
          }

          const number = getNumber(quoted);

          await sock.sendMessage(jid, {
            text:
`👤 MEMBER PROFILE

Group name: ${groupName}
WhatsApp name: Unknown
Number: ${number || "Unknown"}`
          });
        }

      } catch (error) {
        console.error("Command error:", error);
      }
    }
  });
}

startBot().catch(error => {
  console.error("Bot startup error:", error);
});
            
