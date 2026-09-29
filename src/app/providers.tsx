import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/app/query-client";
import { SessionProvider } from "@/hooks/SessionProvider";
import { BorrowCartProvider } from "@/features/cart/BorrowCartProvider";

interface ProvidersProps {
  children: React.ReactNode;
}

export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BorrowCartProvider>{children}</BorrowCartProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
};
