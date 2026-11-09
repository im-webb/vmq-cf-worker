import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, QrCode, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyRow, PageHeader, Panel, Pagination, Toolbar } from '@/components/page-shell';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { QrCodeField } from '@/components/qr-code-field';
import { QrcodeBatchDialog } from '@/components/qrcode-batch-dialog';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';

interface QrcodeRow {
  id: number;
  passage_id: number;
  passage_type: number;
  passage_remarks: string;
  price_fen: number;
  price: string;
  pay_url: string;
  ewm_type: number;
  status: number;
  remarks: string;
  create_time: string;
  update_time: string;
}

interface PassageOption {
  id: number;
  type: number;
  status: number;
  remarks: string;
}

interface FormState {
  id: number;
  passage_id: string;
  price: string;
  pay_url: string;
  ewm_type: string;
  status: string;
  remarks: string;
}

const PAY_TYPES: Record<number, string> = {
  1: '微信（wxpay）',
  2: '支付宝（alipay）',
  3: 'QQ（qqpay）',
  4: '数字人民币（rmbpay）',
};

const LIMIT = 20;

function isImageUrl(v: string) {
  return (
    /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|$)/i.test(v) ||
    v.startsWith('data:') ||
    v.startsWith('/upload/')
  );
}

function qrSrc(v: string) {
  return isImageUrl(v) ? v : `/enQrcode?url=${encodeURIComponent(v)}&size=10`;
}

