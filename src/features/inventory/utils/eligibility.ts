import { EquipmentClass, ClearanceLevel, UserStatus } from "@/types";

export interface EligibilityResult {
  canBorrowOnline: boolean;
  canRequest: boolean;
  reason?: string;
  badgeType: "SUCCESS" | "WARNING" | "RESTRICTED" | "INFO";
  noticeTitle?: string;
  noticeMessage?: string;
  statusLabel?: string;
}

export function clearanceToNumber(c: ClearanceLevel): number {
  switch (c) {
    case "I":
      return 1;
    case "II":
      return 2;
    case "III":
      return 3;
    case "IV":
      return 4;
    case "V":
      return 5;
    case "VI":
      return 6;
    default:
      return 1;
  }
}

/**
 * Authoritative Eligibility Preview
 *
 * Clearance Levels:
 * - Level I: External Individuals -> Allowed A, B
 * - Level II: Aerobotix -> Allowed A, B, C
 * - Level III: IEEE -> Allowed A-E; F only under Level V+ supervision
 * - Level IV: Trusted Individuals -> Special Level VI granted access; All classes according to that authorization
 * - Level V: RAS Board + Eurobot -> Operational logistics authority; Can supervise F
 * - Level VI: RAS Chairman + Logistics Manager -> Final authority; Only level granting G
 *
 * Workflow Rules:
 * - Full platform workflow: A, C, E, F, G
 * - Classes B and D: Off-full-workflow / Direct Board interactions. Never added to online cart.
 *
 * Strikes Rules:
 * - Strike 1: Warning
 * - Strike 2: Second warning; Every request requires explicit Board approval; Classes F/G unavailable
 * - Strike 3: Class E cannot be used unsupervised
 * - Strike 4: Cannot borrow any RAS item until semester end
 * - Strike 5: Permanent blacklist
 *
 * Registration:
 * - Provisional / unverified (isProcessed=false) CAN still submit requests. Affiliation verified by Board during processing.
 */
