import jsQR from 'jsqr';
import { createWorker, OEM, PSM } from 'tesseract.js';

type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
type AssetWindow = Window & { __VMQ_ASSET_BASE__?: string };

let workerPromise: Promise<OcrWorker> | null = null;

function ocrBaseUrl(): string {
  const assetBase = (window as AssetWindow).__VMQ_ASSET_BASE__ || '';
  return `${assetBase}/console/ocr`;
}

async function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    const base = ocrBaseUrl();
    workerPromise = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}/worker.min.js`,
      corePath: `${base}/tesseract-core-simd-lstm.js`,
      langPath: base,
      workerBlobURL: false,
      gzip: true,
    })
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789.',
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
        });
        return worker;
      })
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

function parseOcrAmount(text: string): string {
  const normalized = text
    .replace(/[，,￥¥]/g, '')
    .replace(/[．。]/g, '.')
    .replace(/\s+/g, '');
  const matches = [...normalized.matchAll(/(\d{0,8}\.\d{1,2})/g)];
  const raw = matches.at(-1)?.[1];
  if (!raw) return '';
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : '';
}

/**
 * 固定金额收款图通常把金额放在二维码正上方。
 * 先定位二维码，再裁出上方一条较宽的金额带，并只取其中明确的十进制金额。
 */
export async function recognizeAmountFromImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return '';

  try {
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const qr = jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' });
    const location = qr?.location;
    if (!location) return '';

    const xs = [
      location.topLeftCorner.x,
      location.topRightCorner.x,
      location.bottomLeftCorner.x,
      location.bottomRightCorner.x,
    ];
    const ys = [
      location.topLeftCorner.y,
      location.topRightCorner.y,
      location.bottomLeftCorner.y,
      location.bottomRightCorner.y,
    ];
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const qrWidth = x1 - x0;
    if (qrWidth < 40) return '';

    // 不同平台在二维码上方留白差异很大；取较宽的金额带，再只解析其中的数字。
    const cropHeight = Math.max(1, Math.ceil(qrWidth * 0.65));
    const left = Math.max(0, Math.floor(x0 - qrWidth * 0.25));
    const top = Math.max(0, Math.floor(y0 - cropHeight - qrWidth * 0.015));
    const cropWidth = Math.min(width - left, Math.ceil(qrWidth * 1.5));
    const actualCropHeight = Math.min(height - top, cropHeight);
    if (cropWidth <= 0 || actualCropHeight <= 0) return '';

    const crop = document.createElement('canvas');
    crop.width = cropWidth * 2;
    crop.height = actualCropHeight * 2;
    const cropCtx = crop.getContext('2d', { willReadFrequently: true });
    if (!cropCtx) return '';
    cropCtx.imageSmoothingEnabled = true;
    cropCtx.drawImage(canvas, left, top, cropWidth, actualCropHeight, 0, 0, crop.width, crop.height);

    const pixels = cropCtx.getImageData(0, 0, crop.width, crop.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114;
      const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
      pixels.data[i] = boosted;
      pixels.data[i + 1] = boosted;
      pixels.data[i + 2] = boosted;
    }
    cropCtx.putImageData(pixels, 0, 0);

    const worker = await getWorker();
    const { data } = await worker.recognize(crop);
    return parseOcrAmount(String(data.text ?? ''));
  } catch (error) {
    console.error('OCR amount recognition failed', error);
    return '';
  } finally {
    bitmap.close?.();
  }
}

export async function terminateAmountOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const current = workerPromise;
  workerPromise = null;
  try {
    const worker = await current;
    await worker.terminate();
  } catch {
    /* worker 初始化失败时无需再次处理 */
  }
}
