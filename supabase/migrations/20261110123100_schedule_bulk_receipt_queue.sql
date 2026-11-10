BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'doc-tracking-receipt-queue',
  '5 seconds',
  $$SELECT public.process_document_receipt_queue()$$
);

-- ตัดเฉพาะประวัติรัน Cron ของคิวนี้เพราะงานที่ตรวจคิวทุก 5 วินาทีสร้าง log แม้คิวว่าง
SELECT cron.schedule(
  'doc-tracking-receipt-queue-log-retention',
  '15 17 * * *',
  $$DELETE FROM cron.job_run_details
    WHERE end_time < now() - interval '7 days'
      AND jobid IN (SELECT jobid FROM cron.job WHERE jobname IN (
        'doc-tracking-receipt-queue', 'doc-tracking-receipt-queue-log-retention'
      ))$$
);

COMMIT;
