import OpenAI from "openai";
import type { ChatMessage, FunctionDefinition, LLMProvider } from "./types";

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("your-openai") || apiKey === "sk-your-openai-key") {
    throw new Error(
      "OPENAI_API_KEY is not configured. Add it to .env locally or Vercel Environment Variables (server-only, no VITE_ prefix).",
    );
  }
  return new OpenAI({ apiKey });
}

export const openaiProvider: LLMProvider = {
  async embed(text: string): Promise<number[]> {
    const resp = await getOpenAI().embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return resp.data[0].embedding;
  },

  async chat(messages: ChatMessage[], functions?: FunctionDefinition[]) {
    const resp = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      tools: functions?.length
        ? (functions.map((fn) => ({
            type: "function" as const,
            function: fn,
          })) as any)
        : undefined,
      tool_choice: functions?.length ? "auto" : undefined,
    });
    const choice = resp.choices[0];
    const toolCall = choice.message.tool_calls?.[0];
    return {
      content: choice.message.content || "",
      functionCall: toolCall?.type === "function"
        ? { name: toolCall.function.name, arguments: toolCall.function.arguments }
        : undefined,
    };
  },

  async streamChat(messages: ChatMessage[], onToken: (token: string) => void, functions?: FunctionDefinition[]) {
    const stream = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      tools: functions?.length
        ? (functions.map((fn) => ({
            type: "function" as const,
            function: fn,
          })) as any)
        : undefined,
      tool_choice: functions?.length ? "auto" : undefined,
      stream: true,
    });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) onToken(token);
    }
  },
};
