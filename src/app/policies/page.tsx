'use client';

import { useMemo, useState } from 'react';

/**
 * คู่มือของ "ระบบนี้" เท่านั้น
 *
 * เดิมหน้านี้เก็บกรอบนโยบายองค์กร 6 หมวดที่สรุปจากเว็บไซต์บริษัท (ปรัชญาองค์กร,
 * ESG/SDGs, ความปลอดภัยอาหาร, ฮาลาล, คุณภาพบริการ, สิ่งแวดล้อม) ซึ่งไม่มีข้อไหน
 * บังคับใช้ผ่านระบบนี้ได้เลย คนอ่านจึงต้องเดาเองว่าอะไรคือขั้นตอนจริงที่ต้องทำ
 * ตอนนี้ทุกข้อในหน้านี้ผูกกับสิ่งที่ระบบบังคับหรือบันทึกได้จริง
 *
 * กฎการเพิ่มข้อใหม่: ถ้าเขียนแล้วตอบไม่ได้ว่า "ระบบบังคับข้อนี้ที่ไหน" หรือ
 * "ถ้าไม่ทำจะเห็นได้อย่างไร" ข้อนั้นไม่ควรอยู่ในหน้านี้
 */

type Policy = {
  code: string;
  title: string;
  category: string;
  scope: string;
  summary: string;
  owner: string;
  /** ระบบบังคับข้อนี้ที่ไหน — ว่างไม่ได้ เพราะเป็นเหตุผลที่ข้อนี้อยู่ในหน้านี้ */
  enforcedBy: string;
  controls: string[];
  evidence: string[];
};

