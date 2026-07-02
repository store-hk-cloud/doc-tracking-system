import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AppLayout } from '@/components/layouts/AppLayout';

export const metadata: Metadata = {
  title: 'ระบบรับ-ส่งจดหมายพัสดุ และการควบคุมเอกสาร',
  description: 'ระบบติดตามการรับ-ส่งจดหมาย พัสดุ และควบคุมเอกสารในองค์กร',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#007aff',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" data-theme="light">
      <body>
        <AuthProvider>
          <AppLayout>{children}</AppLayout>
        </AuthProvider>
      </body>
    </html>
  );
}