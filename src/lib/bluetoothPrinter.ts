import type { InvoiceDesignConfig } from '../shared/types.ts';

export interface PrintableInvoiceLine {
  product_code: string;
  name_ar: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface PrintablePosInvoice {
  invoice_number: string;
  created_at: string;
  captain_name: string;
  captain_phone?: string;
  customer_name: string;
  customer_phone?: string;
  order_number?: string | null;
  items: PrintableInvoiceLine[];
  subtotal: number;
  delivery_fee: number;
  discount_amount: number;
  total_amount: number;
  payment_method: string;
}

export type ThermalPaperWidth = '58mm' | '80mm';

export const DEFAULT_INVOICE_DESIGN: InvoiceDesignConfig = {
  header_title: 'اطلبها – Otlobha المنزلة',
  header_subtitle: 'فاتورة توصيل ومشوار معتمدة للعميل',
  logo_url: '/assets/aistudio/Picsart_25-11-19_14-05-26-471_82d5a262.jpg',
  show_logo: true,
  support_phone: '01000000000',
  show_support_phone: true,
  show_captain_info: true,
  show_item_codes: true,
  show_qr_badge: true,
  footer_message: 'شكرًا لاستخدامكم تطبيق اطلبها – المنزلة',
  footer_note: 'خدمة سريعة تغطي المدينة والقرى',
  default_paper_width: '58mm',
  accent_color: '#A92224',
  font_scale: 'normal',
};

const THERMAL_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

type BleDeviceLike = {
  id?: string;
  name?: string;
  gatt?: {
    connected?: boolean;
    connect: () => Promise<{
      getPrimaryServices: () => Promise<
        Array<{
          uuid: string;
          getCharacteristics: () => Promise<
            Array<{
              uuid: string;
              properties: { write?: boolean; writeWithoutResponse?: boolean };
              writeValue: (data: BufferSource) => Promise<void>;
              writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
            }>
          >;
        }>
      >;
    }>;
    disconnect?: () => void;
  };
  addEventListener?: (event: string, listener: () => void) => void;
};

type BleCharacteristicLike = {
  uuid: string;
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
};

let connectedDevice: BleDeviceLike | null = null;
let connectedCharacteristic: BleCharacteristicLike | null = null;

export function isBluetoothPrinterSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as unknown as { bluetooth?: unknown }).bluetooth !== 'undefined';
}

export function getConnectedPrinterName(): string | null {
  if (!connectedDevice || !connectedDevice.gatt?.connected || !connectedCharacteristic) {
    return null;
  }
  return connectedDevice.name || 'طابعة بلوتوث حرارية';
}

export function disconnectBluetoothPrinter(): void {
  try {
    connectedDevice?.gatt?.disconnect?.();
  } catch {
    // ignore
  }
  connectedDevice = null;
  connectedCharacteristic = null;
}

export async function connectBluetoothPrinter(): Promise<{ name: string }> {
  if (!isBluetoothPrinterSupported()) {
    throw new Error('المتصفح الحالي لا يدعم Web Bluetooth؛ يمكنك استخدام الطباعة الحرارية المباشرة (58/80mm) أو متصفح Chrome على أندرويد/الكمبيوتر.');
  }
  const bt = (navigator as unknown as {
    bluetooth: {
      requestDevice: (opts: {
        acceptAllDevices?: boolean;
        optionalServices?: string[];
      }) => Promise<BleDeviceLike>;
    };
  }).bluetooth;

  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: THERMAL_PRINTER_SERVICES,
  });

  if (!device.gatt) {
    throw new Error('الجهاز المختار لا يدعم الاتصال عبر GATT BLE.');
  }

  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  let writableChar: BleCharacteristicLike | null = null;

  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      if (ch.properties?.writeWithoutResponse || ch.properties?.write) {
        writableChar = ch;
        break;
      }
    }
    if (writableChar) break;
  }

  if (!writableChar) {
    throw new Error('تم الاتصال بالجهاز لكن لم يتم العثور على قناة كتابة ESC/POS متوافقة.');
  }

  connectedDevice = device;
  connectedCharacteristic = writableChar;
  device.addEventListener?.('gattserverdisconnected', () => {
    connectedDevice = null;
    connectedCharacteristic = null;
  });

  return { name: device.name || 'طابعة بلوتوث POS' };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

