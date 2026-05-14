import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnalyzeRequest = {
  query?: string;
  symbol?: string;
  name?: string;
};

type PricePoint = {
  date: string;
  close: number;
};

type CompanyReport = {
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  currency: string;
  price: number;
  previousClose?: number;
  marketCap?: number;
  per?: number;
  pbr?: number;
  roe?: number;
  debtToEquity?: number;
  revenueGrowth?: number;
  dividendYield?: number;
  beta?: number;
  chart: PricePoint[];
  scores: {
    growthPotential: number;
    sectorHeat: number;
    bubbleRisk: number;
    financialHealth: number;
  };
  stress: {
    mildDropPrice: number;
    severeDropPrice: number;
    bubbleCrashPrice: number;
    maxDrawdownBasedPrice: number;
  };
  explanations: Record<string, string>;
  warnings: string[];
  sourceStatus: {
    yahooChart: string;
    yahooQuote: string;
    yahooSummary: string;
    dart: string;
  };
};

const KOREAN_TICKER_MAP: Record<string, string> = {
  삼성전자: '005930.KS',
  삼성전자우: '005935.KS',
  SK하이닉스: '000660.KS',
  에스케이하이닉스: '000660.KS',
  현대차: '005380.KS',
  현대자동차: '005380.KS',
  기아: '000270.KS',
  NAVER: '035420.KS',
  네이버: '035420.KS',
  카카오: '035720.KS',
  LG에너지솔루션: '373220.KS',
  엘지에너지솔루션: '373220.KS',
  삼성바이오로직스: '207940.KS',
  셀트리온: '068270.KS',
  POSCO홀딩스: '005490.KS',
  포스코홀딩스: '005490.KS',
  KB금융: '105560.KS',
  신한지주: '055550.KS',
  현대모비스: '012330.KS',
  삼성SDI: '006400.KS',
  LG화학: '051910.KS',
  한화에어로스페이스: '012450.KS',
  HD현대중공업: '329180.KS',
  삼성물산: '028260.KS',
  두산에너빌리티: '034020.KS',
  두산중공업: '034020.KS',
  두산에너: '034020.KS',
  현대로템: '064350.KS',
  HD현대일렉트릭: '267260.KS',
  엘에스일렉트릭: '010120.KS',
  'LS ELECTRIC': '010120.KS',
  LSELECTRIC: '010120.KS',
  에코프로비엠: '247540.KQ',
  에코프로: '086520.KQ',
  알테오젠: '196170.KQ',
  JYP: '035900.KQ',
  'JYP Ent.': '035900.KQ',
  에스엠: '041510.KQ',
  SM: '041510.KQ',
};

function normalizeName(value: string) {
  return value.replace(/\s+/g, '').replace(/[㈜()]/g, '').toUpperCase();
}

