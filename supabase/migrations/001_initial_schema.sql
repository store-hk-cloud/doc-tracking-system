-- ============================================================
-- ระบบรับ-ส่งจดหมายพัสดุ และการควบคุมเอกสาร
-- Database Schema for Supabase PostgreSQL
-- ============================================================

-- 1. DEPARTMENTS
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. PROFILES (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'user')),
  department_id UUID REFERENCES departments(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. DOCUMENTS
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  running_no SERIAL,
  received_date DATE NOT NULL DEFAULT CURRENT_DATE,
  doc_number VARCHAR(255),
  sender VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  recipient_dept_id UUID NOT NULL REFERENCES departments(id),
  note TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','delivered','signed','closed','rejected')),
  is_damaged BOOLEAN DEFAULT false,
  damage_image_url TEXT,
  recorded_by UUID REFERENCES profiles(id),
  admin_signature TEXT,
  admin_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. DELIVERY LOGS
CREATE TABLE delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id),
  recipient_signature TEXT NOT NULL,
  recipient_signed_at TIMESTAMPTZ DEFAULT now(),
  is_verified BOOLEAN DEFAULT true,
  verification_note TEXT,
  verified_by_admin BOOLEAN DEFAULT false,
  verified_by_admin_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(document_id)
);

-- INDEXES
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_received_date ON documents(received_date);
CREATE INDEX idx_documents_sender ON documents(sender);
CREATE INDEX idx_documents_recipient_dept ON documents(recipient_dept_id);
CREATE INDEX idx_delivery_logs_document ON delivery_logs(document_id);
CREATE INDEX idx_profiles_department ON profiles(department_id);
CREATE INDEX idx_profiles_role ON profiles(role);

-- ROW LEVEL SECURITY
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_logs ENABLE ROW LEVEL SECURITY;

-- Departments: all authenticated users can read
CREATE POLICY "departments_select_all" ON departments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "departments_admin_all" ON departments FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin'))
);

-- Profiles: own read, super_admin all
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);
CREATE POLICY "profiles_admin_all" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
);

-- Documents: super_admin+admin all, user own dept
CREATE POLICY "documents_admin_select" ON documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);
CREATE POLICY "documents_user_select" ON documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'user' AND department_id = documents.recipient_dept_id)
);
CREATE POLICY "documents_admin_insert" ON documents FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);
CREATE POLICY "documents_admin_update" ON documents FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);
CREATE POLICY "documents_admin_delete" ON documents FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);

-- Delivery Logs
CREATE POLICY "delivery_admin_all" ON delivery_logs FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);
CREATE POLICY "delivery_user_own" ON delivery_logs FOR ALL USING (recipient_id = auth.uid());

-- AUTO UPDATE updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- SEED DEPARTMENTS (ปรับเปลี่ยนตามหน่วยงานจริงของคุณ)
INSERT INTO departments (name, code) VALUES
  ('สำนักงานใหญ่', 'HQ'),
  ('ธุรการ', 'ADMIN'),
  ('บัญชี', 'ACC'),
  ('การเงิน', 'FIN'),
  ('ทรัพยากรบุคคล', 'HR'),
  ('เทคโนโลยีสารสนเทศ', 'IT'),
  ('การตลาด', 'MKT'),
  ('จัดซื้อ', 'PUR'),
  ('ขาย', 'SALES'),
  ('คลังสินค้า', 'WH'),
  ('กฎหมาย', 'LEGAL'),
  ('พัฒนาธุรกิจ', 'BD');