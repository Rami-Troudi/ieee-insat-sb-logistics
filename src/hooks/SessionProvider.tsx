import React, { useState, useEffect } from "react";
import { UserPersona } from "@/types";
import { SessionContext, PROD_DEFAULT_PERSONA } from "./useSession";
import { authService } from "@/services";

export interface SessionProviderProps {
  children: React.ReactNode;
  initialPersona?: UserPersona;
  isDev?: boolean;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({
  children,
  initialPersona = PROD_DEFAULT_PERSONA,
  isDev = false,
}) => {
  const [currentPersona, setCurrentPersona] = useState<UserPersona>(
    initialPersona.id === PROD_DEFAULT_PERSONA.id ? PROD_DEFAULT_PERSONA : initialPersona
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const openBorrowerAuthModal = React.useCallback(() => setIsAuthModalOpen(true), []);

  const closeBorrowerAuthModal = React.useCallback(() => {
    setIsAuthModalOpen(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("auth") || url.searchParams.has("login")) {
        url.searchParams.delete("auth");
        url.searchParams.delete("login");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
      }
    }
  }, []);

  useEffect(() => {
    void authService
      .getCurrentSession()
      .then((session) => setCurrentPersona(session ?? PROD_DEFAULT_PERSONA))
      .catch(() => setCurrentPersona(PROD_DEFAULT_PERSONA))
      .finally(() => setIsLoading(false));

    const unsubscribe = authService.subscribeSession((session) => {
      setCurrentPersona(session ?? PROD_DEFAULT_PERSONA);
      setIsLoading(false);
    });
    const handleOpen = () => setIsAuthModalOpen(true);
    window.addEventListener("ras:open-borrower-auth", handleOpen);

    return () => {
      unsubscribe();
      window.removeEventListener("ras:open-borrower-auth", handleOpen);
    };
  }, []);

  return (
    <SessionContext.Provider
      value={{
        currentPersona,
        isDev,
        isLoading,
        isAuthModalOpen,
        openBorrowerAuthModal,
        closeBorrowerAuthModal,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};
