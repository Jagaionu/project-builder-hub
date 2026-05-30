import { openaiProvider } from "./openai";
import type { LLMProvider } from "./types";

export const llmProvider: LLMProvider = openaiProvider;
export const embed = llmProvider.embed.bind(llmProvider);
export const chat = llmProvider.chat.bind(llmProvider);
export const streamChat = llmProvider.streamChat.bind(llmProvider);

export type { ChatMessage, FunctionDefinition, FunctionCall, LLMProvider } from "./types";
