/**
 * ทดสอบ src/lib/money.ts — ไม่ต้องใช้ฐานข้อมูล
 * รัน: node scripts/test-money.mjs
 *
 * ข้อที่สำคัญที่สุดคือข้อสุดท้าย: parse("45000.10") - parse("45000.00") ต้องได้ 10
 * เป๊ะ ๆ ถ้าที่ไหนสักแห่งมี float หลุดเข้ามา การล็อก "เงินเกิน" จะทำงานผิดพลาด
 * กับรายการที่ยอดตรงกันจริง
 */
import { readFileSync } from 'fs';
import { transpileModule, ModuleKind } from 'typescript';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ts = readFileSync('src/lib/money.ts', 'utf8');
const js = transpileModule(ts, { compilerOptions: { module: ModuleKind.ESNext, target: 99 } }).outputText;
const dir = mkdtempSync(join(tmpdir(), 'money-'));
const file = join(dir, 'money.mjs');
writeFileSync(file, js);
const { parseBahtToSatang, formatSatangToBaht, classifyVariance, MAX_SATANG } = await import(
  `file://${file.replace(/\\/g, '/')}`
);

let pass = 0;
let fail = 0;

function ok(name, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ✅ ${name} → ${actual}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} → ได้ ${actual} คาดว่า ${expected}`);
  }
}

function throws(name, input) {
  try {
    const v = parseBahtToSatang(input);
    fail++;
    console.log(`  ❌ ${name} → ควร error แต่ได้ ${v}`);
  } catch {
    pass++;
    console.log(`  ✅ ${name} → ปฏิเสธถูกต้อง`);
  }
}

console.log('\n── ค่าที่ต้องรับได้ ──');
ok('"12500.10"', parseBahtToSatang('12500.10'), 1250010);
ok('"12,500.50"', parseBahtToSatang('12,500.50'), 1250050);
ok('"0.01"', parseBahtToSatang('0.01'), 1);
ok('"45000"', parseBahtToSatang('45000'), 4500000);
ok('"45000.5" (ทศนิยมหลักเดียว)', parseBahtToSatang('45000.5'), 4500050);
ok('" 12500.50 " (มีช่องว่าง)', parseBahtToSatang(' 12500.50 '), 1250050);
ok('number 12500 (จำนวนเต็ม)', parseBahtToSatang(12500), 1250000);

console.log('\n── ค่าที่ต้องปฏิเสธ ──');
throws('"1e5" (exponent)', '1e5');
throws('"12.345" (ทศนิยม 3 ตำแหน่ง)', '12.345');
throws('"-5" (ติดลบ)', '-5');
throws('"" (ว่าง)', '');
throws('null', null);
throws('undefined', undefined);
throws('"abc"', 'abc');
throws('number 12.5 (ทศนิยมผ่าน double)', 12.5);
throws('เกินเพดาน', String(MAX_SATANG / 100 + 1));

console.log('\n── การลบต้องแม่นยำ (หัวใจของการล็อกเงินเกิน) ──');
ok(
  'parse("45000.10") - parse("45000.00") === 10',
  parseBahtToSatang('45000.10') - parseBahtToSatang('45000.00'),
  10
);
ok(
  'parse("12500.10") - parse("12500.00") === 10 (เคสที่ float พัง)',
  parseBahtToSatang('12500.10') - parseBahtToSatang('12500.00'),
  10
);
ok(
  'ยอดตรงกันต้องได้ 0 เป๊ะ',
  parseBahtToSatang('45000.10') - parseBahtToSatang('45,000.10'),
  0
);
// พิสูจน์ false positive จริงของวิธี float: ยอดที่ "ตรงกัน" แต่ถูกตัดสินว่าเงินเกิน
// ยอดที่ควรฝาก = ผลรวมสามซอง ซองละ 0.10 บาท / ยอดที่ฝากจริง = 0.30 บาท
const expectedFloat = 0.1 + 0.1 + 0.1;
const actualFloat = 0.3;
const floatVariance = actualFloat - expectedFloat;
console.log(
  `  ℹ️  ถ้าใช้ float: 0.10+0.10+0.10 = ${expectedFloat} เทียบกับ 0.30 ได้ผลต่าง ${floatVariance} ` +
    `→ classify = ${classifyVariance(floatVariance)} (ยอดตรงกันแท้ ๆ แต่ถูกตัดสินว่าไม่ตรง)`
);
// วิธีสตางค์: ตรงเป๊ะ
const expectedSatang = parseBahtToSatang('0.10') * 3;
ok('สตางค์: 3 ซอง ซองละ 0.10 เทียบ 0.30 → match', classifyVariance(parseBahtToSatang('0.30') - expectedSatang), 'match');

console.log('\n── การแสดงผล ──');
ok('format 4500000', formatSatangToBaht(4500000), '45,000.00');
ok('format 1', formatSatangToBaht(1), '0.01');
ok('format -120000', formatSatangToBaht(-120000), '-1,200.00');

console.log('\n── การแยกชนิดผลต่าง ──');
ok('0 → match', classifyVariance(0), 'match');
ok('-50000 → short', classifyVariance(-50000), 'short');
ok('120000 → over', classifyVariance(120000), 'over');

console.log(`\nสรุป: ผ่าน ${pass} / ไม่ผ่าน ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
