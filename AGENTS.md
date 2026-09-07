# คำแนะนำสำหรับ Agent (AGENTS.md)

มาตรฐานนี้บังคับใช้กับ AI agent/coding assistant **ทุกตัว** ที่ทำงานในโปรเจกต์นี้ (Claude, Copilot, Cursor, หรือเครื่องมืออื่นที่อ่านไฟล์นี้) ไม่ใช่เฉพาะเซสชันใดเซสชันหนึ่ง

## 1. ภาษาที่ใช้ตอบ

ให้ตอบและอธิบายเป็น **ภาษาไทยเป็นหลัก** เสมอ ไม่ว่าผู้ใช้จะพิมพ์คำถามเป็นภาษาอะไรก็ตาม
- ชื่อไฟล์, ชื่อฟังก์ชัน, คำสั่ง, error message ที่คัดลอกมาจากระบบ ให้คงไว้เป็นภาษาอังกฤษตามต้นฉบับได้
- คำอธิบาย สรุปผล และการสื่อสารกับผู้ใช้ ให้เขียนเป็นภาษาไทย
- ระหว่างรันคำสั่ง/แก้โค้ด ข้อความสรุปขั้นตอนที่กำลังทำ ให้ใช้ภาษาไทย

## 2. ดีไซน์ระบบ

โปรเจกต์นี้มีระบบดีไซน์ของตัวเองแล้วที่ [DESIGN.md](DESIGN.md) — ให้ยึดไฟล์นั้นเป็นมาตรฐานเดียว (สี, ระยะ, component, contrast) ห้ามคิดค่าใหม่หรือ hardcode hex/rgba ที่ไม่มีอยู่ใน CSS variable ของ `ui-kit/ui-kit.css`

## 3. รูปแบบโค้ดที่ต้องทำตาม

- **Stack**: Next.js 15 (App Router, `src/app/...`), React 18, TypeScript, Supabase (Postgres) ผ่าน `src/lib/supabase/*`, API routes แบบ REST ใน `src/app/api/*`
- ไม่มี component library แยก (ไม่ใช้ MUI/Chakra/shadcn) — สไตล์มาจาก `src/app/globals.css` และ `ui-kit/ui-kit.css` เป็น class สำเร็จรูป (`.search-panel`, `.search-form`, `.table-wrap`, `.segmented-control`, `.status-badge` ฯลฯ) **ก่อนเขียน UI ใหม่ ให้หา pattern ที่มีอยู่แล้วในหน้าอื่นมาใช้ซ้ำก่อนเสมอ** อย่าสร้าง component หรือ CSS class ใหม่ซ้ำซ้อนของเดิม
- Tailwind มีอยู่ใน devDependencies แต่ถือว่าไม่ได้ใช้งานจริงในหน้าเว็บ — อย่าเริ่มใช้ utility class ของ Tailwind ในหน้าที่ยังไม่มี ให้ตามแบบ `ui-kit.css` เดิม
- คอมเมนต์ในโค้ดเขียนเป็นภาษาไทย และเขียนเฉพาะตอนอธิบาย **เหตุผลที่ไม่ชัดเจนจากโค้ด** (workaround, edge case, ทำไมถึงเลือกวิธีนี้) ห้ามคอมเมนต์อธิบายสิ่งที่โค้ดสื่อสารอยู่แล้ว
- ไม่เพิ่ม abstraction, error handling, หรือ validation สำหรับกรณีที่ไม่มีทางเกิดขึ้นจริงในระบบ ทำเท่าที่ task ต้องการ

## 4. รูปแบบ commit

ตาม pattern ที่ใช้อยู่ใน git log: `<type>: <สรุปสั้น ๆ เน้น "ทำไม" มากกว่า "ทำอะไร">` โดย `<type>` เป็นภาษาอังกฤษ (`feat`, `fix`, `refactor`, `docs`) ส่วนข้อความอธิบายจะเป็นภาษาไทยหรืออังกฤษก็ได้ตามความเหมาะสมของคำนั้น ๆ (เช่น `feat: sign every stage from the queue, in a popup and in bulk`, `fix: route ใบเบิก to the accounting team that actually handles it`)