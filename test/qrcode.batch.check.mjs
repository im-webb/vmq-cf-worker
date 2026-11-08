import {
  inferEwmType,
  parseAmountFromFilename,
  parseBatchText,
  validateBatchItems,
} from '../apps/admin/src/lib/qrcode-batch.ts';

let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fail++;
}

check('文件名金额 10.00', parseAmountFromFilename('10.00.png') === '10.00');
check('文件名金额 qrcode_10.01', parseAmountFromFilename('qrcode_10.01.webp') === '10.01');
check('文件名金额 10元', parseAmountFromFilename('10元.jpg') === '10');
check('文件名无金额', parseAmountFromFilename('qrcode.png') === '');

const text = [
  '金额,二维码',
  '10.00,https://example.com/qr/10.png',
  '10.01\twxp://example-test',
  '10.01,wxp://duplicate',
  'bad,wxp://bad',
].join('\n');
const parsed = parseBatchText(text);
check('解析有效行数量', parsed.items.length === 2, String(parsed.items.length));
check('图片地址识别为图片码', parsed.items[0]?.ewmType === 1);
check('二维码文本识别为文本码', parsed.items[1]?.ewmType === 0);
check('重复金额被报告', parsed.errors.some((e) => e.includes('金额重复')));
check('错误金额被报告', parsed.errors.some((e) => e.includes('金额格式不正确')));
check('图片地址推断', inferEwmType('https://example.com/qr/1.webp') === 1);
check('二维码文本推断', inferEwmType('wxp://example') === 0);

const manual = [
  { price: '1.00', payUrl: 'wxp://example-a', ewmType: 0, source: 'a' },
  { price: '1.00', payUrl: 'wxp://example-b', ewmType: 0, source: 'b' },
];
check('复核校验发现重复', validateBatchItems(manual).some((e) => e.includes('金额重复')));

console.log(fail === 0 ? '\n全部通过' : `\n失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);