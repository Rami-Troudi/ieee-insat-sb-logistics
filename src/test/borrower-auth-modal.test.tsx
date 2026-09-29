import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Providers } from "@/app/providers";
import { BorrowerAuthModal } from "@/components/auth/BorrowerAuthModal";
import { authService } from "@/services";

describe("BorrowerAuthModal Component", () => {
  beforeEach(() => {
    localStorage.clear();
    authService.clearSession();
  });

  it("renders popup modal with Name, Surname, Email, Phone, Affiliation buttons, and Board access link", () => {
    render(
      <Providers>
        <MemoryRouter>
          <BorrowerAuthModal isOpen={true} />
        </MemoryRouter>
      </Providers>
    );

    // Modal title & description
    expect(screen.getByText("Welcome to RAS Logistics!")).toBeInTheDocument();
    expect(
      screen.getByText(/Please enter your student details to link your borrow requests/i)
    ).toBeInTheDocument();

    // Required fields
    expect(screen.getByPlaceholderText("e.g. Ahmed")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Ben Mansour")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. ahmed.bm@insat.u-carthage.tn")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("+216 98 765 432")).toBeInTheDocument();

    // Affiliation selector buttons
    expect(screen.getByRole("button", { name: "IEEE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aerobotix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "External" })).toBeInTheDocument();

    // Submit action
    expect(screen.getByRole("button", { name: /Get Started & Save Info/i })).toBeInTheDocument();

    // Board access link
    const boardLink = screen.getByRole("link", { name: /Board staff access/i });
    expect(boardLink).toBeInTheDocument();
    expect(boardLink).toHaveAttribute("href", "/auth/board-login");
  });

  it("validates form fields and requires valid input", async () => {
    render(
      <Providers>
        <MemoryRouter>
          <BorrowerAuthModal isOpen={true} />
        </MemoryRouter>
      </Providers>
    );

    const submitBtn = screen.getByRole("button", { name: /Get Started & Save Info/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText("First name must be at least 2 characters")).toBeInTheDocument();
    expect(screen.getByText("Surname must be at least 2 characters")).toBeInTheDocument();
  });

  it("submits valid borrower details, saves to localStorage, and updates active session", async () => {
    let closed = false;
    let succeeded = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/v1/auth/borrower")) {
          return Response.json({
            ok: true,
            user: {
              id: "member-yassine",
              name: "Yassine Ben Ali",
              email: "yassine.ba@insat.u-carthage.tn",
              role: "MEMBER",
              clearance: "II",
              affiliation: "AEROBOTIX",
              status: "ACTIVE",
            },
          });
        }
        return Response.json({});
      })
    );

    render(
      <Providers>
        <MemoryRouter>
          <BorrowerAuthModal
            isOpen={true}
            onClose={() => {
              closed = true;
            }}
            onSuccess={() => {
              succeeded = true;
            }}
          />
        </MemoryRouter>
      </Providers>
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. Ahmed"), {
      target: { value: "Yassine" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Ben Mansour"), {
      target: { value: "Ben Ali" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. ahmed.bm@insat.u-carthage.tn"), {
      target: { value: "yassine.ba@insat.u-carthage.tn" },
    });
    fireEvent.change(screen.getByPlaceholderText("+216 98 765 432"), {
      target: { value: "+216 98 123 456" },
    });

    // Select Aerobotix
    fireEvent.click(screen.getByRole("button", { name: "Aerobotix" }));

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /Get Started & Save Info/i }));

    await waitFor(() => {
      expect(succeeded).toBe(true);
      expect(closed).toBe(true);
    });

    // Check localStorage
    expect(localStorage.getItem("ras_onboarding_completed")).toBe("true");
    expect(localStorage.getItem("ras_borrower_email")).toBe("yassine.ba@insat.u-carthage.tn");

    const profileRaw = localStorage.getItem("ras_borrower_profile");
    expect(profileRaw).toBeTruthy();
    const profile = JSON.parse(profileRaw!);
    expect(profile.name).toBe("Yassine Ben Ali");
    expect(profile.membership).toBe("AEROBOTIX");
    expect(profile.phone).toBe("+216 98 123 456");

    // Check session
    const current = authService.getCurrentUser();
    expect(current.name).toBe("Yassine Ben Ali");
    expect(current.email).toBe("yassine.ba@insat.u-carthage.tn");
    expect(current.affiliation).toBe("AEROBOTIX");
    expect(current.status).toBe("ACTIVE");
  });
});
