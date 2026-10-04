import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, ShieldCheck, AlertCircle, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BorrowerAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialMode?: "BORROWER" | "STAFF";
  title?: string;
}

export const BorrowerAuthModal: React.FC<BorrowerAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = "BORROWER",
  title,
}) => {
  const [authMode, setAuthMode] = useState<"BORROWER" | "STAFF">(initialMode);

  // Borrower state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [membership, setMembership] = useState<"IEEE" | "EXTERNAL">("IEEE");
  const [phone, setPhone] = useState("");
  const [borrowerError, setBorrowerError] = useState("");
  const [borrowerSubmitting, setBorrowerSubmitting] = useState(false);

  // Staff state
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffError, setStaffError] = useState("");
  const [staffSubmitting, setStaffSubmitting] = useState(false);

  // Load saved profile if available
  useEffect(() => {
    if (isOpen) {
      try {
        const raw =
          localStorage.getItem("sb_borrower_profile") ||
          localStorage.getItem("ras_borrower_profile");
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.firstName) setFirstName(saved.firstName);
          if (saved.lastName) setLastName(saved.lastName);
          if (saved.email) setEmail(saved.email);
          if (saved.membership) setMembership(saved.membership);
          if (saved.phone) setPhone(saved.phone);
        }
      } catch {
        // Ignore JSON error
      }
    }
  }, [isOpen]);

  // Sync mode if initialMode changes
  useEffect(() => {
    if (isOpen) {
      setAuthMode(initialMode);
    }
  }, [isOpen, initialMode]);

  const onSubmitBorrower = async (e: React.FormEvent) => {
    e.preventDefault();
    setBorrowerError("");
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setBorrowerError("Please fill in all required fields.");
      return;
    }
    setBorrowerSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/borrower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          name: fullName,
          email: email.trim().toLowerCase(),
          membership,
          phone: phone.trim(),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(data.error?.message ?? "Could not complete sign up. Please try again.");
      }
      localStorage.setItem("sb_onboarding_completed", "true");
      localStorage.setItem("sb_borrower_email", email.trim().toLowerCase());
      localStorage.setItem(
        "sb_borrower_profile",
        JSON.stringify({
          name: fullName,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          membership,
          phone: phone.trim(),
        })
      );
      onClose();
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setBorrowerError(
        err instanceof Error ? err.message : "Could not complete sign up. Please try again."
      );
    } finally {
      setBorrowerSubmitting(false);
    }
  };

  const onSubmitStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError("");
    setStaffSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/board-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: staffEmail.trim().toLowerCase(),
          password: staffPassword,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(data.error?.message ?? "Unable to sign in right now.");
      }
      onClose();
      if (onSuccess) {
        onSuccess();
      }
    } catch (cause) {
      setStaffError(cause instanceof Error ? cause.message : "Unable to sign in right now.");
    } finally {
      setStaffSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md p-6 rounded-2xl border-border bg-card shadow-2xl">
        {/* Toggle Mode Tabs */}
        <div className="grid grid-cols-2 p-1 rounded-xl bg-surface-subtle text-xs font-semibold mb-2 border border-border">
          <button
            type="button"
            onClick={() => setAuthMode("BORROWER")}
            className={cn(
              "py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all min-h-[36px]",
              authMode === "BORROWER"
                ? "bg-card text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Borrower Sign In</span>
          </button>
          <button
            type="button"
            onClick={() => setAuthMode("STAFF")}
            className={cn(
              "py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all min-h-[36px]",
              authMode === "STAFF"
                ? "bg-card text-foreground shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Board Staff Sign In</span>
          </button>
        </div>

        {authMode === "BORROWER" ? (
          <div>
            <DialogHeader className="text-center sm:text-center space-y-1.5">
              <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-1">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <DialogTitle className="text-xl font-bold text-foreground">
                {title || "Welcome to IEEE INSAT Logistics!"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Please enter your student details to link your borrow requests and get notified when
                equipment is ready for pickup.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmitBorrower} className="space-y-3 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label
                    htmlFor="borrower-first-name"
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                  >
                    Name *
                  </label>
                  <Input
                    id="borrower-first-name"
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. Ahmed"
                    className="min-h-[38px] text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="borrower-last-name"
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                  >
                    Surname *
                  </label>
                  <Input
                    id="borrower-last-name"
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="e.g. Ben Mansour"
                    className="min-h-[38px] text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="borrower-email"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                >
                  Institutional Email / Email address *
                </label>
                <Input
                  id="borrower-email"
                  aria-label="Email address"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. ahmed.bm@insat.u-carthage.tn"
                  className="min-h-[38px] text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Affiliation *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: "IEEE", label: "IEEE Member" },
                      { id: "EXTERNAL", label: "External / Guest" },
                    ] as const
                  ).map((m) => {
                    const isSelected = membership === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMembership(m.id)}
                        className={cn(
                          "h-9 rounded-xl text-xs font-semibold border transition-all flex items-center justify-center",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-xs font-bold"
                            : "bg-background border-input text-foreground hover:bg-surface-subtle"
                        )}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="borrower-phone"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                >
                  Phone Number *
                </label>
                <Input
                  id="borrower-phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+216 98 765 432"
                  className="min-h-[38px] text-xs"
                />
              </div>

              {borrowerError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{borrowerError}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={borrowerSubmitting}
                className="w-full h-10 text-xs font-bold gap-2 rounded-xl mt-3 shadow-xs"
              >
                <Sparkles className="w-4 h-4" />
                <span>{borrowerSubmitting ? "Signing in..." : "Continue to Reservations"}</span>
              </Button>

              <div className="flex flex-col items-center gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => setAuthMode("STAFF")}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Board staff access</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <DialogHeader className="text-center sm:text-center space-y-1.5">
              <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-1">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Board Staff Sign In
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Sign in with your staff email and the password assigned to you.
              </DialogDescription>
            </DialogHeader>

            {staffError && (
              <div
                role="alert"
                className="mt-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{staffError}</span>
              </div>
            )}

            <form onSubmit={onSubmitStaff} className="space-y-3 pt-3">
              <div className="space-y-1">
                <label
                  htmlFor="staff-email"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                >
                  Staff Email *
                </label>
                <Input
                  id="staff-email"
                  type="email"
                  required
                  placeholder="e.g. staff@insat.u-carthage.tn"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="staff-password"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
                >
                  Assigned Password *
                </label>
                <Input
                  id="staff-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <Button
                type="submit"
                disabled={staffSubmitting}
                className="w-full h-10 text-xs font-bold gap-2 rounded-xl mt-3 shadow-xs"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{staffSubmitting ? "Signing in..." : "Sign In"}</span>
              </Button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setAuthMode("BORROWER")}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Borrower sign up</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
