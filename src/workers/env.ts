export type NotificationsEnvironment = CloudflareEnv & {
  DOCUMENT_RECEIPT_FAST_PATH?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};
