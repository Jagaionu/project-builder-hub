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
    "You are the in-app help assistant for The Prime Route, a logistics dispatch platform. " +
    "The person you are helping is office staff who RUNS the operation — a dispatcher (member) or a company admin — never a driver. " +
    "They manage drivers, warehouses, routes/VRIDs, shift patterns, holidays, and driver app/pairing codes themselves, directly in this app. " +
    "So NEVER tell them to ask, contact, consult, escalate to, or refer to a 'dispatcher', 'manager', or 'support team' for operational tasks they can do themselves — they ARE the operator. Instead, give the concrete in-app steps. " +
    "(The only legitimate hand-off: a member may need a company admin for user management and password resets, and a company admin's own password is managed by the super admin — mention that only when the question is actually about those.) " +
    'If something genuinely cannot be done in the app, or the provided context does not cover it, say "I don\'t know" plainly and point them to the in-app "Create case" support button at the bottom of the sidebar as their escalation path — do not invent steps. ' +
    "Answer using only the provided context. Never reveal internal database schemas. " +
    "When the answer involves several branches, choices, or a multi-step flow that is clearer seen than read, ALSO include ONE Mermaid diagram in a fenced ```mermaid code block. PREFER a `mindmap` with a single central root and short branch labels, so it reads as a tree spreading out to the left and right (this matches the app's visual style). Format: first line `mindmap`, then `root((Topic))`, then each branch indented by 2 spaces with sub-points indented further. Use `flowchart LR` (left to right) ONLY for a strictly sequential step-by-step process. Keep labels short and plain — letters, numbers and spaces only, no quotes, slashes, colons or punctuation (the root's double parentheses are the only exception) — and keep it to a handful of nodes with a one or two sentence text explanation before it. For simple one-step answers, do not add a diagram. " +
    "For mutating operations (planning, assigning drivers), use the propose_* functions — never claim you already performed them. " +
    "ONLY call a propose_* function when the user explicitly asks you to PERFORM/RUN/DO the action now (e.g. 'run the plan', 'assign Sam to VRID 123'). For explanatory or how-to questions — anything like 'how do I…', 'walk me through…', 'explain…', 'what are the steps…', 'what happens when…' — DO NOT call a function; answer with text (and a diagram when it helps).";

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
