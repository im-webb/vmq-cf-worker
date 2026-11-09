import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyRow, PageHeader, Panel, Pagination, Toolbar } from '@/components/page-shell';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateRangePicker } from '@/components/date-range-picker';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';

interface OrderRow {
  id: number;
  pid: number;
  order_id: string;
  out_trade_no: string;
  name: string;
  type: string;
  money: string;
  truemoney: string;
  status: number;
  create_time: string;
  pay_time: string;
  notify_attempts: number;
}

const STATUS = [
  { value: '0', label: '待支付', variant: 'warning' as const },
  { value: '1', label: '已支付', variant: 'success' as const },
  { value: '2', label: '回调失败', variant: 'danger' as const },
  { value: '3', label: '已过期', variant: 'muted' as const },
];

const PAY_TYPES = [
  { value: '1', label: '微信（wxpay）' },
  { value: '2', label: '支付宝（alipay）' },
  { value: '3', label: 'QQ（qqpay）' },
  { value: '4', label: '数字人民币（rmbpay）' },
];

const LIMIT = 20;

export function OrdersPage() {
  const qc = useQueryClient();
  const canManage = useMe().data?.role === 1;
  const [page, setPage] = useState(1);
  // 与旧版一致：条件先填，点「搜索」才生效
  const EMPTY_FILTERS = { keyword: '', status: '', type: '', start: '', end: '' };
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirm, setConfirm] = useState<{ open: boolean; title: string; desc?: string; action?: () => Promise<void> }>({
    open: false,
    title: '',
  });

  const query = useQuery({
    queryKey: ['orders', page, filters],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      const r = await api.get<OrderRow[]>(`/orders?${qs.toString()}`);
      return { rows: r.data ?? [], count: r.count ?? 0 };
    },
  });

  function refresh() {
    setSelected([]);
    void qc.invalidateQueries({ queryKey: ['orders'] });
  }

  const notify = useMutation({
    mutationFn: (id: number) => api.post(`/orders/${id}/notify`),
    onSuccess: (r) => {
      toast.success(r.msg || '已重新通知');
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '补单失败'),
  });

  const remove = useMutation({
    mutationFn: (ids: number[]) => api.del('/orders', { ids }),
    onSuccess: (r) => {
      toast.success(r.msg || '已删除');
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '删除失败'),
  });

  const rows = query.data?.rows ?? [];
  const count = query.data?.count ?? 0;
  const allChecked = rows.length > 0 && selected.length === rows.length;

  return (
    <>
      <PageHeader
        title="订单管理"
        description="按订单号筛选；订单号支持本系统单号、商户单号与商品名的模糊匹配"
        className="mb-4 border-b border-border pb-4"
      />

      <Toolbar className="mb-3 border-b border-border pb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">时间范围</span>
          <DateRangePicker
            value={{ start: draft.start, end: draft.end }}
            onChange={(v) => setDraft((d) => ({ ...d, start: v.start, end: v.end }))}
          />
        </div>

        <Select value={draft.type || 'all'} onValueChange={(v) => setDraft((d) => ({ ...d, type: v === 'all' ? '' : v }))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="支付模式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部支付模式</SelectItem>
            {PAY_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          className="w-52"
          placeholder="订单号 / 商户单号 / 商品名"
          value={draft.keyword}
          onChange={(e) => setDraft((d) => ({ ...d, keyword: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPage(1);
              setFilters(draft);
            }
          }}
        />

        <Select value={draft.status || 'all'} onValueChange={(v) => setDraft((d) => ({ ...d, status: v === 'all' ? '' : v }))}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {STATUS.map((st) => (
              <SelectItem key={st.value} value={st.value}>
                {st.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={() => {
            setPage(1);
            setFilters(draft);
          }}
        >
          <Search /> 搜索
        </Button>
      </Toolbar>

      {/* 操作行：搜索条件之外的动作，跟着表格走 */}
      <Toolbar>
        <Button variant="outline" size="sm" onClick={refresh} disabled={query.isFetching}>
          <RefreshCw className={query.isFetching ? 'animate-spin' : ''} /> 刷新
        </Button>
        {canManage ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={!selected.length}
            title={selected.length ? undefined : '先在下方列表勾选要删除的订单'}
            onClick={() =>
              setConfirm({
                open: true,
                title: `批量删除 ${selected.length} 笔订单？`,
                desc: '删除后不可恢复，商户侧记录不受影响。',
                action: async () => {
                  await remove.mutateAsync(selected);
                },
              })
            }
          >
            <Trash2 /> 批量删除{selected.length ? ` (${selected.length})` : ''}
          </Button>
        ) : null}
        {selected.length ? (
          <span className="text-sm text-muted-foreground">已选 {selected.length} 笔</span>
        ) : null}
      </Toolbar>

      <Panel>
        <Table className="min-w-[1320px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  disabled={!canManage}
                  onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                  aria-label="全选"
                />
              </TableHead>
              <TableHead className="w-14">ID</TableHead>
              <TableHead className="w-20">通道ID</TableHead>
              <TableHead>订单号</TableHead>
              <TableHead>商户订单号</TableHead>
              <TableHead>商品名称</TableHead>
              <TableHead>支付方式</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead className="whitespace-nowrap text-right">实付金额</TableHead>
                <TableHead>状态</TableHead>
              <TableHead>添加时间</TableHead>
              <TableHead>支付时间</TableHead>
              <TableHead className="sticky right-0 z-10 w-32 border-b border-l border-border bg-card text-right shadow-[-6px_0_8px_-8px_rgba(0,0,0,0.15)]">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              <EmptyRow colSpan={13} text="加载中…" />
            ) : query.error ? (
              <EmptyRow colSpan={13} text={`加载失败：${String(query.error)}`} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={13} />
            ) : (
              rows.map((r) => {
                const st = STATUS.find((x) => x.value === String(r.status));
                return (
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
                        aria-label={`选择 ${r.order_id}`}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{r.id}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{r.pid ?? '—'}</TableCell>
                    <TableCell className="max-w-48">
                      <div className="truncate font-mono text-xs" title={r.order_id}>
                        {r.order_id}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-52">
                      <div className="truncate font-mono text-xs" title={r.out_trade_no}>
                        {r.out_trade_no}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-40 truncate" title={r.name}>
                      {r.name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.type}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.money}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.truemoney}</TableCell>
                    <TableCell>
                      <Badge variant={st?.variant ?? 'muted'}>{st?.label ?? r.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.create_time}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {r.pay_time || '—'}
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 border-l border-border bg-card text-right shadow-[-6px_0_8px_-8px_rgba(0,0,0,0.15)] group-hover:bg-muted">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={r.status === 0 || notify.isPending}
                          title={
                            r.status === 0
                              ? '待支付订单无需补单'
                              : '把订单重新入队并立刻投递一次回调'
                          }
                          onClick={() =>
                            setConfirm({
                              open: true,
                              title: '重新通知商户？',
                              desc: `订单 ${r.order_id} 会重新入队并立刻投递一次回调。`,
                              action: async () => {
                                await notify.mutateAsync(r.id);
                              },
                            })
                          }
                        >
                          <RefreshCw /> 补单
                        </Button>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            title="删除该订单"
                            disabled={remove.isPending}
                            onClick={() =>
                              setConfirm({
                                open: true,
                                title: '删除这笔订单？',
                                desc: `订单 ${r.order_id}（${r.money} 元）将被删除，不可恢复；商户侧记录不受影响。`,
                                action: async () => {
                                  await remove.mutateAsync([r.id]);
                                },
                              })
                            }
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <Pagination page={page} limit={LIMIT} count={count} onPage={setPage} />
      </Panel>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        description={confirm.desc}
        destructive={confirm.title.includes('删除')}
        busy={notify.isPending || remove.isPending}
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
