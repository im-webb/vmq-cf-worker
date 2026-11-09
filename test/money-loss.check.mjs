#!/usr/bin/env node
/** 到账回调与订单超时的关键回归测试。 */
import assert from 'node:assert/strict';
import { getOrderTimeoutMinutes } from '../src/lib/db.ts';
import { handlePush } from '../src/routes/push.ts';
import { monitorSign } from '../src/lib/sign.ts';

function configEnv(values) {
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...next) {
          args = next;
          return this;
        },
        async first() {
          if (sql.includes('FROM config')) {
            const key = String(args[0]);
            return Object.hasOwn(values, key) ? { v: String(values[key]) } : null;
          }
          return null;
        },
      };
    },
  };
  return { DB: db, ASSETS: {}, RESOURCE_URL: '' };
}

const timeoutCases = [
  [{ order_timeout: '10', close: '5' }, 10, 'order_timeout 优先'],
  [{ close: '7' }, 7, ' order_timeout 缺失时回退 close'],
  [{ order_timeout: 'bad', close: '9' }, 9, 'order_timeout 非法时回退 close'],
  [{ order_timeout: '0', close: '8' }, 8, 'order_timeout 非正数时回退 close'],
  [{}, 5, '两个配置都缺失时使用默认值 5'],
];
for (const [values, want, label] of timeoutCases) {
  assert.equal(await getOrderTimeoutMinutes(configEnv(values)), want, label);
}

function pushEnv(order) {
  const writes = [];
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...next) {
          args = next;
          return this;
        },
        async first() {
          if (sql.includes('FROM config')) {
            const key = String(args[0]);
            const values = { app_key: 'test-only-push-key', replay_window_seconds: '300' };
            return Object.hasOwn(values, key) ? { v: values[key] } : null;
          }
          if (sql.includes('FROM orders')) {
            writes.push({ kind: 'match', sql, args });
            return order;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO notify_task')) throw new Error('simulated enqueue failure');
          writes.push({ kind: 'run', sql, args });
          return { meta: { changes: 1, last_row_id: 1 } };
        },
      };
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
      return [];
    },
  };
  return { env: { DB: db, ASSETS: {}, RESOURCE_URL: '' }, writes };
}

const key = 'test-only-push-key';
const t = String(Math.floor(Date.now() / 1000));
const type = '1';
const price = '0.120';
const pid = '1001';
const sign = monitorSign([type, price, t, pid], key);
const order = {
  id: 1,
  order_id: 'order-test-1',
  out_trade_no: 'merchant-test-1',
  name: 'test-only',
  type: 1,
  pid: 1001,
  passage_id: 1,
  money: '0.12',
  truemoney: '0.12',
  pay_url: '',
  pay_url_type: 0,
  is_auto: 1,
  notify_url: 'https://example.test/notify',
  return_url: '',
  sitename: 'test-only',
  param: '',
  status: 0,
  create_time: Number(t),
  pay_time: 0,
  close_time: 0,
  notify_attempts: 0,
  ip: '',
};
const { env, writes } = pushEnv(order);
const body = new URLSearchParams({ type, price, t, pid, sign });
const res = await handlePush(
  new Request('https://example.test/appPush', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }),
  env
);
const payload = await res.json();
assert.equal(payload.code, 0);
assert.match(payload.msg, /回调入队失败/);
const match = writes.find((item) => item.kind === 'match');
assert.ok(match, '必须查询待支付订单');
assert.equal(match.args[0], '0.12', '0.120 必须归一并命中 0.12 的订单');
const downgraded = writes.find(
  (item) => item.kind === 'run' && item.sql.includes('UPDATE orders SET status = ?') && item.args[0] === 2
);
assert.ok(downgraded, '入队失败后必须更新订单状态');
assert.equal(downgraded.args[0], 2, '订单必须降级为 NOTIFY_FAILED');

console.log('全部通过（金额归一、超时口径、回调入队失败降级）');
