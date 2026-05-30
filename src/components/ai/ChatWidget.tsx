import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { aiChat, type AiChatPendingAction, type AiChatResult } from "@/lib/ai-agent/chat.functions";
import { confirmAction, type ConfirmActionResult } from "@/lib/ai-agent/confirm.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [pendingAction, setPendingAction] = useState<AiChatPendingAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const send = useServerFn(aiChat);
  const confirm = useServerFn(confirmAction);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsLoading(true);

    try {
      const response = (await send({
        data: { message: text, session_id: sessionId },
      })) as AiChatResult;
      setMessages((prev) => [...prev, { role: "assistant", content: response.answer }]);
      setPendingAction(response.pendingAction ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI failed to respond";
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingAction || isConfirming) return;
    setIsConfirming(true);
    try {
      const result = (await confirm({ data: { action_id: pendingAction.id } })) as ConfirmActionResult;
      if (result.success) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Action completed: ${pendingAction.type.replace(/_/g, " ")}.` },
        ]);
        setPendingAction(null);
        toast.success("Action completed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Confirmation failed";
      toast.error(msg);
    } finally {
      setIsConfirming(false);
    }
  };

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, pendingAction, isLoading]);

  if (!open) {
    return (
      <Button
        type="button"
        size="icon"
        className="fixed bottom-4 right-4 z-50 size-12 rounded-full shadow-lg"
        onClick={() => setOpen(true)}
        title="AI Assistant"
      >
        <MessageCircle className="size-5" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-[32rem] w-96 flex-col rounded-lg border border-border bg-background shadow-xl">
      <div className="flex items-center justify-between rounded-t-lg bg-primary px-3 py-2 text-primary-foreground">
        <span className="font-semibold">AI Assistant</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-primary-foreground hover:bg-primary-foreground/10"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div ref={containerRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask about CSV imports, planning, or dispatch workflows.
          </p>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              "rounded-lg p-2 text-sm",
              msg.role === "user" ? "ml-8 bg-muted text-right" : "mr-8 bg-accent/50",
            )}
          >
            {msg.content}
          </div>
        ))}
        {isLoading && <p className="text-sm italic text-muted-foreground">Thinking…</p>}
        {pendingAction && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-semibold">Confirm action</p>
            <p className="text-muted-foreground">Type: {pendingAction.type.replace(/_/g, " ")}</p>
            <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(pendingAction.params, null, 2)}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button onClick={handleConfirm} disabled={isConfirming} size="sm">
                {isConfirming ? "Confirming…" : "Confirm"}
              </Button>
              <Button onClick={() => setPendingAction(null)} size="sm" variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border p-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          className="min-h-[3rem] flex-1 resize-none"
          rows={2}
          disabled={isLoading}
          placeholder="Ask me anything…"
        />
        <Button onClick={() => void handleSend()} disabled={isLoading || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
