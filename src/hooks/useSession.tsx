import { createContext, useContext } from "react";
import { UserPersona } from "@/types";

export interface SessionContextType {
  currentPersona: UserPersona;
  isDev: boolean;
  isLoading: boolean;
  isAuthModalOpen: boolean;
  openBorrowerAuthModal: () => void;
  closeBorrowerAuthModal: () => void;
}

export const PROD_DEFAULT_PERSONA: UserPersona = {
  id: "anonymous",
  name: "Guest",
  email: "",
  role: "MEMBER",
  clearance: "I",
  affiliation: "EXTERNAL",
  isProcessed: false,
  status: "PENDING",
  strikesCount: 0,
};

export const SessionContext = createContext<SessionContextType>({
  currentPersona: PROD_DEFAULT_PERSONA,
  isDev: false,
  isLoading: true,
  isAuthModalOpen: false,
  openBorrowerAuthModal: () => {},
  closeBorrowerAuthModal: () => {},
});

export const useSession = (): SessionContextType => useContext(SessionContext);
