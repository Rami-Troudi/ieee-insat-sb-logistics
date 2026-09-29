import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SessionProvider } from "@/hooks/SessionProvider";
import { useSession, PROD_DEFAULT_PERSONA } from "@/hooks/useSession";
import { UserMenu } from "@/components/shared/UserMenu";
import { RootRedirect } from "@/app/RootRedirect";
import { UserPersona } from "@/types";

describe("Production Session Abstraction & UserMenu", () => {
  it("provides PROD_DEFAULT_PERSONA with role MEMBER and neutral clearance", () => {
    function TestConsumer() {
      const { currentPersona, isDev } = useSession();
      return (
        <div>
          <span data-testid="user-name">{currentPersona.name}</span>
          <span data-testid="user-role">{currentPersona.role}</span>
          <span data-testid="user-clearance">{currentPersona.clearance}</span>
          <span data-testid="is-dev">{String(isDev)}</span>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestConsumer />
      </SessionProvider>
    );

    expect(screen.getByTestId("user-name")).toHaveTextContent(PROD_DEFAULT_PERSONA.name);
    expect(screen.getByTestId("user-role")).toHaveTextContent("MEMBER");
    expect(screen.getByTestId("user-clearance")).toHaveTextContent(PROD_DEFAULT_PERSONA.clearance);
    expect(screen.getByTestId("is-dev")).toHaveTextContent("false");
  });

  it("renders UserMenu with session details in Member mode", () => {
    render(
      <MemoryRouter>
        <SessionProvider>
          <UserMenu isBoard={false} />
        </SessionProvider>
      </MemoryRouter>
    );

    const trigger = screen.getByLabelText("User menu");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent(PROD_DEFAULT_PERSONA.name.split(" ")[0]);
  });

  it("renders UserMenu with board role awareness", () => {
    const boardPersona: UserPersona = {
      id: "board-user-1",
      name: "Board Custodian",
      email: "board@insat.u-carthage.tn",
      role: "OPERATOR",
      clearance: "V",
      affiliation: "RAS_BOARD",
      isProcessed: true,
      status: "ACTIVE",
      strikesCount: 0,
    };

    render(
      <MemoryRouter>
        <SessionProvider initialPersona={boardPersona}>
          <UserMenu isBoard={true} />
        </SessionProvider>
      </MemoryRouter>
    );

    const trigger = screen.getByLabelText("User menu");
    expect(trigger).toHaveTextContent("Board");
  });

  it("RootRedirect routes MEMBER to /app and BOARD to /board", () => {
    const memberPersona = PROD_DEFAULT_PERSONA;
    const boardPersona: UserPersona = {
      ...PROD_DEFAULT_PERSONA,
      role: "OPERATOR",
    };

    const { unmount: u1 } = render(
      <MemoryRouter initialEntries={["/"]}>
        <SessionProvider initialPersona={memberPersona}>
          <RootRedirect />
        </SessionProvider>
      </MemoryRouter>
    );
    u1();

    const { unmount: u2 } = render(
      <MemoryRouter initialEntries={["/"]}>
        <SessionProvider initialPersona={boardPersona}>
          <RootRedirect />
        </SessionProvider>
      </MemoryRouter>
    );
    u2();
  });
});
