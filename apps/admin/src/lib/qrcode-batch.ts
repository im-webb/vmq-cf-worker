/** 固定金额码批量导入的纯前端解析与校验。 */

export type BatchEwmType = 0 | 1;

export interface BatchImportItem {
  price: string;
  payUrl: string;
  ewmType: BatchEwmType;
  source: string;
}

export interface BatchParseResult {
  items: BatchImportItem[];
  errors: string[];
}

export function isImageAddress(value: string): boolean {
  const v = value.trim();
  return (
    /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(v) ||
    v.startsWith('data:image/') ||
    v.startsWith('/upload/')
  );
}

export function inferEwmType(value: string): BatchEwmType {
  return isImageAddress(value) ? 1 : 0;
}

/** 从 10.00.png、qrcode_10.01.webp、10元.jpg 这类文件名提取金额。 */
export function parseAmountFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const decimal = base.match(/(\d+\.\d{1,2})/);
  if (decimal) return decimal[1];
  const yuan = base.match(/(\d+(?:\.\d{1,2})?)\s*元/);
  if (yuan) return yuan[1];
  const separated = [...base.matchAll(/(?:^|[_-])(\d{1,8})(?=$|[_-])/g)];
  return separated.at(-1)?.[1] ?? '';
}

/** 从二维码载荷的查询参数中识别金额，不猜测无明确字段名的数字。 */
export function parseAmountFromQrContent(value: string): string {
  try {
    const url = new URL(value.trim());
    const keys = ['amount', 'money', 'price', 'total', 'total_fee', 'fee', 'pay_amount'];
    for (const key of keys) {
      const raw = url.searchParams.get(key)?.trim() ?? '';
      if (/^\d+(?:\.\d{1,2})?$/.test(raw) && Number(raw) > 0) {
        return Number(raw).toFixed(2);
      }
    }
  } catch {
    /* 非 URL 二维码内容不处理 */
  }
  return '';
}

/**
 * 给没有金额的行按起始金额和步长自动填充，并避让已有金额。
 * 返回新数组，不修改复核项的其他字段。
 */
export function fillMissingBatchAmounts<T extends BatchImportItem>(
  items: T[],
  startPrice: string,
  stepPrice: string
): T[] {
  const startFen = amountKey(startPrice.trim());
  const stepFen = amountKey(stepPrice.trim());
  if (startFen === null || stepFen === null) return items;

  const used = new Set<number>();
  for (const item of items) {
    const key = amountKey(item.price.trim());
    if (key !== null) used.add(key);
  }

  let cursor = startFen;
  return items.map((item) => {
    if (item.price.trim()) return item;
    while (used.has(cursor)) cursor += stepFen;
    used.add(cursor);
    const price = (cursor / 100).toFixed(2);
    cursor += stepFen;
    return { ...item, price };
  });
}
function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function splitLine(line: string): [string, string] | null {
  const tab = line.indexOf('\t');
  if (tab >= 0) return [line.slice(0, tab), line.slice(tab + 1)];
  const comma = line.indexOf(',');
  if (comma >= 0) return [line.slice(0, comma), line.slice(comma + 1)];
  const pipe = line.indexOf('|');
  if (pipe >= 0) return [line.slice(0, pipe), line.slice(pipe + 1)];
  const space = line.match(/^(\d+(?:\.\d{1,2})?)\s+(.+)$/);
  if (space) return [space[1], space[2]];
  return null;
}

function amountKey(price: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(price)) return null;
  const [integer, decimals = ''] = price.split('.');
  const fen = Number(integer) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(fen) && fen > 0 ? fen : null;
}

export function validateBatchItems(items: BatchImportItem[]): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  items.forEach((item, index) => {
    const price = item.price.trim();
    const key = amountKey(price);
    if (key === null) errors.push(`第 ${index + 1} 行金额格式不正确`);
    else if (seen.has(key)) errors.push(`第 ${index + 1} 行金额重复：${price}`);
    else seen.add(key);
    if (!item.payUrl.trim()) errors.push(`第 ${index + 1} 行缺少收款码`);
  });
  return errors;
}

/**
 * 每行格式：
 *   10.00,https://example.com/qr/10.png
 *   10.01<TAB>wxp://example
 *
 * 支持首行 CSV 表头，自动移除空行和注释。
 */
export function parseBatchText(text: string): BatchParseResult {
  const items: BatchImportItem[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    if (/^(price|money|amount|金额)\s*[,|\t]/i.test(line)) return;

    const fields = splitLine(line);
    if (!fields) {
      errors.push(`第 ${index + 1} 行格式不正确`);
      return;
    }

    const price = stripQuotes(fields[0]);
    let payUrl = stripQuotes(fields[1]);
    if (payUrl.startsWith('=')) payUrl = payUrl.slice(1).trim();
    const key = amountKey(price);
    if (key === null) {
      errors.push(`第 ${index + 1} 行金额格式不正确`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`第 ${index + 1} 行金额重复：${price}`);
      return;
    }
    if (!payUrl) {
      errors.push(`第 ${index + 1} 行缺少收款码`);
      return;
    }
    seen.add(key);
    items.push({
      price,
      payUrl,
      ewmType: inferEwmType(payUrl),
      source: `文本第 ${index + 1} 行`,
    });
  });

  return { items, errors };
}