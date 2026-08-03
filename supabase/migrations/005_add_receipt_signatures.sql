-- Additional signatures used only for documents registered as "ใบรับสินค้า".
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS inspector_signature TEXT,
  ADD COLUMN IF NOT EXISTS purchasing_signature TEXT;
