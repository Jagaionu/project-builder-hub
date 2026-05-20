import { createHash } from "crypto";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export function deriveTelegramWebhookSecret(): string {
  const key = process.env.TELEGRAM_API_KEY;
  if (!key) throw new Error("TELEGRAM_API_KEY is not configured");
  return createHash("sha256").update(`telegram-webhook:${key}`).digest("base64url");
}

async function tg(method: string, body: unknown) {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY is not configured");
  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Telegram ${method} failed [${res.status}]: ${JSON.stringify(data)}`);
  return data;
}

export const mainMenu = {
  keyboard: [
    [{ text: "▶️ Start Shift" }, { text: "⏹ End Shift" }],
    [{ text: "📍 Share Location", request_location: true }],
    [{ text: "📦 My Jobs" }, { text: "⚠️ Report Delay" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const removeKeyboard = { remove_keyboard: true };

export function jobInlineKeyboard(jobId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Accept", callback_data: `ACCEPT:${jobId}` },
        { text: "❌ Reject", callback_data: `REJECT:${jobId}` },
      ],
      [
        { text: "🚚 Picked up", callback_data: `PICKED:${jobId}` },
        { text: "🏁 Delivered", callback_data: `DELIVERED:${jobId}` },
      ],
    ],
  };
}

export function delayReasonsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Traffic", callback_data: "DELAY:Traffic" }, { text: "Loading", callback_data: "DELAY:Loading" }],
      [{ text: "Vehicle issue", callback_data: "DELAY:Vehicle issue" }, { text: "Other", callback_data: "DELAY:Other" }],
    ],
  };
}

export async function sendMessage(chatId: number | string, text: string, replyMarkup?: unknown) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

export async function setWebhook(url: string) {
  return tg("setWebhook", {
    url,
    secret_token: deriveTelegramWebhookSecret(),
    allowed_updates: ["message", "edited_message", "callback_query"],
  });
}

export async function getWebhookInfo() {
  return tg("getWebhookInfo", {});
}
