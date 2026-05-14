import AdmZip from 'adm-zip';
import { NextResponse } from 'next/server';
import { candidatesFromInput, normalizeName } from '@/lib/tickers';
import { scoreFromMetrics, type RawMetrics } from '@/lib/scoring';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const modules = [
  'price',
  'summaryProfile',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'recommendationTrend'
].join(',');

type DartCorp = { corpName: string; stockCode: string };
let dartCache: { at: number; items: DartCorp[] } | null = null;

function textBetween(block: string, tag: string) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return (m?.[1] ?? '').trim();
}

function pick(raw: any): RawMetrics {
  const price = raw?.price ?? {};
  const profile = raw?.summaryProfile ?? {};
  const detail = raw?.summaryDetail ?? {};
  const stats = raw?.defaultKeyStatistics ?? {};
  const fin = raw?.financialData ?? {};
  const val = (obj: any, key: string) => obj?.[key]?.raw ?? obj?.[key] ?? null;
  return {
    symbol: price.symbol ?? '',
    name: price.longName ?? price.shortName ?? price.symbol ?? 'Unknown',
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    currency: price.currency ?? detail.currency ?? '',
    price: val(price, 'regularMarketPrice'),
    marketCap: val(price, 'marketCap') ?? val(detail, 'marketCap'),
    trailingPE: val(detail, 'trailingPE'),
    forwardPE: val(stats, 'forwardPE') ?? val(fin, 'forwardPE'),
    priceToBook: val(stats, 'priceToBook'),
    returnOnEquity: val(fin, 'returnOnEquity'),
    debtToEquity: val(fin, 'debtToEquity'),
    revenueGrowth: val(fin, 'revenueGrowth'),
    earningsGrowth: val(fin, 'earningsGrowth'),
    operatingMargins: val(fin, 'operatingMargins'),
    profitMargins: val(fin, 'profitMargins'),
    dividendYield: val(detail, 'dividendYield'),
    beta: val(detail, 'beta'),
    fiftyTwoWeekHigh: val(detail, 'fiftyTwoWeekHigh'),
    fiftyTwoWeekLow: val(detail, 'fiftyTwoWeekLow'),
    recommendationKey: fin.recommendationKey ?? null,
    targetMeanPrice: val(fin, 'targetMeanPrice')
  };
}

function metricsFromChart(symbol: string, chart: Array<{ date: string; close: number }>, requestedName?: string): RawMetrics {
  const closes = chart.map((x) => x.close).filter((x) => x != null && isFinite(x));
  const last = closes.at(-1) ?? null;
  const high = closes.length ? Math.max(...closes) : null;
  const low = closes.length ? Math.min(...closes) : null;
  return {
    symbol,
    name: requestedName || symbol,
    sector: null,
    industry: null,
    currency: symbol.endsWith('.KS') || symbol.endsWith('.KQ') ? 'KRW' : '',
    price: last,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    priceToBook: null,
    returnOnEquity: null,
    debtToEquity: null,
    revenueGrowth: null,
    earningsGrowth: null,
    operatingMargins: null,
    profitMargins: null,
    dividendYield: null,
    beta: null,
    fiftyTwoWeekHigh: high,
    fiftyTwoWeekLow: low,
    recommendationKey: null,
    targetMeanPrice: null
  };
}

async function fetchDartCorps(): Promise<DartCorp[]> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) return [];

  const oneDay = 24 * 60 * 60 * 1000;
  if (dartCache && Date.now() - dartCache.at < oneDay) return dartCache.items;

  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];

  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntry('CORPCODE.xml') ?? zip.getEntries()[0];
  const xml = entry?.getData().toString('utf8') ?? '';

  const items: DartCorp[] = [];
  const blocks = xml.match(/<list>[\s\S]*?<\/list>/g) ?? [];
  for (const block of blocks) {
    const corpName = textBetween(block, 'corp_name');
    const stockCode = textBetween(block, 'stock_code');
    if (corpName && /^\d{6}$/.test(stockCode)) items.push({ corpName, stockCode });
  }

  dartCache = { at: Date.now(), items };
  return items;
}

async function candidatesFromDart(query: string): Promise<string[]> {
  const corps = await fetchDartCorps();
  if (!corps.length) return [];

  const q = normalizeName(query);
  const exact = corps.find((x) => normalizeName(x.corpName) === q);
  const partial = exact ? null : corps.find((x) => normalizeName(x.corpName).includes(q) || q.includes(normalizeName(x.corpName)));
  const hit = exact ?? partial;
  return hit ? [`${hit.stockCode}.KS`, `${hit.stockCode}.KQ`] : [];
}

async function fetchYahooSummary(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 company-diagnosis-pwa',
      Accept: 'application/json'
    }
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.quoteSummary?.result?.[0] ?? null;
}

async function fetchChart(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0 company-diagnosis-pwa' } });
  if (!res.ok) return [];
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const timestamps = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  return timestamps.map((t: number, i: number) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: closes[i]
  })).filter((x: any) => x.close != null);
}

async function resolveWorkingSymbol(query: string) {
  const seen = new Set<string>();
  const candidates = [...candidatesFromInput(query), ...(await candidatesFromDart(query))]
    .map((x) => x.toUpperCase())
    .filter((x) => !seen.has(x) && seen.add(x));

  for (const symbol of candidates) {
    const chart = await fetchChart(symbol);
    if (chart.length) return { symbol, chart };
  }
  return { symbol: candidates[0] ?? query.toUpperCase(), chart: [] as Array<{ date: string; close: number }> };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query ?? '').trim();
    if (!query) return NextResponse.json({ error: '기업명이나 티커를 입력하세요.' }, { status: 400 });

    const { symbol, chart } = await resolveWorkingSymbol(query);
    const raw = await fetchYahooSummary(symbol);
    const metrics = raw ? pick(raw) : metricsFromChart(symbol, chart, query);
    metrics.symbol = metrics.symbol || symbol;
    if ((!metrics.name || metrics.name === 'Unknown') && query) metrics.name = query;
    if (!metrics.price && chart.length) metrics.price = chart.at(-1)?.close ?? null;
    if (!metrics.fiftyTwoWeekHigh && chart.length) metrics.fiftyTwoWeekHigh = Math.max(...chart.map((x) => x.close));
    if (!metrics.fiftyTwoWeekLow && chart.length) metrics.fiftyTwoWeekLow = Math.min(...chart.map((x) => x.close));

    const scores = scoreFromMetrics(metrics);
    const source = raw
      ? 'Yahoo Finance public endpoint'
      : 'Yahoo chart fallback. DART_API_KEY가 있으면 국내 종목명 검색을 보강합니다.';
    return NextResponse.json({ query, symbol, metrics, scores, chart, source });
  } catch (e: any) {
    return NextResponse.json({
      error: e?.message ?? '데이터 조회 실패',
      hint: '국내 종목은 회사명, 6자리 코드, 005930.KS/KQ 형식 모두 지원합니다. 모든 종목명 검색은 Vercel 환경변수 DART_API_KEY 설정 후 더 정확해집니다.'
    }, { status: 500 });
  }
}
