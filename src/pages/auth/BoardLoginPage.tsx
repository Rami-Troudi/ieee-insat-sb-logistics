import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { AppBrand } from "@/components/shared/AppBrand";
import { ShieldCheck } from "lucide-react";

const schema = z.object({ email: z.string().email("Please enter a valid staff email") });
type FormData = z.infer<typeof schema>;

export const BoardLoginPage: React.FC = () => {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async ({ email }: FormData) => {
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          callbackURL: `${window.location.origin}/board`,
        }),
      });
      if (!response.ok) throw new Error("Unable to send the sign-in link.");
      setMessage("A single-use sign-in link was sent to the staff mailbox.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in right now.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md p-6 rounded-2xl border border-border bg-card shadow-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-block"><AppBrand to="/" /></div>
          <h1 className="text-xl font-bold">Board & Operator Access</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with the staff email. The system will send a single-use link to that mailbox.
          </p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="board-email" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Staff email
            </label>
            <input id="board-email" type="email" autoComplete="email" required {...register("email")}
              placeholder="operator@insat.u-carthage.tn"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]" />
            {errors.email && <span className="text-xs text-destructive">{errors.email.message}</span>}
          </div>
          {message && <p role="status" className="text-sm text-emerald-600">{message}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isSubmitting} className="w-full min-h-[44px] gap-2 font-bold">
            <ShieldCheck className="w-4 h-4" />
            {isSubmitting ? "Sending link…" : "Send Sign-In Link"}
          </Button>
        </form>
        <p className="text-center text-xs">
          <Link to="/auth/login" className="text-primary font-bold hover:underline">← Switch to Borrower access</Link>
        </p>
      </div>
    </div>
  );
};
