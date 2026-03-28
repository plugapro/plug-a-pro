"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/shared/FormFeedback";

type Role = "customer" | "worker";

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("customer");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "waitlist",
          email,
          name,
          source: "/waitlist",
          message: `Role: ${role}`,
        }),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div>
      {status !== "success" && (
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Role toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setRole("customer")}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                role === "customer"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              I need help
            </button>
            <button
              type="button"
              onClick={() => setRole("worker")}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                role === "worker"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              I want work
            </button>
          </div>

          <Input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={status === "loading"}
          />
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={status === "loading"}
          />
          <Button type="submit" disabled={status === "loading"} className="w-full">
            {status === "loading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Joining…
              </>
            ) : (
              "Join the waitlist"
            )}
          </Button>
        </form>
      )}
      <div className="mt-3">
        <FormFeedback
          status={status}
          successMessage="You're on the list! We'll message you when we launch."
        />
      </div>
    </div>
  );
}
