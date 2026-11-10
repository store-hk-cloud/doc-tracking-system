const receiptErrors = {
  receipt_stale: 'ข้อมูลเอกสารเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด',
  receipt_duplicate: 'เอกสารรอบนี้อยู่ในคิวอื่นแล้ว',
  receipt_invalid_batch: 'ข้อมูลที่ส่งไม่ครบ กรุณาตรวจรายการอีกครั้ง',
  receipt_invalid_signature: 'กรุณาระบุชื่อผู้ลงนาม ความยาวไม่เกิน 255 ตัวอักษร',
  receipt_batch_conflict: 'คำขอนี้มีข้อมูลไม่ตรงกับชุดเดิม กรุณาตรวจคิวก่อนส่งใหม่',
  receipt_queue_busy: 'ยังมีคิวค้างหลายชุด กรุณารอให้บันทึกเสร็จก่อน',
};

function displayError(message, retryable = false) {
  return Object.assign(new Error(message), { retryable });
}

export function createReceiptApi(client) {
  async function rpc(name, args) {
    let result;
    try {
      result = await client.rpc(name, args);
    } catch {
      throw displayError('เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาลองอีกครั้ง', true);
    }
    const { data, error, status } = result;
    if (!error) return data;
    if (!status || status >= 500 || status === 429) {
      throw displayError('ติดต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง', true);
    }
    if (status === 401 || error.code === 'PGRST301' || error.message === 'receipt_actor_not_authenticated') {
      throw displayError('เซสชันหมดอายุ กรุณาออกจากระบบและเข้าสู่ระบบอีกครั้ง');
    }
    if (status === 403 || error.code === '42501' || error.message === 'receipt_forbidden') {
      throw displayError('บัญชีนี้ไม่มีสิทธิ์ทำรายการ');
    }
    throw displayError(Object.hasOwn(receiptErrors, error.message)
      ? receiptErrors[error.message] : 'ดำเนินการไม่สำเร็จ กรุณาตรวจรายการแล้วลองอีกครั้ง');
  }

  return {
    async login(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.session) {
        const message = error?.status === 400 || error?.status === 401
          ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
        throw displayError(message);
      }
      return data.session;
    },
    async logout() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw displayError('ติดต่อระบบเพื่อออกจากบัญชีไม่สำเร็จ');
    },
    async getSession() {
      const { data } = await client.auth.getSession();
      return data.session;
    },
    listPending(search) {
      return rpc('list_desktop_pending_receipts', { p_search: search.trim() });
    },
    submitReceipts({ batchId, signatureName, items }) {
      return rpc('enqueue_desktop_receipts', {
        p_batch_id: batchId, p_signature_name: signatureName.trim(),
        p_items: items.map(({ recipientId, expectedUpdatedAt }) => ({ recipientId, expectedUpdatedAt })),
      });
    },
    listBatches() {
      return rpc('list_desktop_receipt_batches', {});
    },
  };
}
