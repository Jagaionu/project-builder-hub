import { llmProvider, embed } from "./llm-providers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encodingForModel } from "js-tiktoken";
import type { ChatMessage, FunctionDefinition } from "./llm-providers/types";

const enc = encodingForModel("gpt-4o");
const MAX_TOKENS = 8000;
const TOKEN_BUFFER = 1000;

type RetrievedChunk = { id: string; chunk_text: string; score: number };

export async function answerQuestion(
  tenantId: string,
  userId: string,
  question: string,
  conversationHistory: ChatMessage[],
  functions?: FunctionDefinition[],
) {
  const qEmbedding = await embed(question);

  const { data: chunks, error: rpcError } = await (supabaseAdmin as any).rpc(
    "match_ai_knowledge_rrf",
    {
      query_text: question,
      query_embedding: qEmbedding,
      match_count: 6,
      p_tenant_id: tenantId,
    },
  );

  if (rpcError) {
    console.error("match_ai_knowledge_rrf failed", rpcError);
  }

  const retrieved = (chunks ?? []) as RetrievedChunk[];
  const context = retrieved.map((c) => c.chunk_text).join("\n\n");

  const systemPrompt =
    "You are an AI assistant for a logistics dispatch platform. Answer using only the provided context. " +
    'If unsure, say "I don\'t know" and suggest escalating to a dispatcher. Never reveal internal database schemas. ' +
    "For mutating operations (planning, assigning drivers), use the propose_* functions — never claim you already performed them.";

  let messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: `Relevant documentation:\n${context || "(no matching docs)"}` },
    ...conversationHistory,
    { role: "user", content: question },
  ];

  let totalTokens = messages.reduce((sum, m) => sum + enc.encode(m.content).length, 0);
  while (totalTokens > MAX_TOKENS - TOKEN_BUFFER && messages.length > 2) {
    const removeIdx = messages.findIndex((m) => m.role !== "system");
    if (removeIdx === -1) break;
    messages.splice(removeIdx, 1);
    totalTokens = messages.reduce((sum, m) => sum + enc.encode(m.content).length, 0);
  }

  const { data: log, error: logError } = await (supabaseAdmin as any)
    .from("ai_query_logs")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      question,
      retrieved_chunk_ids: retrieved.map((c) => c.id),
    })
    .select("id")
    .single();

  if (logError) console.error("Failed to insert query log", logError);
  const logId = (log as { id: string } | null)?.id;
  const startTime = Date.now();

  const response = await llmProvider.chat(messages, functions);
  const endTime = Date.now();

  if (logId) {
    const responseTokens = response.content ? enc.encode(response.content).length : 0;
    // Flag content gaps: no docs retrieved, or the model said it doesn't know.
    const answered =
      retrieved.length > 0 &&
      !/\bi (?:don'?t|do not) (?:know|have)\b/i.test(response.content ?? "");
    await (supabaseAdmin as any)
      .from("ai_query_logs")
      .update({
        latency_ms: endTime - startTime,
        token_usage: totalTokens + responseTokens,
        answer: response.content ?? "",
        answered,
      })
      .eq("id", logId);
  }

  return {
    answer: response.content,
    functionCall: response.functionCall,
    retrievedChunks: retrieved,
  };
}
