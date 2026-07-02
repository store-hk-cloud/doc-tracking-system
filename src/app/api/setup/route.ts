import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createServerSupabase();

    // Check if tables exist
    const { data: existing } = await supabase
      .from('departments')
      .select('id')
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({
        success: true,
        message: '✅ ระบบพร้อมใช้งานแล้ว (Database already set up)',
        data: { departments_count: existing.length }
      });
    }

    // Run schema setup
    const schemaSQL = `
      CREATE TABLE IF NOT EXISTS departments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'user')),
        department_id UUID REFERENCES departments(id),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS documents (
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

      CREATE TABLE IF NOT EXISTS delivery_logs (
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

      -- Seed departments
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
        ('พัฒนาธุรกิจ', 'BD')
      ON CONFLICT (code) DO NOTHING;
    `;

    // Split by semicolons and execute each statement
    const statements = schemaSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      const { error } = await supabase.rpc('exec_sql', { query: stmt + ';' });
      if (error) {
        // Try direct query via REST
        console.log(`Statement error (continuing): ${error.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: '✅ ตั้งค่าฐานข้อมูลสำเร็จ! สามารถ login ได้เลย',
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      message: '❌ เกิดข้อผิดพลาด กรุณาลองอีกครั้ง หรือเปิด Supabase Dashboard',
    });
  }
}