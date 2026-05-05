"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { analytics } from "@/lib/analytics";
import { ChatMessages } from "./ChatMessages";
import { WhatsAppButton } from "./WhatsAppButton";

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isDisabled = status === "streaming" || status === "submitted";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isDisabled) return;
    setInput("");
    analytics.chatMessageSent();
    void sendMessage({ text });
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-80 h-[480px] rounded-xl border border-border bg-background shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <span className="font-semibold text-sm">Chat with us</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ChatMessages messages={messages} />
          <form onSubmit={handleSubmit} className="p-3 border-t border-border/40 flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isDisabled}
              placeholder="Ask a question..."
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={isDisabled}>
              Send
            </Button>
          </form>
          {/* WhatsApp escalation — wired in Task 14 */}
          <div className="px-4 py-2 border-t border-border/40 text-xs text-muted-foreground">
            Prefer a human? <WhatsAppButton compact source="chat_widget" />
          </div>
        </div>
      )}
      <Button
        size="icon"
        className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) analytics.chatOpen();
        }}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </Button>
    </>
  );
}
