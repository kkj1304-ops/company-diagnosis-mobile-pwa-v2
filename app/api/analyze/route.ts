import { NextResponse } from 'next/server';
import AdmZip from 'adm-zip';
import { candidatesFromInput, normalizeName } from '@/lib/tickers';
import { scoreFromMetrics, type RawMetrics } from '@/lib/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AnalyzeRequest = {
  query?: string;
  symbol?: string;
  name?: string;
};

type ChartPoint = {
  date: string;
  close: number;
};

type SourceStatus = {
  yahooChart: string;
  yahooQuote: string;
  yahooSummary: string;
  naverChart: string;
  naverBasic: string;
  naverIntegration: string;
  dart: string;
};

type AnalyzeResponse = {
  query: string;
  symbol: string;
  source: string;
  metrics: RawMetrics;
  scores: ReturnType<typeof scoreFromMetrics>;
  chart: ChartPoint[];
  warnings: string[];
  sourceStatus: SourceStatus;
};

type QuoteData = Partial<RawMetrics> & {
  name?: string;
  currency?: string;
};

type ChartData = {
  chart: ChartPoint[];
  price: number;
  currency?: string;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
};

type DartResolveResult = {
  candidates: string[];
  status: string;
};

let dartXmlCache: Promise<string> | null = null;

function cleanTicker(input: string): string {
  return input.trim().toUpperCase();
}

function hasHangul(input: string): boolean {
  return /[가-힣]/.test(input);
}

function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  return Number.isFinite(value) ? value : null;
}

function rawNumber(value: unknown): number | null {
  if (typeof value === 'number') return numberOrNull(value);
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { raw?: unknown }).raw;
  return numberOrNull(raw);
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function firstNumber(...values: Array<unknown>): number | null {
  for (const value of values) {
    const n = rawNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    const text = stringOrUndefined(value);
    if (text) return text;
  }
  return undefined;
}


function naverCodeFromSymbol(symbol: string): string | null {
  const match = symbol.trim().match(/^(\d{6})(?:\.(KS|KQ))?$/i);
  return match?.[1] ?? null;
}

function formatNaverDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function dateFromNaver(value: unknown): string | undefined {
  const text = stringOrUndefined(value);
  if (!text) return undefined;
  const digits = text.replace(/[^0-9]/g, '');
  if (!/^\d{8}$/.test(digits)) return undefined;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function parseLooseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentToRatio(value: unknown): number | null {
  const parsed = parseLooseNumber(value);
  return parsed === null ? null : parsed / 100;
}

function parseKoreanAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.replace(/,/g, '').replace(/\s+/g, '');
  const units: Array<[RegExp, number]> = [
    [/(\d+(?:\.\d+)?)조/g, 1_000_000_000_000],
    [/(\d+(?:\.\d+)?)억/g, 100_000_000],
    [/(\d+(?:\.\d+)?)만/g, 10_000],
  ];

  let total = 0;
  let matched = false;

  for (const [regex, multiplier] of units) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      total += Number(match[1]) * multiplier;
      matched = true;
    }
  }

  if (matched) return total;
  return parseLooseNumber(value);
}

function getObjectValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function naverInfoValue(totalInfos: unknown, keys: string[]): unknown {
  if (!Array.isArray(totalInfos)) return undefined;

  const wanted = keys.map((key) => key.toLowerCase().replace(/\s+/g, ''));

  for (const item of totalInfos) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const labels = [
      record.code,
      record.key,
      record.name,
      record.title,
      record.label,
      record.itemName,
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase().replace(/\s+/g, ''));

    const matched = labels.some((label) =>
      wanted.some((target) => label === target || label.includes(target) || target.includes(label)),
    );

    if (matched) {
      return getObjectValue(record, ['value', 'data', 'text', 'content', 'description', 'formattedValue']);
    }
  }

  return undefined;
}

function buildNaverRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  return { start: formatNaverDate(start), end: formatNaverDate(end) };
}

