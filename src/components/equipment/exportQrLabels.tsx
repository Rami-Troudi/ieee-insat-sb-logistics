import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";

type LabelAsset = {
  assetCode: string;
  qrUrl: string;
  serialNumber: string | null;
  state: string;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!
  );

export function exportQrLabels(equipmentName: string, assets: LabelAsset[]) {
  if (!assets.length) throw new Error("This equipment type has no material labels to export.");
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("Allow popups for this site to export QR labels.");
  preview.opener = null;
  const labels = assets
    .map((asset) => {
      const qr = renderToStaticMarkup(
        <QRCodeSVG value={asset.qrUrl} size={150} level="M" marginSize={4} />
      );
      return `<article class="label">
      <header>IEEE INSAT STUDENT BRANCH</header>
      <div class="body"><div class="details"><strong>${escapeHtml(equipmentName)}</strong>
      <p class="code">${escapeHtml(asset.assetCode)}</p>
      ${asset.serialNumber ? `<p>SN: ${escapeHtml(asset.serialNumber)}</p>` : ""}
      <p>${escapeHtml(asset.state.replaceAll("_", " "))}</p></div><div class="qr">${qr}</div></div>
      <footer>Scan material for pickup or return</footer>
    </article>`;
    })
    .join("");
  preview.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>${escapeHtml(equipmentName)} - QR labels</title>
    <style>
      @page { size: A4; margin: 10mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, sans-serif; color: #172a3a; }
      .toolbar { padding: 20px; background: #eef3f6; margin-bottom: 15px; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      button { padding: 10px 16px; cursor: pointer; background: #00629b; color: white; border: 0; border-radius: 5px; }
      .sheet { max-width: 190mm; margin: auto; font-size: 0; }
      .label { display: inline-block; vertical-align: top; width: 90mm; height: 50mm; margin: 2mm; padding: 3mm; border: 0.5mm solid #00629b; break-inside: avoid; page-break-inside: avoid; font-size: 10px; overflow: hidden; }
      header { font-size: 10px; font-weight: bold; padding-bottom: 2mm; border-bottom: 0.2mm solid #b8c5ce; }
      .body { display: flex; align-items: center; height: 32mm; gap: 2mm; }
      .details { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      strong { font-size: 12px; } p { margin: 2mm 0; font-size: 9px; }
      .code { font-family: monospace; font-size: 13px; font-weight: bold; }
      .qr { width: 32mm; height: 32mm; flex-shrink: 0; }
      svg { width: 100%; height: 100%; }
      footer { font-size: 8px; }
      @media print { .toolbar { display: none; } .sheet { margin: 0; } }
    </style></head><body>
    <div class="toolbar"><h1>${escapeHtml(equipmentName)} — ${assets.length} QR labels</h1>
    <p>One label per physical material. Print at 100% scale, or select “Save as PDF” in the print dialog.</p>
    <button id="print-labels" type="button">Print / Save as PDF</button></div>
    <main class="sheet">${labels}</main></body></html>`);
  preview.document.close();
  preview.document.getElementById("print-labels")?.addEventListener("click", () => preview.print());
  preview.focus();
}
