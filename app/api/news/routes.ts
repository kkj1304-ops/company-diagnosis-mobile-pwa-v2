import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type NaverNewsItem = {
  title: string;
  originallink?: string;
  link: string;
  description: string;
  pubDate: string;
};

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function safeUrl(value?: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim() ?? '';

  if (!query) {
    return NextResponse.json({ items: [] });
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      items: [],
      warning: 'NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수가 없습니다.',
    });
  }

  try {
    const searchQuery = `${query} 주가 실적 전망`;
    const url = new URL('https://openapi.naver.com/v1/search/news.json');

    url.searchParams.set('query', searchQuery);
    url.searchParams.set('display', '5');
    url.searchParams.set('start', '1');
    url.searchParams.set('sort', 'date');

    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({
        items: [],
        warning: `네이버 뉴스 조회 실패: ${res.status}`,
      });
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    const normalized = items.map((item: NaverNewsItem) => {
      const link = safeUrl(item.originallink) || safeUrl(item.link);

      return {
        title: stripHtml(item.title ?? ''),
        description: stripHtml(item.description ?? ''),
        link,
        pubDate: item.pubDate ?? '',
      };
    });

    return NextResponse.json({
      items: normalized.filter((item: any) => item.title && item.link),
    });
  } catch (error: any) {
    return NextResponse.json({
      items: [],
      warning: error?.message ?? '뉴스 조회 중 오류가 발생했습니다.',
    });
  }
}
