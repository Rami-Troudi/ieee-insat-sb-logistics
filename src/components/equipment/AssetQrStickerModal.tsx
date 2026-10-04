import React, { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer, Copy, Check, QrCode } from "lucide-react";

export interface AssetStickerData {
  id: string;
  assetCode: string;
  equipmentName: string;
  category?: string;
  serialNumber?: string | null;
  qrUrl: string;
}

interface AssetQrStickerModalProps {
  asset: AssetStickerData | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AssetQrStickerModal: React.FC<AssetQrStickerModalProps> = ({
  asset,
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = React.useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  if (!asset) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(asset.qrUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPng = () => {
    // Generate a rich physical sticker PNG (600x400) on an off-screen canvas
    const width = 600;
    const height = 400;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Background (White card with rounded corners)
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);

    // Outer border (IEEE Blue accent)
    ctx.strokeStyle = "#00629B";
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, width - 12, height - 12);

    // Inner subtle border
    ctx.strokeStyle = "#D9E2E8";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    // Top Brand Header Banner (IEEE Navy #002855)
    ctx.fillStyle = "#002855";
    ctx.fillRect(20, 20, width - 40, 68);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 22px 'Open Sans', Arial, sans-serif";
    ctx.fillText("IEEE INSAT STUDENT BRANCH", 40, 52);

    ctx.fillStyle = "#00B5E2";
    ctx.font = "bold 13px 'Open Sans', Arial, sans-serif";
    ctx.fillText("EQUIPMENT LOGISTICS ASSET LABEL", 40, 72);

    // Left Column: Details
    ctx.fillStyle = "#667085";
    ctx.font = "bold 12px 'Open Sans', Arial, sans-serif";
    ctx.fillText("EQUIPMENT NAME", 40, 125);

    ctx.fillStyle = "#172A3A";
    ctx.font = "bold 22px 'Open Sans', Arial, sans-serif";
    ctx.fillText(asset.equipmentName.slice(0, 22), 40, 155);

    ctx.fillStyle = "#667085";
    ctx.font = "bold 12px 'Open Sans', Arial, sans-serif";
    ctx.fillText("ASSET IDENTIFIER", 40, 195);

    // Asset Code Pill
    ctx.fillStyle = "#EEF3F6";
    ctx.fillRect(40, 208, 220, 48);
    ctx.strokeStyle = "#B8C5CE";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 208, 220, 48);

    ctx.fillStyle = "#00629B";
    ctx.font = "900 24px monospace";
    ctx.fillText(asset.assetCode, 55, 242);

    if (asset.serialNumber) {
      ctx.fillStyle = "#667085";
      ctx.font = "12px monospace";
      ctx.fillText(`SN: ${asset.serialNumber}`, 40, 280);
    }

    // Bottom Notice
    ctx.fillStyle = "#667085";
    ctx.font = "italic 12px 'Open Sans', Arial, sans-serif";
    ctx.fillText("Scan with Board Console to Handover or Return", 40, 340);
    ctx.fillStyle = "#98A2B3";
    ctx.font = "10px monospace";
    ctx.fillText("https://sb.insat.tn/scan", 40, 360);

    // Right Column: QR Code Image
    const qrCanvas = canvasRef.current;
    if (qrCanvas) {
      const qrSize = 220;
      const qrX = width - qrSize - 40;
      const qrY = 110;

      // QR container box
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20);
      ctx.strokeStyle = "#D9E2E8";
      ctx.lineWidth = 2;
      ctx.strokeRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20);

      ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);
    }

    // Trigger Browser Download
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${asset.assetCode}-label.png`;
    link.click();
  };

  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
    );
  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Label - ${escape(asset.assetCode)}</title>
          <style>
            @page {
              size: 70mm 45mm;
              margin: 0;
            }
            body {
              font-family: 'Open Sans', Arial, sans-serif;
              margin: 0;
              padding: 4mm;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #fff;
            }
            .label-card {
              width: 62mm;
              height: 37mm;
              border: 1.5px solid #002855;
              border-radius: 2mm;
              padding: 2mm;
              box-sizing: border-box;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            .header {
              border-bottom: 1px solid #00629b;
              padding-bottom: 1mm;
              margin-bottom: 1mm;
            }
            .org {
              font-size: 8pt;
              font-weight: 800;
              color: #002855;
              text-transform: uppercase;
            }
            .sub {
              font-size: 5.5pt;
              font-weight: 600;
              color: #00629b;
            }
            .content {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 2mm;
            }
            .info {
              flex: 1;
            }
            .name {
              font-size: 9pt;
              font-weight: 700;
              color: #172a3a;
              line-height: 1.1;
              margin-bottom: 2mm;
            }
            .code-badge {
              display: inline-block;
              font-family: monospace;
              font-size: 11pt;
              font-weight: 800;
              color: #002855;
              background: #eef3f6;
              padding: 1mm 2mm;
              border: 1px solid #b8c5ce;
              border-radius: 1mm;
            }
            .qr-box img {
              width: 24mm;
              height: 24mm;
              display: block;
            }
            .footer {
              font-size: 5pt;
              color: #667085;
              text-align: center;
              border-top: 0.5px solid #d9e2e8;
              padding-top: 0.8mm;
            }
          </style>
        </head>
        <body>
          <div class="label-card">
            <div class="header">
              <div class="org">IEEE INSAT Student Branch</div>
              <div class="sub">Equipment Logistics Asset Label</div>
            </div>
            <div class="content">
              <div class="info">
                <div class="name">${escape(asset.equipmentName)}</div>
                <div class="code-badge">${escape(asset.assetCode)}</div>
                ${asset.serialNumber ? `<div style="font-size: 6pt; font-family: monospace; margin-top: 1mm;">SN: ${escape(asset.serialNumber)}</div>` : ""}
              </div>
              <div class="qr-box">
                <img src="${canvasRef.current?.toDataURL("image/png")}" alt="QR" />
              </div>
            </div>
            <div class="footer">
              Scan with Desk Scanner to Handover or Return • sb.insat.tn
            </div>
          </div>

        </body>
      </html>
    `);
    printWindow.addEventListener(
      "load",
      async () => {
        await Promise.all(
          Array.from(printWindow.document.images).map((img) => img.decode().catch(() => undefined))
        );
        printWindow.print();
      },
      { once: true }
    );
    printWindow.document.close();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6 bg-card border-border sm:rounded-2xl space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <QrCode className="w-5 h-5 text-primary" />
            <span>Asset Printable QR Sticker</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Download as a high-resolution PNG or print directly onto adhesive label paper.
          </DialogDescription>
        </DialogHeader>

        {/* Physical Sticker Preview (Simulating 50mm x 30mm label) */}
        <div className="p-4 rounded-xl border-2 border-primary/40 bg-white text-slate-900 shadow-md space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-primary/20">
            <div>
              <div className="font-extrabold text-xs tracking-wider text-[#002855]">
                IEEE INSAT STUDENT BRANCH
              </div>
              <div className="text-[10px] font-bold text-primary">EQUIPMENT ASSET LABEL</div>
            </div>
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-surface-subtle border border-border text-foreground">
              {asset.category ?? "ASSET"}
            </span>
          </div>

          {/* Body */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Equipment
              </div>
              <div className="font-bold text-sm text-foreground truncate">
                {asset.equipmentName}
              </div>

              <div className="pt-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Asset Code
                </div>
                <div className="inline-block mt-0.5 font-mono font-black text-sm text-[#002855] px-2.5 py-1 rounded-md bg-[#EEF3F6] border border-[#B8C5CE]">
                  {asset.assetCode}
                </div>
              </div>

              {asset.serialNumber && (
                <div className="text-[10px] font-mono text-muted-foreground pt-0.5 truncate">
                  SN: {asset.serialNumber}
                </div>
              )}
            </div>

            {/* High Resolution Scannable QR Code Canvas */}
            <div className="p-2 rounded-lg border border-border bg-white shrink-0 shadow-xs">
              <QRCodeCanvas
                ref={canvasRef}
                value={asset.qrUrl}
                size={130}
                level="H"
                includeMargin={false}
              />
            </div>
          </div>

          {/* Footer Instruction */}
          <div className="pt-2 border-t border-dashed border-border/80 flex items-center justify-between text-[10px] text-muted-foreground font-medium">
            <span>Scan to check out or return</span>
            <span className="font-mono text-[9px]">sb.insat.tn/scan</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="grid grid-cols-3 gap-2 pt-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleDownloadPng}
            className="text-xs font-semibold gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download PNG</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="text-xs font-semibold gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Label</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="text-xs font-semibold gap-1.5"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy URL</span>
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