function clamp(value: number, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isKoreanCode(input: string) {
  return /^\d{6}$/.test(input.trim());
}

function looksLikeYahooTicker(input: string) {
  return /^[A-Z0-9.\-]+$/i.test(input.trim());
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchYahooChart(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=1y&interval=1d`;

  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];

  if (!result) {
    throw new Error('Yahoo chart result empty');
  }

  const timestamps: number[] = result.timestamp || [];
  const closes: Array<number | null> =
    result.indicators?.quote?.[0]?.close || [];

  const chart: PricePoint[] = timestamps
    .map((timestamp, index) => {
      const close = closes[index];
      if (typeof close !== 'number' || !Number.isFinite(close)) return null;

      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close: round(close, 2),
      };
    })
    .filter(Boolean) as PricePoint[];

  if (chart.length === 0) {
    throw new Error('Yahoo chart close data empty');
  }

  const meta = result.meta || {};
  const price =
    safeNumber(meta.regularMarketPrice) ||
    chart[chart.length - 1]?.close ||
    0;

  const previousClose =
    safeNumber(meta.chartPreviousClose) ||
    chart[Math.max(0, chart.length - 2)]?.close;

  const currency = meta.currency || '';

  return {
    chart,
    price: round(price, 2),
    previousClose: previousClose ? round(previousClose, 2) : undefined,
    currency,
  };
}

async function fetchYahooQuote(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
    symbol
  )}`;

  const json = await fetchJson(url);
  const quote = json?.quoteResponse?.result?.[0];

  if (!quote) {
    throw new Error('Yahoo quote result empty');
  }

  return {
    name: quote.longName || quote.shortName || symbol,
    marketCap: safeNumber(quote.marketCap),
    per: safeNumber(quote.trailingPE),
    pbr: safeNumber(quote.priceToBook),
    dividendYield:
      typeof quote.trailingAnnualDividendYield === 'number'
        ? quote.trailingAnnualDividendYield * 100
        : undefined,
    beta: safeNumber(quote.beta),
    currency: quote.currency || '',
  };
}

async function fetchYahooSummary(symbol: string) {
  const modules = [
    'assetProfile',
    'defaultKeyStatistics',
    'financialData',
    'summaryDetail',
  ].join(',');

  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    symbol
  )}?modules=${modules}`;

  const json = await fetchJson(url);
  const result = json?.quoteSummary?.result?.[0];

  if (!result) {
    throw new Error('Yahoo summary result empty');
  }

  const assetProfile = result.assetProfile || {};
  const keyStats = result.defaultKeyStatistics || {};
  const financialData = result.financialData || {};
  const summaryDetail = result.summaryDetail || {};

  return {
    sector: assetProfile.sector || undefined,
    industry: assetProfile.industry || undefined,
    per: safeNumber(summaryDetail.trailingPE?.raw),
    pbr: safeNumber(keyStats.priceToBook?.raw),
    roe:
      typeof financialData.returnOnEquity?.raw === 'number'
        ? financialData.returnOnEquity.raw * 100
        : undefined,
    debtToEquity: safeNumber(financialData.debtToEquity?.raw),
    revenueGrowth:
      typeof financialData.revenueGrowth?.raw === 'number'
        ? financialData.revenueGrowth.raw * 100
        : undefined,
    dividendYield:
      typeof summaryDetail.dividendYield?.raw === 'number'
        ? summaryDetail.dividendYield.raw * 100
        : undefined,
    marketCap: safeNumber(summaryDetail.marketCap?.raw),
    beta: safeNumber(summaryDetail.beta?.raw),
  };
}

async function findTickerFromDart(companyName: string) {
  const apiKey = process.env.DART_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(
    apiKey
  )}`;

  const response = await fetch(url, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`DART corpCode failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const zip = new AdmZip(Buffer.from(arrayBuffer));
  const entry = zip.getEntries().find((item) => item.entryName.endsWith('.xml'));

  if (!entry) {
    throw new Error('DART corpCode XML not found');
  }

  const xml = entry.getData().toString('utf-8');
  const target = normalizeName(companyName);

  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match: RegExpExecArray | null;

  while ((match = listRegex.exec(xml)) !== null) {
    const block = match[1];

    const corpName = block.match(/<corp_name>([\s\S]*?)<\/corp_name>/)?.[1];
    const stockCode = block.match(/<stock_code>([\s\S]*?)<\/stock_code>/)?.[1];

    if (!corpName || !stockCode) continue;
    if (!/^\d{6}$/.test(stockCode)) continue;

    if (normalizeName(corpName) === target) {
      return `${stockCode}.KS`;
    }
  }

  return undefined;
}

async function resolveSymbol(input: string) {
  const raw = input.trim();

  if (!raw) {
    throw new Error('기업명 또는 티커를 입력해 주세요.');
  }

  const directMap =
    KOREAN_TICKER_MAP[raw] ||
    KOREAN_TICKER_MAP[raw.toUpperCase()] ||
    Object.entries(KOREAN_TICKER_MAP).find(
      ([key]) => normalizeName(key) === normalizeName(raw)
    )?.[1];

  if (directMap) {
    return {
      symbol: directMap,
      requestedName: raw,
      dartStatus: 'not needed',
    };
  }

  if (isKoreanCode(raw)) {
    return {
      symbol: `${raw}.KS`,
      requestedName: raw,
      dartStatus: 'not needed',
    };
  }

  if (raw.toUpperCase().endsWith('.KS') || raw.toUpperCase().endsWith('.KQ')) {
    return {
      symbol: raw.toUpperCase(),
      requestedName: raw,
      dartStatus: 'not needed',
    };
  }

  try {
    const dartSymbol = await findTickerFromDart(raw);

    if (dartSymbol) {
      return {
        symbol: dartSymbol,
        requestedName: raw,
        dartStatus: 'resolved by DART',
      };
    }

    return {
      symbol: looksLikeYahooTicker(raw) ? raw.toUpperCase() : raw,
      requestedName: raw,
      dartStatus: 'not found',
    };
  } catch (error) {
    return {
      symbol: looksLikeYahooTicker(raw) ? raw.toUpperCase() : raw,
      requestedName: raw,
      dartStatus:
        error instanceof Error ? `failed: ${error.message}` : 'failed',
    };
  }
}

function calculateMaxDrawdown(chart: PricePoint[]) {
  if (chart.length < 2) return 0;

  let peak = chart[0].close;
  let maxDrawdown = 0;

  for (const point of chart) {
    if (point.close > peak) {
      peak = point.close;
    }

    const drawdown = (point.close - peak) / peak;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Math.abs(maxDrawdown);
}

function calculateMomentum(chart: PricePoint[]) {
  if (chart.length < 60) return 0;

  const last = chart[chart.length - 1].close;
  const before20 = chart[Math.max(0, chart.length - 21)].close;
  const before60 = chart[Math.max(0, chart.length - 61)].close;

  const r20 = before20 > 0 ? (last / before20 - 1) * 100 : 0;
  const r60 = before60 > 0 ? (last / before60 - 1) * 100 : 0;

  return r20 * 0.6 + r60 * 0.4;
}

function calculateScores(params: {
  per?: number;
  pbr?: number;
  roe?: number;
  debtToEquity?: number;
  revenueGrowth?: number;
  beta?: number;
  chart: PricePoint[];
}) {
  const { per, pbr, roe, debtToEquity, revenueGrowth, beta, chart } = params;

  const momentum = calculateMomentum(chart);

  const growthScore =
    clamp((revenueGrowth ?? 0) * 2 + 50) * 0.35 +
    clamp((roe ?? 0) * 3) * 0.25 +
    clamp(momentum + 50) * 0.25 +
    clamp(100 - Math.max(0, debtToEquity ?? 100) / 3) * 0.15;

  const sectorHeat =
    clamp(momentum + 50) * 0.7 +
    clamp((revenueGrowth ?? 0) * 2 + 50) * 0.3;

  let valuationRisk = 40;

  if (typeof per === 'number') {
    if (per > 60) valuationRisk += 30;
    else if (per > 35) valuationRisk += 20;
    else if (per > 20) valuationRisk += 10;
    else if (per > 0 && per < 10) valuationRisk -= 10;
  }

  if (typeof pbr === 'number') {
    if (pbr > 8) valuationRisk += 25;
    else if (pbr > 4) valuationRisk += 15;
    else if (pbr > 2) valuationRisk += 8;
    else if (pbr > 0 && pbr < 1) valuationRisk -= 10;
  }

  if (momentum > 60) valuationRisk += 20;
  else if (momentum > 30) valuationRisk += 10;

  if ((beta ?? 1) > 1.5) valuationRisk += 10;

  const financialHealth =
    clamp((roe ?? 0) * 3) * 0.35 +
    clamp(100 - Math.max(0, debtToEquity ?? 100) / 3) * 0.35 +
    clamp((revenueGrowth ?? 0) * 2 + 50) * 0.3;

  return {
    growthPotential: round(clamp(growthScore), 0),
    sectorHeat: round(clamp(sectorHeat), 0),
    bubbleRisk: round(clamp(valuationRisk), 0),
    financialHealth: round(clamp(financialHealth), 0),
  };
}

function calculateStressPrices(price: number, chart: PricePoint[]) {
  const maxDrawdown = calculateMaxDrawdown(chart);
  const drawdownPrice = price * (1 - Math.min(maxDrawdown, 0.8));

  return {
    mildDropPrice: round(price * 0.8, 2),
    severeDropPrice: round(price * 0.6, 2),
    bubbleCrashPrice: round(price * 0.4, 2),
    maxDrawdownBasedPrice: round(drawdownPrice, 2),
  };
}

function buildExplanations() {
  return {
    price:
      '현재가입니다. 단기적으로는 뉴스, 시장 분위기, 수급에 따라 크게 흔들릴 수 있습니다.',
    marketCap:
      '시가총액은 회사 전체의 시장 가격입니다. 주가 × 발행주식수로 계산합니다.',
    per:
      'PER은 주가가 이익의 몇 배인지 보는 지표입니다. 낮다고 무조건 좋은 것은 아니고, 성장성이 낮아서 낮을 수도 있습니다.',
    pbr:
      'PBR은 주가가 장부가치의 몇 배인지 보는 지표입니다. 1보다 낮으면 장부가보다 싸다는 뜻이지만, 회사의 질도 함께 봐야 합니다.',
    roe:
      'ROE는 자기자본으로 얼마나 이익을 잘 내는지 보는 지표입니다. 일반적으로 높을수록 수익성이 좋습니다.',
    debtToEquity:
      '부채비율 성격의 지표입니다. 높을수록 재무 부담이 클 수 있습니다.',
    revenueGrowth:
      '매출 성장률입니다. 회사의 외형이 커지는 속도를 봅니다.',
    growthPotential:
      '성장 가능성 점수는 매출 성장, ROE, 주가 모멘텀, 부채 부담을 합쳐 만든 참고용 점수입니다. 미래 수익률 확률이 아닙니다.',
    sectorHeat:
      '섹터 열기는 최근 주가 흐름과 성장 데이터를 기반으로 해당 종목이 속한 테마가 시장에서 뜨거운지 추정한 점수입니다.',
    bubbleRisk:
      '버블 위험은 PER, PBR, 최근 급등 정도, 변동성을 기반으로 과열 가능성을 점수화한 것입니다.',
    stress:
      '스트레스 가격은 예측 가격이 아니라 하락장이 왔을 때를 가정한 시나리오입니다.',
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const input = body.query || body.symbol || body.name || '';

    const { symbol, requestedName, dartStatus } = await resolveSymbol(input);

    const warnings: string[] = [];
    const sourceStatus = {
      yahooChart: 'not tried',
      yahooQuote: 'not tried',
      yahooSummary: 'not tried',
      dart: dartStatus,
    };

    let chartData: Awaited<ReturnType<typeof fetchYahooChart>>;

    try {
      chartData = await fetchYahooChart(symbol);
      sourceStatus.yahooChart = 'ok';
    } catch (firstError) {
      if (/^\d{6}\.KS$/.test(symbol)) {
        const kqSymbol = symbol.replace('.KS', '.KQ');

        try {
          chartData = await fetchYahooChart(kqSymbol);
          sourceStatus.yahooChart = `ok with ${kqSymbol}`;
        } catch {
          throw firstError;
        }
      } else {
        throw firstError;
      }
    }

    let quoteData: Awaited<ReturnType<typeof fetchYahooQuote>> | undefined;

    try {
      quoteData = await fetchYahooQuote(symbol);
      sourceStatus.yahooQuote = 'ok';
    } catch (error) {
      sourceStatus.yahooQuote =
        error instanceof Error ? `failed: ${error.message}` : 'failed';
      warnings.push(
        'Yahoo quote 데이터 조회에 실패했습니다. 일부 주식 파라미터가 비어 있을 수 있습니다.'
      );
    }

    let summaryData:
      | Awaited<ReturnType<typeof fetchYahooSummary>>
      | undefined;

    try {
      summaryData = await fetchYahooSummary(symbol);
      sourceStatus.yahooSummary = 'ok';
    } catch (error) {
      sourceStatus.yahooSummary =
        error instanceof Error ? `failed: ${error.message}` : 'failed';
      warnings.push(
        'Yahoo summary API가 실패했습니다. Vercel 환경에서 401이 발생할 수 있어 가능한 가격/차트 데이터 중심으로 표시합니다.'
      );
    }

    const name =
      quoteData?.name ||
      requestedName ||
      symbol;

    const currency =
      chartData.currency ||
      quoteData?.currency ||
      (symbol.endsWith('.KS') || symbol.endsWith('.KQ') ? 'KRW' : 'USD');

    const per = summaryData?.per ?? quoteData?.per;
    const pbr = summaryData?.pbr ?? quoteData?.pbr;
    const roe = summaryData?.roe;
    const debtToEquity = summaryData?.debtToEquity;
    const revenueGrowth = summaryData?.revenueGrowth;
    const dividendYield =
      summaryData?.dividendYield ?? quoteData?.dividendYield;
    const beta = summaryData?.beta ?? quoteData?.beta;
    const marketCap = summaryData?.marketCap ?? quoteData?.marketCap;

    const scores = calculateScores({
      per,
      pbr,
      roe,
      debtToEquity,
      revenueGrowth,
      beta,
      chart: chartData.chart,
    });

    const report: CompanyReport = {
      symbol,
      name,
      sector: summaryData?.sector || '',
      industry: summaryData?.industry || '',
      currency,
      price: chartData.price,
      previousClose: chartData.previousClose,
      marketCap,
      per,
      pbr,
      roe,
      debtToEquity,
      revenueGrowth,
      dividendYield,
      beta,
      chart: chartData.chart,
      scores,
      stress: calculateStressPrices(chartData.price, chartData.chart),
      explanations: buildExplanations(),
      warnings,
      sourceStatus,
    };

    return NextResponse.json(report);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';

    return NextResponse.json(
      {
        error: message,
        hint:
          '한국 기업은 삼성전자처럼 기업명을 넣거나 005930.KS 형식으로 입력해 보세요. 코스닥은 247540.KQ 형식입니다.',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Company diagnosis API is running.',
  });
}
