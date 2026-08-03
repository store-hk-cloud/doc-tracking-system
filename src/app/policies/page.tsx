'use client';

import { useMemo, useState } from 'react';

type Policy = {
  code: string;
  title: string;
  category: string;
  scope: string;
  summary: string;
  owner: string;
  cadence: string;
  source?: string;
  sourceLabel?: string;
  controls: string[];
  evidence: string[];
};

const policies: Policy[] = [
  {
    code: 'ORG-01',
    title: 'ปรัชญาองค์กรและนวัตกรรม',
    category: 'องค์กร',
    scope: 'ทุกหน่วยงาน',
    summary: 'ใช้กรอบ H-Innovation for Lives เป็นหลักในการตัดสินใจ: รากฐานจากเกษตรพื้นที่สูง สร้างนวัตกรรมจากทรัพยากรและความรู้ท้องถิ่น และส่งมอบคุณค่าที่ดีต่อชีวิตผู้คน',
    owner: 'ผู้บริหารองค์กร',
    cadence: 'ทบทวนทุกปี',
    source: 'https://hillkoff.com/วิสัยทัศน์และพันธกิจ-2',
    sourceLabel: 'วิสัยทัศน์และพันธกิจ',
    controls: ['ทุกโครงการต้องระบุคุณค่าที่ส่งมอบให้ผู้มีส่วนได้ส่วนเสีย', 'สนับสนุนการทดลองและการปรับปรุงจากข้อมูลจริง', 'ใช้แผนระยะกลางและระยะยาวประกอบการตัดสินใจ'],
    evidence: ['บันทึกการประชุม/มติอนุมัติ', 'ตัวชี้วัดผลลัพธ์ของโครงการ', 'บทเรียนหลังจบงาน'],
  },
  {
    code: 'ESG-02',
    title: 'ความยั่งยืนและธรรมาภิบาล',
    category: 'ESG / SDGs',
    scope: 'ทุกหน่วยงานและคู่ค้า',
    summary: 'ปรับใช้แนวคิดความสมดุลระหว่างชุมชน ผู้คน สิ่งแวดล้อม และผลประกอบการ โดยเชื่อมโยง ESG/SDGs เข้ากับกระบวนการทำงานและการตัดสินใจ',
    owner: 'คณะทำงานความยั่งยืน',
    cadence: 'รายไตรมาส',
    source: 'https://hillkoff.com/sustainabilitycoffee',
    sourceLabel: 'พันธกิจเพื่อความยั่งยืน',
    controls: ['ประเมินผลกระทบด้านสิ่งแวดล้อมและสังคมก่อนเริ่มโครงการสำคัญ', 'เปิดเผยข้อมูลอย่างตรวจสอบย้อนกลับได้', 'เลือกแนวทางที่ลดการสูญเสียและใช้ทรัพยากรอย่างคุ้มค่า'],
    evidence: ['แบบประเมิน ESG', 'รายงานการใช้ทรัพยากร/ของเสีย', 'รายงานผลต่อชุมชนและคู่ค้า'],
  },
  {
    code: 'FS-03',
    title: 'ความปลอดภัยอาหารและคุณภาพ',
    category: 'คุณภาพและความปลอดภัย',
    scope: 'วัตถุดิบ ผลิต จัดเก็บ และขนส่ง',
    summary: 'ยึดหลัก ISO 22000:2018, GHPs และ HACCP เพื่อควบคุมอันตรายตลอดห่วงโซ่ ตั้งแต่วัตถุดิบจนถึงผู้บริโภค รวมถึงการสื่อสารและการตรวจสอบย้อนกลับ',
    owner: 'ฝ่ายคุณภาพ / Food Safety Team',
    cadence: 'ตามแผนตรวจประเมิน',
    source: 'https://hillkoff.com/มาตรฐาน-ความปลอดภัย-ด้านอาหาร',
    sourceLabel: 'มาตรฐานความปลอดภัยด้านอาหาร',
    controls: ['รับสินค้าโดยตรวจจำนวน สภาพ บรรจุภัณฑ์ และเอกสารประกอบ', 'แยกกักสินค้าที่ไม่เป็นไปตามข้อกำหนดและแจ้งผู้รับผิดชอบ', 'เก็บบันทึกล็อต/เลขที่เอกสารเพื่อเรียกดูย้อนหลังได้'],
    evidence: ['ใบรับสินค้าและรูปความเสียหาย', 'บันทึกการตรวจสอบคุณภาพ', 'หลักฐานการแก้ไขและป้องกันปัญหา'],
  },
  {
    code: 'FS-04',
    title: 'ฮาลาลและการควบคุมการปนเปื้อน',
    category: 'คุณภาพและความปลอดภัย',
    scope: 'ผลิตภัณฑ์และกระบวนการที่เกี่ยวข้อง',
    summary: 'คงความบริสุทธิ์ของวัตถุดิบ ความสะอาดปลอดภัย และการควบคุมกระบวนการตั้งแต่วัตถุดิบ การผลิต การจัดเก็บ จนถึงการขนส่ง โดยเคารพความเชื่อของผู้บริโภคทุกกลุ่ม',
    owner: 'ฝ่ายคุณภาพ / ผู้ประสานงานฮาลาล',
    cadence: 'ตามรอบใบรับรอง',
    source: 'https://hillkoff.com/มาตรฐาน-ความปลอดภัย-ด้านอาหาร',
    sourceLabel: 'มาตรฐานความปลอดภัยด้านอาหาร',
    controls: ['ตรวจสอบแหล่งที่มาและเอกสารรับรองของวัตถุดิบ', 'ป้องกันการปนเปื้อนทางตรงและทางอ้อม', 'แจ้งเหตุผิดปกติและหยุดการใช้สินค้าที่มีความเสี่ยงทันที'],
    evidence: ['เอกสารรับรอง/ใบอนุญาต', 'บันทึกการตรวจรับ', 'บันทึกการกักกันและปล่อยสินค้า'],
  },
  {
    code: 'SV-05',
    title: 'คุณภาพการให้บริการและกิจการเพื่อสังคม',
    category: 'บริการ',
    scope: 'งานบริการ ลูกค้า และผู้มาติดต่อ',
    summary: 'ให้บริการด้วยมาตรฐานที่สม่ำเสมอ โปร่งใส และคำนึงถึงผลกระทบต่อสังคม พร้อมนำข้อเสนอแนะมาปรับปรุงประสบการณ์ของผู้รับบริการ',
    owner: 'หัวหน้าหน่วยงานบริการ',
    cadence: 'รายเดือน',
    source: 'https://hillkoff.com/มาตรฐานให้บริการ-มอก-เอส',
    sourceLabel: 'มาตรฐานคุณภาพการให้บริการ',
    controls: ['สื่อสารขั้นตอน ระยะเวลา และผู้รับผิดชอบให้ชัดเจน', 'รับเรื่องร้องเรียนและติดตามจนปิดประเด็น', 'ทบทวนข้อผิดพลาดเชิงระบบ ไม่มุ่งโทษบุคคล'],
    evidence: ['บันทึกคำขอ/ข้อร้องเรียน', 'SLA และเวลาปิดงาน', 'ผลสำรวจความพึงพอใจ'],
  },
  {
    code: 'ENV-06',
    title: 'สิ่งแวดล้อม คาร์บอน และเกษตรอินทรีย์',
    category: 'สิ่งแวดล้อม',
    scope: 'การดำเนินงาน ผลิตภัณฑ์ และห่วงโซ่อุปทาน',
    summary: 'ลดผลกระทบต่อสิ่งแวดล้อมผ่านการวัดและลดคาร์บอน การจัดการทรัพยากร การออกแบบสีเขียว และการสนับสนุนมาตรฐานสินค้าเกษตร/เกษตรอินทรีย์',
    owner: 'คณะทำงานสิ่งแวดล้อม',
    cadence: 'รายไตรมาส',
    source: 'https://hillkoff.com/มาตรฐานสิ่งแวดล้อมและเกษตรอินทรีย์',
    sourceLabel: 'มาตรฐานสิ่งแวดล้อมและเกษตรอินทรีย์',
    controls: ['ติดตามการใช้พลังงาน น้ำ วัตถุดิบ และการเกิดของเสีย', 'ลดการใช้วัสดุสิ้นเปลืองและเพิ่มการใช้ซ้ำ/รีไซเคิล', 'ตรวจสอบข้อกล่าวอ้างด้านสิ่งแวดล้อมก่อนสื่อสารภายนอก'],
    evidence: ['ข้อมูล Carbon Footprint', 'บันทึกการจัดการของเสีย', 'เอกสารรับรองสินค้า/กระบวนการ'],
  },
  {
    code: 'DOC-07',
    title: 'การควบคุมเอกสารภายใน',
    category: 'ระบบเอกสาร',
    scope: 'ผู้ใช้งานระบบทุกคน',
    summary: 'กำหนดให้เอกสารทุกฉบับมีเจ้าของ ผู้ตรวจสอบ สถานะ และหลักฐานการส่งมอบที่ตรวจสอบย้อนหลังได้ ลดความเสี่ยงจากเอกสารตกหล่น ซ้ำซ้อน หรือเข้าถึงโดยไม่เหมาะสม',
    owner: 'ผู้ดูแลระบบ / ธุรการ',
    cadence: 'ทบทวนทุก 6 เดือน',
    controls: ['ลงทะเบียนเอกสารทันทีที่รับเข้า พร้อมเลขที่เอกสารและหน่วยงานปลายทาง', 'แยกหน้าที่ผู้บันทึก ผู้ส่งมอบ ผู้รับ และผู้ตรวจสอบ', 'ปิดงานเมื่อมีหลักฐานครบและจัดการข้อยกเว้นตามขั้นตอน'],
    evidence: ['ประวัติสถานะและลายเซ็น', 'ใบรับสินค้า/รูปความเสียหาย', 'รายงานติดตามและบันทึกการแก้ไข'],
  },
];