export async function buildReceiptCanvas(
  invoice: PrintablePosInvoice,
  designInput?: Partial<InvoiceDesignConfig> | string,
  paperWidthOverride?: ThermalPaperWidth
): Promise<HTMLCanvasElement> {
  const design: InvoiceDesignConfig =
    typeof designInput === 'string'
      ? { ...DEFAULT_INVOICE_DESIGN, logo_url: designInput }
      : { ...DEFAULT_INVOICE_DESIGN, ...(designInput || {}) };

  const paperWidth: ThermalPaperWidth = paperWidthOverride || design.default_paper_width || '58mm';
  const widthPx = paperWidth === '80mm' ? 576 : 384;
  const pad = 16;
  const contentWidth = widthPx - pad * 2;
  const isWide = paperWidth === '80mm';
  const scaleMult = design.font_scale === 'compact' ? 0.9 : design.font_scale === 'large' ? 1.12 : 1;

  const sz = (base: number) => Math.round(base * scaleMult);
  const bodyFont = `600 ${sz(isWide ? 22 : 18)}px "Cairo", "Segoe UI", Tahoma, sans-serif`;
  const smallFont = `500 ${sz(isWide ? 18 : 15)}px "Cairo", "Segoe UI", Tahoma, sans-serif`;

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = widthPx;
  measureCanvas.height = 100;
  const mctx = measureCanvas.getContext('2d');

  let estimatedHeight = 360;
  if (mctx) {
    mctx.font = bodyFont;
    for (const item of invoice.items) {
      const wrapped = wrapTextLines(mctx, item.name_ar, contentWidth - 110);
      estimatedHeight += Math.max(1, wrapped.length) * sz(isWide ? 28 : 24) + 30;
    }
  } else {
    estimatedHeight += invoice.items.length * 60;
  }
  estimatedHeight += 360;

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = estimatedHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, widthPx, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  let y = 14;

  if (design.show_logo && design.logo_url) {
    const logoImg = await loadImage(design.logo_url);
    if (logoImg) {
      const targetH = isWide ? 108 : 84;
      const ratio = logoImg.width > 0 ? logoImg.height / logoImg.width : 1;
      const targetW = Math.min(contentWidth * 0.7, Math.round(targetH / (ratio || 1)));
      const drawX = Math.round((widthPx - targetW) / 2);
      ctx.drawImage(logoImg, drawX, y, targetW, targetH);
      y += targetH + 8;
    }
  }

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.font = `800 ${sz(isWide ? 26 : 21)}px "Cairo", "Segoe UI", Tahoma, sans-serif`;
  ctx.fillText(design.header_title || DEFAULT_INVOICE_DESIGN.header_title, widthPx / 2, y);
  y += sz(isWide ? 34 : 28);

  if (design.header_subtitle) {
    ctx.font = smallFont;
    ctx.fillText(design.header_subtitle, widthPx / 2, y);
    y += sz(isWide ? 26 : 22);
  }

  if (design.show_support_phone && design.support_phone) {
    ctx.font = smallFont;
    ctx.fillText(`خدمة العملاء: ${design.support_phone}`, widthPx / 2, y);
    y += sz(isWide ? 24 : 20);
  }

  const drawDivider = (dashed = true) => {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(pad, y + 4);
    ctx.lineTo(widthPx - pad, y + 4);
    ctx.stroke();
    ctx.restore();
    y += 14;
  };

  drawDivider(false);

  const drawPair = (rightLabel: string, leftValue: string, bold = false) => {
    ctx.font = bold ? `800 ${sz(isWide ? 21 : 17)}px "Cairo", "Segoe UI", Tahoma, sans-serif` : smallFont;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillText(rightLabel, widthPx - pad, y);
    ctx.textAlign = 'left';
    ctx.fillText(leftValue, pad, y);
    y += sz(isWide ? 28 : 23);
  };

  drawPair('رقم الفاتورة:', invoice.invoice_number, true);
  drawPair('التاريخ:', String(invoice.created_at || '').slice(0, 16).replace('T', ' '));
  if (design.show_captain_info) {
    drawPair('الطيار:', invoice.captain_name);
    if (invoice.captain_phone) drawPair('هاتف الطيار:', invoice.captain_phone);
  }
  drawPair('العميل:', invoice.customer_name || 'عميل مباشر');
  if (invoice.customer_phone) drawPair('هاتف العميل:', invoice.customer_phone);
  if (invoice.order_number) drawPair('مرجع الطلب/المشوار:', invoice.order_number);

  drawDivider(true);

  ctx.font = `800 ${sz(isWide ? 19 : 15)}px "Cairo", "Segoe UI", Tahoma, sans-serif`;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillText('التفاصيل / الخدمة', widthPx - pad, y);
  ctx.textAlign = 'left';
  ctx.fillText('القيمة', pad, y);
  y += sz(isWide ? 28 : 22);

  drawDivider(true);

  for (const item of invoice.items) {
    ctx.font = bodyFont;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const lines = wrapTextLines(ctx, item.name_ar, contentWidth - 95);
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], widthPx - pad, y);
      if (i === 0) {
        ctx.textAlign = 'left';
        ctx.fillText(`${Number(item.line_total).toFixed(2)} ج.م`, pad, y);
        ctx.textAlign = 'right';
      }
      y += sz(isWide ? 26 : 22);
    }
    ctx.font = smallFont;
    ctx.textAlign = 'right';
    const metaText = design.show_item_codes
      ? `المرجع: ${item.product_code || '-'} | ${item.qty} × ${Number(item.unit_price).toFixed(2)} ج.م`
      : `${item.qty} × ${Number(item.unit_price).toFixed(2)} ج.م`;
    ctx.fillText(metaText, widthPx - pad, y);
    y += sz(isWide ? 24 : 20);
  }

  drawDivider(true);

  drawPair('المبلغ الأساسي:', `${Number(invoice.subtotal).toFixed(2)} ج.م`);
  if (invoice.delivery_fee > 0) {
    drawPair('رسوم التوصيل:', `${Number(invoice.delivery_fee).toFixed(2)} ج.م`);
  }
  if (invoice.discount_amount > 0) {
    drawPair('الخصم:', `-${Number(invoice.discount_amount).toFixed(2)} ج.م`);
  }

  drawDivider(false);

  ctx.font = `800 ${sz(isWide ? 25 : 21)}px "Cairo", "Segoe UI", Tahoma, sans-serif`;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillText('الصافي المستحق:', widthPx - pad, y);
  ctx.textAlign = 'left';
  ctx.fillText(`${Number(invoice.total_amount).toFixed(2)} ج.م`, pad, y);
  y += sz(isWide ? 36 : 30);

  drawPair(
    'طريقة الدفع:',
    invoice.payment_method === 'cash' ? 'نقدي عند التسليم' : invoice.payment_method === 'wallet' ? 'محفظة' : invoice.payment_method
  );

  if (design.show_qr_badge) {
    y += 4;
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad + 18, y, contentWidth - 36, 36);
    ctx.font = `700 ${sz(isWide ? 16 : 13)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`OTLOBHA VERIFIED · ${invoice.invoice_number}`, widthPx / 2, y + 10);
    ctx.restore();
    y += 46;
  }

  y += 6;
  drawDivider(true);
  ctx.font = smallFont;
  ctx.textAlign = 'center';
  if (design.footer_message) {
    ctx.fillText(design.footer_message, widthPx / 2, y);
    y += sz(isWide ? 26 : 22);
  }
  if (design.footer_note) {
    ctx.fillText(design.footer_note, widthPx / 2, y);
    y += sz(isWide ? 24 : 20);
  }
  y += 24;

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = widthPx;
  finalCanvas.height = Math.max(200, y);
  const fctx = finalCanvas.getContext('2d');
  if (fctx) {
    fctx.fillStyle = '#FFFFFF';
    fctx.fillRect(0, 0, widthPx, finalCanvas.height);
    fctx.drawImage(canvas, 0, 0, widthPx, finalCanvas.height, 0, 0, widthPx, finalCanvas.height);
  }
  return finalCanvas;
}

export function canvasToEscPosRasterBytes(canvas: HTMLCanvasElement): Uint8Array {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(0);
  const imgData = ctx.getImageData(0, 0, width, height).data;

  const widthBytes = Math.ceil(width / 8);
  const rasterSize = widthBytes * height;
  const buffer = new Uint8Array(2 + 8 + rasterSize + 6);
  let offset = 0;

  buffer[offset++] = 0x1b;
  buffer[offset++] = 0x40;

  buffer[offset++] = 0x1d;
  buffer[offset++] = 0x76;
  buffer[offset++] = 0x30;
  buffer[offset++] = 0x00;
  buffer[offset++] = widthBytes & 0xff;
  buffer[offset++] = (widthBytes >> 8) & 0xff;
  buffer[offset++] = height & 0xff;
  buffer[offset++] = (height >> 8) & 0xff;

  for (let y = 0; y < height; y += 1) {
    for (let xByte = 0; xByte < widthBytes; xByte += 1) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = xByte * 8 + bit;
        if (x < width) {
          const idx = (y * width + x) * 4;
          const r = imgData[idx];
          const g = imgData[idx + 1];
          const b = imgData[idx + 2];
          const a = imgData[idx + 3];
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          const isBlack = a > 100 && luminance < 165;
          if (isBlack) {
            byteVal |= 0x80 >> bit;
          }
        }
      }
      buffer[offset++] = byteVal;
    }
  }

  buffer[offset++] = 0x1b;
  buffer[offset++] = 0x64;
  buffer[offset++] = 0x04;

  buffer[offset++] = 0x1d;
  buffer[offset++] = 0x56;
  buffer[offset++] = 0x01;

  return buffer;
}

export async function sendBytesToConnectedPrinter(bytes: Uint8Array): Promise<void> {
  if (!connectedDevice || !connectedDevice.gatt?.connected || !connectedCharacteristic) {
    throw new Error('لم يتم توصيل طابعة بلوتوث بعد. اضغط «ربط طابعة بلوتوث» أولاً.');
  }
  const chunkSize = 180;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.slice(i, i + chunkSize);
    if (connectedCharacteristic.properties?.writeWithoutResponse && connectedCharacteristic.writeValueWithoutResponse) {
      await connectedCharacteristic.writeValueWithoutResponse(slice);
    } else {
      await connectedCharacteristic.writeValue(slice);
    }
    await new Promise((r) => setTimeout(r, 18));
  }
}

export async function printInvoiceViaBluetooth(
  invoice: PrintablePosInvoice,
  designOrLogo?: Partial<InvoiceDesignConfig> | string,
  paperWidth?: ThermalPaperWidth
): Promise<void> {
  const canvas = await buildReceiptCanvas(invoice, designOrLogo, paperWidth);
  const escPosBytes = canvasToEscPosRasterBytes(canvas);
  await sendBytesToConnectedPrinter(escPosBytes);
}

export async function printBluetoothTestPage(
  captainName: string,
  designOrLogo?: Partial<InvoiceDesignConfig> | string,
  paperWidth?: ThermalPaperWidth
): Promise<void> {
  const testInvoice: PrintablePosInvoice = {
    invoice_number: 'TEST-POS-01',
    created_at: new Date().toISOString(),
    captain_name: captainName,
    customer_name: 'اختبار طابعة البلوتوث',
    items: [
      {
        product_code: 'OTL-TEST',
        name_ar: 'صفحة اختبار جودة الطباعة وتصميم الفاتورة',
        qty: 1,
        unit_price: 0,
        line_total: 0,
      },
    ],
    subtotal: 0,
    delivery_fee: 0,
    discount_amount: 0,
    total_amount: 0,
    payment_method: 'cash',
  };
  await printInvoiceViaBluetooth(testInvoice, designOrLogo, paperWidth);
}

export function printInvoiceViaHiddenIframe(
  invoice: PrintablePosInvoice,
  designInput?: Partial<InvoiceDesignConfig> | string,
  paperWidthOverride?: ThermalPaperWidth
): void {
  const design: InvoiceDesignConfig =
    typeof designInput === 'string'
      ? { ...DEFAULT_INVOICE_DESIGN, logo_url: designInput }
      : { ...DEFAULT_INVOICE_DESIGN, ...(designInput || {}) };

  const paperWidth: ThermalPaperWidth = paperWidthOverride || design.default_paper_width || '58mm';
  const existing = document.getElementById('otlobha-pos-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'otlobha-pos-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) return;

  const esc = (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const accent = /^#[0-9a-fA-F]{3,8}$/.test(design.accent_color || '') ? design.accent_color : '#A92224';
  const fontMult = design.font_scale === 'compact' ? 0.92 : design.font_scale === 'large' ? 1.12 : 1;

  const rowsHtml = invoice.items
    .map(
      (item) => `
      <tr>
        <td style="padding:4px 0; border-bottom:1px dashed #cbd5e1;">
          <div style="font-weight:700; font-size:${Math.round(12 * fontMult)}px;">${esc(item.name_ar)}</div>
          <div style="font-size:${Math.round(10 * fontMult)}px; color:#475569;">
            ${design.show_item_codes ? `المرجع: ${esc(item.product_code || '-')} · ` : ''}${item.qty} × ${Number(item.unit_price).toFixed(2)}
          </div>
        </td>
        <td style="padding:4px 0; text-align:left; font-weight:700; font-size:${Math.round(12 * fontMult)}px; border-bottom:1px dashed #cbd5e1; white-space:nowrap;">
          ${Number(item.line_total).toFixed(2)} ج.م
        </td>
      </tr>
    `
    )
    .join('');

  doc.open();
  doc.write(`<!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>فاتورة ${esc(invoice.invoice_number)}</title>
    <style>
      @page { size: ${paperWidth} auto; margin: 4mm; }
      body { font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; width: ${paperWidth === '80mm' ? '72mm' : '50mm'}; margin: 0 auto; color: #0f172a; direction: rtl; }
      .center { text-align: center; }
      .logo { width: 58px; height: 58px; object-fit: contain; margin: 0 auto 6px; display: block; border-radius: 8px; }
      .meta { font-size: ${Math.round(11 * fontMult)}px; line-height: 1.5; border-top: 2px solid ${accent}; border-bottom: 1px dashed #64748b; padding: 6px 0; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      table { width: 100%; border-collapse: collapse; }
      .totals { border-top: 1px solid #0f172a; padding-top: 6px; margin-top: 6px; font-size: ${Math.round(12 * fontMult)}px; }
      .grand { font-size: ${Math.round(15 * fontMult)}px; font-weight: 800; color: ${accent}; border-top: 1px dashed #0f172a; padding-top: 5px; margin-top: 5px; }
      .badge { margin-top: 8px; border: 1.5px solid #0f172a; padding: 4px 6px; text-align: center; font-family: monospace; font-size: 10px; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="center">
      ${design.show_logo && design.logo_url ? `<img src="${esc(design.logo_url)}" class="logo" alt="Logo" />` : ''}
      <div style="font-weight:800; font-size:${Math.round(15 * fontMult)}px; color:${accent};">${esc(design.header_title)}</div>
      ${design.header_subtitle ? `<div style="font-size:${Math.round(10 * fontMult)}px; color:#475569;">${esc(design.header_subtitle)}</div>` : ''}
      ${design.show_support_phone && design.support_phone ? `<div style="font-size:${Math.round(10 * fontMult)}px; color:#0f172a; margin-top:2px;">خدمة العملاء: ${esc(design.support_phone)}</div>` : ''}
    </div>
    <div class="meta">
      <div class="row"><span>رقم الفاتورة:</span><strong>${esc(invoice.invoice_number)}</strong></div>
      <div class="row"><span>التاريخ:</span><span>${esc(String(invoice.created_at).slice(0, 16).replace('T', ' '))}</span></div>
      ${design.show_captain_info ? `<div class="row"><span>الطيار:</span><span>${esc(invoice.captain_name)}</span></div>` : ''}
      ${design.show_captain_info && invoice.captain_phone ? `<div class="row"><span>هاتف الطيار:</span><span>${esc(invoice.captain_phone)}</span></div>` : ''}
      <div class="row"><span>العميل:</span><span>${esc(invoice.customer_name || 'عميل مباشر')}</span></div>
      ${invoice.customer_phone ? `<div class="row"><span>الهاتف:</span><span>${esc(invoice.customer_phone)}</span></div>` : ''}
      ${invoice.order_number ? `<div class="row"><span>مرجع الطلب:</span><span>${esc(invoice.order_number)}</span></div>` : ''}
    </div>
    <table>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>المبلغ الأساسي:</span><span>${Number(invoice.subtotal).toFixed(2)} ج.م</span></div>
      ${invoice.delivery_fee > 0 ? `<div class="row"><span>رسوم التوصيل:</span><span>${Number(invoice.delivery_fee).toFixed(2)} ج.م</span></div>` : ''}
      ${invoice.discount_amount > 0 ? `<div class="row"><span>الخصم:</span><span>-${Number(invoice.discount_amount).toFixed(2)} ج.م</span></div>` : ''}
      <div class="row grand"><span>الصافي المستحق:</span><span>${Number(invoice.total_amount).toFixed(2)} ج.م</span></div>
      <div class="row" style="margin-top:4px; font-size:11px;"><span>طريقة الدفع:</span><span>${invoice.payment_method === 'cash' ? 'نقدي عند التسليم' : esc(invoice.payment_method)}</span></div>
    </div>
    ${design.show_qr_badge ? `<div class="badge">OTLOBHA VERIFIED · ${esc(invoice.invoice_number)}</div>` : ''}
    <div class="center" style="margin-top:10px; font-size:${Math.round(10 * fontMult)}px; border-top:1px dashed #64748b; padding-top:6px;">
      <div>${esc(design.footer_message)}</div>
      ${design.footer_note ? `<div style="color:#64748b; margin-top:2px;">${esc(design.footer_note)}</div>` : ''}
    </div>
  </body>
  </html>`);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => iframe.remove(), 3000);
    }
  }, 250);
}
