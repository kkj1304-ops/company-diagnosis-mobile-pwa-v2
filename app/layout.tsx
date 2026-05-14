import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '기업 진단 PWA',
  description: '모바일에서 기업 재무, 가치, 성장 가능성, 섹터 열기, 버블 스트레스 시나리오를 확인합니다.',
  appleWebApp: {
    capable: true,
    title: '기업진단',
    statusBarStyle: 'black-translucent'
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0f172a'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
