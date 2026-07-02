-- ============================================================
-- Fix RLS infinite recursion for ALL tables
-- Strategy: Strip all current policies and re-create with NON-recursive logic
-- Uses just auth.uid() directly, NO subqueries that select from profiles
-- ============================================================

-- 1. PROFILES: Only allow users to read their own profile
--    Admin can read all via service_role key (not RLS)
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- 2. DOCUMENTS: Any authenticated user can read
DROP POLICY IF EXISTS "documents_admin_select" ON documents;
DROP POLICY IF EXISTS "documents_user_select" ON documents;
DROP POLICY IF EXISTS "documents_admin_insert" ON documents;
DROP POLICY IF EXISTS "documents_admin_update" ON documents;
DROP POLICY IF EXISTS "documents_admin_delete" ON documents;
DROP POLICY IF EXISTS "documents_select_all_auth" ON documents;
DROP POLICY IF EXISTS "documents_insert_auth" ON documents;
DROP POLICY IF EXISTS "documents_update_auth" ON documents;
DROP POLICY IF EXISTS "documents_delete_auth" ON documents;

CREATE POLICY "documents_select_all_auth" ON documents FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "documents_insert_auth" ON documents FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "documents_update_auth" ON documents FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "documents_delete_auth" ON documents FOR DELETE
  USING (auth.role() = 'authenticated');

-- 3. DELIVERY LOGS: Any authenticated user can read
DROP POLICY IF EXISTS "delivery_admin_all" ON delivery_logs;
DROP POLICY IF EXISTS "delivery_user_own" ON delivery_logs;
DROP POLICY IF EXISTS "delivery_select_all_auth" ON delivery_logs;
DROP POLICY IF EXISTS "delivery_insert_auth" ON delivery_logs;
DROP POLICY IF EXISTS "delivery_update_auth" ON delivery_logs;
DROP POLICY IF EXISTS "delivery_delete_auth" ON delivery_logs;

CREATE POLICY "delivery_select_all_auth" ON delivery_logs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "delivery_insert_auth" ON delivery_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "delivery_update_auth" ON delivery_logs FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "delivery_delete_auth" ON delivery_logs FOR DELETE
  USING (auth.role() = 'authenticated');

-- 4. DEPARTMENTS: Any authenticated user can read
DROP POLICY IF EXISTS "departments_select_all" ON departments;
DROP POLICY IF EXISTS "departments_admin_all" ON departments;
DROP POLICY IF EXISTS "departments_select_all_auth" ON departments;

CREATE POLICY "departments_select_all_auth" ON departments FOR SELECT
  USING (auth.role() = 'authenticated');
