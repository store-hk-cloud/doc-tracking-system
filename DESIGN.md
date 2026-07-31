# ดีไซน์ระบบ — จดหมาย พัสดุ เอกสารภายใน

เอกสารนี้สรุประบบดีไซน์ (design system) ของแอปทั้งหมด ใช้เป็นข้อมูลอ้างอิงเวลาเพิ่ม/แก้หน้าใหม่ ให้หน้าตาสอดคล้องกันทั้งแอป

แนวทางหลัก: **Enterprise Dashboard** — เรียบ ทึบ ขอบเหลี่ยมมนเล็กน้อย เน้นความหนาแน่นของข้อมูล อ่านง่าย ไม่มีเอฟเฟกต์ตกแต่งแบบ Apple/iOS (glass blur, ปุ่มโค้งมนเต็ม, animation แบบ spring/pulse/bounce)

## 1. แบรนด์

- **โลโก้**: ตราสัญลักษณ์วงกลมของ Hillkoff (ลายใบชา/เมล็ดกาแฟ) ดึงจาก hillkoff.com จริง เก็บไว้ที่ [public/icons/hillkoff-emblem.png](public/icons/hillkoff-emblem.png) (160×160) ใช้แสดงในหน้า Login และ Sidebar
- **ไอคอน PWA**: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` สร้างจากโลโก้ต้นฉบับความละเอียด 600×600
- **ฟอนต์**: **Kanit** (ฟอนต์เดียวกับที่ hillkoff.com ใช้จริง) โหลดผ่าน `next/font/google` ใน [layout.tsx](src/app/layout.tsx) — self-host ไม่ยิง request ไป Google ตอน runtime

## 2. โทนสี (CSS variables ใน [ui-kit.css](ui-kit/ui-kit.css))

สีหลักดึงมาจาก hillkoff.com จริง (ตรวจสอบด้วย computed style จากเว็บจริง)

| ตัวแปร | โหมดสว่าง | โหมดมืด | ใช้ทำอะไร |
|---|---|---|---|
| `--primary` | `#058581` | `#1aa39d` | สีหลักของแบรนด์ (teal เข้ม) — ปุ่ม, ลิงก์, badge active |
| `--primary-strong` | `#046662` | `#51ddd7` | ข้อความบนพื้นสี soft, hover state เข้มขึ้น |
| `--primary-soft` | `rgba(5,133,129,0.1)` | `rgba(26,163,157,0.16)` | พื้นหลังอ่อนของ badge/active state |
| `--brand-accent` | `#00bac6` | เหมือนกัน | สี hover ของปุ่มหลัก (cyan-teal จากเว็บจริง) |
| `--brand-mint` | `#51ddd7` | เหมือนกัน | สี mint อ่อน สำรองไว้ใช้จุดเน้น |
| `--page` | `#eaf4f3` | `#04120f` | พื้นหลังทั้งหน้า (teal อ่อน ไม่ใช้ขาว/เทาแบบ iOS) |
| `--page-soft` | `#dcede9` | `#0c211e` | พื้นหลังรอง |
| `--surface` | `#ffffff` | `#14201f` | พื้นการ์ด/panel — **ทึบ ไม่โปร่งแสง** |
| `--surface-soft` | `#f3f8f7` | `#0f1918` | พื้นรองของการ์ด (แถบค้นหา, filter bar) |
| `--text` | `#1c1c1e` | `#f5f5f7` | ข้อความหลัก |
| `--muted` | `#6b7280` | `#9aa5a3` | ข้อความรอง/label |
| `--line` / `--line-strong` | เทาอ่อน/เข้ม | | เส้นขอบตาราง/การ์ด |

สีสถานะ (ความหมายสากล ไม่อิงแบรนด์): `--success` (เขียว), `--warning` (ส้ม/น้ำตาล), `--danger` (แดง) — แต่ละสีมีคู่ `-bg`/`-line` สำหรับพื้นหลัง/ขอบอ่อน

## 3. ระยะโค้งมุม, เงา (flat, ไม่ใช่ iOS)

| ตัวแปร | ค่า | เทียบกับของเดิม (iOS) |
|---|---|---|
| `--radius-sm` | 6px | เดิม 10px |
| `--radius-md` | 8px | เดิม 16px |
| `--radius-lg` | 10px | เดิม 22px |
| `--radius-full` | 999px | เท่าเดิม (ใช้เฉพาะ status badge ทรงแคปซูล) |
| `--shadow-sm` | `0 1px 2px rgba(16,24,32,.06)` | เดิมเป็นเงาหลายชั้นซ้อนแบบลอย (`0 20px 60px...`) |

**กฎ**: การ์ด/ปุ่มใช้เงาชั้นเดียวบางๆ เท่านั้น ห้ามใช้ `backdrop-filter` หรือพื้นหลังโปร่งแสง (`rgba(255,255,255,0.x)`) กับ panel เนื้อหา

