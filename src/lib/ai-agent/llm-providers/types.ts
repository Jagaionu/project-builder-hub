export interface ChatMessage {
  role: "system" | "user" | "assistant" | "function";
  content: string;
  name?: string;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: object;
}

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface LLMProvider {
  embed(text: string): Promise<number[]>;
  chat(
    messages: ChatMessage[],
    functions?: FunctionDefinition[],
  ): Promise<{ content: string; functionCall?: FunctionCall }>;
  streamChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    functions?: FunctionDefinition[],
  ): Promise<void>;
}