function normalizeForDart(input: string): string {
  return normalizeName(input)
    .replace(/주식회사/g, '')
    .replace(/유한회사/g, '')
    .replace(/㈜/g, '')
    .replace(/\(주\)/g, '')
    .replace(/[^0-9A-Z가-힣]/g, '');
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1] ? decodeXmlText(match[1].trim()) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  return response.json();
}


async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  return response.text();
}

async function fetchYahooChart(symbol: string): Promise<ChartData> {
  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1d`,
  ];

  let lastError: unknown;

  for (const url of urls) {
    try {
      const json = await fetchJson(url);
      const result = json?.chart?.result?.[0];

      if (!result) {
        throw new Error('Yahoo chart result empty');
      }

      const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
      const closes: Array<number | null> = Array.isArray(
        result.indicators?.quote?.[0]?.close,
      )
        ? result.indicators.quote[0].close
        : [];

      const chart = timestamps
        .map((timestamp, index): ChartPoint | null => {
          const close = closes[index];
          if (typeof close !== 'number' || !Number.isFinite(close)) return null;

          return {
            date: new Date(timestamp * 1000).toISOString().slice(0, 10),
            close: round(close, 2),
          };
        })
        .filter((point): point is ChartPoint => point !== null);

      if (chart.length === 0) {
        throw new Error('Yahoo chart close data empty');
      }

      const meta = result.meta ?? {};
      const price = firstNumber(meta.regularMarketPrice) ?? chart[chart.length - 1].close;
      const closesOnly = chart.map((point) => point.close);
      const fiftyTwoWeekHigh = Math.max(...closesOnly);
      const fiftyTwoWeekLow = Math.min(...closesOnly);

      return {
        chart,
        price: round(price, 2),
        currency: firstString(meta.currency),
        fiftyTwoWeekHigh: round(fiftyTwoWeekHigh, 2),
        fiftyTwoWeekLow: round(fiftyTwoWeekLow, 2),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Yahoo chart failed: ${errorMessage(lastError)}`);
}

async function fetchYahooQuote(symbol: string): Promise<QuoteData> {
  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encoded}`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encoded}`,
  ];

  let lastError: unknown;

  for (const url of urls) {
    try {
      const json = await fetchJson(url);
      const quote = json?.quoteResponse?.result?.[0];

      if (!quote) {
        throw new Error('Yahoo quote result empty');
      }

      return {
        symbol,
        name: firstString(quote.longName, quote.shortName, quote.displayName),
        currency: firstString(quote.currency),
        price: firstNumber(quote.regularMarketPrice),
        marketCap: firstNumber(quote.marketCap),
        trailingPE: firstNumber(quote.trailingPE),
        forwardPE: firstNumber(quote.forwardPE),
        priceToBook: firstNumber(quote.priceToBook),
        dividendYield: firstNumber(quote.trailingAnnualDividendYield, quote.dividendYield),
        beta: firstNumber(quote.beta),
        fiftyTwoWeekHigh: firstNumber(quote.fiftyTwoWeekHigh),
        fiftyTwoWeekLow: firstNumber(quote.fiftyTwoWeekLow),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Yahoo quote failed: ${errorMessage(lastError)}`);
}

async function fetchYahooSummary(symbol: string): Promise<QuoteData> {
  const modules = [
    'assetProfile',
    'defaultKeyStatistics',
    'financialData',
    'summaryDetail',
  ].join(',');

  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encoded}?modules=${modules}`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encoded}?modules=${modules}`,
  ];

  let lastError: unknown;

  for (const url of urls) {
    try {
      const json = await fetchJson(url);
      const result = json?.quoteSummary?.result?.[0];

      if (!result) {
        throw new Error('Yahoo summary result empty');
      }

      const assetProfile = result.assetProfile ?? {};
      const keyStats = result.defaultKeyStatistics ?? {};
      const financialData = result.financialData ?? {};
      const summaryDetail = result.summaryDetail ?? {};

      return {
        symbol,
        sector: firstString(assetProfile.sector),
        industry: firstString(assetProfile.industry),
        marketCap: firstNumber(summaryDetail.marketCap),
        trailingPE: firstNumber(summaryDetail.trailingPE, keyStats.trailingPE),
        forwardPE: firstNumber(summaryDetail.forwardPE, keyStats.forwardPE),
        priceToBook: firstNumber(keyStats.priceToBook),
        returnOnEquity: firstNumber(financialData.returnOnEquity),
        debtToEquity: firstNumber(financialData.debtToEquity),
        revenueGrowth: firstNumber(financialData.revenueGrowth),
        earningsGrowth: firstNumber(financialData.earningsGrowth),
        operatingMargins: firstNumber(financialData.operatingMargins),
        profitMargins: firstNumber(financialData.profitMargins),
        dividendYield: firstNumber(summaryDetail.dividendYield),
        beta: firstNumber(summaryDetail.beta),
        recommendationKey: firstString(financialData.recommendationKey),
        targetMeanPrice: firstNumber(financialData.targetMeanPrice),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Yahoo summary failed: ${errorMessage(lastError)}`);
}


