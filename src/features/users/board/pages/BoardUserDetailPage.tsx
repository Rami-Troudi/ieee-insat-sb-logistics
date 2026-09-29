import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { PageContainer, PageHeader } from "@/components/shared/PageContainer";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AlertBanner } from "@/components/shared/AlertBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/shared/LoadingState";
import { useSession } from "@/hooks/useSession";
import {
  useBoardUserDetail,
  useProcessUser,
  useUpdateUserClearance,
  useUpdateUserRole,
} from "../hooks/useBoardUsers";
import { useBoardStrikes } from "@/features/discipline/board/hooks/useBoardDiscipline";
import { ArrowLeft, User, Shield, ShieldAlert, ShieldCheck, Lock, Award } from "lucide-react";
import { UserRole, Affiliation } from "@/types/users";

export const BoardUserDetailPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const { currentPersona } = useSession();

  const { data: user, isLoading } = useBoardUserDetail(userId || "");
  const { data: strikes = [] } = useBoardStrikes(userId || "");

  const processUserMutation = useProcessUser();
  const updateClearanceMutation = useUpdateUserClearance();
  const updateRoleMutation = useUpdateUserRole();

  // Registration approval state
  const [approvalAffiliation, setApprovalAffiliation] = useState<Affiliation>("IEEE");
  const [approvalNotes, setApprovalNotes] = useState("");

  // Affiliation update state
  const [newAffiliation, setNewAffiliation] = useState<Affiliation>("IEEE");
  const [affiliationReason, setAffiliationReason] = useState("");

  // Superadmin manual clearance state
  const [manualReason, setManualReason] = useState("");

  // Superadmin privileged role state
  const [targetRole, setTargetRole] = useState<UserRole>("OPERATOR");
  const [roleReason, setRoleReason] = useState("");

  // Staff password reset state

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isSuperadmin = currentPersona.role === "SUPERADMIN";

  if (isLoading || !user) {
    return (
      <PageContainer maxWidth="wide">
        <LoadingState message="Loading user dossier..." />
      </PageContainer>
    );
  }

  const userStatus = user.status || user.accountStatus || "ACTIVE";
  const userClearance = user.clearance || user.clearanceLevel || "I";
  const strikeTotal = user.strikesCount ?? user.strikeCount ?? 0;
  const isPending = userStatus === "PENDING" || !user.isProcessed;
  const displayName = user.name || user.fullName || user.id;

  const handleProcessAccount = async (approved: boolean) => {
    try {
      setErrorMessage(null);
      await processUserMutation.mutateAsync({
        payload: {
          userId: user.id,
          verifiedAffiliation: approved ? approvalAffiliation : "EXTERNAL",
          notes: approvalNotes || (approved ? "Registration approved" : "Registration rejected"),
        },
        actorUserId: currentPersona.id,
        actorRole: currentPersona.role,
      });

      setSuccessMessage(
        approved
          ? `Account approved with affiliation ${approvalAffiliation}.`
          : "Account registration rejected."
      );
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMessage(e.message || "Failed to process account");
    }
  };

  const handleVerifyAffiliation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAffiliation.trim()) return;

    try {
      setErrorMessage(null);
      await processUserMutation.mutateAsync({
        payload: {
          userId: user.id,
          verifiedAffiliation: newAffiliation,
          notes: affiliationReason || "Affiliation verification update",
        },
        actorUserId: currentPersona.id,
        actorRole: currentPersona.role,
      });

      setSuccessMessage("Affiliation successfully updated and clearance recalculated.");
      setAffiliationReason("");
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMessage(e.message || "Failed to verify affiliation");
    }
  };

  const handleToggleManualLevelIV = async (grant: boolean) => {
    try {
      setErrorMessage(null);
      await updateClearanceMutation.mutateAsync({
        payload: {
          userId: user.id,
          newClearance: grant ? "IV" : "I",
          source: grant ? "MANUAL_LEVEL_IV" : "AFFILIATION",
          reason: manualReason || (grant ? "Granted Level IV" : "Revoked Level IV"),
        },
        actorUserId: currentPersona.id,
        actorRole: currentPersona.role,
        actorClearance: currentPersona.clearance,
      });

      setSuccessMessage(
        grant
          ? "Manual Level IV clearance granted successfully."
          : "Manual Level IV clearance revoked."
      );
      setManualReason("");
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMessage(e.message || "Failed to update Level IV clearance");
    }
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setErrorMessage(null);
      await updateRoleMutation.mutateAsync({
        payload: {
          userId: user.id,
          newRole: targetRole,
          reason: roleReason || `Assigned privileged role ${targetRole}`,
        },
        actorUserId: currentPersona.id,
        actorRole: currentPersona.role,
      });

      setSuccessMessage(`User role successfully changed to ${targetRole}.`);
      setRoleReason("");
    } catch (err: unknown) {
      const e = err as Error;
      setErrorMessage(e.message || "Failed to assign role");
    }
  };

  return (
    <PageContainer maxWidth="wide">
      <div className="pb-3">
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
          <Link to="/board/users">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Users Queue</span>
          </Link>
        </Button>
      </div>

      <PageHeader
        title={displayName}
        description={`ID: ${user.id} · ${user.email} · Registered ${new Date(
          user.joinedDate || user.createdAt || Date.now()
        ).toLocaleDateString()}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={userStatus} />
          </div>
        }
      />

      {errorMessage && (
        <div className="mb-4">
          <AlertBanner variant="destructive" title="Action Failed" description={errorMessage} />
        </div>
      )}

      {successMessage && (
        <div className="mb-4">
          <AlertBanner variant="success" title="Success" description={successMessage} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Dossier Card */}
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-border bg-card space-y-3 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 border-b border-border pb-2">
              <User className="w-4 h-4 text-primary" />
              <span>User Profile & Status</span>
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">System Role</span>
                <span className="font-bold text-foreground">{user.role}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Clearance Level</span>
                <span className="font-bold text-primary">Level {userClearance}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Clearance Source</span>
                <span className="font-mono text-muted-foreground">
                  {user.clearanceSource || "AFFILIATION"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Claimed Affiliation</span>
                <span className="text-foreground">
                  {user.claimedAffiliation || user.affiliation || "INSAT Student"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Verified Affiliation</span>
                <span className="font-semibold text-emerald-600">
                  {user.isProcessed ? user.affiliation : "Unverified"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-muted-foreground">Strike Count</span>
                <span
                  className={`font-bold ${
                    strikeTotal > 0 ? "text-destructive" : "text-emerald-600"
                  }`}
                >
                  {strikeTotal} Strike{strikeTotal !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Blacklisted / Banned</span>
                <span
                  className={
                    user.isBanned || userStatus === "BANNED" || userStatus === "BLACKLISTED"
                      ? "text-destructive font-bold"
                      : "text-foreground"
                  }
                >
                  {user.isBanned || userStatus === "BANNED" || userStatus === "BLACKLISTED"
                    ? "Yes (Permanent)"
                    : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Pending Account Registration Box */}
          {isPending && (
            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span>Process Pending Account</span>
              </h3>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-muted-foreground block mb-1">
                    Assign Verified Affiliation:
                  </label>
                  <select
                    value={approvalAffiliation}
                    onChange={(e) => setApprovalAffiliation(e.target.value as Affiliation)}
                    className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                  >
                    <option value="IEEE">IEEE RAS Member (Level III)</option>
                    <option value="AEROBOTIX">Aerobotix Member (Level II)</option>
                    <option value="EXTERNAL">INSAT Student / General (Level I)</option>
                    <option value="EUROBOT">Eurobot Project (Level V)</option>
                  </select>
                </div>

                <div>
                  <label className="text-muted-foreground block mb-1">Approval Notes:</label>
                  <Input
                    placeholder="Membership verified..."
                    value={approvalNotes}
                    onChange={(e) => setApprovalNotes(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleProcessAccount(false)}
                    disabled={processUserMutation.isPending}
                    className="w-1/2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                  >
                    Reject
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleProcessAccount(true)}
                    disabled={processUserMutation.isPending}
                    className="w-1/2 text-xs font-semibold"
                  >
                    Approve & Activate
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Clearances & Superadmin Controls */}
        <div className="lg:col-span-2 space-y-6">
          {/* Affiliation Update Form */}
          <div className="p-5 rounded-xl border border-border bg-card space-y-4 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 border-b border-border pb-2">
              <Shield className="w-4 h-4 text-secondary" />
              <span>Update Verified Affiliation</span>
            </h3>

            <form onSubmit={handleVerifyAffiliation} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-muted-foreground block mb-1">
                    New Verified Affiliation:
                  </label>
                  <select
                    value={newAffiliation}
                    onChange={(e) => setNewAffiliation(e.target.value as Affiliation)}
                    className="w-full h-8 px-2 rounded-md border border-input bg-background text-xs"
                  >
                    <option value="IEEE">IEEE RAS Member (Level III)</option>
                    <option value="AEROBOTIX">Aerobotix Member (Level II)</option>
                    <option value="EXTERNAL">INSAT Student / General (Level I)</option>
                    <option value="EUROBOT">Eurobot Project (Level V)</option>
                  </select>
                </div>
                <div>
                  <label className="text-muted-foreground block mb-1">Verification Reason:</label>
                  <Input
                    placeholder="Verified IEEE ID card 2026..."
                    value={affiliationReason}
                    onChange={(e) => setAffiliationReason(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={processUserMutation.isPending}
                  className="text-xs"
                >
                  Update Affiliation
                </Button>
              </div>
            </form>
          </div>

          {/* Superadmin Privileged Operations Section */}
          <div className="p-5 rounded-xl border border-purple-300 bg-purple-50/20 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-purple-200 pb-2">
              <h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
                <Award className="w-4 h-4 text-purple-700" />
                <span>Superadmin Clearance & Role Elevation (Clearance VI)</span>
              </h3>
              {!isSuperadmin && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>Superadmin Role Required</span>
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Clearance and role changes are recorded by the authorized human operator and kept in the audit trail.</p>

            {/* Manual Level IV Clearance */}
            <div className="p-3 rounded-lg border border-purple-200 bg-card space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  Manual Level IV Clearance (Direct Board & Off-Workflow)
                </span>
                <span className="text-xs text-muted-foreground">
                  Current: Level {userClearance}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <Input
                  disabled={!isSuperadmin}
                  placeholder="Reason for manual Level IV clearance..."
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isSuperadmin || updateClearanceMutation.isPending}
                  onClick={() => handleToggleManualLevelIV(userClearance !== "IV")}
                  className="text-xs shrink-0"
                >
                  {userClearance === "IV" ? "Revoke Level IV" : "Grant Level IV"}
                </Button>
              </div>
            </div>

            {/* Privileged Role Assignment */}
            <form
              onSubmit={handleAssignRole}
              className="p-3 rounded-lg border border-purple-200 bg-card space-y-2 text-xs"
            >
              <div className="font-semibold text-foreground">
                Elevate / Assign Privileged System Role
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  disabled={!isSuperadmin}
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as UserRole)}
                  className="h-8 px-2 rounded-md border border-input bg-background text-xs"
                >
                  <option value="MEMBER">MEMBER (Normal User)</option>
                  <option value="OPERATOR">BOARD (Clearance V)</option>
                  <option value="SUPERADMIN">SUPERADMIN (Clearance VI)</option>
                </select>

                <Input
                  disabled={!isSuperadmin}
                  placeholder="Elevation reason..."
                  value={roleReason}
                  onChange={(e) => setRoleReason(e.target.value)}
                  className="h-8 text-xs sm:col-span-2"
                />
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  disabled={!isSuperadmin || updateRoleMutation.isPending}
                  className="text-xs bg-purple-700 hover:bg-purple-800 text-white font-semibold"
                >
                  Confirm Role Change
                </Button>
              </div>
            </form>
          </div>

          {/* Disciplinary Strikes History */}
          <div className="p-4 rounded-xl border border-border bg-card space-y-3 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 border-b border-border pb-2">
              <ShieldAlert className="w-4 h-4 text-destructive" />
              <span>Strike History ({strikes.length})</span>
            </h3>

            {strikes.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No active or historical disciplinary strikes recorded for this user.
              </p>
            ) : (
              <div className="space-y-2 text-xs">
                {strikes.map((s) => (
                  <div
                    key={s.id}
                    className="p-2.5 rounded-lg border border-destructive/20 bg-destructive/5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-destructive">Strike {s.level}</span>
                      <span className="text-[10px] text-muted-foreground">
                        Issued {new Date(s.issuedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{s.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
