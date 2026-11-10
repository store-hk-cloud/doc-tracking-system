export async function completeDeviceLogin({ startDeviceLogin, setSession, openBrowser, ...options }) {
  const tokens = await startDeviceLogin({
    ...options,
    openBrowser(value) {
      const url = new URL(value);
      if (url.origin !== options.origin || url.pathname !== '/desktop/connect' || url.username || url.password) {
        throw new Error('ลิงก์ยืนยันการเข้าสู่ระบบไม่ถูกต้อง');
      }
      return openBrowser(url.href);
    },
  });
  options.signal.throwIfAborted();
  const { error } = await setSession(tokens);
  if (error) throw error;
}
