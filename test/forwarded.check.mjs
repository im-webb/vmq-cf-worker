#!/usr/bin/env node
/**
 * 对外域名/协议推断测试。
 *
 * 默认不信任任何 X-Forwarded-*；只有显式配置 TRUST_PROXY=1 且 Host 命中
 * TRUSTED_HOSTS 白名单时才采用，避免直接访问 Worker 时伪造 Host 引发开放重定向。
 */
import { externalHost, externalProto, isSecureRequest, publicUrl } from '../src/lib/util.ts';

let bad = 0;
function eq(got, want, label) {
  if (got !== want) {
    bad++;
    console.log('FAIL', label, 'got', JSON.stringify(got), 'want', JSON.stringify(want));
  }
}

const base = 'https://vmq.example.workers.dev/demo?x=1';
const trusted = { TRUST_PROXY: '1', TRUSTED_HOSTS: 'pay.example.com,admin.example.com' };
const forwarded = new Request(base, {
  headers: {
    'x-forwarded-host': 'pay.example.com',
    'x-forwarded-proto': 'http',
  },
});

// 默认：忽略伪造头，使用请求自身 URL
eq(externalHost(forwarded), 'vmq.example.workers.dev', '默认忽略 forwarded host');
eq(externalProto(forwarded), 'https', '默认忽略 forwarded proto');
eq(
  publicUrl(forwarded, '/index/pay/page?trade_no=1'),
  'https://vmq.example.workers.dev/index/pay/page?trade_no=1',
  '默认 publicUrl 使用 Worker host'
);

// 显式信任反代 + 白名单：采用真实域名和协议
eq(externalHost(forwarded, trusted), 'pay.example.com', '可信 forwarded host');
eq(externalProto(forwarded, trusted), 'http', '可信 forwarded proto');

// 未命中白名单仍然忽略
eq(
  externalHost(
    new Request(base, { headers: { 'x-forwarded-host': 'evil.example.com' } }),
    trusted
  ),
  'vmq.example.workers.dev',
  '白名单外 host 被忽略'
);

// 只配 TRUST_PROXY 但没有白名单也不信任
eq(
  externalHost(new Request(base, { headers: { 'x-forwarded-host': 'pay.example.com' } }), {
    TRUST_PROXY: '1',
  }),
  'vmq.example.workers.dev',
  '缺少 TRUSTED_HOSTS 时不信任'
);

// 多级反代取第一个
eq(
  externalHost(
    new Request(base, { headers: { 'x-forwarded-host': 'pay.example.com, inner.local' } }),
    trusted
  ),
  'pay.example.com',
  'multi proxy first value'
);

// 非法 proto 忽略
eq(
  externalProto(
    new Request('http://x/y', { headers: { 'x-forwarded-proto': 'ftp' } }),
    trusted
  ),
  'http',
  'invalid proto falls back'
);

eq(
  publicUrl(forwarded, '/index/pay/page?trade_no=1', trusted),
  'http://pay.example.com/index/pay/page?trade_no=1',
  '可信 publicUrl'
);

// Cloudflare 的 CF-Visitor 可用于 Secure cookie 判定
eq(
  isSecureRequest(
    new Request('http://internal.local/x', {
      headers: { 'cf-visitor': JSON.stringify({ scheme: 'https' }) },
    })
  ),
  true,
  'CF-Visitor https 识别为安全请求'
);

console.log(bad === 0 ? '全部通过（反代头信任与默认拒绝）' : `失败 ${bad} 个`);
process.exit(bad === 0 ? 0 : 1);
