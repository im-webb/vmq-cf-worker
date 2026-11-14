import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PasswordInput } from '@/components/ui/password-input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-shell';
import { api, ApiError } from '@/lib/api';

interface ConfigPayload {
  config: Record<string, string>;
  /** 用户没填过时的默认值（目前只有支付网关地址 = 本站域名） */
  defaults?: Record<string, string>;
  /** 密钥只返回是否已配置，不回传明文 */
  secretSet?: Record<string, boolean>;
}

interface ConfigField {
  name: string;
  label: string;
  hint?: string;
  /** 留空保存 = 保持不变（提交时空值会被跳过，避免误清空）。 */
  secret?: boolean;
  full?: boolean;
}

interface ConfigGroup {
  id: string;
  title: string;
  fields: ConfigField[];
}

/** 配置分组：按使用场景拆成三组，一组一个 tab、各自独立保存 */
const GROUPS: ConfigGroup[] = [
  {
    id: 'site',
    title: '站点信息',
    fields: [
      { name: 'title', label: '站点名称' },
      { name: 'url', label: '站点地址', hint: '含协议，如 https://pay.example.com' },
      { name: 'resource_url', label: '静态资源地址', hint: '所有 JS/CSS/图片的资源根地址（含协议，末尾不带斜杠）。留空则用本站相对路径。填 CDN 后需把 site/、console/、static/ 三个目录平铺上传到该地址下。' },
      { name: 'keywords', label: '关键词' },
      { name: 'description', label: '描述', full: true },
      { name: 'footer', label: '页脚', full: true },
    ],
  },
  {
    id: 'trade',
    title: '交易设置',
    fields: [
      { name: 'order_timeout', label: '订单超时（分钟）' },
      { name: 'home_url', label: '支付完成跳转' },
      { name: 'timeout_url', label: '超时跳转' },
    ],
  },
  {
    id: 'secret',
    title: '密钥管理',
    fields: [
      {
        name: 'key',
        label: '通讯密钥',
        secret: true,
        hint: '监控端 App 和商户下单共用这一把：App 的心跳/推送、商户下单与回调验签都用它。安装时自动生成 32 位，可直接复制；改动前请先同步 App 与商户，否则验签会全部失败。',
      },
      {
        name: 'epaykey_ali',
        label: '商户密钥（易支付）',
        secret: true,
        hint: '历史兼容项，仅当上面的通讯密钥为空时才生效（取值顺序 app_key → key → epaykey_ali）。本站不主动对接易支付网关，一般留空即可。',
      },
      {
        name: 'epayid_ali',
        label: '商户 ID',
        hint: '安装时自动生成（10 位数字）。商户下单时必须带上，会随订单记录并原样写进回调；本站不做比对，但改了要和商户端的 PID 一起改。',
      },
      {
        name: 'epayurl_ali',
        label: '支付网关地址',
        hint: '安装时自动填成本站地址（含协议），商户接入时按它填网关；本站不会主动请求这个地址。',
      },
    ],
  },
];

export function ConfigPage() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<{
    key: string;
    label: string;
    password: string;
    value: string;
    busy: boolean;
  } | null>(null);

  const cfg = useQuery({
    queryKey: ['config'],
    queryFn: async () => (await api.get<ConfigPayload>('/config')).data,
  });

  useEffect(() => {
    if (!cfg.data) return;
    // 用库里已有值打底；用户没填过的（支付网关地址）补上后端给的默认值
    const next: Record<string, string> = { ...cfg.data.config };
    for (const [k, v] of Object.entries(cfg.data.defaults ?? {})) {
      if (!next[k]) next[k] = v;
    }
    setValues(next);
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: (v: Record<string, string>) => api.put('/config', v),
    onSuccess: (r) => {
      toast.success(r.msg || '已保存');
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '保存失败'),
  });

  /** 只提交当前 tab 的字段；密钥留空不提交（后端也按「留空不改」处理） */
  async function revealSecret() {
    if (!reveal || reveal.busy) return;
    setReveal({ ...reveal, busy: true });
    try {
      const r = await api.post<{ key: string; value: string }>('/config/secret/reveal', {
        key: reveal.key,
        password: reveal.password,
      });
      setReveal({ ...reveal, busy: false, value: r.data?.value ?? '' });
    } catch (e) {
      setReveal({ ...reveal, busy: false });
      toast.error(e instanceof ApiError ? e.message : '查看失败');
    }
  }

  function submit(g: ConfigGroup) {
    // 连点保护：disabled 要下一帧才生效，同一帧内的重复点击会并发提交
    if (save.isPending) return;
    const body: Record<string, string> = {};
    for (const f of g.fields) {
      const v = (values[f.name] ?? '').trim();
      if (f.secret && !v) continue;
      body[f.name] = v;
    }
    save.mutate(body);
  }


  return (
    <>
      <PageHeader
        title="系统配置"
        description="分组保存，改完点「保存」立即生效；密钥类留空表示保持原值"
        className="mb-4 border-b border-border pb-4"
      />

      <Tabs defaultValue={GROUPS[0]?.id}>
        <TabsList>
          {GROUPS.map((g) => (
            <TabsTrigger key={g.id} value={g.id}>
              {g.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {GROUPS.map((g) => (
          <TabsContent key={g.id} value={g.id}>
            <Card>
              <CardHeader>
                <CardTitle>{g.title}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {g.fields.map((f) => (
                  <div key={f.name} className={f.full ? 'col-span-2 space-y-1.5' : 'space-y-1.5'}>
                    <Label htmlFor={f.name}>{f.label}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={f.name}
                        type={f.secret ? 'password' : 'text'}
                        value={values[f.name] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                        placeholder={f.secret ? '输入新值；留空保存表示不修改' : undefined}
                      />
                      {f.secret && cfg.data?.secretSet?.[f.name] ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setReveal({ key: f.name, label: f.label, password: '', value: '', busy: false })
                          }
                        >
                          查看当前值
                        </Button>
                      ) : null}
                    </div>
                    {f.secret ? (
                      <p className="text-xs text-muted-foreground">
                        {cfg.data?.secretSet?.[f.name] ? '已配置。' : '尚未配置。'}
                        查看明文需要再次输入当前账号密码，并会记录操作日志。
                      </p>
                    ) : null}
                    {f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
                  </div>
                ))}
              </CardContent>
              <div className="flex items-center gap-3 border-t border-border p-4">
                <Button size="sm" onClick={() => submit(g)} disabled={save.isPending || cfg.isLoading}>
                  <Save /> {save.isPending ? '保存中…' : '保存'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  只提交「{g.title}」这一组，其它设置不受影响
                </p>
              </div>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!reveal} onOpenChange={(open) => !open && setReveal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>查看{reveal?.label ?? '密钥'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reveal-password">当前账号密码</Label>
              <PasswordInput
                id="reveal-password"
                value={reveal?.password ?? ''}
                onChange={(e) => reveal && setReveal({ ...reveal, password: e.target.value, value: '' })}
                autoComplete="current-password"
              />
            </div>
            {reveal?.value ? (
              <div className="space-y-1.5">
                <Label htmlFor="reveal-value">当前密钥</Label>
                <Input id="reveal-value" readOnly value={reveal.value} className="font-mono" />
                <p className="text-xs text-destructive">请勿通过聊天、截图或工单发送此值。</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReveal(null)} disabled={reveal?.busy}>
              关闭
            </Button>
            <Button onClick={() => void revealSecret()} disabled={!reveal?.password || reveal?.busy}>
              {reveal?.busy ? '验证中…' : '验证并查看'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