export function evaluateItemEligibility(
  equipmentClass: EquipmentClass,
  userClearance: ClearanceLevel,
  userStatus: UserStatus,
  isProcessed: boolean,
  availableQuantity: number,
  strikesCount: number = 0
): EligibilityResult {
  // Disciplinary Blacklist
  if (userStatus === "BANNED" || userStatus === "BLACKLISTED" || strikesCount >= 5) {
    return {
      canBorrowOnline: false,
      canRequest: false,
      badgeType: "RESTRICTED",
      statusLabel: "Restricted",
      reason: "Account blacklisted. Borrowing is permanently suspended.",
      noticeTitle: "Account Blacklisted",
      noticeMessage:
        "You are prohibited from borrowing equipment due to disciplinary blacklisting.",
    };
  }

  // Strike 4: Complete semester suspension
  if (strikesCount >= 4) {
    return {
      canBorrowOnline: false,
      canRequest: false,
      badgeType: "RESTRICTED",
      statusLabel: "Restricted",
      reason: "Account suspended until semester end (Strike 4).",
      noticeTitle: "Borrowing Suspended",
      noticeMessage:
        "Your borrowing privileges are suspended for the remainder of the semester following disciplinary review.",
    };
  }

  // Strike 2 & 3: Classes F and G are strictly unavailable
  if (strikesCount >= 2 && (equipmentClass === "F" || equipmentClass === "G")) {
    return {
      canBorrowOnline: false,
      canRequest: false,
      badgeType: "RESTRICTED",
      statusLabel: "Restricted",
      reason:
        "Classes F and G are unavailable due to active disciplinary strike standing (Strike 2+).",
      noticeTitle: "Equipment Class Restricted",
      noticeMessage:
        "Members with 2 or more active strikes cannot request Heavy Equipment (Class F) or High-Value Electronics (Class G).",
    };
  }

  // Classes B and D: Direct Board Request / Interaction (Off-online-workflow)
  // Evaluated ONLY AFTER clearance eligibility is established
  if (equipmentClass === "B") {
    return {
      canBorrowOnline: false,
      canRequest: false,
      badgeType: "INFO",
      statusLabel: "Direct Board",
      reason: "Class B (Expendable Resources): Direct Board Request / Interaction.",
      noticeTitle: "Direct Board Request (Class B)",
      noticeMessage:
        "Class B items (screws, LEDs, resistors, rods, cables) are expendable resources managed via Direct Board interaction, not the online reservation cart.",
    };
  }

  if (equipmentClass === "D") {
    return {
      canBorrowOnline: false,
      canRequest: false,
      badgeType: "INFO",
      statusLabel: "Direct Board",
      reason: "Class D (Light Equipment): Direct Board Request / Interaction.",
      noticeTitle: "Direct Board Request (Class D)",
      noticeMessage:
        "Class D tools (screwdrivers, hammers, keys, multimeters) are available via Direct Board interaction at the workshop counter.",
    };
  }

  // Level III: Allowed A-E. F only under Level V+ supervision. G requires Level VI.
  if (clNum === 3) {
    if (equipmentClass === "F") {
      return {
        canBorrowOnline: true,
        canRequest: true,
        badgeType: "INFO",
        statusLabel: "Supervised (Lv V+)",
        reason: "Eligible with Level V+ supervision.",
        noticeTitle: "Eligible with Level V+ Supervision",
        noticeMessage:
          "Class F Heavy Equipment (drills, grinders, soldering stations) may be requested but must be used under active Level V+ (Board/Eurobot) supervision in the lab.",
      };
    }
    if (equipmentClass === "G") {
      return {
        canBorrowOnline: true,
        canRequest: true,
        badgeType: "WARNING",
        statusLabel: "Level VI Auth Req.",
        reason: "Class G High Value Electronics require explicit Level VI authorization.",
        noticeTitle: "Level VI Authorization Required",
        noticeMessage:
          "Rare or irreplaceable high-value electronics (Class G) require explicit authorization from the RAS Chairman or Logistics Manager (Level VI).",
      };
    }
  }

  // Level IV: Exceptional Level VI authorization
  if (clNum === 4) {
    if (equipmentClass === "G") {
      return {
        canBorrowOnline: true,
        canRequest: true,
        badgeType: "WARNING",
        statusLabel: "Level VI Auth Req.",
        reason: "Class G High Value Electronics require explicit Level VI authorization.",
        noticeTitle: "Level VI Authorization Required",
        noticeMessage: "Class G items require direct approval from Level VI authority.",
      };
    }
  }

  // Level V: Can supervise F. G requires Level VI.
  if (clNum === 5) {
    if (equipmentClass === "G") {
      return {
        canBorrowOnline: true,
        canRequest: true,
        badgeType: "WARNING",
        statusLabel: "Level VI Auth Req.",
        reason: "Class G High Value Electronics require explicit Level VI authorization.",
        noticeTitle: "Level VI Authorization Required",
        noticeMessage:
          "Class G items require explicit Level VI authorization even for Level V members.",
      };
    }
  }

  // Out of stock
  if (availableQuantity <= 0) {
    return {
      canBorrowOnline: true,
      canRequest: false,
      badgeType: "WARNING",
      statusLabel: "Out of Stock",
      reason: "Currently out of stock in the workshop inventory.",
      noticeTitle: "Out of Stock",
      noticeMessage: "All units of this equipment are currently allocated or on loan.",
    };
  }

  // Provisional / Unprocessed warning notice (still eligible to submit!)
  if (!isProcessed) {
    return {
      canBorrowOnline: true,
      canRequest: true,
      badgeType: "INFO",
      statusLabel: "Provisional",
      reason:
        "Affiliation not yet verified; Board will verify/correct identity and affiliation during processing.",
      noticeTitle: "Provisional Request Eligibility",
      noticeMessage:
        "Your account is provisional. You can submit this request; the Logistics Board will verify and confirm your affiliation during review.",
    };
  }

  // Strike 3: Class E may only be used under supervision (and F/G remain unavailable)
  if (strikesCount === 3 && equipmentClass === "E") {
    return {
      canBorrowOnline: true,
      canRequest: true,
      badgeType: "WARNING",
      statusLabel: "Supervised (Strike 3)",
      reason:
        "Class E electronic resources may only be used under supervision (Strike 3 standing).",
      noticeTitle: "Supervised Usage Required (Strike 3)",
      noticeMessage:
        "Under active Strike 3 standing, Class E development boards and electronic resources may only be used under active supervision in the lab.",
    };
  }

  // Strike 2 & 3 Warning notice for other ordinary equipment
  if (strikesCount === 3) {
    return {
      canBorrowOnline: true,
      canRequest: true,
      badgeType: "WARNING",
      statusLabel: "Board Review (Strike 3)",
      reason:
        "Eligible; all requests require explicit Board approval and Class E requires supervision (Strike 3).",
      noticeTitle: "Disciplinary Standing: Strike 3 Active",
      noticeMessage:
        "Due to active Strike 3 standing, all requests require explicit Board approval. Class E items require supervision, and Classes F and G are strictly unavailable.",
    };
  }

  if (strikesCount === 2) {
    return {
      canBorrowOnline: true,
      canRequest: true,
      badgeType: "WARNING",
      statusLabel: "Board Review Req.",
      reason: "Eligible; request requires explicit Board approval due to active Strike 2.",
      noticeTitle: "Explicit Board Review Required",
      noticeMessage:
        "Due to active disciplinary strikes, all borrow requests are subject to strict Board deliberation.",
    };
  }

  return {
    canBorrowOnline: true,
    canRequest: true,
    badgeType: "SUCCESS",
    statusLabel: "Eligible",
    reason: "Eligible for online borrow request.",
  };
}