const categories = ['ทั้งหมด', ...Array.from(new Set(policies.map((policy) => policy.category)))];

const workflowSteps = [
  { no: '01', title: 'ลงทะเบียนรับเข้า', owner: 'ธุรการ / Admin', detail: 'เลือกประเภทเอกสาร กรอกวันที่ เลขที่เอกสาร ผู้ส่ง เรื่อง และหน่วยงานผู้รับ ตรวจทานก่อนกดบันทึก' },
  { no: '02', title: 'ตรวจสอบความครบถ้วน', owner: 'ผู้ตรวจสอบ / จัดซื้อ', detail: 'สำหรับใบรับสินค้า ให้ตรวจจำนวน สภาพสินค้า เอกสารประกอบ และบันทึกชื่อหรือลายเซ็นในช่องที่กำหนด' },
  { no: '03', title: 'ส่งมอบให้หน่วยงาน', owner: 'Admin', detail: 'ตรวจรายการและเลขที่เอกสารก่อนส่งมอบ ลงลายเซ็นผู้ส่งมอบ แล้วระบบจะแจ้งหน่วยงานปลายทาง' },
  { no: '04', title: 'รับและยืนยันเอกสาร', owner: 'หน่วยงานผู้รับ', detail: 'เปิดรายการที่ได้รับ ตรวจสอบความถูกต้อง เลือกยืนยันหรือแจ้งปัญหา และลงชื่อรับด้วยบัญชีของตนเอง' },
  { no: '05', title: 'ติดตามและปิดงาน', owner: 'Admin / ผู้ตรวจสอบ', detail: 'ติดตามสถานะจากหน้าติดตาม ตรวจรายการแจ้งปัญหา ส่งมอบใหม่เมื่อจำเป็น และปิดงานเมื่อหลักฐานครบ' },
];