async function fetchNaverChartModern(code: string): Promise<ChartData> {
  const { start, end } = buildNaverRange();
  const url = `https://api.stock.naver.com/chart/domestic/item/${code}?periodType=dayCandle&startDateTime=${start}&endDateTime=${end}`;
  const json = await fetchJson(url);
  const priceInfos: unknown[] = Array.isArray(json?.priceInfos)
    ? json.priceInfos
    : Array.isArray(json)
      ? json
      : [];

  const chart = priceInfos
    .map((item): ChartPoint | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const date = dateFromNaver(record.localDate ?? record.date);
      const close = parseLooseNumber(record.closePrice);
      if (!date || close === null) return null;
      return { date, close: round(close, 2) };
    })
    .filter((point): point is ChartPoint => point !== null);

  if (chart.length === 0) {
    throw new Error('Naver modern chart data empty');
  }

  const closesOnly = chart.map((point) => point.close);

  return {
    chart,
    price: chart[chart.length - 1].close,
    currency: 'KRW',
    fiftyTwoWeekHigh: round(Math.max(...closesOnly), 2),
    fiftyTwoWeekLow: round(Math.min(...closesOnly), 2),
  };
}

function parseNaverSiseRows(text: string): Array<Array<string | number>> {
  const rowMatches = text.trim().match(/\[[^\[\]]*\]/g) ?? [];

  return rowMatches
    .map((row) => {
      const values: Array<string | number> = [];
      const tokenRegex = /'([^']*)'|(-?\d+(?:\.\d+)?)/g;
      let match: RegExpExecArray | null;

      while ((match = tokenRegex.exec(row)) !== null) {
        if (match[1] !== undefined) values.push(match[1]);
        else values.push(Number(match[2]));
      }

      return values;
    })
    .filter((row) => row.length > 0);
}

async function fetchNaverChartLegacy(code: string): Promise<ChartData> {
  const { start, end } = buildNaverRange();
  const url = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${start}&endTime=${end}&timeframe=day`;
  const text = await fetchText(url);
  const rows = parseNaverSiseRows(text).slice(1);

  const chart = rows
    .map((row): ChartPoint | null => {
      const date = dateFromNaver(row[0]);
      const close = parseLooseNumber(row[4]);
      if (!date || close === null) return null;
      return { date, close: round(close, 2) };
    })
    .filter((point): point is ChartPoint => point !== null);

  if (chart.length === 0) {
    throw new Error('Naver legacy chart data empty');
  }

  const closesOnly = chart.map((point) => point.close);

  return {
    chart,
    price: chart[chart.length - 1].close,
    currency: 'KRW',
    fiftyTwoWeekHigh: round(Math.max(...closesOnly), 2),
    fiftyTwoWeekLow: round(Math.min(...closesOnly), 2),
  };
}

async function fetchNaverChart(code: string): Promise<ChartData> {
  let lastError: unknown;

  try {
    return await fetchNaverChartModern(code);
  } catch (error) {
    lastError = error;
  }

  try {
    return await fetchNaverChartLegacy(code);
  } catch (error) {
    lastError = error;
  }

  throw new Error(`Naver chart failed: ${errorMessage(lastError)}`);
}

async function fetchNaverBasic(code: string): Promise<QuoteData> {
  const json = await fetchJson(`https://m.stock.naver.com/api/stock/${code}/basic`);

  return {
    name: firstString(json?.stockName),
    currency: 'KRW',
    price: parseLooseNumber(json?.closePrice),
  };
}