const policies: Policy[] = [
  {
    code: 'DOC-01',
    title: 'การลงทะเบียนเอกสารรับเข้า',
    category: 'ระบบเอกสาร',
    scope: 'ผู้ใช้งานระบบทุกคน',
    summary:
      'เอกสารทุกฉบับที่รับเข้าต้องถูกลงทะเบียนทันที พร้อมวันที่รับ ผู้ส่ง เรื่อง และหน่วยงานปลายทาง ระบบออกเลขที่วิ่งให้เองเพื่อให้อ้างอิงได้ตรงกันทุกฝ่าย',
    owner: 'ธุรการผู้รับเอกสาร',
    enforcedBy: 'เลขที่วิ่งออกโดยระบบ · ต้องเลือกหน่วยงานปลายทางอย่างน้อยหนึ่งหน่วยงาน',
    controls: [
      'ลงทะเบียนทันทีที่รับเข้า ไม่ค้างไว้ทำรวมทีหลัง',
      'กรอกเลขที่เอกสารของต้นฉบับด้วย ถ้ามี — ใช้ค้นหาย้อนหลังได้',
      'เอกสารเสียหายต้องถ่ายรูปและติ๊กช่องเสียหายตอนลงทะเบียน',
    ],
    evidence: ['เลขที่วิ่งของระบบ', 'ชื่อผู้บันทึกและเวลาที่บันทึก', 'รูปความเสียหาย'],
  },
  {
    code: 'DOC-02',
    title: 'การส่งมอบและการลงนามรับ',
    category: 'ระบบเอกสาร',
    scope: 'ธุรการผู้ส่งมอบ และหน่วยงานผู้รับ',
    summary:
      'เอกสารเปลี่ยนมือได้เฉพาะผ่านการส่งมอบในระบบ และปิดงานได้เมื่อหน่วยงานปลายทางลงนามรับด้วยบัญชีของตนเอง ผู้รับเลือกได้ว่ายืนยันถูกต้องหรือแจ้งปัญหา',
    owner: 'ธุรการ และหัวหน้าหน่วยงานปลายทาง',
    enforcedBy: 'ผู้กดยืนยันมาจาก session ที่ล็อกอิน ปลอมจากหน้าเว็บไม่ได้ · เอกสารที่ปิดแล้วกดซ้ำได้ 409',
    controls: [
      'ผู้ส่งมอบและผู้รับต้องเป็นคนละบัญชี',
      'ตรวจเนื้อเอกสารก่อนกดยืนยัน ไม่กดยืนยันล่วงหน้าแล้วค่อยตรวจ',
      'ถ้าเอกสารไม่ตรงหรือไม่ครบ ให้กดแจ้งปัญหาพร้อมเหตุผล ไม่ใช่ปฏิเสธด้วยการไม่กดอะไร',
    ],
    evidence: ['ลายเซ็นผู้ส่งมอบและเวลา', 'บัญชีที่กดยืนยัน (จาก session)', 'ชื่อผู้รับที่พิมพ์ในช่องลายเซ็น', 'หมายเหตุกรณีแจ้งปัญหา'],
  },
  {
    code: 'DOC-03',
    title: 'ช่องลายเซ็นผู้รับพิมพ์ชื่อได้',
    category: 'ระบบเอกสาร',
    scope: 'หน่วยงานผู้รับ',
    summary:
      'คนที่มารับของหน้าเคาน์เตอร์อาจไม่ใช่เจ้าของบัญชีที่ล็อกอิน (ฝากเพื่อนแผนกมารับ) ช่องลายเซ็นผู้รับจึงพิมพ์ชื่อคนรับจริงได้ ไม่ล็อกเป็นชื่อเจ้าของบัญชี',
    owner: 'หน่วยงานผู้รับ',
    enforcedBy: 'ระบบเก็บสองค่าแยกกัน: บัญชีที่กดยืนยัน (ปลอมไม่ได้) และชื่อที่พิมพ์',
    controls: [
      'พิมพ์ชื่อคนที่มารับของจริง ไม่ใช่ชื่อเจ้าของบัญชีถ้าไม่ใช่คนเดียวกัน',
      'ถ้าเว้นว่าง ระบบใช้ชื่อเจ้าของบัญชีให้เอง',
      'ห้ามให้คนอื่นยืมบัญชีตัวเองกดยืนยัน — ให้พิมพ์ชื่อเขาในช่องลายเซ็นแทน',
    ],
    evidence: ['ชื่อผู้รับที่พิมพ์', 'บัญชีที่กดยืนยัน — ตามหาคนกดได้ทุกกรณีแม้สองค่าไม่ตรงกัน'],
  },
  {
    code: 'GR-04',
    title: 'ใบรับสินค้า: ตรวจสอบ → จัดซื้อ → บัญชี',
    category: 'ใบรับสินค้า',
    scope: 'คลังสินค้า · FAC-PP · จัดซื้อ · ACC/บัญชี',
    summary:
      'เอกสารเรื่อง “ใบรับสินค้า” เดินตามลำดับสามด่านคงที่ ข้ามด่านไม่ได้ ปลายทางเป็น ACC/บัญชี เท่านั้น หน่วยงานอื่นที่เกี่ยวข้องติดเป็นหน่วยงานกำกับได้แต่ไม่ใช่ผู้ปิดงาน',
    owner: 'จัดซื้อ (เจ้าของกระบวนการ)',
    enforcedBy: 'สิทธิ์ผูกกับรหัสหน่วยงาน ไม่ใช่บทบาท · ปิดงานได้เฉพาะ ACC/บัญชี · ทุกการลงนามเก็บใน audit ที่แก้ไม่ได้',
    controls: [
      'ด่าน 1 ผู้ตรวจสอบ — คลังสินค้า หรือ FAC-PP ตรวจจำนวน สภาพ และเอกสารประกอบ',
      'ด่าน 2 จัดซื้อ — ตรวจว่าตรงกับที่สั่งซื้อ',
      'ด่าน 3 ACC/บัญชี — ลงนามรับและปิดงาน',
      'ระวังชื่อเรื่อง: ต้องเป็น “ใบรับสินค้า” พอดี เอกสารที่ตั้งชื่อว่า “ใบรับสินค้าสำเร็จรูป” ไม่เข้ากระบวนการนี้ จะเดินเส้นทางเอกสารทั่วไป',
    ],
    evidence: ['ลายเซ็นและเวลาของทั้งสามด่าน', 'ประวัติการแก้ลายเซ็นใน audit', 'ใบรับสินค้าและรูปความเสียหาย'],
  },
  {
    code: 'CSH-05',
    title: 'การส่งมอบซองเงินสดที่สาขา',
    category: 'เงินสดสาขา',
    scope: 'แคชเชียร์สาขา และแมสเซนเจอร์',
    summary:
      'แคชเชียร์เขียนยอดบนหน้าซอง ปิดผนึก แล้วแจ้งยอดเดียวกันในระบบด้วยการกดส่งซอง แมสเซนเจอร์เทียบยอดในระบบกับหน้าซองแล้วกดรับซอง ยอดต้นทางเป็นของแคชเชียร์ ไม่ใช่ของผู้ขนเงิน',
    owner: 'หัวหน้าสาขา',
    enforcedBy: 'ฐานข้อมูลปฏิเสธทุกยอดที่แมสเซนเจอร์ส่งมาไม่ตรงกับที่แคชเชียร์แจ้ง · ยอดที่แจ้งแก้ไม่ได้ · แจ้งในนามสาขาอื่นไม่ได้',
    controls: [
      'คีย์ยอดตามที่เขียนบนหน้าซอง ไม่ใช่ยอดในใบ Pay-in ที่อยู่ข้างใน — แมสเซนเจอร์เห็นได้แค่หน้าซอง',
      'ทำหลังปิดผนึกซองแล้ว และก่อนแมสเซนเจอร์มาถึง',
      'คีย์ผิดให้ยกเลิกแล้วส่งใหม่ — ยกเลิกได้เฉพาะตอนที่ยังไม่มีใครรับ',
      'แมสเซนเจอร์เทียบไม่ตรงต้องกด “ยอดไม่ตรงกับหน้าซอง” ห้ามรับซองไปก่อนแล้วค่อยแจ้ง',
    ],
    evidence: ['ใบประกาศยอดของแคชเชียร์', 'รูปซองเงินที่แมสเซนเจอร์ถ่าย', 'พิกัดและเวลาที่รับ', 'เหตุผลกรณีแจ้งยอดไม่ตรง'],
  },
  {
    code: 'CSH-06',
    title: 'การนำฝากธนาคารและการเทียบยอด',
    category: 'เงินสดสาขา',
    scope: 'แมสเซนเจอร์',
    summary:
      'เก็บซองได้หลายสาขาในทริปเดียวแล้วนำฝากรวมครั้งเดียว ระบบเทียบผลรวมยอดหน้าซองกับยอดที่ฝากจริงให้เอง ตรงกันปิดงานทันที ไม่ตรงต้องทำรายงานผลต่าง',
    owner: 'แมสเซนเจอร์ และ ACC/บัญชี',
    enforcedBy: 'ผลต่างคำนวณโดยฐานข้อมูล ไม่ใช่หน้าเว็บ · ยอดฝาก เลขที่ใบนำฝาก และรูปสลิป เขียนได้ครั้งเดียว · รูปสลิปใช้ซ้ำสองงานไม่ได้',
    controls: [
      'คีย์ยอดตามใบนำฝากจริง หน้าจอซ่อนยอดที่ต้องฝากไว้ และการกดเปิดดูถูกบันทึก',
      'เลขที่ใบนำฝากเว้นว่างได้ ระบบออกเลขให้เองและทำเครื่องหมายว่าไม่ใช่ของธนาคาร',
      'ถ่ายรูปใบนำฝากทุกครั้ง ปิดงานไม่ได้ถ้าไม่มีรูป',
      'เงินสดคงค้างในมือควรเป็นศูนย์ทุกสิ้นวัน',
    ],
    evidence: ['ยอดที่ต้องฝากที่ snapshot ไว้', 'ยอดฝากจริงและรูปใบนำฝาก', 'ธนาคารและสาขาที่ฝาก'],
  },
  {
    code: 'CSH-07',
    title: 'ผลต่างเงินขาดและเงินเกิน',
    category: 'เงินสดสาขา',
    scope: 'แมสเซนเจอร์ และ ACC/บัญชี',
    summary:
      'ยอดขาดและยอดเกินสำคัญเท่ากัน ใช้เส้นทางและกติกาปิดงานเดียวกัน ทั้งสองกรณีคือเงินของบริษัทไม่ตรงกับหลักฐาน จึงถูกล็อกไว้และปิดเองไม่ได้',
    owner: 'ธุรการ ACC/บัญชี',
    enforcedBy: 'ปิดผลต่างได้เฉพาะธุรการในหน่วยงานผู้อนุมัติ · ใบอนุมัติใช้ข้ามรายการไม่ได้ · ผู้เกี่ยวข้องอนุมัติงานตัวเองไม่ได้ ครอบทุกจุดรับในทริป',
    controls: [
      'ผู้แจ้งผลต่างคือเจ้าหน้าที่ธนาคารที่เปิดซอง ไม่ใช่แมสเซนเจอร์ตัดสินเอง',
      'ก่อนแก้ใบ Pay-in ตามเงินจริง ต้องแจ้งการเงินก่อน',
      'รายงานผลต่างต้องระบุสาเหตุและคำอธิบายอย่างน้อย 10 ตัวอักษร',
      'ผู้ตัดสินต้องเปิดสลิปดูจริงและติ๊กยืนยัน พร้อมเหตุผลอย่างน้อย 10 ตัวอักษร',
      'ควรมีธุรการในหน่วยงานผู้อนุมัติอย่างน้อย 2 คน มิฉะนั้นวันที่คนเดียวลาผลต่างจะค้างทั้งหมด',
    ],
    evidence: ['รายงานผลต่างและสาเหตุ', 'ยอดที่ snapshot ไว้ตอนตัดสิน', 'ชื่อผู้ตัดสิน หน่วยงาน และเวลา'],
  },
  {
    code: 'SEC-08',
    title: 'บัญชีผู้ใช้ สิทธิ์ และร่องรอยการตรวจสอบ',
    category: 'สิทธิ์และการตรวจสอบ',
    scope: 'ผู้ดูแลระบบ และผู้ใช้ทุกคน',
    summary:
      'สิทธิ์ในระบบมาจากหน่วยงานของบัญชีเป็นหลัก ไม่ใช่การตั้งค่ารายคน ย้ายคนข้ามหน่วยงานแล้วสิทธิ์เปลี่ยนตามทันที และการกระทำที่กระทบสิทธิ์ถูกบันทึกแบบลบไม่ได้',
    owner: 'ผู้ดูแลระบบ',
    enforcedBy: 'บันทึกการกระทำของผู้ดูแลเป็นตารางที่แก้และลบไม่ได้ · ตั้งรหัสผ่านใหม่ให้คนอื่นได้เฉพาะผู้ดูแลระบบสูงสุด',
    controls: [
      'หนึ่งคนหนึ่งบัญชี ห้ามใช้บัญชีร่วมกัน',
      'บัญชีที่หน่วยงานเป็นเจ้าของสาขา จะได้สิทธิ์ส่งซองเงินโดยอัตโนมัติ — ตรวจว่าหน่วยงานนั้นเป็นจุดรับเงินจริง',
      'สาขาที่ไม่ใช่จุดรับเงินให้ปิดใช้งาน ไม่ต้องลบ แล้วสิทธิ์ส่งซองจะหายไปเอง',
      'ผู้ที่ลาออกให้ปิดใช้งานบัญชี ไม่ลบ เพื่อให้ประวัติเดิมยังอ่านได้',
    ],
    evidence: ['บันทึกการเปลี่ยนสิทธิ์และหน่วยงาน', 'บันทึกการตั้งรหัสผ่านใหม่ (ไม่เก็บตัวรหัส)', 'ประวัติทุกการกระทำในงานเงินสด'],
  },
];

