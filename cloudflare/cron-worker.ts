export interface Env {
  CRON_TARGET_URL: string;
  CRON_SECRET: string;
}

async function runOverdueDocuments(env: Env) {
  const response = await fetch(`${env.CRON_TARGET_URL.replace(/\/$/, '')}/api/cron/overdue-documents`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`overdue-documents returned ${response.status}: ${body.slice(0, 200)}`);
  }
}

export default {
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runOverdueDocuments(env));
  },

  async fetch() {
    return new Response('Doc Tracking cron worker is running.');
  },
};
