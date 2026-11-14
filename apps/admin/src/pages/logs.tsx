import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eraser, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';

interface LogRow {
  id: number;
  uid: number;
  username: string;
  content: string;
  ip: string;
  create_time: string;
}
interface AdminOption {
  id: number;
  username: string;
}

const LIMIT = 30;

export function LogsPage() {
  const qc = useQueryClient();
  const canManage = useMe().data?.role === 1;
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [confirm, setConfirm] = useState<{ open: boolean; days: number }>({ open: false, days: 7 });

  const logs = useQuery({
    queryKey: ['logs', page, role],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (role) qs.set('role', role);
      const r = await api.get<LogRow[]>(`/logs?${qs.toString()}`);
      return { rows: r.data ?? [], count: r.count ?? 0 };
    },
  });

  const admins = useQuery({
    queryKey: ['admin-options'],
    queryFn: async () => (await api.get<AdminOption[]>('/admins?page=1&limit=200')).data ?? [],
    staleTime: 60_000,
  });

  const clear = useMutation({
    mutationFn: (days: number) => api.del(`/logs?days=${days}`),
    onSuccess: (r) => {
      toast.success(r.msg || '已清理');
      void qc.invalidateQueries({ queryKey: ['logs'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '清理失败'),
  });

  const rows = logs.data?.rows ?? [];
  const count = logs.data?.count ?? 0;

  return (
    <>
      <PageHeader
        title="操作日志"
        description="登录、补单、改配置等动作都会记一条"
        className="mb-4 border-b border-border pb-4"
      />

      <Toolbar className="mb-3 border-b border-border pb-3">
        <Select
          value={role || 'all'}
          onValueChange={(v) => {
            setPage(1);
            setRole(v === 'all' ? '' : v);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="操作人" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部操作人</SelectItem>
            <SelectItem value="0">system</SelectItem>
            <SelectItem value="-1">tourist</SelectItem>
            {(admins.data ?? []).map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Toolbar>

      {/* 操作行：搜索条件之外的动作，跟着表格走 */}
      <Toolbar>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void qc.invalidateQueries({ queryKey: ['logs'] })}
        >
          <RefreshCw className={logs.isFetching ? 'animate-spin' : ''} /> 刷新
        </Button>
        {canManage ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirm({ open: true, days: 7 })}
          >
            <Eraser /> 清理 7 天前
          </Button>
        ) : null}
      </Toolbar>

      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">ID</TableHead>
              <TableHead className="w-32">操作人</TableHead>
              <TableHead>内容</TableHead>
              <TableHead className="w-36">IP</TableHead>
              <TableHead className="w-44">时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.isLoading ? (
              <EmptyRow colSpan={5} text="加载中…" />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={5} />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{r.id}</TableCell>
                  <TableCell className="text-sm">{r.username}</TableCell>
                  <TableCell>{r.content}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.ip || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.create_time}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Pagination page={page} limit={LIMIT} count={count} onPage={setPage} />
      </Panel>

      <ConfirmDialog
        open={confirm.open}
        title={`清理 ${confirm.days} 天前的日志？`}
        description="该操作不可恢复。"
        destructive
        busy={clear.isPending}
        onOpenChange={(v) => setConfirm((c) => ({ ...c, open: v }))}
        onConfirm={async () => {
          try {
            await clear.mutateAsync(confirm.days);
            setConfirm((c) => ({ ...c, open: false }));
          } catch {
            /* toast 已在 mutation 里 */
          }
        }}
      />
    </>
  );
}