const categories = ['ทั้งหมด', ...Array.from(new Set(policies.map((policy) => policy.category)))];

type Flow = { key: string; label: string; title: string; note: string; steps: { no: string; title: string; owner: string; detail: string }[] };

const flows: Flow[] = [
  {
    key: 'doc',
    label: 'DOCUMENT FLOW',
    title: 'เอกสารทั่วไป',
    note: 'จดหมาย ใบเบิก ใบกำกับภาษี ใบวางบิล และเอกสารอื่น',
    steps: [
      { no: '01', title: 'ลงทะเบียนรับเข้า', owner: 'ธุรการ', detail: 'กรอกวันที่รับ เลขที่เอกสาร ผู้ส่ง เรื่อง และเลือกหน่วยงานปลายทาง ระบบออกเลขที่วิ่งให้เอง' },
      { no: '02', title: 'ส่งมอบให้หน่วยงาน', owner: 'ธุรการ', detail: 'ตรวจรายการก่อนส่งมอบ ลงลายเซ็นผู้ส่งมอบ แล้วระบบแจ้งหน่วยงานปลายทาง' },
      { no: '03', title: 'ผู้รับลงนาม', owner: 'หน่วยงานปลายทาง', detail: 'ตรวจเอกสาร พิมพ์ชื่อผู้รับจริง แล้วเลือกยืนยันถูกต้องหรือแจ้งปัญหาพร้อมเหตุผล' },
      { no: '04', title: 'ปิดงานหรือส่งใหม่', owner: 'ธุรการ', detail: 'ยืนยันแล้วปิดงานทันที · แจ้งปัญหาแล้วธุรการตรวจเหตุผลและส่งมอบใหม่เมื่อเหมาะสม' },
    ],
  },
  {
    key: 'gr',
    label: 'GOODS RECEIPT FLOW',
    title: 'ใบรับสินค้า',
    note: 'ใช้กับเอกสารที่ตั้งเรื่องว่า “ใบรับสินค้า” พอดีเท่านั้น',
    steps: [
      { no: '01', title: 'ลงทะเบียน', owner: 'ธุรการ', detail: 'ติดหน่วยงานที่เกี่ยวข้องได้หลายหน่วยงานเป็นข้อมูลกำกับ แต่ปลายทางของงานคือ ACC/บัญชี เสมอ' },
      { no: '02', title: 'ผู้ตรวจสอบลงนาม', owner: 'คลังสินค้า / FAC-PP', detail: 'ตรวจจำนวน สภาพสินค้า และเอกสารประกอบ แล้วลงนามด่านแรก' },
      { no: '03', title: 'จัดซื้อลงนาม', owner: 'จัดซื้อ', detail: 'ตรวจว่าของที่รับตรงกับที่สั่งซื้อ แล้วลงนามด่านที่สอง' },
      { no: '04', title: 'บัญชีรับและปิดงาน', owner: 'ACC/บัญชี', detail: 'ลงนามรับเป็นด่านสุดท้ายและปิดงาน หน่วยงานอื่นปิดไม่ได้' },
    ],
  },
  {
    key: 'cash',
    label: 'CASH FLOW',
    title: 'เงินสดสาขาและการนำฝาก',
    note: 'สาขาที่ยังไม่มีบัญชีแคชเชียร์ ให้ข้ามขั้น 01 แล้วแมสเซนเจอร์คีย์ยอดหน้าซองเองในขั้น 02',
    steps: [
      { no: '01', title: 'แคชเชียร์ส่งซอง', owner: 'แคชเชียร์สาขา', detail: 'ปิดผนึกซองแล้วแจ้งยอดตามหน้าซองและจำนวนซองในระบบ คีย์ยอดซ้ำสองครั้งให้ตรงกัน' },
      { no: '02', title: 'แมสเซนเจอร์รับซอง', owner: 'แมสเซนเจอร์', detail: 'เทียบยอดในระบบกับที่เขียนบนหน้าซอง ติ๊กยืนยันว่าตรง ถ่ายรูปซอง — ไม่ตรงให้กดแจ้ง ห้ามรับ' },
      { no: '03', title: 'เก็บสาขาถัดไป', owner: 'แมสเซนเจอร์', detail: 'ทำซ้ำได้ทุกสาขาในทริปเดียว สาขาเดิมรับซ้ำในทริปเดียวไม่ได้' },
      { no: '04', title: 'นำฝากรวมครั้งเดียว', owner: 'แมสเซนเจอร์', detail: 'เลือกธนาคารและสาขา คีย์ยอดฝากจริงตามใบนำฝาก ถ่ายรูปใบนำฝาก' },
      { no: '05', title: 'ระบบเทียบยอด', owner: 'ระบบ / ACC/บัญชี', detail: 'ตรงกันปิดงานทันที · ไม่ตรงต้องทำรายงานผลต่าง แล้วธุรการบัญชีเป็นผู้ตัดสิน' },
    ],
  },
];

