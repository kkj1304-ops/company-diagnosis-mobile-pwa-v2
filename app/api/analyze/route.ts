import { NextResponse } from 'next/server';
import { normalizeTicker } from '@/lib/tickers';
import { scoreFromMetrics, type RawMetrics } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

const modules = [
  'price',
  'summaryProfile',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'recommendationTrend'
].join(',');

function pick(raw: any): RawMetrics {
  const price = raw.price ?? {};
  const profile = raw.summaryProfile ?? {};
  const detail = raw.summaryDetail ?? {};
  const stats = raw.defaultKeyStatistics ?? {};
  const fin = raw.financialData ?? {};
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

async function fetchYahooSummary(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 company-diagnosis-pwa',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Yahoo summary failed: ${res.status}`);
  const json = await res.json();
  const result = json?.quoteSummary?.result?.[0];
  const err = json?.quoteSummary?.error;
  if (!result || err) throw new Error(err?.description ?? '데이터가 비어 있습니다.');
  return result;
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query ?? '').trim();
    if (!query) return NextResponse.json({ error: '기업명이나 티커를 입력하세요.' }, { status: 400 });
    const symbol = normalizeTicker(query);
    const raw = await fetchYahooSummary(symbol);
    const metrics = pick(raw);
    metrics.symbol = metrics.symbol || symbol;
    const scores = scoreFromMetrics(metrics);
    const chart = await fetchChart(symbol);
    return NextResponse.json({ query, symbol, metrics, scores, chart, source: 'Yahoo Finance public endpoint' });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '데이터 조회 실패', hint: '한국 기업은 삼성전자 대신 005930.KS처럼 입력해 보세요. 코스닥은 247540.KQ 형식입니다.' }, { status: 500 });
  }
}
