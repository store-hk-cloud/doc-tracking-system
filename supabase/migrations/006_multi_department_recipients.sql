-- Allow a single document to be linked to multiple recipient departments,
-- each tracking its own delivery/sign/close workflow independently.
CREATE TABLE document_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id),
  status VARCHAR(50) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','delivered','signed','closed','rejected')),
  admin_signature TEXT,
  admin_signed_at TIMESTAMPTZ,
  inspector_signature TEXT,
  purchasing_signature TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(document_id, department_id)
);

CREATE INDEX idx_doc_recipients_document ON document_recipients(document_id);
CREATE INDEX idx_doc_recipients_department ON document_recipients(department_id);
CREATE INDEX idx_doc_recipients_status ON document_recipients(status);

CREATE TRIGGER document_recipients_updated_at
  BEFORE UPDATE ON document_recipients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- delivery_logs now scope to a specific department's copy of a document.
ALTER TABLE delivery_logs ADD COLUMN document_recipient_id UUID REFERENCES document_recipients(id) ON DELETE CASCADE;

-- Backfill: every existing document becomes exactly one document_recipients row,
-- preserving its current single-department status/signatures unchanged.
INSERT INTO document_recipients (document_id, department_id, status, admin_signature, admin_signed_at, inspector_signature, purchasing_signature, created_at, updated_at)
SELECT id, recipient_dept_id, status, admin_signature, admin_signed_at, inspector_signature, purchasing_signature, created_at, updated_at
FROM documents;

UPDATE delivery_logs dl
SET document_recipient_id = dr.id
FROM document_recipients dr
WHERE dr.document_id = dl.document_id;

ALTER TABLE delivery_logs ALTER COLUMN document_recipient_id SET NOT NULL;

ALTER TABLE document_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_recipients_admin_all" ON document_recipients FOR ALL USING (
  auth.uid() IN (SELECT id FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);
CREATE POLICY "doc_recipients_user_select" ON document_recipients FOR SELECT USING (
  auth.uid() IN (SELECT id FROM profiles WHERE id = auth.uid() AND role = 'user' AND department_id = document_recipients.department_id)
);