async function fetchNaverIntegration(code: string): Promise<QuoteData> {
  const json = await fetchJson(`https://m.stock.naver.com/api/stock/${code}/integration`);
  const totalInfos = json?.totalInfos;
  const consensusInfo = json?.consensusInfo ?? {};

  const marketCap = parseKoreanAmount(naverInfoValue(totalInfos, ['marketValue', 'marketCap', '시가총액', '시총']));
  const trailingPE = parseLooseNumber(naverInfoValue(totalInfos, ['per', 'PER']));
  const forwardPE = parseLooseNumber(naverInfoValue(totalInfos, ['cnsPer', '추정PER', '추정 per']));
  const priceToBook = parseLooseNumber(naverInfoValue(totalInfos, ['pbr', 'PBR']));
  const returnOnEquity = parsePercentToRatio(naverInfoValue(totalInfos, ['roe', 'ROE']));
  const debtToEquity = parseLooseNumber(naverInfoValue(totalInfos, ['debtToEquity', '부채비율', 'debt']));
  const dividendYield = parsePercentToRatio(
    naverInfoValue(totalInfos, ['dividendYieldRatio', '배당수익률', 'dividendYield']),
  );
  const fiftyTwoWeekHigh = parseLooseNumber(
    naverInfoValue(totalInfos, ['highPriceOf52Weeks', '52주최고', '52주 최고']),
  );
  const fiftyTwoWeekLow = parseLooseNumber(
    naverInfoValue(totalInfos, ['lowPriceOf52Weeks', '52주최저', '52주 최저']),
  );
  const targetMeanPrice = parseLooseNumber(
    getObjectValue(consensusInfo as Record<string, unknown>, [
      'priceTargetMean',
      'targetMeanPrice',
      'targetPrice',
    ]),
  );

  return {
    currency: 'KRW',
    marketCap,
    trailingPE,
    forwardPE,
    priceToBook,
    returnOnEquity,
    debtToEquity,
    dividendYield,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    targetMeanPrice,
  };
}