const roleMatrix = [
  { role: 'ผู้ลงทะเบียน', can: 'สร้างรายการ / แนบหลักฐาน', must: 'กรอกข้อมูลจริง ตรวจทานก่อนบันทึก' },
  { role: 'Admin / ธุรการ', can: 'ตรวจสอบ ส่งมอบ แก้ไขตามสิทธิ์', must: 'แยกหน้าที่และลงชื่อทุกครั้งที่ส่งมอบ' },
  { role: 'หน่วยงานผู้รับ', can: 'ตรวจรับ ยืนยัน หรือแจ้งปัญหา', must: 'ใช้บัญชีตนเองและตรวจเอกสารก่อนลงชื่อ' },
  { role: 'ผู้ตรวจสอบ / จัดซื้อ', can: 'ตรวจคุณภาพและความครบถ้วน', must: 'บันทึกผลตามหลักฐาน ห้ามข้ามขั้นตอน' },
  { role: 'Super Admin', can: 'กำกับผู้ใช้ หน่วยงาน และข้อมูลระบบ', must: 'ใช้สิทธิ์สูงเท่าที่จำเป็นและตรวจ audit trail' },
];

const rules = [
  'ห้ามใช้บัญชีผู้อื่นลงชื่อรับหรือยืนยันเอกสาร',
  'ห้ามลบหรือแก้ไขข้อมูลเพื่อปกปิดข้อผิดพลาด ให้ใช้กระบวนการแจ้งปัญหาและแก้ไขแทน',
  'เอกสารเสียหายต้องถ่ายรูปและแนบหลักฐานก่อนส่งต่อ',
  'เอกสารที่มีข้อมูลส่วนบุคคลให้เปิดเผยเฉพาะผู้ที่จำเป็นต้องใช้',
  'ทุกข้อยกเว้นต้องมีหมายเหตุ ผู้รับผิดชอบ และหลักฐานประกอบ',
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
      const searchable = [policy.code, policy.title, policy.category, policy.scope, policy.summary, ...policy.controls].join(' ').toLowerCase();
      return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [category, query]);

  return (
    <div className="policy-page">
      <section className="policy-hero">
        <div className="policy-hero-copy">
          <div className="title-badge">◈ POLICY & HANDBOOK</div>
          <h1>ศูนย์นโยบายและคู่มือการปฏิบัติงาน</h1>
          <p>กรอบกำกับดูแลสำหรับการรับ–ส่งเอกสารภายใน ให้ทุกหน่วยงานทำงานด้วยมาตรฐานเดียวกัน ตรวจสอบย้อนหลังได้ และปรับปรุงอย่างต่อเนื่อง</p>
          <div className="policy-hero-actions">
            <button className="secondary-button" onClick={() => document.getElementById('policy-content')?.scrollIntoView({ behavior: 'smooth' })}>เปิดดูข้อกำหนด</button>
            <a className="ghost-button policy-link-button" href="https://hillkoff.com/" target="_blank" rel="noopener noreferrer">ดูเว็บไซต์หลัก ↗</a>
          </div>
        </div>
        <div className="policy-hero-panel">
          <div className="policy-hero-panel-label">CONTROL CENTER</div>
          <strong>HILLKOFF INTERNAL STANDARD</strong>
          <span>Version 1.0 · Owner: Admin Office</span>
          <div className="policy-hero-meter"><span style={{ width: '86%' }} /></div>
          <small>ใช้เป็นแนวทางการปฏิบัติงานและการควบคุมเอกสารภายใน</small>
        </div>
      </section>

      <div className="policy-notice">
        <span className="policy-notice-icon">i</span>
        <div><strong>ขอบเขตและการอ้างอิง</strong><br />เนื้อหานี้เป็นแนวทางปฏิบัติภายในที่สรุปจากข้อมูลสาธารณะของเว็บไซต์ Hillkoff และปรับให้เข้ากับระบบเอกสาร ไม่แทนใบรับรอง มาตรฐานฉบับเต็ม หรือคำแนะนำทางกฎหมาย</div>
      </div>

      <div className="policy-metrics">
        <div><span>กรอบนโยบาย</span><strong>{policies.length}</strong><small>Policy domains</small></div>
        <div><span>กระบวนการหลัก</span><strong>{workflowSteps.length}</strong><small>Controlled steps</small></div>
        <div><span>บทบาทในระบบ</span><strong>{roleMatrix.length}</strong><small>Segregation of duties</small></div>
        <div><span>หลักควบคุมสำคัญ</span><strong>{rules.length}</strong><small>Mandatory rules</small></div>
      </div>

      <div className="policy-tabs" role="tablist" aria-label="ศูนย์นโยบายและคู่มือ">
        <button className={activeTab === 'policies' ? 'active' : ''} onClick={() => setActiveTab('policies')} role="tab" aria-selected={activeTab === 'policies'}>กรอบนโยบายและข้อกำหนด</button>
        <button className={activeTab === 'handbook' ? 'active' : ''} onClick={() => setActiveTab('handbook')} role="tab" aria-selected={activeTab === 'handbook'}>คู่มือการใช้งานระบบ</button>
      </div>

      {activeTab === 'policies' ? (
        <section id="policy-content" className="policy-content-grid">
          <aside className="policy-filter-panel">
            <div className="policy-section-kicker">CONTROL LIBRARY</div>
            <h2>ค้นหาข้อกำหนด</h2>
            <label className="policy-search">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหานโยบายหรือคำสำคัญ" aria-label="ค้นหานโยบาย" />
            </label>
            <div className="policy-category-list" role="listbox" aria-label="กรองตามหมวดหมู่">
              {categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}<span>{item === 'ทั้งหมด' ? policies.length : policies.filter((policy) => policy.category === item).length}</span></button>)}
            </div>
            <div className="policy-filter-footnote"><strong>หลักการใช้งาน</strong><p>อ่าน Summary เพื่อเข้าใจเจตนารมณ์ และเปิดรายละเอียดเพื่อดู Control กับ Evidence ที่ต้องเก็บ</p></div>
          </aside>

          <div className="policy-list-panel">
            <div className="policy-list-heading"><div><div className="policy-section-kicker">POLICY REGISTER</div><h2>ทะเบียนนโยบายองค์กร</h2></div><span>{filteredPolicies.length} รายการ</span></div>
            {filteredPolicies.length === 0 ? <div className="policy-empty">ไม่พบข้อกำหนดที่ตรงกับการค้นหา</div> : filteredPolicies.map((policy) => {
              const isExpanded = expanded === policy.code;
              return (
                <article className={`policy-card ${isExpanded ? 'expanded' : ''}`} key={policy.code}>
                  <div className="policy-card-topline"><span className="policy-code">{policy.code}</span><span className="policy-category">{policy.category}</span><span className="policy-status">แนวทางใช้งาน</span></div>
                  <div className="policy-card-main"><div className="policy-card-icon">{policy.code.split('-')[0]}</div><div className="policy-card-copy"><h3>{policy.title}</h3><p>{policy.summary}</p><div className="policy-meta"><span>Owner: {policy.owner}</span><span>Review: {policy.cadence}</span><span>Scope: {policy.scope}</span></div></div></div>
                  <div className="policy-card-actions"><button className="ghost-button" onClick={() => setExpanded(isExpanded ? null : policy.code)} aria-expanded={isExpanded}>{isExpanded ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'} <span>{isExpanded ? '⌃' : '⌄'}</span></button>{policy.source && <a href={policy.source} target="_blank" rel="noopener noreferrer">อ้างอิง: {policy.sourceLabel} ↗</a>}</div>
                  {isExpanded && <div className="policy-detail-grid"><div><h4>Control requirements</h4><ul>{policy.controls.map((control) => <li key={control}>{control}</li>)}</ul></div><div><h4>Evidence to retain</h4><ul>{policy.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div></div>}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section id="handbook" className="handbook-content">
          <div className="handbook-intro"><div><div className="policy-section-kicker">OPERATING HANDBOOK</div><h2>คู่มือใช้งานระบบเอกสารภายใน</h2><p>ทำตามลำดับขั้นตอนเดียวกันทุกครั้ง เพื่อให้ข้อมูลครบ ผู้รับผิดชอบชัด และสามารถตรวจสอบย้อนหลังได้</p></div><div className="handbook-version"><span>QUICK START</span><strong>5 ขั้นตอน</strong><small>จากรับเข้า ถึงปิดงาน</small></div></div>

          <div className="workflow-timeline">{workflowSteps.map((step, index) => <div className="workflow-step" key={step.no}><div className="workflow-number">{step.no}</div><div className="workflow-line" /><div className="workflow-copy"><span>{step.owner}</span><h3>{step.title}</h3><p>{step.detail}</p></div>{index < workflowSteps.length - 1 && <div className="workflow-arrow">→</div>}</div>)}</div>

          <div className="handbook-two-column"><section className="handbook-panel"><div className="policy-section-kicker">ROLE MATRIX</div><h2>ใครทำอะไรในระบบ</h2><div className="role-table-wrap"><table className="role-table"><thead><tr><th>บทบาท</th><th>สิทธิ์หลัก</th><th>ข้อกำหนดสำคัญ</th></tr></thead><tbody>{roleMatrix.map((row) => <tr key={row.role}><td><strong>{row.role}</strong></td><td>{row.can}</td><td>{row.must}</td></tr>)}</tbody></table></div></section><section className="handbook-panel"><div className="policy-section-kicker">MANDATORY RULES</div><h2>กฎที่ต้องปฏิบัติ</h2><div className="rules-list">{rules.map((rule, index) => <div key={rule}><span>{String(index + 1).padStart(2, '0')}</span><p>{rule}</p></div>)}</div></section></div>

          <section className="handbook-panel incident-panel"><div><div className="policy-section-kicker">EXCEPTION PLAYBOOK</div><h2>เมื่อเอกสารมีปัญหา ให้ทำตามนี้</h2></div><div className="incident-grid"><div><strong>01 · พบข้อมูลไม่ครบ</strong><p>ยังไม่ต้องส่งมอบ ให้ติดต่อผู้ลงทะเบียนและแก้ไขให้ครบในสถานะลงทะเบียน</p></div><div><strong>02 · พบความเสียหาย</strong><p>ถ่ายรูป แนบหลักฐาน ระบุหมายเหตุ และแจ้งผู้ตรวจสอบ/จัดซื้อก่อนดำเนินการต่อ</p></div><div><strong>03 · ผู้รับแจ้งปัญหา</strong><p>ระบบจะเปลี่ยนเป็นแจ้งปัญหา Admin ตรวจสอบเหตุผลและใช้การส่งมอบใหม่เมื่อเหมาะสม</p></div><div><strong>04 · ต้องการตรวจสอบย้อนหลัง</strong><p>ใช้หน้าติดตามค้นหาด้วยเลขที่เอกสารหรือสถานะ และตรวจลายเซ็น/ผู้บันทึกประกอบ</p></div></div></section>
        </section>
      )}

      <footer className="policy-footer"><div><strong>Hillkoff Internal Document Control</strong><span>คู่มือฉบับนี้ควรทบทวนเมื่อมีการเปลี่ยนแปลงกระบวนการ ระบบ หรือมาตรฐานอ้างอิง</span></div><a href="https://hillkoff.com/ติดต่อเรา" target="_blank" rel="noopener noreferrer">ติดต่อสำนักงานใหญ่ ↗</a></footer>
    </div>
  );
}
