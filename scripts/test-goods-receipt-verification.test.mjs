import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { loadModule } from './test-support/load-module.mjs';
const id = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-0000-0000-000000000002';
async function fixture(stage = 'inspector') {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE document_recipients (id uuid PRIMARY KEY, document_id uuid, department_id uuid, status text,
      inspector_signature text, inspector_signed_by uuid, inspector_signed_at timestamptz,
      purchasing_signature text, purchasing_signed_by uuid, purchasing_signed_at timestamptz);
    CREATE TABLE document_approval_audit (document_recipient_id uuid, stage text, action text CHECK(action IN ('signed','updated','reset')),
      signature text, previous_signature text, actor_id uuid, actor_name text);
    INSERT INTO document_recipients(id,document_id,department_id,status) VALUES ('${id}','${id}','${id}','awaiting_${stage}');`);
  const migration = readdirSync('supabase/migrations').find(n => n.endsWith('_goods_receipt_stage_verification.sql'));
  const old = readFileSync('supabase/migrations/024_atomic_document_writes.sql','utf8');
  await db.exec(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION sign_goods_receipt_stage'), old.indexOf('-- ── 2)')));
  if (migration) {
    const sql = readFileSync(`supabase/migrations/${migration}`, 'utf8');
    await db.exec(sql);
    await db.exec(sql);
  }
  const rpc = async (name, a) => {
    try {
      const sql = name === 'sign_goods_receipt_stage'
        ? (migration ? 'SELECT sign_goods_receipt_stage($1,$2,$3,$4,$5,$6,$7,$8) AS result' : 'SELECT sign_goods_receipt_stage($1,$2,$3,$4,$5,$6) AS result')
        : 'SELECT reset_goods_receipt_stages($1,$2,$3) AS result';
      const args = name === 'sign_goods_receipt_stage'
        ? [a.p_recipient_id,a.p_stage,a.p_signature,a.p_actor_id,a.p_actor_name,a.p_allowed_status,a.p_is_verified,a.p_verification_note]
        : [a.p_recipient_id,a.p_actor_id,a.p_actor_name];
      return { data: (await db.query(sql, !migration && name === 'sign_goods_receipt_stage' ? args.slice(0,6) : args)).rows[0].result, error:null };
    } catch(error) { return {data:null,error}; }
  };
  const supabase = { rpc, from(table) { const q = {select(){return q;},eq(){return q;},async single(){
    if(table==='document_recipients') { const row=(await db.query('SELECT * FROM document_recipients')).rows[0]; return {data:{...row,documents:{subject:'ใบรับสินค้า'}}}; }
    if(table==='documents') return {data:{id,subject:'ใบรับสินค้า'}};
    return {data:{full_name:'ผู้ตรวจ',name:'บัญชี'}};
  }}; return q; }};
  let department = stage === 'inspector' ? '0-ADM04' : '0-BSN10';
  const route = loadModule('src/app/api/documents/[id]/sign/route.ts', {
    '@/lib/supabase/admin':{getServiceSupabase:()=>supabase},
    '@/lib/supabase/auth-helpers':{requireRoles:async()=>({context:{user:{id:actor},profile:{role:'admin',department_code:department}}}),forbiddenResponse:()=>Response.json({}, {status:403})},
    '@/lib/google-sheets':{syncRowInSheet:async()=>{}}, '@/lib/upstash':{notifyDepartment:async()=>{}}
  });
  return {db,rpc, department:(v)=>department=v, call:(body={})=>route.PUT({json:async()=>({[`${stage}_signature`]:'ผู้ตรวจ',...body})},{params:Promise.resolve({id})}), row:async()=>(await db.query('SELECT * FROM document_recipients')).rows[0]};
}
for (const stage of ['inspector','purchasing']) {
  test(`${stage}: rejects with a trimmed reason and immutable audit`,async()=>{const f=await fixture(stage);try{
    const response = await f.call({is_verified:false,verification_note:'  รายการผิด  '});
    assert.equal(response.status,200);
    const data = (await response.json()).data;
    assert.equal(data.rejection_stage,stage);
    assert.equal(data.rejection_note,'รายการผิด');
    const row=await f.row(); assert.equal(row.status,'rejected');assert.equal(row[`${stage}_verified`],false);assert.equal(row[`${stage}_verification_note`],'รายการผิด');
    const audit=(await f.db.query('SELECT action,is_verified,verification_note FROM document_approval_audit')).rows;
    assert.deepEqual(audit,[{action:'rejected',is_verified:false,verification_note:'รายการผิด'}]);
  }finally{await f.db.close();}});
  test(`${stage}: legacy accept and name correction do not change result or advance again`,async()=>{const f=await fixture(stage);try{
    assert.equal((await f.call()).status,200);const before=await f.row();assert.equal(before[`${stage}_verified`],true);
    assert.equal((await f.call({is_verified:false,verification_note:'เปลี่ยนผล'})).status,409);
    assert.equal((await f.call({[`${stage}_signature`]:'ชื่อใหม่'})).status,200);
    assert.equal((await f.row()).status,stage==='inspector'?'awaiting_purchasing':'awaiting_recipient');
  }finally{await f.db.close();}});
}
test('validation and department authorization prevent writes',async()=>{const f=await fixture();try{
  for(const body of [{is_verified:'false'},{is_verified:null},{is_verified:false},{is_verified:false,verification_note:'  '}]) assert.equal((await f.call(body)).status,400);
  f.department('0-ADM03');assert.equal((await f.call()).status,403);assert.equal((await f.row()).status,'awaiting_inspector');
}finally{await f.db.close();}});
test('audit failure rolls back result, status and signature',async()=>{const f=await fixture();try{
  await f.db.exec(`CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;CREATE TRIGGER fail_audit BEFORE INSERT ON document_approval_audit FOR EACH ROW EXECUTE FUNCTION fail_audit();`);
  assert.equal((await f.call({is_verified:false,verification_note:'ผิด'})).status,500);const row=await f.row();assert.equal(row.status,'awaiting_inspector');assert.equal(row.inspector_signature,null);assert.equal(row.inspector_verified,null);
}finally{await f.db.close();}});
test('reset starts another round while retaining rejection history',async()=>{const f=await fixture();try{
  await f.call({is_verified:false,verification_note:'ผิด'});
  const result=await f.rpc('reset_goods_receipt_stages',{p_recipient_id:id,p_actor_id:actor,p_actor_name:'ธุรการ'});assert.equal(result.error,null);
  const row=await f.row();assert.equal(row.status,'awaiting_inspector');for(const stage of ['inspector','purchasing']) for(const field of ['signature','signed_by','signed_at','verified','verification_note']) assert.equal(row[`${stage}_${field}`],null);
  assert.deepEqual((await f.db.query('SELECT action FROM document_approval_audit')).rows,[{action:'rejected'},{action:'reset'}]);
}finally{await f.db.close();}});
test('list rejects current approval stage without exposing recipient evidence from the previous round', async()=>{
  const rows = {documents:[{id,subject:'ใบรับสินค้า'}],document_recipients:[{id,document_id:id,status:'rejected',inspector_verified:false,inspector_verification_note:'จำนวนผิด'}],departments:[],profiles:[],delivery_logs:[{id:'old',document_recipient_id:id,recipient_signature:'ชื่อเก่า',is_verified:false,verification_note:'เหตุผลเก่า'}],document_department_tags:[]};
  const supabase={from(table){const q={select(){return q;},order(){return q;},in(){return q;},eq(){return q;},range(){return q;},then(resolve){return Promise.resolve({data:rows[table]||[],error:null}).then(resolve);}};return q;}};
  const route=loadModule('src/app/api/documents/route.ts',{'@/lib/supabase/admin':{getServiceSupabase:()=>supabase},'@/lib/supabase/auth-helpers':{requireRoles:async()=>({context:{user:{id:actor},profile:{role:'admin'}}})},'@/lib/google-sheets':{appendRows:async()=>{}}});
  const response=await route.GET({url:'http://localhost/api/documents'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const row=(await response.json()).data[0];assert.equal(row.rejection_stage,'inspector');assert.equal(row.rejection_note,'จำนวนผิด');assert.equal(row.recipient_signature,null);assert.equal(row.recipient_verification_note,null);assert.equal(row.inspector_verified,false);
});
test('historical name correction keeps unknown verification result',async()=>{const f=await fixture();try{
  await f.db.exec("UPDATE document_recipients SET status='awaiting_purchasing',inspector_signature='เดิม'");
  assert.equal((await f.call()).status,200);assert.equal((await f.row()).inspector_verified,null);
}finally{await f.db.close();}});
test('stage RPC rejects stale status and browser roles while retaining one callable overload',async()=>{const f=await fixture();try{
  const args={p_recipient_id:id,p_stage:'inspector',p_signature:'ชื่อ',p_actor_id:actor,p_actor_name:'ชื่อ',p_allowed_status:['awaiting_inspector'],p_is_verified:true,p_verification_note:null};
  assert.equal((await f.rpc('sign_goods_receipt_stage',args)).error,null);
  assert.match((await f.rpc('sign_goods_receipt_stage',args)).error.message,/stage_changed/);
  assert.deepEqual((await f.db.query("SELECT pronargs FROM pg_proc WHERE proname='sign_goods_receipt_stage'")).rows,[{pronargs:8}]);
  const permissions=(await f.db.query("SELECT has_function_privilege('authenticated','sign_goods_receipt_stage(uuid,text,text,uuid,text,text[],boolean,text)','execute') AS browser, has_function_privilege('service_role','sign_goods_receipt_stage(uuid,text,text,uuid,text,text[],boolean,text)','execute') AS service")).rows;
  assert.deepEqual(permissions,[{browser:false,service:true}]);
}finally{await f.db.close();}});
test('reset audit failure retains the complete rejected round',async()=>{const f=await fixture();try{
  await f.call({is_verified:false,verification_note:'ผิด'});
  await f.db.exec(`CREATE FUNCTION fail_reset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='reset' THEN RAISE EXCEPTION 'audit unavailable'; END IF;RETURN NEW;END $$;CREATE TRIGGER fail_reset BEFORE INSERT ON document_approval_audit FOR EACH ROW EXECUTE FUNCTION fail_reset();`);
  const result=await f.rpc('reset_goods_receipt_stages',{p_recipient_id:id,p_actor_id:actor,p_actor_name:'ธุรการ'});assert.match(result.error.message,/audit unavailable/);const row=await f.row();assert.equal(row.status,'rejected');assert.equal(row.inspector_verified,false);assert.equal(row.inspector_signature,'ผู้ตรวจ');
}finally{await f.db.close();}});

for (const [code, expectedStatus] of [['PGRST116', 409], ['XX000', 500]]) {
  test(`ordinary redelivery maps ${code} to ${expectedStatus} when updating the rejected row fails`, async () => {
    const supabase = {
      from(table) {
        let updating = false;
        const query = {
          select: () => query, eq: () => query,
          update() { updating = true; return query; },
          async single() {
            if (table === 'documents') return { data: { id, subject: 'จดหมาย' }, error: null };
            if (updating) return { data: null, error: { code, message: 'row update failed' } };
            return { data: { id, document_id: id, status: 'rejected' }, error: null };
          },
        };
        return query;
      },
    };
    const route = loadModule('src/app/api/documents/[id]/redeliver/route.ts', {
      '@/lib/supabase/admin': { getServiceSupabase: () => supabase },
      '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ context: { user: { id: actor }, profile: { role: 'admin' } } }) },
      '@/lib/google-sheets': { syncRowInSheet: async () => assert.fail('failed writes must not sync Sheets') },
    });
    const response = await route.PUT({}, { params: Promise.resolve({ id }) });
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).success, false);
  });
}