async function getDartCorpCodeXml(): Promise<string> {
  const apiKey = process.env.DART_API_KEY;

  if (!apiKey) {
    throw new Error('DART_API_KEY is not set');
  }

  if (!dartXmlCache) {
    dartXmlCache = (async () => {
      const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(
        apiKey,
      )}`;

      const response = await fetch(url, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`DART corpCode failed: ${response.status} ${response.statusText}`.trim());
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const zip = new AdmZip(buffer);
      const entry = zip.getEntries().find((item) => item.entryName.endsWith('.xml'));

      if (!entry) {
        throw new Error('DART corpCode XML not found');
      }

      return entry.getData().toString('utf-8');
    })();
  }

  return dartXmlCache;
}

async function resolveFromDart(companyName: string): Promise<DartResolveResult> {
  if (!process.env.DART_API_KEY) {
    return { candidates: [], status: 'skipped: DART_API_KEY missing' };
  }

  try {
    const xml = await getDartCorpCodeXml();
    const target = normalizeForDart(companyName);
    const exactMatches: string[] = [];
    const partialMatches: string[] = [];
    const listRegex = /<list>([\s\S]*?)<\/list>/g;
    let match: RegExpExecArray | null;

    while ((match = listRegex.exec(xml)) !== null) {
      const block = match[1];
      const corpName = xmlTag(block, 'corp_name');
      const stockCode = xmlTag(block, 'stock_code');

      if (!corpName || !stockCode || !/^\d{6}$/.test(stockCode)) continue;

      const normalizedCorpName = normalizeForDart(corpName);

      if (normalizedCorpName === target) {
        exactMatches.push(stockCode);
      } else if (target.length >= 3 && normalizedCorpName.includes(target)) {
        partialMatches.push(stockCode);
      }
    }

    const stockCode = exactMatches[0] ?? partialMatches[0];

    if (!stockCode) {
      return { candidates: [], status: 'not found' };
    }

    return {
      candidates: [`${stockCode}.KS`, `${stockCode}.KQ`],
      status: `resolved by DART: ${stockCode}`,
    };
  } catch (error) {
    dartXmlCache = null;
    return { candidates: [], status: `failed: ${errorMessage(error)}` };
  }
}

async function resolveCandidates(input: string): Promise<DartResolveResult> {
  const raw = input.trim();

  if (!raw) {
    throw new Error('기업명 또는 티커를 입력해 주세요.');
  }

  const localCandidates = candidatesFromInput(raw);
  const firstLocal = localCandidates[0];

  if (/^\d{6}$/.test(raw) || /^\d{6}\.(KS|KQ)$/i.test(raw)) {
    return { candidates: localCandidates, status: 'not needed' };
  }

  if (!hasHangul(raw)) {
    return { candidates: localCandidates.length ? localCandidates : [cleanTicker(raw)], status: 'not needed' };
  }

  const localResolved = firstLocal && /^\d{6}\.(KS|KQ)$/i.test(firstLocal);

  if (localResolved) {
    return { candidates: localCandidates, status: 'not needed' };
  }

  const dartResult = await resolveFromDart(raw);

  if (dartResult.candidates.length > 0) {
    return dartResult;
  }

  return {
    candidates: localCandidates.length ? localCandidates : [raw],
    status: dartResult.status,
  };
}

function makeSource(status: SourceStatus): string {
  const parts: string[] = [];

  if (status.yahooChart === 'ok') parts.push('Yahoo chart');
  if (status.naverChart === 'ok') parts.push('Naver chart');
  if (status.yahooQuote === 'ok') parts.push('Yahoo quote');
  if (status.naverBasic === 'ok') parts.push('Naver basic');
  if (status.yahooSummary === 'ok') parts.push('Yahoo summary');
  if (status.naverIntegration === 'ok') parts.push('Naver metrics');
  if (status.yahooSummary !== 'ok') parts.push('summary fallback');
  if (status.dart.startsWith('resolved by DART')) parts.push('DART ticker');

  return parts.length ? parts.join(' + ') : 'fallback';
}

async function buildReport(query: string, symbol: string, dartStatus: string): Promise<AnalyzeResponse> {
  const warnings: string[] = [];
  const sourceStatus: SourceStatus = {
    yahooChart: 'not tried',
    yahooQuote: 'not tried',
    yahooSummary: 'not tried',
    naverChart: 'not tried',
    naverBasic: 'not tried',
    naverIntegration: 'not tried',
    dart: dartStatus,
  };

  let chartData: ChartData;
  const naverCode = naverCodeFromSymbol(symbol);

  try {
    chartData = await fetchYahooChart(symbol);
    sourceStatus.yahooChart = 'ok';
  } catch (error) {
    sourceStatus.yahooChart = `failed: ${errorMessage(error)}`;

    if (!naverCode) {
      throw error;
    }

    try {
      chartData = await fetchNaverChart(naverCode);
      sourceStatus.naverChart = 'ok';
      warnings.push('Yahoo chart 조회 실패로 네이버 금융 차트 데이터를 사용했습니다.');
    } catch (naverError) {
      sourceStatus.naverChart = `failed: ${errorMessage(naverError)}`;
      throw error;
    }
  }

  let quoteData: QuoteData = {};

  try {
    quoteData = await fetchYahooQuote(symbol);
    sourceStatus.yahooQuote = 'ok';
  } catch (error) {
    sourceStatus.yahooQuote = `failed: ${errorMessage(error)}`;
    warnings.push('Yahoo quote 조회에 실패해 가격/차트 중심으로 표시합니다.');
  }

  let summaryData: QuoteData = {};

  try {
    summaryData = await fetchYahooSummary(symbol);
    sourceStatus.yahooSummary = 'ok';
  } catch (error) {
    sourceStatus.yahooSummary = `failed: ${errorMessage(error)}`;
    warnings.push('Yahoo summary API가 실패했지만 앱은 가격/차트 데이터로 계속 동작합니다.');
  }

  let naverBasicData: QuoteData = {};
  let naverIntegrationData: QuoteData = {};

  if (naverCode) {
    try {
      naverBasicData = await fetchNaverBasic(naverCode);
      sourceStatus.naverBasic = 'ok';
    } catch (error) {
      sourceStatus.naverBasic = `failed: ${errorMessage(error)}`;
    }

    try {
      naverIntegrationData = await fetchNaverIntegration(naverCode);
      sourceStatus.naverIntegration = 'ok';
    } catch (error) {
      sourceStatus.naverIntegration = `failed: ${errorMessage(error)}`;
    }
  }

  const metrics: RawMetrics = {
    symbol,
    name: firstString(quoteData.name, naverBasicData.name, query, symbol) ?? symbol,
    sector: firstString(summaryData.sector),
    industry: firstString(summaryData.industry),
    currency: firstString(chartData.currency, quoteData.currency, naverBasicData.currency, naverIntegrationData.currency) ?? (symbol.endsWith('.KS') || symbol.endsWith('.KQ') ? 'KRW' : 'USD'),
    price: chartData.price ?? quoteData.price ?? naverBasicData.price ?? null,
    marketCap: summaryData.marketCap ?? quoteData.marketCap ?? naverIntegrationData.marketCap ?? null,
    trailingPE: summaryData.trailingPE ?? quoteData.trailingPE ?? naverIntegrationData.trailingPE ?? null,
    forwardPE: summaryData.forwardPE ?? quoteData.forwardPE ?? naverIntegrationData.forwardPE ?? null,
    priceToBook: summaryData.priceToBook ?? quoteData.priceToBook ?? naverIntegrationData.priceToBook ?? null,
    returnOnEquity: summaryData.returnOnEquity ?? naverIntegrationData.returnOnEquity ?? null,
    debtToEquity: summaryData.debtToEquity ?? naverIntegrationData.debtToEquity ?? null,
    revenueGrowth: summaryData.revenueGrowth ?? null,
    earningsGrowth: summaryData.earningsGrowth ?? null,
    operatingMargins: summaryData.operatingMargins ?? null,
    profitMargins: summaryData.profitMargins ?? null,
    dividendYield: summaryData.dividendYield ?? quoteData.dividendYield ?? naverIntegrationData.dividendYield ?? null,
    beta: summaryData.beta ?? quoteData.beta ?? null,
    fiftyTwoWeekHigh: quoteData.fiftyTwoWeekHigh ?? naverIntegrationData.fiftyTwoWeekHigh ?? chartData.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: quoteData.fiftyTwoWeekLow ?? naverIntegrationData.fiftyTwoWeekLow ?? chartData.fiftyTwoWeekLow ?? null,
    recommendationKey: summaryData.recommendationKey ?? null,
    targetMeanPrice: summaryData.targetMeanPrice ?? naverIntegrationData.targetMeanPrice ?? null,
  };

  return {
    query,
    symbol,
    source: makeSource(sourceStatus),
    metrics,
    scores: scoreFromMetrics(metrics),
    chart: chartData.chart,
    warnings,
    sourceStatus,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const query = body.query ?? body.symbol ?? body.name ?? '';
    const { candidates, status: dartStatus } = await resolveCandidates(query);
    const tried: string[] = [];
    let lastError: unknown;

    for (const candidate of candidates) {
      const symbol = cleanTicker(candidate);
      tried.push(symbol);

      try {
        const report = await buildReport(query.trim(), symbol, dartStatus);
        return NextResponse.json(report);
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `조회 가능한 Yahoo 티커를 찾지 못했습니다. 시도: ${tried.join(', ') || '없음'}. ${errorMessage(
        lastError,
      )}`,
    );
  } catch (error) {
    const message = errorMessage(error);

    return NextResponse.json(
      {
        error: message,
        hint: '한국 기업은 삼성전자처럼 기업명을 넣거나 005930.KS / 247540.KQ 형식으로 입력해 보세요. 국내 종목은 Yahoo 실패 시 네이버 금융 fallback을 시도하며, DART_API_KEY가 있으면 종목명 검색이 보강됩니다.',
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Company diagnosis API is running.',
  });
}
