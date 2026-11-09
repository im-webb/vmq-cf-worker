#!/usr/bin/env node
/**
 * 金额工具测试。
 *
 * 重点回归 `toFen` / `normalizeYuan`：到账匹配（/appPush）必须按「分」比较，
 * 不能拿字符串直接比。历史上是 `WHERE truemoney = ?` 字符串相等，
 * 监控端 App 推上来的 price 只要写法不同（"0.1" / "0.120" / 带空格），
 * 钱到了也匹配不到订单。
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

/* ---------- yuanToFen：严格格式，非法值返回 null ---------- */
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
eq(yuanToFen(' 1.00 '), null, 'yuanToFen 不 trim（归一是 normalizeYuan 的事）');

/* ---------- toFen：先 trim，再折算成分 ---------- */
eq(toFen('0.12'), 12, 'toFen 0.12');
eq(toFen(' 0.12 '), 12, 'toFen 带空格');
eq(toFen('0.1'), 10, 'toFen 一位小数');
eq(toFen('0.120'), null, 'toFen 三位小数非法（不允许四舍五入猜）');
eq(toFen('12.3'), 1230, 'toFen 一位小数补零');
eq(toFen(''), null, 'toFen 空串');

/* ---------- normalizeYuan：折算回两位小数的元 ---------- */
eq(normalizeYuan('0.12'), '0.12', 'normalize 0.12');
eq(normalizeYuan('0.1'), '0.10', 'normalize 0.1 → 0.10');
eq(normalizeYuan(' 0.12 '), '0.12', 'normalize 带空格');
eq(normalizeYuan('1'), '1.00', 'normalize 1 → 1.00');
eq(normalizeYuan('12.3'), '12.30', 'normalize 12.3 → 12.30');
eq(normalizeYuan('0.120'), null, 'normalize 三位小数不猜');
eq(normalizeYuan('abc'), null, 'normalize 非数字');

/* ---------- fenToYuan：归一化的落点必须和订单表写法一致 ---------- */
eq(fenToYuan(12), '0.12', 'fenToYuan 12');
eq(fenToYuan(1), '0.01', 'fenToYuan 1');
eq(fenToYuan(100), '1.00', 'fenToYuan 100');
eq(fenToYuan(0), '0.00', 'fenToYuan 0');

/*
 * 核心回归：订单表里 truemoney 是 fenToYuan() 写的两位小数（"0.12"），
 * 只有折算成「分」再比才对得上。这里模拟旧实现（字符串相等）会漏掉的所有写法。
 */
const stored = fenToYuan(12); // "0.12" —— 订单表里的形状
for (const raw of ['0.12', ' 0.12 ', '0.12\n']) {
  eq(toFen(raw), toFen(stored), `按分匹配: ${JSON.stringify(raw)} vs ${JSON.stringify(stored)}`);
}
// 这几种写法折算后也是 12 分（0.1 是 10 分，不算入内）
eq(toFen('0.120'), null, '三位小数不参与匹配，直接判非法而不是猜成 0.12');

console.log(bad === 0 ? '全部通过（金额归一 + 按分比较）' : `失败 ${bad} 个`);
process.exit(bad === 0 ? 0 : 1);