## 4. Animation — นโยบาย

**ตัดออกเกือบทั้งหมด** ตามที่ตกลงกันไว้ เหลือเฉพาะที่จำเป็นจริง:

- ✅ `transition` สีพื้นหลัง/ขอบ/ข้อความ **0.15s ease** ตอน hover/focus — อนุญาต
- ✅ `.spin` (loading spinner หมุน) — อนุญาต เพราะเป็นตัวบ่งชี้การทำงานที่จำเป็น
- ✅ toast fade-in สั้นๆ (0.15s, fade อย่างเดียว ไม่มี slide) — อนุญาตเพื่อไม่ให้ข้อความแจ้งเตือนโผล่มากระชากสายตา
- ❌ **ห้าม**: hover lift (`translateY`), scale ตอนคลิก, rotate, glow/pulse ที่วนซ้ำไม่รู้จบ, การ์ด entrance animation, แถวตารางไล่ทยอยขึ้น (stagger), ตัวเลข "pop" ตอนโหลดเสร็จ

ถ้าจะเพิ่มฟีเจอร์ใหม่และคิดจะใส่ animation — ให้ถามตัวเองก่อนว่า "จำเป็นจริงไหม หรือแค่สวย" ถ้าไม่แน่ใจ ให้ไม่ใส่

## 5. Component patterns หลัก

| Component | Class | ลักษณะ |
|---|---|---|
| การ์ดเนื้อหา | `.side-panel`, `.scan-panel`, `.report-panel` | พื้นขาวทึบ ขอบบาง 1px เงาชั้นเดียว มุมมน 8px ไม่มี hover effect |
| ปุ่มหลัก | `.secondary-button` | พื้น `--primary` ตัวหนังสือขาว hover เปลี่ยนเป็น `--primary-strong` เท่านั้น (ไม่มี lift) |
| ปุ่มรอง | `.ghost-button` | ขอบเทา พื้นขาว hover เปลี่ยนเป็น `--surface-soft` |
| Badge สถานะ | `.status-badge` | แคปซูลเล็ก สี soft ตามสถานะ (success/warning/danger) ไม่มี hover animation |
| ตาราง | `table`, `th`, `td` | เส้นบางชัดเจน (`border-bottom: 1px solid var(--line)`), แถวคู่มีพื้นเทาอ่อนสลับ (zebra), hover เปลี่ยนพื้นเป็น `--primary-soft` |
| Segmented control (ตัวกรอง) | `.segmented-control` | กล่องขอบบาง ปุ่ม active มีพื้น `--primary-soft` |

## 6. ตัวอย่างการใช้งานสี/ฟอนต์ในไฟล์จริง

```css
.app-title {
  border-bottom: 1px solid var(--line);
}
.title-badge {
  background: var(--primary-soft);
  color: var(--primary-strong);
  border-radius: var(--radius-sm);
}
```

ฟอนต์ทั้งระบบ:
```css
font-family: var(--font-kanit), -apple-system, ..., sans-serif;
```
(`var(--font-kanit)` มาก่อนเสมอ — fallback ไว้เผื่อฟอนต์โหลดไม่ทันเท่านั้น)

## 7. ไฟล์ที่เกี่ยวข้อง

- [ui-kit/ui-kit.css](ui-kit/ui-kit.css) — ระบบดีไซน์หลักทั้งหมด (tokens + component styles)
- [src/app/globals.css](src/app/globals.css) — override เฉพาะเลย์เอาต์แอป (topbar, sidebar, mobile nav, form, toast)
- [src/app/layout.tsx](src/app/layout.tsx) — โหลดฟอนต์ Kanit + PWA metadata
- [public/manifest.json](public/manifest.json) — theme color, ชื่อแอพ, ไอคอน PWA
- [public/icons/hillkoff-emblem.png](public/icons/hillkoff-emblem.png) — โลโก้ต้นฉบับ

## 8. ก่อนเพิ่มดีไซน์ใหม่

เช็กลิสต์ก่อน commit ทุกครั้งที่แก้ UI:
- [ ] ใช้ตัวแปรสีจาก `:root` เท่านั้น ห้าม hardcode hex/rgba ใหม่
- [ ] ไม่มี `backdrop-filter` หรือพื้นหลังโปร่งแสงกับการ์ดเนื้อหา
- [ ] มุมโค้งใช้ `--radius-sm/md/lg` เท่านั้น ไม่เกิน 10px สำหรับการ์ด
- [ ] ไม่มี hover lift/scale/rotate ปุ่มหรือการ์ด — เปลี่ยนแค่สี
- [ ] Animation ใหม่ต้องมีเหตุผลเชิงฟังก์ชัน (บอกสถานะ, ไม่ใช่แค่ตกแต่ง)
