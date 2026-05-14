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

function val(obj: any, key: string) {
  return obj?.[key]?.raw ?? obj?.[key] ?? null;
}

function pickSummary(raw: any): Partial<RawMetrics> {
  const price = raw.price ?? {};
  const profile = raw.summaryProfile ?? {};
  const detail = raw.summaryDetail ?? {};
  const stats = raw.defaultKeyStatistics ?? {};
  const fin = raw.financialData ?? {};
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

function pickQuote(q: any): Partial<RawMetrics> {
  return {
    symbol: q.symbol ?? '',
    name: q.longName ?? q.shortName ?? q.displayName ?? q.symbol ?? 'Unknown',
    sector: q.sector ?? null,
    industry: q.industry ?? null,
    currency: q.currency ?? '',
    price: q.regularMarketPrice ?? q.postMarketPrice ?? q.preMarketPrice ?? null,
    marketCap: q.marketCap ?? null,
    trailingPE: q.trailingPE ?? null,
    forwardPE: q.forwardPE ?? null,
    priceToBook: q.priceToBook ?? null,
    returnOnEquity: q.returnOnEquity ?? null,
    debtToEquity: q.debtToEquity ?? null,
    revenueGrowth: q.revenueGrowth ?? null,
    earningsGrowth: q.earningsGrowth ?? null,
    dividendYield: q.dividendYield ?? q.trailingAnnualDividendYield ?? null,
    beta: q.beta ?? q.beta3Year ?? null,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
    targetMeanPrice: q.targetMeanPrice ?? null
  };
}

function mergeMetrics(symbol: string, ...parts: Array<Partial<RawMetrics> | null | undefined>): RawMetrics {
  const merged: any = {
    symbol,
    name: symbol,
    sector: null,
    industry: null,
    currency: '',
    price: null,
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
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    recommendationKey: null,
    targetMeanPrice: null
  };
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (v !== null && v !== undefined && v !== '') merged[k] = v;
    }
  }
  merged.symbol = merged.symbol || symbol;
  return merged as RawMetrics;
}

async function fetchYahooSummary(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 company-diagnosis-pwa',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Yahoo summary failed: ${res.status}`);
  const json = await res.json();
  const result = json?.quoteSummary?.result?.[0];
  const err = json?.quoteSummary?.error;
  if (!result || err) throw new Error(err?.description ?? 'summary 데이터가 비어 있습니다.');
  return pickSummary(result);
}

async function fetchYahooQuote(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 company-diagnosis-pwa',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Yahoo quote failed: ${res.status}`);
  const json = await res.json();
  const result = json?.quoteResponse?.result?.[0];
  if (!result) throw new Error('quote 데이터가 비어 있습니다.');
  return pickQuote(result);
}

async function fetchChart(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 company-diagnosis-pwa',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Yahoo chart failed: ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const meta = r?.meta ?? {};
  const timestamps = r?.timestamp ?? [];
  const quote = r?.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const chart = timestamps.map((t: number, i: number) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: closes[i]
  })).filter((x: any) => x.close != null);
  const validHighs = highs.filter((x: any) => typeof x === 'number' && isFinite(x));
  const validLows = lows.filter((x: any) => typeof x === 'number' && isFinite(x));
  const last = chart.length ? chart[chart.length - 1].close : null;
  const metrics: Partial<RawMetrics> = {
    symbol: meta.symbol ?? symbol,
    name: meta.longName ?? meta.shortName ?? meta.symbol ?? symbol,
    currency: meta.currency ?? '',
    price: meta.regularMarketPrice ?? last,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? (validHighs.length ? Math.max(...validHighs) : null),
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? (validLows.length ? Math.min(...validLows) : null)
  };
  return { chart, metrics };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query ?? '').trim();
    if (!query) return NextResponse.json({ error: '기업명이나 티커를 입력하세요.' }, { status: 400 });

    const symbol = normalizeTicker(query);
    const [chartResult, quoteResult, summaryResult] = await Promise.allSettled([
      fetchChart(symbol),
      fetchYahooQuote(symbol),
      fetchYahooSummary(symbol)
    ]);

    const chart = chartResult.status === 'fulfilled' ? chartResult.value.chart : [];
    const chartMetrics = chartResult.status === 'fulfilled' ? chartResult.value.metrics : null;
    const quoteMetrics = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
    const summaryMetrics = summaryResult.status === 'fulfilled' ? summaryResult.value : null;

    const metrics = mergeMetrics(symbol, chartMetrics, quoteMetrics, summaryMetrics);
    if (!metrics.price && chart.length) metrics.price = chart[chart.length - 1].close;

    if (!metrics.price && !metrics.marketCap && !chart.length) {
      const reasons = [chartResult, quoteResult, summaryResult]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason?.message ?? String(r.reason))
        .join(' / ');
      throw new Error(reasons || '데이터가 비어 있습니다.');
    }

    const scores = scoreFromMetrics(metrics);
    const sources = [
      chartResult.status === 'fulfilled' ? 'chart' : null,
      quoteResult.status === 'fulfilled' ? 'quote' : null,
      summaryResult.status === 'fulfilled' ? 'summary' : null
    ].filter(Boolean).join(' + ');

    return NextResponse.json({
      query,
      symbol,
      metrics,
      scores,
      chart,
      source: `Yahoo Finance public endpoint (${sources || 'fallback'})`,
      warnings: [
        summaryResult.status === 'rejected' ? 'Yahoo summary API가 막혀 일부 재무/섹터 정보가 비어 있을 수 있습니다.' : null,
        quoteResult.status === 'rejected' ? 'Yahoo quote API가 막혀 일부 밸류에이션 정보가 비어 있을 수 있습니다.' : null
      ].filter(Boolean)
    });
  } catch (e: any) {
    return NextResponse.json({
      error: e?.message ?? '데이터 조회 실패',
      hint: 'Yahoo가 일부 API를 401로 막을 수 있습니다. AAPL/NVDA로 먼저 테스트하고, 한국 기업은 005930.KS처럼 입력하세요.'
    }, { status: 500 });
  }
}
