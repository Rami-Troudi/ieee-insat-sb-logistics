import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { FilterChip } from "@/components/shared/FilterChip";
import { FilterBar } from "@/components/shared/FilterBar";
import { ConfirmationDialog } from "@/components/shared/ConfirmationDialog";
import { AlertBanner } from "@/components/shared/AlertBanner";
import { PolicyNotice } from "@/components/shared/PolicyNotice";
import { Metric } from "@/components/shared/Metric";
import { KeyValueRow } from "@/components/shared/KeyValueRow";
import { LoadingState } from "@/components/shared/LoadingState";
import { ResponsiveDataTable } from "@/components/shared/ResponsiveDataTable";
import { UserMenu } from "@/components/shared/UserMenu";
import { SessionProvider } from "@/hooks/SessionProvider";

describe("Shared Foundation Primitives", () => {
  it("interacts properly with FilterChip and FilterBar", () => {
    const handleRemove = vi.fn();
    const handleClearAll = vi.fn();

    render(
      <FilterBar
        filters={[
          { id: "f1", label: "Class", value: "Class E", count: 4 },
          { id: "f2", label: "Availability", value: "In Stock" },
        ]}
        onRemoveFilter={handleRemove}
        onClearAll={handleClearAll}
      />
    );

    expect(screen.getByText("Class E")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("In Stock")).toBeInTheDocument();

    const removeBtn = screen.getByLabelText("Remove filter for Class: Class E");
    fireEvent.click(removeBtn);
    expect(handleRemove).toHaveBeenCalledWith("f1");

    const clearAllBtn = screen.getByText("Reset all");
    fireEvent.click(clearAllBtn);
    expect(handleClearAll).toHaveBeenCalled();
  });

  it("renders FilterChip standalone and triggers onRemove", () => {
    const handleRemove = vi.fn();
    render(
      <FilterChip label="Category" value="Microcontrollers" count={5} onRemove={handleRemove} />
    );

    expect(screen.getByText("Category:")).toBeInTheDocument();
    expect(screen.getByText("Microcontrollers")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();

    const removeBtn = screen.getByLabelText("Remove filter for Category: Microcontrollers");
    fireEvent.click(removeBtn);
    expect(handleRemove).toHaveBeenCalled();
  });

  it("handles ConfirmationDialog confirm and cancel actions", () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();
    const handleOpenChange = vi.fn();

    render(
      <ConfirmationDialog
        open={true}
        onOpenChange={handleOpenChange}
        title="Revoke Approval?"
        description="Are you sure you want to revoke this approval?"
        confirmLabel="Revoke Now"
        variant="destructive"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );

    expect(screen.getByText("Revoke Approval?")).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to revoke this approval?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(handleCancel).toHaveBeenCalled();

    fireEvent.click(screen.getByText("Revoke Now"));
    expect(handleConfirm).toHaveBeenCalled();
  });

  it("renders AlertBanner and PolicyNotice correctly", () => {
    const handleDismiss = vi.fn();

    render(
      <div>
        <AlertBanner
          variant="warning"
          title="Attention Needed"
          description="Loan expires soon"
          onDismiss={handleDismiss}
        />
        <PolicyNotice
          ruleRef="REG-SEC-3.1"
          summary="Class E Rule"
          details="Requires Level III clearance"
        />
      </div>
    );

    expect(screen.getByText("Attention Needed")).toBeInTheDocument();
    expect(screen.getByText("Loan expires soon")).toBeInTheDocument();
    expect(screen.getByText("REG-SEC-3.1")).toBeInTheDocument();
    expect(screen.getByText("Class E Rule")).toBeInTheDocument();

    const dismissBtn = screen.getByLabelText("Dismiss notification");
    fireEvent.click(dismissBtn);
    expect(handleDismiss).toHaveBeenCalled();
  });

  it("renders Metric, KeyValueRow, and LoadingState variants", () => {
    render(
      <div>
        <Metric label="Active Loans" value="12" description="Current held items" />
        <KeyValueRow label="Serial Number" value="SN-2026-001" isMono />
        <LoadingState variant="cards" count={2} />
      </div>
    );

    expect(screen.getByText("Active Loans")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Serial Number")).toBeInTheDocument();
    expect(screen.getByText("SN-2026-001")).toBeInTheDocument();
  });

  it("renders ResponsiveDataTable with desktop table and mobile card fallback", () => {
    const testData = [
      { id: "item-1", name: "Arduino Uno", category: "Microcontrollers", stock: 5 },
      { id: "item-2", name: "STM32 Nucleo", category: "Development Boards", stock: 8 },
    ];

    render(
      <ResponsiveDataTable
        data={testData}
        keyExtractor={(item) => item.id}
        columns={[
          { key: "name", header: "Name", render: (it) => it.name },
          { key: "category", header: "Category", render: (it) => it.category },
          { key: "stock", header: "Stock", render: (it) => `${it.stock} units` },
        ]}
      />
    );

    expect(screen.getByText("Arduino Uno")).toBeInTheDocument();
    expect(screen.getByText("STM32 Nucleo")).toBeInTheDocument();
  });

  it("renders UserMenu with active persona info", () => {
    render(
      <MemoryRouter>
        <SessionProvider>
          <UserMenu />
        </SessionProvider>
      </MemoryRouter>
    );

    expect(screen.getByLabelText("User menu")).toBeInTheDocument();
  });
});
