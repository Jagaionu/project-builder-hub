import { createServerFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";
import { setWebhook, getWebhookInfo } from "./telegram.server";

export const registerTelegramWebhook = createServerFn({ method: "POST" }).handler(async () => {
  const host = getRequestHost();
  // Use the stable public dev host for non-published projects.
  const url = `https://${host}/api/public/telegram/webhook`;
  const result = await setWebhook(url);
  return { url, result };
});

export const telegramWebhookInfo = createServerFn({ method: "GET" }).handler(async () => {
  return await getWebhookInfo();
});