export function QrcodesPage() {
  const qc = useQueryClient();
  const canManage = useMe().data?.role === 1;
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [qr, setQr] = useState<{ src: string; title: string } | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    desc?: string;
    action?: () => Promise<void>;
  }>({ open: false, title: '' });

  const list = useQuery({
    queryKey: ['qrcodes', page],
    queryFn: async () => {
      const r = await api.get<QrcodeRow[]>(`/qrcodes?page=${page}&limit=${LIMIT}`);
      return { rows: r.data ?? [], count: r.count ?? 0 };
    },
  });

  const options = useQuery({
    queryKey: ['passage-options'],
    queryFn: async () => (await api.get<PassageOption[]>('/passages/options')).data ?? [],
    staleTime: 60_000,
  });

  const blank = (): FormState => {
    const first = options.data?.find((x) => x.status === 1) ?? options.data?.[0];
    return {
      id: 0,
      passage_id: first ? String(first.id) : '',
      price: '',
      pay_url: '',
      ewm_type: '0',
      status: '1',
      remarks: '',
    };
  };

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const body = {
        passage_id: f.passage_id,
        price: f.price,
        pay_url: f.pay_url,
        ewm_type: f.ewm_type,
        status: f.status,
        remarks: f.remarks,
      };
      return f.id ? api.put(`/qrcodes/${f.id}`, body) : api.post('/qrcodes', body);
    },
    onSuccess: (r) => {
      toast.success(r.msg || '已保存');
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['qrcodes'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '保存失败'),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: number; status: number }) =>
      api.patch(`/qrcodes/${v.id}/status`, { status: v.status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['qrcodes'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '操作失败'),
  });

  const remove = useMutation({
    mutationFn: (ids: number[]) => api.del('/qrcodes', { ids }),
    onSuccess: (r) => {
      toast.success(r.msg || '已删除');
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ['qrcodes'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '删除失败'),
  });

  const rows = list.data?.rows ?? [];
  const count = list.data?.count ?? 0;
  const optLabel = (pid: number) => {
    const o = (options.data ?? []).find((x) => x.id === pid);
    if (!o) return `#${pid}`;
    return `#${o.id} ${PAY_TYPES[o.type] ?? o.type}${o.remarks ? ` · ${o.remarks}` : ''}${
      o.status === 1 ? '' : '（已停用）'
    }`;
  };

  return (
    <>
      <PageHeader
        title="固定金额码"
        description="按实际分配金额精确命中固定码；未配置时自动回退通道默认无金额码"
        className="mb-4 border-b border-border pb-4"
      />

      <Toolbar>
        {canManage ? (
          <>
            <Button
              size="sm"
              onClick={() => setForm(blank())}
              disabled={!options.data?.length}
              title={options.data?.length ? undefined : '请先在通道管理中创建通道'}
            >
              <Plus /> 新增固定码
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBatchOpen(true)}
              disabled={!options.data?.length}
            >
              <Upload /> 批量添加
            </Button>
          </>
        ) : null}        <Button
          variant="outline"
          size="sm"
          onClick={() => void qc.invalidateQueries({ queryKey: ['qrcodes'] })}
        >
          <RefreshCw className={list.isFetching ? 'animate-spin' : ''} /> 刷新
        </Button>
        {canManage ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={!selected.length}
            onClick={() =>
              setConfirm({
                open: true,
                title: `批量删除 ${selected.length} 条固定码？`,
                desc: '删除后，对应金额将回退使用通道默认无金额码。',
                action: async () => {
                  await remove.mutateAsync(selected);
                },
              })
            }
          >
            <Trash2 /> 批量删除{selected.length ? ` (${selected.length})` : ''}
          </Button>
        ) : null}
      </Toolbar>

      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.length === rows.length}
                  disabled={!canManage}
                  onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                  aria-label="全选"
                />
              </TableHead>
              <TableHead className="w-12">ID</TableHead>
              <TableHead className="w-24">实际金额</TableHead>
              <TableHead>所属通道</TableHead>
              <TableHead className="w-24">码类型</TableHead>
              <TableHead className="w-20">状态</TableHead>
              <TableHead>备注</TableHead>
              <TableHead className="w-40">创建时间</TableHead>
              <TableHead className="sticky right-0 z-10 w-52 border-b border-l border-border bg-card text-right shadow-[-6px_0_8px_-8px_rgba(0,0,0,0.15)]">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <EmptyRow colSpan={9} text="加载中…" />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={9} text="还没有固定金额码；下单会继续使用通道默认码" />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className="group">
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      disabled={!canManage}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                        )
                      }
                      aria-label={`选择 ${r.id}`}
                    />
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{r.id}</TableCell>
                  <TableCell className="font-medium tabular-nums">¥{r.price}</TableCell>
                  <TableCell className="text-sm">{optLabel(r.passage_id)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.ewm_type === 1 ? '图片码' : '二维码文本'}
                  </TableCell>
                  <TableCell>
                    {r.status === 1 ? (
                      <Badge variant="success">启用</Badge>
                    ) : (
                      <Badge variant="muted">停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
                    {r.remarks || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.create_time}</TableCell>
                  <TableCell className="sticky right-0 z-10 border-l border-border bg-card text-right shadow-[-6px_0_8px_-8px_rgba(0,0,0,0.15)] group-hover:bg-muted">
                    <div className={canManage ? 'flex items-center justify-end gap-1' : 'hidden'}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setQr({ src: qrSrc(r.pay_url), title: `固定码 #${r.id} · ¥${r.price}` })}
                      >
                        <QrCode /> 查看
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setForm({
                            id: r.id,
                            passage_id: String(r.passage_id),
                            price: r.price,
                            pay_url: r.pay_url,
                            ewm_type: String(r.ewm_type),
                            status: String(r.status),
                            remarks: r.remarks ?? '',
                          })
                        }
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggle.mutate({ id: r.id, status: r.status === 1 ? 0 : 1 })}
                      >
                        {r.status === 1 ? '停用' : '启用'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pagination page={page} limit={LIMIT} count={count} onPage={setPage} />
      </Panel>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{form?.id ? `编辑固定金额码 #${form.id}` : '新增固定金额码'}</DialogTitle>
          </DialogHeader>
          {form ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>
                    所属通道 <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.passage_id}
                    onValueChange={(v) => setForm({ ...form, passage_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择通道" />
                    </SelectTrigger>
                    <SelectContent>
                      {(options.data ?? []).map((o) => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          #{o.id} {PAY_TYPES[o.type] ?? o.type}
                          {o.remarks ? ` · ${o.remarks}` : ''}
                          {o.status === 1 ? '' : '（已停用）'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price">
                    实际金额（元） <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="price"
                    inputMode="decimal"
                    placeholder="例如 10.00"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </div>
              </div>

              <QrCodeField
                id="fixed-pay-url"
                label="固定金额收款码"
                required
                value={form.pay_url}
                onChange={(v) => setForm({ ...form, pay_url: v, ewm_type: '0' })}
                onImage={(url) => setForm({ ...form, pay_url: url, ewm_type: '1' })}
                placeholder="上传图片自动解码，或粘贴固定金额的二维码内容"
                hint="匹配的是订单分配后的实际金额；未命中时回退通道默认码。"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qr-remarks">备注</Label>
                  <Input
                    id="qr-remarks"
                    placeholder="选填，仅后台可见"
                    value={form.remarks}
                    onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>状态</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">启用</SelectItem>
                      <SelectItem value="0">停用</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                同一通道、同一金额只能配置一条固定码。订单金额被占用时会按系统设置自动加/减
                0.01；因此需要同时准备实际可能出现的金额。
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!form || save.isPending) return;
                save.mutate(form);
              }}
              disabled={save.isPending}
            >
              {save.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QrcodeBatchDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        passages={options.data ?? []}
        onCompleted={() => void qc.invalidateQueries({ queryKey: ['qrcodes'] })}
      />
      <Dialog open={!!qr} onOpenChange={(v) => !v && setQr(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{qr?.title}</DialogTitle>
          </DialogHeader>
          {qr ? (
            <img
              src={qr.src}
              alt={qr.title}
              className="mx-auto rounded-md border border-border bg-white p-2"
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        description={confirm.desc}
        destructive
        busy={remove.isPending}
        onOpenChange={(v) => setConfirm((c) => ({ ...c, open: v }))}
        onConfirm={async () => {
          try {
            await confirm.action?.();
            setConfirm((c) => ({ ...c, open: false }));
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : '操作失败');
          }
        }}
      />
    </>
  );
}