import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-shell';
import { ImageUpload } from '@/components/image-upload';
import { api, ApiError } from '@/lib/api';

interface Profile {
  id: number;
  username: string;
  head_img: string;
  status: number;
}

export function ProfilePage() {
  const qc = useQueryClient();
  // 手机 / 邮箱字段已整块下线，个人资料只剩头像
  const [form, setForm] = useState({ head_img: '' });
  const [pw, setPw] = useState({ password: '', password_again: '' });

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: async () => (await api.get<Profile>('/profile')).data,
  });

  useEffect(() => {
    if (profile.data) setForm({ head_img: profile.data.head_img ?? '' });
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => api.put('/profile', form),
    onSuccess: (r) => {
      toast.success(r.msg || '已保存');
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '保存失败'),
  });

  const changePw = useMutation({
    mutationFn: () => api.put('/profile/password', pw),
    onSuccess: (r) => {
      toast.success(r.msg || '密码已修改，请重新登录');
      setPw({ password: '', password_again: '' });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '修改失败'),
  });

  return (
    <>
      <PageHeader
        title="个人资料"
        description="当前登录账号的信息与密码"
        className="mb-4 border-b border-border pb-4"
      />

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">基本信息</TabsTrigger>
          <TabsTrigger value="password">修改密码</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>账号</Label>
                <Input value={profile.data?.username ?? ''} disabled />
                <p className="text-xs text-muted-foreground">账号名不可修改</p>
              </div>

              <div className="space-y-1.5">
                <Label>头像</Label>
                <ImageUpload
                  value={form.head_img}
                  onChange={(url) => setForm({ head_img: url })}
                  size="lg"
                />
                <p className="text-xs text-muted-foreground">
                  上传后会显示在左侧边栏底部的账号位置
                </p>
              </div>

              <Button
                onClick={() => {
                  if (!save.isPending) save.mutate();
                }}
                disabled={save.isPending}
              >
                <Save /> {save.isPending ? '保存中…' : '保存'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="password">
          <Card>
            <CardHeader>
              <CardTitle>修改密码</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pw1">新密码</Label>
                <PasswordInput
                  id="pw1"
                  autoComplete="new-password"
                  value={pw.password}
                  onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">至少 8 位</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw2">确认新密码</Label>
                <PasswordInput
                  id="pw2"
                  autoComplete="new-password"
                  value={pw.password_again}
                  onChange={(e) => setPw((p) => ({ ...p, password_again: e.target.value }))}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => changePw.mutate()}
                disabled={changePw.isPending || !pw.password}
              >
                <KeyRound /> {changePw.isPending ? '提交中…' : '修改密码'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