const roleMatrix = [
  { role: 'ธุรการผู้ลงทะเบียน', can: 'ลงทะเบียน ส่งมอบ ส่งมอบใหม่', must: 'กรอกตามเอกสารจริง แนบรูปเมื่อพบความเสียหาย' },
  { role: 'หน่วยงานปลายทาง', can: 'ลงนามรับ ยืนยัน หรือแจ้งปัญหา', must: 'ใช้บัญชีตนเอง พิมพ์ชื่อผู้รับจริงในช่องลายเซ็น' },
  { role: 'คลังสินค้า / FAC-PP', can: 'ลงนามด่านผู้ตรวจสอบของใบรับสินค้า', must: 'ตรวจจำนวนและสภาพก่อนลงนาม ห้ามข้ามด่าน' },
  { role: 'จัดซื้อ', can: 'ลงนามด่านที่สองของใบรับสินค้า', must: 'ตรวจว่าตรงกับคำสั่งซื้อก่อนลงนาม' },
  { role: 'แคชเชียร์สาขา', can: 'แจ้งยอดหน้าซองและส่งซอง', must: 'คีย์ตามที่เขียนบนหน้าซอง ยกเลิกได้ก่อนมีคนรับเท่านั้น' },
  { role: 'แมสเซนเจอร์', can: 'รับซอง นำฝาก ทำรายงานผลต่าง', must: 'เทียบยอดก่อนรับ แก้ยอดที่แคชเชียร์แจ้งไม่ได้' },
  { role: 'ธุรการ ACC/บัญชี', can: 'ลงนามปิดใบรับสินค้า และตัดสินผลต่างเงินสด', must: 'เปิดสลิปดูจริง ให้เหตุผล และอนุมัติงานที่ตนเกี่ยวข้องไม่ได้' },
  { role: 'ผู้ดูแลระบบสูงสุด', can: 'จัดการผู้ใช้ หน่วยงาน ยกเลิกทริปที่คีย์ผิด', must: 'ใช้เท่าที่จำเป็นและตรวจบันทึกการกระทำย้อนหลัง' },
];

