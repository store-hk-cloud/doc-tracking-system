-- สคริปต์เก่าเปิดสิทธิ์เขียนกว้างเกินไป ห้ามนำกลับไปรันกับฐานข้อมูล
DO $$
BEGIN
  RAISE EXCEPTION 'Retired unsafe RLS script. Use 20260908013649_database_security_lockdown.sql instead.';
END;
$$;
