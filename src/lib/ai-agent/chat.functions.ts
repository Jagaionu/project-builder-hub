import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getUserTenantId } from "@/lib/auth-helpers.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { availableFunctions } from "./action-definitions";
import type { ChatMessage } from "./llm-providers/types";

const chatInputSchema = z.object({
  message: z.string().min(1).max(2000),
  session_id: z.string().uuid().optional(),
});

export type AiChatPendingAction = {
  id: string;
  type: string;
  params: Record<string, any>;
};

export type AiChatResult = {
  answer: string;
  pendingAction: AiChatPendingAction | null;
  guidance: import("./ui-actions").Guidance | null;
  session_id: string;
};

function parseFunctionArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid action parameters from AI");
  }
}

async function getConversationHistory(
  tenantId: string,
  userId: string,
  sessionId?: string,
): Promise<ChatMessage[]> {
  if (!sessionId) return [];
  const { data } = await (supabaseAdmin as any)
    .from("ai_conversations")
    .select("role, content")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(10);
  return ((data ?? []) as Array<{ role: string; content: string }>).map((row) => ({
    role: row.role as ChatMessage["role"],
    content: row.content,
  }));
}

async function saveToConversation(
  tenantId: string,
  userId: string,
  sessionId: string,
  role: string,
  content: string,
) {
  await (supabaseAdmin as any).from("ai_conversations").insert({
    tenant_id: tenantId,
    user_id: userId,
    session_id: sessionId,
    role,
    content,
  });
}

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => chatInputSchema.parse(data))
  .handler(async ({ context, data }): Promise<AiChatResult> => {
    const { userId } = context;
    const tenantId = await getUserTenantId(userId);
    if (!tenantId) throw new Error("Forbidden");

    const sessionId = data.session_id ?? crypto.randomUUID();
    const history = await getConversationHistory(tenantId, userId, sessionId);

    const { answerQuestion } = await import("./rag.server");
    const { answer, functionCall } = await answerQuestion(
      tenantId,
      userId,
      data.message,
      history,
      availableFunctions,
    );

    let responseText = (answer ?? "").trim();
    let pendingAction: { id: string; type: string; params: Record<string, unknown> } | null = null;

    if (functionCall?.name?.startsWith("propose_")) {
      try {
        const actionType = functionCall.name.replace("propose_", "");
        const params = parseFunctionArgs(functionCall.arguments);

        const { data: inserted, error: insertError } = await (supabaseAdmin as any)
          .from("ai_pending_actions")
          .insert({
            tenant_id: tenantId,
            user_id: userId,
            action_type: actionType,
            params,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          console.error("Failed to store pending action", insertError);
          responseText = "Sorry, I couldn't prepare that action. Please try again.";
        } else {
          pendingAction = { id: (inserted as { id: string }).id, type: actionType, params };
          responseText = `I can ${actionType.replace(/_/g, " ")} for you. Please review and confirm below.`;
        }
      } catch (err) {
        // Bad/unparseable args, etc. — degrade gracefully instead of failing the
        // whole turn with "the assistant couldn't respond".
        console.error("Failed to prepare proposed action", err);
        responseText = "Sorry, I couldn't prepare that action. Please try again, or rephrase.";
      }
    }

    // Guarantee a non-empty answer (e.g. when the model returns a tool call with
    // no text, or an empty completion) so the client never sees a blank/error.
    if (!responseText) {
      responseText =
        "Sorry, I couldn't generate a response for that. Please try rephrasing your question.";
    }

    await saveToConversation(tenantId, userId, sessionId, "user", data.message);
    await saveToConversation(tenantId, userId, sessionId, "assistant", responseText);

    const { matchUiAction } = await import("./ui-actions");
    return {
      answer: responseText,
      pendingAction,
      guidance: matchUiAction(data.message),
      session_id: sessionId,
    };
  });