const rules = [
  'ห้ามใช้บัญชีผู้อื่นลงชื่อรับหรือยืนยัน — ถ้าคนอื่นมารับแทน ให้พิมพ์ชื่อเขาในช่องลายเซ็น',
  'ห้ามลบหรือแก้ข้อมูลเพื่อกลบข้อผิดพลาด ให้ใช้การแจ้งปัญหาหรือยกเลิกพร้อมเหตุผลแทน',
  'เอกสารหรือสินค้าเสียหายต้องถ่ายรูปแนบก่อนส่งต่อ',
  'ยอดเงินที่บันทึกแล้วแก้ไม่ได้ คีย์ผิดต้องยกเลิกทริปแล้วเปิดใหม่ ไม่ใช่แก้ตัวเลข',
  'แมสเซนเจอร์แก้ยอดที่แคชเชียร์แจ้งไม่ได้ และแคชเชียร์แก้ยอดที่ส่งไปแล้วไม่ได้',
  'ผลต่างเงินขาดและเงินเกินปิดเองไม่ได้ทั้งคู่ ต้องผ่านธุรการบัญชี',
  'ผู้ที่เกี่ยวข้องกับงานหนึ่ง ตัดสินผลต่างของงานนั้นไม่ได้ แม้ระบบจะเปิดเมนูให้',
  'ทุกข้อยกเว้นต้องมีเหตุผล ผู้รับผิดชอบ และหลักฐานประกอบ',
];

