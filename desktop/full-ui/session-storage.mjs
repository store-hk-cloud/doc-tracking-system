export function createSessionStorage(bridge) {
  if (bridge) return bridge;
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

export async function signOutDesktop({ signOut, storage, storageKey }) {
  let result;
  try {
    result = await signOut({ scope: 'local' });
    return result;
  } finally {
    // SDK อาจเก็บ session ไว้เมื่อ Supabase ตอบ 5xx แต่เครื่องนี้ต้องออกจากระบบได้
    if (!result || result.error) {
      await Promise.all(['', '-code-verifier', '-user'].map((suffix) => storage.removeItem(storageKey + suffix)));
    }
  }
}
