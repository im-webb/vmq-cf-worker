#!/usr/bin/env node
/**
 * 金额工具测试。
 *
 * /appPush 的 price 来自通知原文，可能是一位小数、两位小数或带纯尾随零。
 * 匹配前必须安全归一到订单表使用的两位小数格式，同时拒绝有第三位有效小数的值。
 */
import { fenToYuan, normalizeYuan, toFen, yuanToFen } from '../src/lib/amount.ts';

let bad = 0;
function eq(got, want, label) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    bad++;
    console.log('FAIL', label, 'got', JSON.stringify(got), 'want', JSON.stringify(want));
  }
}

/* ---------- yuanToFen：下单入口继续使用严格两位小数 ---------- */
eq(yuanToFen('0.12'), 12, 'yuanToFen 0.12');
eq(yuanToFen('1'), 100, 'yuanToFen 1');
eq(yuanToFen('1.00'), 100, 'yuanToFen 1.00');
eq(yuanToFen('0.01'), 1, 'yuanToFen 0.01');
eq(yuanToFen('9999.99'), 999999, 'yuanToFen 9999.99');
eq(yuanToFen('0.120'), null, 'yuanToFen 三位小数非法');
eq(yuanToFen('1.2.3'), null, 'yuanToFen 多个小数点非法');
eq(yuanToFen('abc'), null, 'yuanToFen 非数字非法');
eq(yuanToFen('-1.00'), null, 'yuanToFen 负数非法');
eq(yuanToFen(''), null, 'yuanToFen 空串非法');
eq(yuanToFen(' 1.00 '), null, 'yuanToFen 不 trim');

/* ---------- toFen：到账通知金额归一 ---------- */
eq(toFen('0.12'), 12, 'toFen 0.12');
eq(toFen(' 0.12 '), 12, 'toFen 带空格');
eq(toFen('0.1'), 10, 'toFen 一位小数');
eq(toFen('12.3'), 1230, 'toFen 一位小数补零');
eq(toFen('0.120'), 12, 'toFen 纯尾随零仍归一到 12 分');
eq(toFen('1.2300'), 123, 'toFen 多位尾随零仍归一到 123 分');
eq(toFen('0.121'), null, 'toFen 第三位有效小数非法');
eq(toFen('0.001'), null, 'toFen 第三位有效小数非法（分以下）');
eq(toFen(''), null, 'toFen 空串');
eq(toFen('abc'), null, 'toFen 非数字');

/* ---------- normalizeYuan：折算回订单表使用的两位小数格式 ---------- */
eq(normalizeYuan('0.12'), '0.12', 'normalize 0.12');
eq(normalizeYuan('0.1'), '0.10', 'normalize 0.1 → 0.10');
eq(normalizeYuan(' 0.12 '), '0.12', 'normalize 带空格');
eq(normalizeYuan('1'), '1.00', 'normalize 1 → 1.00');
eq(normalizeYuan('12.3'), '12.30', 'normalize 12.3 → 12.30');
eq(normalizeYuan('0.120'), '0.12', 'normalize 0.120 → 0.12');
eq(normalizeYuan('1.2300'), '1.23', 'normalize 1.2300 → 1.23');
eq(normalizeYuan('0.121'), null, 'normalize 0.121 不猜');
eq(normalizeYuan('abc'), null, 'normalize 非数字');

/* ---------- fenToYuan：归一化的落点必须和订单表写法一致 ---------- */
eq(fenToYuan(12), '0.12', 'fenToYuan 12');
eq(fenToYuan(1), '0.01', 'fenToYuan 1');
eq(fenToYuan(100), '1.00', 'fenToYuan 100');
eq(fenToYuan(0), '0.00', 'fenToYuan 0');

/*
 * 核心回归：订单表里的 truemoney 是两位小数，通知原文的等价写法
 * 必须先归一，才能命中同一个字符串。
 */
const stored = fenToYuan(12);
for (const raw of ['0.12', ' 0.12 ', '0.12\n', '0.120']) {
  eq(normalizeYuan(raw), stored, `到账金额归一: ${JSON.stringify(raw)}`);
}

console.log(bad === 0 ? '全部通过（金额归一 + 按分比较）' : `失败 ${bad} 个`);
process.exit(bad === 0 ? 0 : 1);