const incidents = [
  { title: '01 · เอกสารข้อมูลไม่ครบ', detail: 'ยังไม่ต้องส่งมอบ ให้ติดต่อผู้ลงทะเบียนแก้ให้ครบในสถานะลงทะเบียนก่อน' },
  { title: '02 · พบความเสียหาย', detail: 'ถ่ายรูป แนบหลักฐาน ระบุหมายเหตุ และแจ้งผู้ตรวจสอบหรือจัดซื้อก่อนดำเนินการต่อ' },
  { title: '03 · ผู้รับแจ้งปัญหา', detail: 'สถานะเปลี่ยนเป็นแจ้งปัญหา ธุรการตรวจเหตุผลแล้วส่งมอบใหม่เมื่อเหมาะสม' },
  { title: '04 · ยอดในระบบไม่ตรงหน้าซอง', detail: 'ห้ามรับซอง กดแจ้งยอดไม่ตรงพร้อมเหตุผล สาขาและบัญชีได้แจ้งเตือนทันที แล้วให้แคชเชียร์ออกใบใหม่' },
  { title: '05 · ธนาคารเปิดซองแล้วยอดไม่ตรง', detail: 'เจ้าหน้าที่ธนาคารเป็นผู้แจ้ง แมสเซนเจอร์แจ้งการเงินก่อน แล้วแก้ใบ Pay-in ตามเงินจริง ฝาก แล้วทำรายงานผลต่าง' },
  { title: '06 · คีย์ยอดผิดไปแล้ว', detail: 'แก้ตัวเลขไม่ได้ ให้ผู้ดูแลระบบยกเลิกทริปพร้อมเหตุผลแล้วเปิดใหม่ ยอดเดิมยังอยู่ในประวัติ' },
  { title: '07 · เงินสดคงค้างไม่เป็นศูนย์ตอนเย็น', detail: 'มีทริปที่รับเงินแล้วยังไม่ฝาก ดูที่หน้าเงินสด/ฝากธนาคารว่าค้างที่ใคร แล้วติดตามทันทีวันนั้น' },
  { title: '08 · ต้องการตรวจย้อนหลัง', detail: 'ค้นที่หน้าติดตามด้วยเลขที่เอกสารหรือสถานะ · งานเงินสดดูประวัติรายทริปซึ่งแก้ไม่ได้' },
];

