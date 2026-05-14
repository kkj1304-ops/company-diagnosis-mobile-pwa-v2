import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '기업 진단 PWA',
    short_name: '기업진단',
    description: '기업명이나 티커를 입력하면 재무 상태, 밸류에이션, 성장 가능성, 섹터 열기, 버블 스트레스 시나리오를 모바일에서 확인합니다.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  };
}
