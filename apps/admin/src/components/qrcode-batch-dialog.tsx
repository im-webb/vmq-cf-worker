import { useEffect, useRef, useState } from 'react';
import { FileUp, ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError, uploadImage } from '@/lib/api';
import { recognizeAmountFromImage, terminateAmountOcrWorker } from '@/lib/image-amount-ocr';
import { decodeQrFile } from '@/lib/qr-decode';
import {
  fillMissingBatchAmounts,
  isImageAddress,
  parseAmountFromFilename,
  parseAmountFromQrContent,
  parseBatchText,
  validateBatchItems,
  type BatchImportItem,
} from '@/lib/qrcode-batch';

interface PassageOption {
  id: number;
  type: number;
  status: number;
  remarks: string;
}

interface BatchRow extends BatchImportItem {
  id: string;
  previewUrl?: string;
  objectUrl?: boolean;
}

const PAY_TYPES: Record<number, string> = {
  1: '微信（wxpay）',
  2: '支付宝（alipay）',
  3: 'QQ（qqpay）',
  4: '数字人民币（rmbpay）',
};

const MAX_ROWS = 200;
const MAX_IMAGE = Math.floor(1.4 * 1024 * 1024);

export function QrcodeBatchDialog({
  open,
  onOpenChange,
  passages,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passages: PassageOption[];
  onCompleted: () => void;
}) {
  const [tab, setTab] = useState('text');
  const [passageId, setPassageId] = useState('');
  const [status, setStatus] = useState('1');
  const [remarks, setRemarks] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [imageMode, setImageMode] = useState<'decode' | 'image'>('decode');
  const [fallbackStart, setFallbackStart] = useState('0.10');
  const [fallbackStep, setFallbackStep] = useState('0.01');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [preview, setPreview] = useState<{ src: string; title: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const objectUrls = useRef<Set<string>>(new Set());

  const nextId = () => `${Date.now()}-${++seq.current}`;

  function revokeAllObjectUrls() {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }

  function previewOf(row: BatchRow) {
    if (row.previewUrl) return row.previewUrl;
    if (row.ewmType === 1 && isImageAddress(row.payUrl)) return row.payUrl;
    return row.payUrl ? `/enQrcode?url=${encodeURIComponent(row.payUrl)}&size=8` : '';
  }

  function removeRow(id: string) {
    setRows((prev) => {
      const target = prev.find((row) => row.id === id);
      if (target?.objectUrl && target.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrls.current.delete(target.previewUrl);
      }
      return prev.filter((row) => row.id !== id);
    });
  }

  function clearRows() {
    revokeAllObjectUrls();
    setRows([]);
    setErrors([]);
  }

  function applyAmountRule() {
    const before = rows.filter((row) => !row.price.trim()).length;
    if (!before) {
      toast.error('当前没有空白金额需要填充');
      return;
    }
    const filled = fillMissingBatchAmounts(rows, fallbackStart, fallbackStep);
    setRows(filled);
    setErrors([]);
    const after = filled.filter((row) => !row.price.trim()).length;
    toast.success(after ? `已填充 ${before - after} 条，仍有 ${after} 条需检查` : `已填充 ${before} 条`);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      revokeAllObjectUrls();
      void terminateAmountOcrWorker();
      setPreview(null);
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open) return;
    revokeAllObjectUrls();
    const first = passages.find((p) => p.status === 1) ?? passages[0];
    setTab('text');
    setPassageId(first ? String(first.id) : '');
    setStatus('1');
    setRemarks('');
    setText('');
    setRows([]);
    setErrors([]);
    setImageMode('decode');
    setFallbackStart('0.10');
    setFallbackStep('0.01');
    setBusy(false);
    setBusyLabel('');
  }, [open, passages]);

  useEffect(() => () => {
    revokeAllObjectUrls();
    void terminateAmountOcrWorker();
  }, []);

  function updateRow(id: string, patch: Partial<BatchRow>) {
    setErrors([]);
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function parseTextRows() {
    const result = parseBatchText(text);
    const next = result.items.map((item) => ({ ...item, id: nextId() }));
    setRows((prev) => [...prev, ...next].slice(0, MAX_ROWS));
    setErrors(result.errors);
    if (next.length) toast.success(`已加入 ${next.length} 条，请人工复核金额`);
    else toast.error('没有解析到有效数据');
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const remaining = MAX_ROWS - rows.length;
    if (remaining <= 0) {
      toast.error(`一次最多导入 ${MAX_ROWS} 条`);
      return;
    }

    const picked = Array.from(files).slice(0, remaining);
    const next: BatchRow[] = [];
    const nextErrors: string[] = [];
    setBusy(true);
    try {
      for (let i = 0; i < picked.length; i++) {
        const file = picked[i];
        setBusyLabel(`处理图片 ${i + 1}/${picked.length}`);
        if (file.size > MAX_IMAGE) {
          nextErrors.push(`${file.name}：图片不能超过 1.4MB`);
          continue;
        }
        try {
          let payUrl = '';
          let ewmType: 0 | 1 = 0;
          let previewUrl = '';
          let objectUrl = false;
          if (imageMode === 'decode') {
            payUrl = (await decodeQrFile(file)) ?? '';
            if (!payUrl) throw new Error('未识别出二维码');
            previewUrl = URL.createObjectURL(file);
            objectUrls.current.add(previewUrl);
            objectUrl = true;
          } else {
            payUrl = await uploadImage(file);
            ewmType = 1;
            previewUrl = payUrl;
          }
          let price = parseAmountFromFilename(file.name) || parseAmountFromQrContent(payUrl);
          if (!price) {
            setBusyLabel(`识别图片金额 ${i + 1}/${picked.length}`);
            price = await recognizeAmountFromImage(file);
          }
          next.push({
            id: nextId(),
            price,
            payUrl,
            ewmType,
            source: file.name,
            previewUrl,
            objectUrl,
          });
        } catch (error) {
          nextErrors.push(`${file.name}：${error instanceof Error ? error.message : '处理失败'}`);
        }
      }
    } finally {
      setBusy(false);
      setBusyLabel('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }

    if (next.length) {
      setRows((prev) => [...prev, ...next].slice(0, MAX_ROWS));
      const recognized = next.filter((row) => row.price.trim()).length;
      toast.success(`已加入 ${next.length} 张图片，自动识别 ${recognized} 个金额，请复核`);
    }
    if (nextErrors.length) {
      setErrors(nextErrors);
      toast.error(`${nextErrors.length} 张图片处理失败`);
    } else {
      setErrors([]);
    }
  }

  async function submit() {
    if (!passageId) {
      toast.error('请选择所属通道');
      return;
    }

    let currentRows = rows;
    if (!currentRows.length && tab === 'text' && text.trim()) {
      const parsed = parseBatchText(text);
      currentRows = parsed.items.map((item) => ({ ...item, id: nextId() }));
      setRows(currentRows);
      setErrors(parsed.errors);
    }
    if (!currentRows.length) {
      toast.error('没有可导入的数据');
      return;
    }

    const validation = validateBatchItems(currentRows);
    if (validation.length) {
      setErrors(validation);
      toast.error('请先修正复核列表中的错误');
      return;
    }

    setBusy(true);
    setBusyLabel('批量写入中');
    try {
      const result = await api.post<{ inserted: number }>('/qrcodes/batch', {
        passage_id: passageId,
        status,
        remarks,
        items: currentRows.map((row) => ({
          price: row.price.trim(),
          pay_url: row.payUrl,
          ewm_type: row.ewmType,
        })),
      });
      toast.success(result.msg || '批量添加成功');
      onCompleted();
      handleOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '批量添加失败');
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }

  const readyCount = rows.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>批量添加固定金额码</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>
              所属通道 <span className="text-destructive">*</span>
            </Label>
            <Select value={passageId} onValueChange={setPassageId}>
              <SelectTrigger>
                <SelectValue placeholder="选择通道" />
              </SelectTrigger>
              <SelectContent>
                {passages.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    #{p.id} {PAY_TYPES[p.type] ?? p.type}
                    {p.remarks ? ` · ${p.remarks}` : ''}
                    {p.status === 1 ? '' : '（已停用）'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>导入后状态</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">启用</SelectItem>
                <SelectItem value="0">停用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="batch-remarks">备注</Label>
            <Input
              id="batch-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="选填，应用到本批全部记录"
            />
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">
              <FileUp className="mr-1 size-4" /> 金额 + 地址
            </TabsTrigger>
            <TabsTrigger value="images">
              <ImagePlus className="mr-1 size-4" /> 批量图片
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            <div className="space-y-2">
              <Label htmlFor="batch-text">每行一条，金额和二维码内容/图片地址用逗号或 Tab 分隔</Label>
              <textarea
                id="batch-text"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={'10.00,https://example.com/qr/10.png\n10.01,wxp://example'}
              />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={parseTextRows} disabled={busy || !text.trim()}>
                  <Upload /> 解析并加入复核
                </Button>
                <p className="text-xs text-muted-foreground">最多 200 条；图片地址会自动识别为图片码。</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="images">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                <div className="space-y-1.5">
                  <Label>图片处理方式</Label>
                  <Select
                    value={imageMode}
                    onValueChange={(v) => setImageMode(v === 'image' ? 'image' : 'decode')}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="decode">解码二维码文本</SelectItem>
                      <SelectItem value="image">保留图片并上传</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                  先尝试从文件名和二维码参数识别；仍未识别时会自动对二维码上方的金额文字做 OCR。
                  OCR 失败的行保持空白，可再手动点击下方规则填充。
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[160px_160px_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor="fallback-start">兜底起始金额</Label>
                  <Input
                    id="fallback-start"
                    value={fallbackStart}
                    inputMode="decimal"
                    onChange={(e) => setFallbackStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fallback-step">递增步长</Label>
                  <Input
                    id="fallback-step"
                    value={fallbackStep}
                    inputMode="decimal"
                    onChange={(e) => setFallbackStep(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button variant="outline" onClick={applyAmountRule} disabled={busy || !rows.length}>
                    按规则填充空白金额
                  </Button>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(e) => void addImages(e.target.files)}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                {busy ? busyLabel || '处理中…' : '选择多张图片'}
              </Button>
              <p className="text-xs text-muted-foreground">
                单张不超过 1.4MB。解码模式不会上传原图；保留图片模式会存入现有 uploads 表。
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">人工复核</p>
              <p className="text-xs text-muted-foreground">
                已准备 {readyCount} 条；提交前请核对金额、码类型和来源文件。
              </p>
            </div>
            {rows.length ? (
              <Button variant="ghost" size="sm" onClick={clearRows}>
                <Trash2 /> 清空
              </Button>
            ) : null}
          </div>

          <div className="max-h-72 overflow-auto rounded-md border border-border">
            {rows.length ? (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-28 px-3 py-2">金额</th>
                    <th className="w-16 px-2 py-2">预览</th>
                    <th className="w-28 px-2 py-2">码类型</th>
                    <th className="px-2 py-2">来源</th>
                    <th className="w-12 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const invalid = !!row.price.trim() && !/^\d+(?:\.\d{1,2})?$/.test(row.price.trim());

                    return (
                      <tr key={row.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <Input
                            value={row.price}
                            inputMode="decimal"
                            aria-invalid={invalid}
                            placeholder="金额"
                            onChange={(e) => updateRow(row.id, { price: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {previewOf(row) ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPreview({
                                  src: previewOf(row),
                                  title: `第 ${index + 1} 条收款码预览`,
                                })
                              }
                              className="block size-12 overflow-hidden rounded border border-border bg-white"
                              aria-label={`预览第 ${index + 1} 条收款码`}
                              title="点击放大预览"
                            >
                              <img
                                src={previewOf(row)}
                                alt={`第 ${index + 1} 条收款码预览`}
                                className="size-full object-contain"
                              />
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Select
                            value={String(row.ewmType)}
                            onValueChange={(v) => updateRow(row.id, { ewmType: v === '1' ? 1 : 0 })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">二维码文本</SelectItem>
                              <SelectItem value="1">图片地址</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="max-w-0 px-2 py-2 text-xs text-muted-foreground">
                          <span className="block truncate" title={row.source}>
                            {index + 1}. {row.source}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`移除第 ${index + 1} 条`}
                            onClick={() => removeRow(row.id)}
                          >
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                解析文本或选择图片后，在这里逐条复核
              </p>
            )}
          </div>

          {errors.length ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {errors.slice(0, 6).map((error) => <p key={error}>{error}</p>)}
              {errors.length > 6 ? <p>另有 {errors.length - 6} 条错误…</p> : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !rows.length}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {busy ? busyLabel || '处理中…' : `批量添加 ${rows.length ? `(${rows.length})` : ''}`}
          </Button>
        </DialogFooter>

        <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
          <DialogContent className="sm:max-w-[720px]">
            <DialogHeader>
              <DialogTitle>{preview?.title}</DialogTitle>
            </DialogHeader>
            {preview ? (
              <img
                src={preview.src}
                alt={preview.title}
                className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md border border-border bg-white object-contain p-2"
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