export default function PoliciesPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ทั้งหมด');
  const [activeTab, setActiveTab] = useState<'policies' | 'handbook'>('policies');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filteredPolicies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return policies.filter((policy) => {
      const matchesCategory = category === 'ทั้งหมด' || policy.category === category;
      const searchable = [policy.code, policy.title, policy.category, policy.scope, policy.summary, policy.enforcedBy, ...policy.controls].join(' ').toLowerCase();
      return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [category, query]);

  const totalSteps = flows.reduce((sum, flow) => sum + flow.steps.length, 0);

  return (
    <div className="policy-page">
      <section className="policy-hero">
        <div className="policy-hero-copy">
          <div className="title-badge">◈ คู่มือการใช้งาน</div>
          <h1>คู่มือระบบรับ–ส่งเอกสารและเงินสดสาขา</h1>
          <p>ทุกข้อในหน้านี้เป็นขั้นตอนที่ทำในระบบนี้จริง และระบุไว้ว่าระบบบังคับข้อนั้นที่ไหน ไม่ใช่แนวปฏิบัติกว้าง ๆ ที่ตรวจไม่ได้</p>
          <div className="policy-hero-actions">
            <button className="secondary-button" onClick={() => setActiveTab('handbook')}>ดูขั้นตอนการทำงาน</button>
            <button className="ghost-button" onClick={() => { setActiveTab('policies'); document.getElementById('policy-content')?.scrollIntoView({ behavior: 'smooth' }); }}>เปิดดูข้อกำหนด</button>
          </div>
        </div>
        <div className="policy-hero-panel">
          <div className="policy-hero-panel-label">ขอบเขตของคู่มือนี้</div>
          <strong>3 กระบวนการที่ระบบคุม</strong>
          <span>เอกสารทั่วไป · ใบรับสินค้า · เงินสดสาขา</span>
          <small>ไม่รวมนโยบายองค์กร มาตรฐานคุณภาพ หรือข้อกำหนดที่ไม่ได้ทำผ่านระบบนี้</small>
        </div>
      </section>

      <div className="policy-notice">
        <span className="policy-notice-icon">i</span>
        <div>
          <strong>อ่านคู่มือนี้ควบคู่กับหน้าจอจริง</strong>
          <br />
          ถ้าหน้าจอทำอย่างหนึ่งแต่คู่มือเขียนอีกอย่าง ให้ถือว่าหน้าจอถูกและแจ้งให้แก้คู่มือ เพราะกฎที่บังคับใช้จริงอยู่ในฐานข้อมูล ไม่ใช่ในเอกสารนี้
        </div>
      </div>

      <div className="policy-metrics">
        <div><span>ข้อกำหนด</span><strong>{policies.length}</strong><small>ผูกกับระบบนี้ทุกข้อ</small></div>
        <div><span>กระบวนการ</span><strong>{flows.length}</strong><small>รวม {totalSteps} ขั้น</small></div>
        <div><span>บทบาท</span><strong>{roleMatrix.length}</strong><small>แยกหน้าที่กันชัดเจน</small></div>
        <div><span>กฎที่ต้องทำ</span><strong>{rules.length}</strong><small>ห้ามยกเว้นเอง</small></div>
      </div>

      <div className="policy-tabs" role="tablist" aria-label="คู่มือการใช้งาน">
        <button className={activeTab === 'policies' ? 'active' : ''} onClick={() => setActiveTab('policies')} role="tab" aria-selected={activeTab === 'policies'}>ข้อกำหนดและการควบคุม</button>
        <button className={activeTab === 'handbook' ? 'active' : ''} onClick={() => setActiveTab('handbook')} role="tab" aria-selected={activeTab === 'handbook'}>ขั้นตอนการทำงาน</button>
      </div>

      {activeTab === 'policies' ? (
        <section id="policy-content" className="policy-content-grid">
          <aside className="policy-filter-panel">
            <div className="policy-section-kicker">ค้นหา</div>
            <h2>ค้นหาข้อกำหนด</h2>
            <label className="policy-search">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาคำสำคัญ เช่น ซองเงิน ผลต่าง ใบรับสินค้า" aria-label="ค้นหาข้อกำหนด" />
            </label>
            <div className="policy-category-list" role="listbox" aria-label="กรองตามหมวดหมู่">
              {categories.map((item) => (
                <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>
                  {item}
                  <span>{item === 'ทั้งหมด' ? policies.length : policies.filter((policy) => policy.category === item).length}</span>
                </button>
              ))}
            </div>
            <div className="policy-filter-footnote">
              <strong>วิธีอ่าน</strong>
              <p>สรุปคือเจตนาของข้อนั้น · “ระบบบังคับที่” คือจุดที่ระบบไม่ยอมให้ทำผิด · เปิดรายละเอียดเพื่อดูสิ่งที่ต้องทำและหลักฐานที่ต้องเหลือไว้</p>
            </div>
          </aside>

          <div className="policy-list-panel">
            <div className="policy-list-heading">
              <div><div className="policy-section-kicker">ข้อกำหนด</div><h2>สิ่งที่ต้องทำในระบบนี้</h2></div>
              <span>{filteredPolicies.length} รายการ</span>
            </div>
            {filteredPolicies.length === 0 ? (
              <div className="policy-empty">ไม่พบข้อกำหนดที่ตรงกับการค้นหา</div>
            ) : (
              filteredPolicies.map((policy) => {
                const isExpanded = expanded === policy.code;
                return (
                  <article className={`policy-card ${isExpanded ? 'expanded' : ''}`} key={policy.code}>
                    <div className="policy-card-topline">
                      <span className="policy-code">{policy.code}</span>
                      <span className="policy-category">{policy.category}</span>
                      <span className="policy-status">ใช้อยู่จริง</span>
                    </div>
                    <div className="policy-card-main">
                      <div className="policy-card-icon">{policy.code.split('-')[0]}</div>
                      <div className="policy-card-copy">
                        <h3>{policy.title}</h3>
                        <p>{policy.summary}</p>
                        <div className="policy-meta">
                          <span>ผู้รับผิดชอบ: {policy.owner}</span>
                          <span>ผู้เกี่ยวข้อง: {policy.scope}</span>
                        </div>
                      </div>
                    </div>
                    <div className="policy-card-actions">
                      <button className="ghost-button" onClick={() => setExpanded(isExpanded ? null : policy.code)} aria-expanded={isExpanded}>
                        {isExpanded ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'} <span>{isExpanded ? '⌃' : '⌄'}</span>
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="policy-detail-grid">
                        <div>
                          <h4>สิ่งที่ต้องทำ</h4>
                          <ul>{policy.controls.map((control) => <li key={control}>{control}</li>)}</ul>
                        </div>
                        <div>
                          <h4>หลักฐานที่ต้องเหลือไว้</h4>
                          <ul>{policy.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
                          <h4 style={{ marginTop: 14 }}>ระบบบังคับข้อนี้ที่</h4>
                          <ul><li>{policy.enforcedBy}</li></ul>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      ) : (
        <section id="handbook" className="handbook-content">
          <div className="handbook-intro">
            <div>
              <div className="policy-section-kicker">ขั้นตอน</div>
              <h2>สามกระบวนการที่ทำในระบบนี้</h2>
              <p>แต่ละกระบวนการมีลำดับคงที่และข้ามขั้นไม่ได้ ทำตามลำดับเดียวกันทุกครั้ง เพื่อให้ผู้รับผิดชอบชัดและตรวจย้อนหลังได้</p>
            </div>
            <div className="handbook-version">
              <span>ทั้งหมด</span>
              <strong>{totalSteps} ขั้น</strong>
              <small>ใน {flows.length} กระบวนการ</small>
            </div>
          </div>

          {flows.map((flow) => (
            <section className="handbook-panel" key={flow.key} style={{ padding: 0, border: 0 }}>
              <div className="policy-section-kicker">{flow.label}</div>
              <h2 style={{ margin: '4px 0 4px' }}>{flow.title}</h2>
              <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: '0.82rem' }}>{flow.note}</p>
              <div className="workflow-timeline" style={{ ['--steps' as string]: flow.steps.length }}>
                {flow.steps.map((step, index) => (
                  <div className="workflow-step" key={step.no}>
                    <div className="workflow-number">{step.no}</div>
                    <div className="workflow-line" />
                    <div className="workflow-copy">
                      <span>{step.owner}</span>
                      <h3>{step.title}</h3>
                      <p>{step.detail}</p>
                    </div>
                    {index < flow.steps.length - 1 && <div className="workflow-arrow">→</div>}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <div className="handbook-two-column">
            <section className="handbook-panel">
              <div className="policy-section-kicker">แยกหน้าที่</div>
              <h2>ใครทำอะไรในระบบ</h2>
              <div className="role-table-wrap">
                <table className="role-table">
                  <thead><tr><th>บทบาท</th><th>ทำอะไรได้</th><th>ข้อกำหนดสำคัญ</th></tr></thead>
                  <tbody>{roleMatrix.map((row) => <tr key={row.role}><td><strong>{row.role}</strong></td><td>{row.can}</td><td>{row.must}</td></tr>)}</tbody>
                </table>
              </div>
              <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '0.76rem', lineHeight: 1.55 }}>
                สิทธิ์ส่วนใหญ่มาจาก<strong>หน่วยงาน</strong>ของบัญชี ไม่ใช่การตั้งค่ารายคน — ย้ายคนข้ามหน่วยงานแล้วสิทธิ์เปลี่ยนตามทันที
              </p>
            </section>
            <section className="handbook-panel">
              <div className="policy-section-kicker">กฎที่ต้องทำ</div>
              <h2>กฎที่ห้ามยกเว้นเอง</h2>
              <div className="rules-list">{rules.map((rule, index) => <div key={rule}><span>{String(index + 1).padStart(2, '0')}</span><p>{rule}</p></div>)}</div>
            </section>
          </div>

          <section className="handbook-panel incident-panel">
            <div>
              <div className="policy-section-kicker">เมื่อมีปัญหา</div>
              <h2>เจอเคสนี้ ให้ทำตามนี้</h2>
            </div>
            <div className="incident-grid">
              {incidents.map((item) => <div key={item.title}><strong>{item.title}</strong><p>{item.detail}</p></div>)}
            </div>
          </section>
        </section>
      )}

      <footer className="policy-footer">
        <div>
          <strong>คู่มือระบบรับ–ส่งเอกสารและเงินสดสาขา</strong>
          <span>ทบทวนเมื่อขั้นตอนหรือหน้าจอเปลี่ยน · ข้อที่ระบบบังคับไม่ได้แล้ว ให้ลบออกจากคู่มือ ไม่เก็บไว้เป็นข้อความลอย</span>
        </div>
      </footer>
    </div>
  );
}
