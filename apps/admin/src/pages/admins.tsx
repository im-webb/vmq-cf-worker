import { CrudPage, StatusBadge, type CrudConfig } from '@/components/crud-page';

interface Admin {
  id: number;
  username: string;
  role: string;
  status: number;
  created_at: string;
  login_time: string;
}

const config: CrudConfig<Admin> = {
  title: '管理员',
  description: '账号增删改；密码留空表示不修改',
  endpoint: '/admins',
  columns: [
    { key: 'id', label: 'ID', className: 'w-12 text-muted-foreground tabular-nums' },
    { key: 'username', label: '账号' },
    { key: 'role', label: '角色' },
    { key: 'status', label: '状态', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'login_time', label: '最后登录', className: 'text-xs text-muted-foreground' },
  ],
  fields: [
    { name: 'username', label: '账号', placeholder: '3-20 位字母数字下划线' },
    {
      name: 'role',
      label: '角色',
      type: 'select',
      options: [
        { value: '1', label: '超级管理员' },
        { value: '2', label: '普通管理员' },
      ],
    },
    { name: 'password', label: '密码', type: 'password', hint: '至少 8 位；编辑时留空则不修改' },
    { name: 'repassword', label: '确认密码', type: 'password' },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      options: [
        { value: '1', label: '启用' },
        { value: '0', label: '停用' },
      ],
    },
  ],
  empty: { username: '', role: '2', password: '', repassword: '', status: '1' },
  toForm: (r) => ({
    username: r.username,
    role: String(r.role === '超级管理员' ? 1 : 2),
    password: '',
    repassword: '',
    status: String(r.status),
  }),
  statusKey: 'status',
};

export function AdminsPage() {
  return <CrudPage config={config} />;
}
