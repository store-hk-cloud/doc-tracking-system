-- Allow more than one delivery_logs row per document so a rejected document
-- can be redelivered and signed again (history of attempts is preserved).
ALTER TABLE delivery_logs DROP CONSTRAINT IF EXISTS delivery_logs_document_id_key;
