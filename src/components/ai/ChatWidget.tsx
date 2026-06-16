import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { aiChat, type AiChatPendingAction, type AiChatResult } from "@/lib/ai-agent/chat.functions";
import { confirmAction, type ConfirmActionResult } from "@/lib/ai-agent/confirm.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Sparkles,
  X,
  Send,
  Check,
  AlertCircle,
  User,
  ArrowDown,
  Loader2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// A small palette so users can give the assistant a personal accent. Clicking
// the header icon cycles through these; the choice persists and recolours both
// the header icon and the launcher circle.
const AI_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

const SUGGESTED_PROMPTS = [
  { label: "Run today's plan", prompt: "Run the planning algorithm for today's pending jobs." },
  { label: "Driver workflow help", prompt: "How do I assign a driver to a specific job?" },
  { label: "Import CSV guide", prompt: "Walk me through importing jobs from a CSV file." },
  { label: "Explain dispatch board", prompt: "What do the columns on the dispatch board mean?" },
];

export function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [pendingAction, setPendingAction] = useState<AiChatPendingAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [colorIdx, setColorIdx] = useState(() => {
    if (typeof window === "undefined") return 0;
    const n = Number(localStorage.getItem("ai.accentIdx"));
    return Number.isInteger(n) && n >= 0 && n < AI_COLORS.length ? n : 0;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const accent = AI_COLORS[colorIdx];
  const cycleColor = () =>
    setColorIdx((i) => {
      const next = (i + 1) % AI_COLORS.length;
      try {
        localStorage.setItem("ai.accentIdx", String(next));
      } catch {
        /* noop */
      }
      return next;
    });

  const requestClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 280);
  };

  const send = useServerFn(aiChat);
  const confirm = useServerFn(confirmAction);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = (await send({
        data: { message: trimmed, session_id: sessionId },
      })) as AiChatResult;
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: response.answer },
      ]);
      setPendingAction(response.pendingAction ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The assistant couldn't respond.";
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: `⚠️ ${msg}` },
      ]);
    } finally {
      setIsLoading(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleConfirm = async () => {
    if (!pendingAction || isConfirming) return;
    setIsConfirming(true);
    try {
      const result = (await confirm({
        data: { action_id: pendingAction.id },
      })) as ConfirmActionResult;
      if (result.success) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `✅ Done — **${pendingAction.type.replace(/_/g, " ")}** completed.`,
          },
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

  const resetChat = () => {
    setMessages([]);
    setPendingAction(null);
    setSessionId(crypto.randomUUID());
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pendingAction, isLoading]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollDown(distance > 80);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  return (
    <>
      {/* Launcher — round, icon-only, lives inline (sidebar). The accent colour
          and the flicker stay even when the chat is open. */}
      <button
        type="button"
        onClick={() => (open ? requestClose() : setOpen(true))}
        title="AI Assistant"
        className="relative grid place-items-center size-7 rounded-full text-white shrink-0 transition-transform hover:scale-105 active:scale-95"
        style={{ background: accent }}
      >
        <Sparkles
          className="size-3.5 relative"
          style={{ animation: "ai-door 6s ease-in-out infinite" }}
        />
      </button>

      {open && (
        <div
          className={cn(
            "fixed bottom-5 left-5 z-[2000] flex h-[34rem] w-[22rem] min-h-[20rem] min-w-[18rem] max-h-[calc(100vh-2.5rem)] max-w-[calc(100vw-2.5rem)] resize overflow-hidden",
            "flex-col rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl",
            "shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)]",
            closing ? "ai-sandoff" : "animate-in fade-in slide-in-from-bottom-4 duration-200",
          )}
        >
          {/* Header */}
          <div className="relative flex items-center justify-between border-b border-border/60 bg-gradient-to-br from-primary/10 via-background to-background px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={cycleColor}
                title="Click to change accent colour"
                className="relative flex size-9 items-center justify-center rounded-full text-white shadow-md transition-transform active:scale-90"
                style={{ background: accent }}
              >
                <Sparkles className="size-4" />
                <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
              </button>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-foreground">AI Assistant</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Online · Ready to help
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={resetChat}
                  title="New conversation"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={requestClose}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4 scroll-smooth"
          >
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" />
                  <div
                    className="relative flex size-14 items-center justify-center rounded-2xl text-white shadow-lg"
                    style={{ background: accent }}
                  >
                    <Sparkles className="size-6" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-foreground">How can I help today?</h3>
                  <p className="text-xs text-muted-foreground max-w-[260px]">
                    Ask me about dispatch, planning, drivers, or imports. I can also run actions for
                    you.
                  </p>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 pt-2">
                  {SUGGESTED_PROMPTS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => void submit(s.prompt)}
                      className={cn(
                        "rounded-lg border border-border/60 bg-card/50 px-3 py-2.5 text-left text-xs",
                        "text-foreground/80 hover:text-foreground hover:bg-accent/60 hover:border-border",
                        "transition-all duration-150",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} accent={accent} />
            ))}

            {isLoading && (
              <div className="flex items-center gap-2">
                <div
                  className="flex size-7 items-center justify-center rounded-full text-white"
                  style={{ background: accent }}
                >
                  <Sparkles className="size-3.5" />
                </div>
                <div className="flex gap-1 rounded-2xl rounded-tl-sm bg-muted px-3 py-3">
                  <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
                </div>
              </div>
            )}

            {pendingAction && (
              <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-3.5 shadow-sm">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertCircle className="size-4" />
                  <span className="text-sm font-semibold">Confirm action</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  I'll run{" "}
                  <span className="font-medium text-foreground">
                    {pendingAction.type.replace(/_/g, " ")}
                  </span>{" "}
                  with these parameters:
                </p>
                <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-background/80 border border-border/60 p-2 text-[11px] font-mono text-foreground/80">
                  {JSON.stringify(pendingAction.params, null, 2)}
                </pre>
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={handleConfirm}
                    disabled={isConfirming}
                    size="sm"
                    className="flex-1 gap-1.5"
                  >
                    {isConfirming ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    {isConfirming ? "Running…" : "Confirm & run"}
                  </Button>
                  <Button
                    onClick={() => setPendingAction(null)}
                    size="sm"
                    variant="outline"
                    disabled={isConfirming}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {showScrollDown && (
              <button
                type="button"
                onClick={() =>
                  scrollRef.current?.scrollTo({
                    top: scrollRef.current.scrollHeight,
                    behavior: "smooth",
                  })
                }
                className="sticky bottom-2 ml-auto flex size-8 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-accent"
              >
                <ArrowDown className="size-4" />
              </button>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border/60 bg-background/80 p-3">
            <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card/50 p-1.5 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15 transition-all">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit(input);
                  }
                }}
                className="min-h-[2.25rem] max-h-32 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
                rows={1}
                disabled={isLoading}
                placeholder="Ask anything…"
              />
              <Button
                onClick={() => void submit(input)}
                disabled={isLoading || !input.trim()}
                size="icon"
                className="size-8 shrink-0 rounded-lg"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
              Press{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono">Enter</kbd> to
              send ·{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono">
                Shift+Enter
              </kbd>{" "}
              for newline
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function MessageBubble({ message, accent }: { message: Message; accent: string }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: accent }}
        >
          <Sparkles className="size-3.5" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm bg-muted text-foreground",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div
            className={cn(
              "prose prose-sm max-w-none dark:prose-invert",
              "prose-p:my-1.5 prose-p:leading-relaxed",
              "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5",
              "prose-pre:my-2 prose-pre:bg-background/80 prose-pre:border prose-pre:border-border/60 prose-pre:text-foreground",
              "prose-code:text-foreground prose-code:bg-background/80 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none",
              "prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary",
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <User className="size-3.5" />
        </div>
      )}
    </div>
  );
}
