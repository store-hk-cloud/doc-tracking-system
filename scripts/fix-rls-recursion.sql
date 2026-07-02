-- ============================================================
-- Fix RLS infinite recursion for profiles table
-- Run this SQL in Supabase SQL Editor
-- ============================================================

-- Create a security definer helper function to check role
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = user_id;
$$;

-- Drop old recursive policies on profiles
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON profiles;

-- Recreate with helper function (no recursion)
CREATE POLICY "profiles_admin_all" ON profiles FOR ALL USING (
  public.get_user_role(auth.uid()) = 'super_admin'
);

-- Fix documents policies
DROP POLICY IF EXISTS "documents_admin_select" ON documents;
DROP POLICY IF EXISTS "documents_user_select" ON documents;
DROP POLICY IF EXISTS "documents_admin_insert" ON documents;
DROP POLICY IF EXISTS "documents_admin_update" ON documents;
DROP POLICY IF EXISTS "documents_admin_delete" ON documents;

CREATE POLICY "documents_admin_select" ON documents FOR SELECT USING (
  public.get_user_role(auth.uid()) IN ('super_admin', 'admin')
);
CREATE POLICY "documents_user_select" ON documents FOR SELECT USING (
  public.get_user_role(auth.uid()) = 'user' 
  AND department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "documents_admin_insert" ON documents FOR INSERT WITH CHECK (
  public.get_user_role(auth.uid()) IN ('super_admin', 'admin')
);
CREATE POLICY "documents_admin_update" ON documents FOR UPDATE USING (
  public.get_user_role(auth.uid()) IN ('super_admin', 'admin')
);
CREATE POLICY "documents_admin_delete" ON documents FOR DELETE USING (
  public.get_user_role(auth.uid()) IN ('super_admin', 'admin')
);

-- Fix deliveries policies
DROP POLICY IF EXISTS "delivery_admin_all" ON delivery_logs;

CREATE POLICY "delivery_admin_all" ON delivery_logs FOR ALL USING (
  public.get_user_role(auth.uid()) IN ('super_admin', 'admin')
);

-- Fix departments admin policy
DROP POLICY IF EXISTS "departments_admin_all" ON departments;

CREATE POLICY "departments_admin_all" ON departments FOR ALL USING (
  public.get_user_role(auth.uid()) = 'super_admin'
);

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_user_role TO authenticated, anon;