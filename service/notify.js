import "dotenv/config";
import axios from "axios";

/**
 * Sends a message via a Telegram bot. Set up once:
 * 1. Message @BotFather on Telegram, /newbot, get a token.
 * 2. Message your new bot anything, then visit
 *    https://api.telegram.org/bot<token>/getUpdates to find your chat id.
 * 3. Put both in .env as TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
 *
 * If those env vars aren't set, this just logs to console instead of
 * throwing — notifications are optional, not required for the pipeline.
 */
export async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("[notify] TELEGRAM_BOT_TOKEN/CHAT_ID not set, printing instead:\n" + text);
    return;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error("[notify] Failed to send Telegram message:", err.message);
  }
}