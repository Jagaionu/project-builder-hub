import { createServerFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";
import { setWebhook, getWebhookInfo } from "./telegram.server";

function stableWebhookUrl(): string {
  const host = getRequestHost();
  // id-preview--<id>.<host>  ->  project--<id>-dev.<host>  (stable, no auth bridge)
  const dev = host.replace(/^id-preview--([^.]+)\./, "project--$1-dev.");
  return `https://${dev}/api/public/telegram/webhook`;
}

export const registerTelegramWebhook = createServerFn({ method: "POST" }).handler(async () => {
  const url = stableWebhookUrl();
  const result = await setWebhook(url);
  return { url, result };
});

export const telegramWebhookInfo = createServerFn({ method: "GET" }).handler(async () => {
  return await getWebhookInfo();
});
