import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useBoardUsers, useCreateUser, useRemoveUser } from "../hooks/useBoardUsers";
import { useBoardLoans } from "@/features/loans/board/hooks/useBoardLoans";
import { useSession } from "@/hooks/useSession";
import { LoadingState } from "@/components/shared/LoadingState";
import { SearchInput } from "@/components/shared/SearchInput";
import { AlertBanner } from "@/components/shared/AlertBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Role, ClearanceLevel, Affiliation, UserProfile } from "@/types";
import {
  UserPlus,
  Trash2,
  Shield,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";

export const BoardPeoplePage: React.FC = () => {
  const { currentPersona } = useSession();
  const { data: users = [], isLoading, error: queryError } = useBoardUsers();
  const { data: loans = [] } = useBoardLoans();

  const createUserMutation = useCreateUser();
  const removeUserMutation = useRemoveUser();

  const [search, setSearch] = useState("");
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Add person dialog state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "MEMBER" as Role,
    affiliation: "IEEE" as Affiliation,
    clearance: "III" as ClearanceLevel,
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Remove person dialog state
  const [userToRemove, setUserToRemove] = useState<UserProfile | null>(null);

  const isSuperadmin = currentPersona.role === "SUPERADMIN";

  const activeLoansByUser = useMemo(() => {
    const map: Record<string, number> = {};
    loans.forEach((loan) => {
      if (loan.lifecycleStatus === "ACTIVE") {
        const count = loan.items.reduce((s, i) => s + i.borrowedQuantity, 0);
        map[loan.userId] = (map[loan.userId] || 0) + count;
      }
    });
    return map;
  }, [loans]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone && u.phone.toLowerCase().includes(q)) ||
        (u.affiliation && u.affiliation.toLowerCase().includes(q)) ||
        (u.role && u.role.toLowerCase().includes(q))
      );
    });
  }, [users, search]);

  const handleRoleChange = (role: Role) => {
    let defaultAffiliation: Affiliation = addForm.affiliation;
    let defaultClearance: ClearanceLevel = addForm.clearance;

    if (role === "SUPERADMIN") {
      defaultAffiliation = "RAS_BOARD";
      defaultClearance = "VI";
    } else if (role === "OPERATOR") {
      defaultAffiliation = "RAS_BOARD";
      defaultClearance = "V";
    } else {
      // Member
      defaultAffiliation = addForm.affiliation === "RAS_BOARD" ? "IEEE" : addForm.affiliation;
      defaultClearance =
        defaultAffiliation === "IEEE"
          ? "III"
          : defaultAffiliation === "AEROBOTIX"
            ? "II"
            : defaultAffiliation === "EUROBOT"
              ? "V"
              : "I";
    }

    setAddForm((prev) => ({
      ...prev,
      role,
      affiliation: defaultAffiliation,
      clearance: defaultClearance,
    }));
    setFormError(null);
  };

  const handleAffiliationChange = (affiliation: Affiliation) => {
    let clearance = addForm.clearance;
    if (addForm.role === "MEMBER") {
      clearance =
        affiliation === "IEEE"
          ? "III"
          : affiliation === "AEROBOTIX"
            ? "II"
            : affiliation === "EUROBOT"
              ? "V"
              : "I";
    }
    setAddForm((prev) => ({ ...prev, affiliation, clearance }));
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!addForm.name.trim() || addForm.name.trim().length < 2) {
      setFormError("Please enter a valid full name (at least 2 characters).");
      return;
    }
    if (!addForm.email.trim() || !addForm.email.includes("@")) {
      setFormError("Please enter a valid email address.");
      return;
    }

    try {
      await createUserMutation.mutateAsync({
        payload: {
          name: addForm.name.trim(),
          email: addForm.email.trim(),
          phone: addForm.phone.trim() || undefined,
          role: addForm.role,
          affiliation: addForm.affiliation,
          clearance: addForm.clearance,
        },
        actorUserId: currentPersona.id,
        actorRole: currentPersona.role,
      });

      if (true) {
        setIsAddModalOpen(false);
        setSuccessBanner(`User "${addForm.name}" created successfully.`);
        resetAddForm();
      }
    } catch (err: any) {
      setFormError(err.message || "Failed to create user. Please try again.");
    }
  };

  const resetAddForm = () => {
    setAddForm({
      name: "",
      email: "",
      phone: "",
      role: "MEMBER",
      affiliation: "IEEE",
      clearance: "III",
    });
    setFormError(null);
  };

  const handleConfirmRemove = async () => {
    if (!userToRemove) return;
    setErrorMessage(null);
    try {
      await removeUserMutation.mutateAsync({
        userId: userToRemove.id,
        actorUserId: currentPersona.id,
        actorRole: currentPersona.role,
      });
      setSuccessBanner(`User "${userToRemove.name}" was successfully removed.`);
      setUserToRemove(null);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to remove user.");
      setUserToRemove(null);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <LoadingState message="Loading borrower directory..." />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {successBanner && (
        <AlertBanner
          variant="success"
          title="Success"
          description={successBanner}
          onDismiss={() => setSuccessBanner(null)}
        />
      )}

      {(errorMessage || queryError) && (
        <AlertBanner
          variant="warning"
          title="Notice"
          description={
            errorMessage ||
            (queryError instanceof Error ? queryError.message : "Error loading people roster")
          }
          onDismiss={() => setErrorMessage(null)}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">People & Staff</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Member roster, staff provisionings, active borrowing status, and clearances.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-full sm:w-60">
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              placeholder="Search people..."
            />
          </div>
          <Button
            onClick={() => {
              resetAddForm();
              setIsAddModalOpen(true);
            }}
            className="shrink-0 gap-1.5 h-9"
          >
            <UserPlus className="h-4 w-4" />
            <span>Add Person</span>
          </Button>
        </div>
      </div>

      <div className="space-y-2.5">
        {filteredUsers.length === 0 ? (
          <div className="p-8 text-center border border-dashed rounded-xl text-muted-foreground text-sm">
            No people found matching "{search}".
          </div>
        ) : (
          filteredUsers.map((u) => {
            const itemsOut = activeLoansByUser[u.id] || 0;
            const isRestricted = (u.strikesCount || 0) >= 4 || u.status === "BANNED";
            const isSelf = u.id === currentPersona.id;
            const isSuper = u.role === "SUPERADMIN";
            const isStaff = u.role === "OPERATOR";

            return (
              <div
                key={u.id}
                className="p-3.5 rounded-xl border border-border bg-card shadow-xs flex items-center justify-between gap-3 text-xs hover:border-border/80 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-full font-bold flex items-center justify-center shrink-0 ${
                      isSuper
                        ? "bg-purple-500/15 text-purple-600 border border-purple-500/30"
                        : isStaff
                          ? "bg-primary/15 text-primary border border-primary/30"
                          : "bg-muted text-foreground"
                    }`}
                  >
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground truncate">{u.name}</span>
                      {isSuper && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                          <ShieldAlert className="h-3 w-3" />
                          SUPERADMIN
                        </span>
                      )}
                      {isStaff && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <Shield className="h-3 w-3" />
                          STAFF
                        </span>
                      )}
                      <span className="text-[11px] font-medium text-muted-foreground px-2 py-0.5 rounded bg-muted">
                        {u.affiliation || "IEEE"}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60">
                        Lvl {u.clearance || "I"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground mt-0.5 truncate">
                      <span className="truncate">{u.email}</span>
                      {u.phone && <span className="hidden sm:inline shrink-0">· {u.phone}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right hidden sm:block">
                    <span
                      className={`font-bold block ${
                        itemsOut > 0 ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {itemsOut} {itemsOut === 1 ? "item" : "items"} out
                    </span>
                    {isRestricted ? (
                      <span className="text-[10px] font-semibold text-destructive">Restricted</span>
                    ) : (
                      <span className="text-[10px] text-emerald-600 font-medium">Active</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                      <Link to={`/board/users/${u.id}`}>Details</Link>
                    </Button>

                    {!isSelf && (isSuperadmin || u.role !== "SUPERADMIN") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setUserToRemove(u)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title={`Remove ${u.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Person / Staff Modal */}
      <Dialog
        open={isAddModalOpen}
        onOpenChange={(open) => {
          if (!open) resetAddForm();
          setIsAddModalOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="text-lg">Add Person / Staff</DialogTitle>
              <DialogDescription>
                Provision a borrower member or board staff account. Staff sign in by email link.
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-medium text-foreground block mb-1">Full Name *</label>
                <Input required value={addForm.name} onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))} className="h-9" />
              </div>
              <div>
                <label className="font-medium text-foreground block mb-1">Email Address *</label>
                <Input type="email" required value={addForm.email} onChange={(e) => setAddForm((p) => ({ ...p, email: e.target.value }))} className="h-9" />
              </div>
              <div>
                <label className="font-medium text-foreground block mb-1">Phone Number (Optional)</label>
                <Input type="tel" value={addForm.phone} onChange={(e) => setAddForm((p) => ({ ...p, phone: e.target.value }))} className="h-9" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-foreground block mb-1">Role</label>
                  <select value={addForm.role} onChange={(e) => handleRoleChange(e.target.value as Role)} className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-foreground text-xs">
                    <option value="MEMBER">Borrower Member</option>
                    <option value="OPERATOR">Board Staff / Operator</option>
                    {isSuperadmin && <option value="SUPERADMIN">Superadmin</option>}
                  </select>
                </div>
                <div>
                  <label className="font-medium text-foreground block mb-1">Affiliation</label>
                  <select value={addForm.affiliation} onChange={(e) => handleAffiliationChange(e.target.value as Affiliation)} className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-foreground text-xs">
                    <option value="IEEE">IEEE RAS Member</option>
                    <option value="AEROBOTIX">Aerobotix Member</option>
                    <option value="EXTERNAL">External / INSAT Student</option>
                    <option value="RAS_BOARD">RAS Board Member</option>
                    <option value="EUROBOT">Eurobot Team</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-medium text-foreground block mb-1">Clearance Level</label>
                <select value={addForm.clearance} onChange={(e) => setAddForm((p) => ({ ...p, clearance: e.target.value as ClearanceLevel }))} className="w-full h-9 px-2.5 rounded-md border border-input bg-background text-foreground text-xs">
                  <option value="I">Level I</option>
                  <option value="II">Level II</option>
                  <option value="III">Level III</option>
                  <option value="IV">Level IV</option>
                  <option value="V">Level V</option>
                  <option value="VI">Level VI</option>
                </select>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)} disabled={createUserMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={createUserMutation.isPending} className="gap-1.5">
                {createUserMutation.isPending ? "Creating..." : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation Dialog */}
      <Dialog
        open={Boolean(userToRemove)}
        onOpenChange={(open) => {
          if (!open) setUserToRemove(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mx-auto w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-1">
              <Trash2 className="h-5 w-5" />
            </div>
            <DialogTitle className="text-center">Remove User Account</DialogTitle>
            <DialogDescription className="text-center">
              Are you sure you want to permanently remove this user?
            </DialogDescription>
          </DialogHeader>

          {userToRemove && (
            <div className="p-3.5 rounded-lg border border-border bg-muted/40 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name:</span>
                <span className="font-semibold text-foreground">{userToRemove.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email:</span>
                <span className="font-mono text-foreground">{userToRemove.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Role / Level:</span>
                <span className="font-medium text-foreground">
                  {userToRemove.role} (Clearance {userToRemove.clearance})
                </span>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            This action will permanently delete their account profile, session tokens, and revoke
            all access. This action cannot be undone.
          </p>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setUserToRemove(null)}
              disabled={removeUserMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmRemove}
              disabled={removeUserMutation.isPending}
            >
              {removeUserMutation.isPending ? "Removing..." : "Confirm Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
