"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useTranslations } from "next-intl";
import { ArrowUp, Loader2, MessageSquare, Square, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/app-shell";
import { useActiveWorkspaceId } from "@/lib/workspace-store";
import { cn } from "@/lib/utils";

export function ChatClient() {
  const t = useTranslations("chat");
  const workspaceId = useActiveWorkspaceId();

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: (): Record<string, string> =>
        workspaceId != null ? { "x-workspace-id": String(workspaceId) } : {},
    }),
  });

  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const isBusy = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || isBusy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        meta={t("meta")}
        actions={
          messages.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMessages([])}
              disabled={isBusy}
            >
              {t("newChat")}
            </Button>
          ) : null
        }
      />

      <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-[calc(100dvh-4rem)]">
        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto px-4 pb-4 pt-6 md:px-6 lg:px-8"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {messages.length === 0 && (
              <EmptyState
                suggestions={[
                  t("suggest1"),
                  t("suggest2"),
                  t("suggest3"),
                  t("suggest4"),
                ]}
                onPick={(s) => {
                  setInput("");
                  sendMessage({ text: s });
                }}
                busy={isBusy}
              />
            )}

            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {status === "submitted" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("thinking")}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                {t("error")}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 bg-background/80 px-4 py-3 backdrop-blur md:px-6 lg:px-8">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="mx-auto flex max-w-3xl items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={t("composerPlaceholder")}
              rows={1}
              className="max-h-48 min-h-[44px] flex-1 resize-none rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm shadow-sm outline-none ring-foreground/10 focus:ring-2"
              disabled={status === "error"}
            />
            {isBusy ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => stop()}
                aria-label={t("stop")}
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim()}
                aria-label={t("send")}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </form>
        </div>
      </div>
    </>
  );
}

interface MessagePart {
  type: string;
  text?: string;
  toolName?: string;
}

interface UIMessageLike {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
}

function MessageBubble({ message }: { message: UIMessageLike }) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card ring-1 ring-foreground/10"
        )}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return <span key={i}>{part.text}</span>;
          }
          if (part.type.startsWith("tool-")) {
            const name = part.type.slice("tool-".length);
            return (
              <span
                key={i}
                className="my-1 inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
              >
                <MessageSquare className="h-3 w-3" />
                {name}
              </span>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function EmptyState({
  suggestions,
  onPick,
  busy,
}: {
  suggestions: string[];
  onPick: (s: string) => void;
  busy: boolean;
}) {
  const t = useTranslations("chat");
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 pt-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h2 className="font-serif text-2xl tracking-tight">
          {t("emptyTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => onPick(s)}
            className="rounded-xl border border-border/60 bg-card px-4 py-3 text-start text-sm leading-snug ring-foreground/10 transition hover:bg-accent disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
