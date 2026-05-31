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
  const { data } = await supabaseAdmin
    .from("ai_conversations")
    .select("role, content")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(10);
  return (data ?? []).map((row) => ({
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
  await supabaseAdmin.from("ai_conversations").insert({
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

    let responseText = answer;
    let pendingAction: { id: string; type: string; params: Record<string, unknown> } | null = null;

    if (functionCall?.name?.startsWith("propose_")) {
      const actionType = functionCall.name.replace("propose_", "");
      const params = parseFunctionArgs(functionCall.arguments);

      const { data: inserted, error: insertError } = await supabaseAdmin
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
        pendingAction = { id: inserted.id, type: actionType, params };
        responseText = `I can ${actionType.replace(/_/g, " ")} for you. Please review and confirm below.`;
      }
    }

    await saveToConversation(tenantId, userId, sessionId, "user", data.message);
    await saveToConversation(tenantId, userId, sessionId, "assistant", responseText);

    return {
      answer: responseText,
      pendingAction,
      session_id: sessionId,
    };
  });
