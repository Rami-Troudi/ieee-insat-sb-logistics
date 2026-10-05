export function readSelection(storage: Pick<Storage, "getItem">): Record<string, number> {
  try {
    const value: unknown = JSON.parse(storage.getItem("sb-item-selection") ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([id, quantity]) =>
          id.length > 0 &&
          typeof quantity === "number" &&
          Number.isSafeInteger(quantity) &&
          quantity > 0 &&
          quantity <= 100
      )
    );
  } catch {
    return {};
  }
}
export function storeSelection(storage: Pick<Storage, "setItem">, value: Record<string, number>) {
  try {
    storage.setItem("sb-item-selection", JSON.stringify(value));
  } catch {
    /* Selection remains available in memory. */
  }
}
