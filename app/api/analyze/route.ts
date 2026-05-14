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

type CompanyAnalysis = {
  headline: string;
  summary: string;
  positives: string[];
  risks: string[];
  checklist: string[];
  disclaimer: string;
};

type PeerRecommendation = {
  rank: number;
  symbol: string;
  name: string;
  sectorKey: string;
  score: number;
  growthScore: number;
  sectorScore: number;
  bubbleRisk: number;
  price?: number | null;
  currency?: string;
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  returnOnEquity?: number | null;
  reason: string;
  source: string;
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
  analysis: CompanyAnalysis;
  peers: PeerRecommendation[];
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


const DIRECT_TICKER_ALIASES: Record<string, string> = {
  '삼성전자': '005930.KS',
  '삼전': '005930.KS',
  'SK하이닉스': '000660.KS',
  '에스케이하이닉스': '000660.KS',
  '하이닉스': '000660.KS',
  '현대차': '005380.KS',
  '현대자동차': '005380.KS',
  '기아': '000270.KS',
  'NAVER': '035420.KS',
  '네이버': '035420.KS',
  '카카오': '035720.KS',
  '두산에너빌리티': '034020.KS',
  '두산중공업': '034020.KS',
  '두산에너': '034020.KS',
  '에코프로비엠': '247540.KQ',
  '에코프로': '086520.KQ',
  'LG에너지솔루션': '373220.KS',
  '엘지에너지솔루션': '373220.KS',
  '삼성SDI': '006400.KS',
  'LG화학': '051910.KS',
  'POSCO홀딩스': '005490.KS',
  '포스코홀딩스': '005490.KS',
  '포스코퓨처엠': '003670.KS',

  // 금융/은행: DART 또는 lib/tickers.ts가 빠져 있어도 직접 해석되도록 둡니다.
  'KB금융': '105560.KS',
  'KB금융지주': '105560.KS',
  '케이비금융': '105560.KS',
  '신한지주': '055550.KS',
  '신한금융지주': '055550.KS',
  '신한금융': '055550.KS',
  '하나금융지주': '086790.KS',
  '하나금융': '086790.KS',
  '하나금융그룹': '086790.KS',
  '하나지주': '086790.KS',
  'HANA FINANCIAL': '086790.KS',
  'HANA FINANCIAL GROUP': '086790.KS',
  'HANAFINANCIAL': '086790.KS',
  'HANAFINANCIALGROUP': '086790.KS',
  '우리금융지주': '316140.KS',
  '우리금융': '316140.KS',
  '기업은행': '024110.KS',
  'IBK기업은행': '024110.KS',
  '메리츠금융지주': '138040.KS',
  '한국금융지주': '071050.KS',
  '미래에셋증권': '006800.KS',
  'NH투자증권': '005940.KS',
  '카카오뱅크': '323410.KS',
};

const NORMALIZED_DIRECT_TICKER_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(DIRECT_TICKER_ALIASES).map(([name, symbol]) => [normalizeName(name), symbol]),
);

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function directCandidatesFromInput(input: string): string[] {
  const trimmed = input.trim();
  const normalized = normalizeName(trimmed);
  const direct =
    DIRECT_TICKER_ALIASES[trimmed] ??
    DIRECT_TICKER_ALIASES[trimmed.toUpperCase()] ??
    NORMALIZED_DIRECT_TICKER_ALIASES[normalized];

  return direct ? [direct] : [];
}

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

const FETCH_HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
};

async function fetchWithTimeout(url: string, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      cache: 'no-store',
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, timeoutMs = 4500): Promise<any> {
  const response = await fetchWithTimeout(url, timeoutMs);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  return response.json();
}

async function fetchText(url: string, timeoutMs = 4500): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs);

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

  const directCandidates = directCandidatesFromInput(raw);
  const libraryCandidates = candidatesFromInput(raw);
  const localCandidates = uniqueStrings([...directCandidates, ...libraryCandidates]);
  const firstLocal = localCandidates[0];

  if (/^\d{6}$/.test(raw) || /^\d{6}\.(KS|KQ)$/i.test(raw)) {
    return { candidates: localCandidates, status: 'not needed' };
  }

  if (!hasHangul(raw)) {
    return { candidates: localCandidates.length ? localCandidates : [cleanTicker(raw)], status: 'not needed' };
  }

  const localResolved = firstLocal && /^\d{6}\.(KS|KQ)$/i.test(firstLocal);

  if (localResolved) {
    return { candidates: localCandidates, status: directCandidates.length ? 'resolved by built-in alias' : 'not needed' };
  }

  const dartResult = await resolveFromDart(raw);

  if (dartResult.candidates.length > 0) {
    return { candidates: uniqueStrings([...dartResult.candidates, ...localCandidates]), status: dartResult.status };
  }

  return {
    // 한글 기업명을 그대로 Yahoo에 던지면 실패가 길어지므로, 검증된 후보가 없으면 빈 목록을 반환합니다.
    candidates: localCandidates.filter((candidate) => /^\d{6}\.(KS|KQ)$/i.test(candidate)),
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


type PeerSeed = {
  symbol: string;
  name: string;
  sectorKey: string;
};

const PEER_GROUPS: Record<string, PeerSeed[]> = {
  'kr-financial': [
    { symbol: '105560.KS', name: 'KB금융', sectorKey: 'kr-financial' },
    { symbol: '055550.KS', name: '신한지주', sectorKey: 'kr-financial' },
    { symbol: '086790.KS', name: '하나금융지주', sectorKey: 'kr-financial' },
    { symbol: '316140.KS', name: '우리금융지주', sectorKey: 'kr-financial' },
    { symbol: '024110.KS', name: '기업은행', sectorKey: 'kr-financial' },
    { symbol: '138930.KS', name: 'BNK금융지주', sectorKey: 'kr-financial' },
    { symbol: '139130.KS', name: 'DGB금융지주', sectorKey: 'kr-financial' },
    { symbol: '175330.KS', name: 'JB금융지주', sectorKey: 'kr-financial' },
  ],
  'kr-semiconductor': [
    { symbol: '005930.KS', name: '삼성전자', sectorKey: 'kr-semiconductor' },
    { symbol: '000660.KS', name: 'SK하이닉스', sectorKey: 'kr-semiconductor' },
    { symbol: '042700.KS', name: '한미반도체', sectorKey: 'kr-semiconductor' },
    { symbol: '058470.KQ', name: '리노공업', sectorKey: 'kr-semiconductor' },
    { symbol: '039030.KQ', name: '이오테크닉스', sectorKey: 'kr-semiconductor' },
    { symbol: '403870.KQ', name: 'HPSP', sectorKey: 'kr-semiconductor' },
    { symbol: '000990.KS', name: 'DB하이텍', sectorKey: 'kr-semiconductor' },
    { symbol: '240810.KQ', name: '원익IPS', sectorKey: 'kr-semiconductor' },
  ],
  'kr-battery': [
    { symbol: '373220.KS', name: 'LG에너지솔루션', sectorKey: 'kr-battery' },
    { symbol: '006400.KS', name: '삼성SDI', sectorKey: 'kr-battery' },
    { symbol: '051910.KS', name: 'LG화학', sectorKey: 'kr-battery' },
    { symbol: '247540.KQ', name: '에코프로비엠', sectorKey: 'kr-battery' },
    { symbol: '086520.KQ', name: '에코프로', sectorKey: 'kr-battery' },
    { symbol: '003670.KS', name: '포스코퓨처엠', sectorKey: 'kr-battery' },
    { symbol: '066970.KQ', name: '엘앤에프', sectorKey: 'kr-battery' },
  ],
  'kr-auto': [
    { symbol: '005380.KS', name: '현대차', sectorKey: 'kr-auto' },
    { symbol: '000270.KS', name: '기아', sectorKey: 'kr-auto' },
    { symbol: '012330.KS', name: '현대모비스', sectorKey: 'kr-auto' },
    { symbol: '204320.KS', name: 'HL만도', sectorKey: 'kr-auto' },
    { symbol: '011210.KS', name: '현대위아', sectorKey: 'kr-auto' },
    { symbol: '018880.KS', name: '한온시스템', sectorKey: 'kr-auto' },
  ],
  'kr-internet': [
    { symbol: '035420.KS', name: 'NAVER', sectorKey: 'kr-internet' },
    { symbol: '035720.KS', name: '카카오', sectorKey: 'kr-internet' },
    { symbol: '012510.KS', name: '더존비즈온', sectorKey: 'kr-internet' },
    { symbol: '032500.KQ', name: '케이엠더블유', sectorKey: 'kr-internet' },
    { symbol: '063080.KQ', name: '컴투스홀딩스', sectorKey: 'kr-internet' },
  ],
  'kr-bio': [
    { symbol: '207940.KS', name: '삼성바이오로직스', sectorKey: 'kr-bio' },
    { symbol: '068270.KS', name: '셀트리온', sectorKey: 'kr-bio' },
    { symbol: '326030.KS', name: 'SK바이오팜', sectorKey: 'kr-bio' },
    { symbol: '196170.KQ', name: '알테오젠', sectorKey: 'kr-bio' },
    { symbol: '028300.KQ', name: 'HLB', sectorKey: 'kr-bio' },
  ],
  'kr-defense': [
    { symbol: '012450.KS', name: '한화에어로스페이스', sectorKey: 'kr-defense' },
    { symbol: '064350.KS', name: '현대로템', sectorKey: 'kr-defense' },
    { symbol: '047810.KS', name: '한국항공우주', sectorKey: 'kr-defense' },
    { symbol: '079550.KS', name: 'LIG넥스원', sectorKey: 'kr-defense' },
    { symbol: '272210.KS', name: '한화시스템', sectorKey: 'kr-defense' },
  ],
  'kr-energy': [
    { symbol: '034020.KS', name: '두산에너빌리티', sectorKey: 'kr-energy' },
    { symbol: '015760.KS', name: '한국전력', sectorKey: 'kr-energy' },
    { symbol: '052690.KS', name: '한전기술', sectorKey: 'kr-energy' },
    { symbol: '051600.KS', name: '한전KPS', sectorKey: 'kr-energy' },
    { symbol: '010120.KS', name: 'LS ELECTRIC', sectorKey: 'kr-energy' },
    { symbol: '298040.KS', name: '효성중공업', sectorKey: 'kr-energy' },
  ],
  'kr-shipbuilding': [
    { symbol: '329180.KS', name: 'HD현대중공업', sectorKey: 'kr-shipbuilding' },
    { symbol: '009540.KS', name: 'HD한국조선해양', sectorKey: 'kr-shipbuilding' },
    { symbol: '010140.KS', name: '삼성중공업', sectorKey: 'kr-shipbuilding' },
    { symbol: '042660.KS', name: '한화오션', sectorKey: 'kr-shipbuilding' },
    { symbol: '010620.KS', name: 'HD현대미포', sectorKey: 'kr-shipbuilding' },
  ],
  'kr-entertainment': [
    { symbol: '352820.KS', name: '하이브', sectorKey: 'kr-entertainment' },
    { symbol: '035900.KQ', name: 'JYP Ent.', sectorKey: 'kr-entertainment' },
    { symbol: '041510.KQ', name: '에스엠', sectorKey: 'kr-entertainment' },
    { symbol: '122870.KQ', name: '와이지엔터테인먼트', sectorKey: 'kr-entertainment' },
    { symbol: '035760.KQ', name: 'CJ ENM', sectorKey: 'kr-entertainment' },
  ],
  'kr-steel': [
    { symbol: '005490.KS', name: 'POSCO홀딩스', sectorKey: 'kr-steel' },
    { symbol: '004020.KS', name: '현대제철', sectorKey: 'kr-steel' },
    { symbol: '010130.KS', name: '고려아연', sectorKey: 'kr-steel' },
    { symbol: '103140.KS', name: '풍산', sectorKey: 'kr-steel' },
    { symbol: '001430.KS', name: '세아베스틸지주', sectorKey: 'kr-steel' },
  ],
  'kr-large': [
    { symbol: '005930.KS', name: '삼성전자', sectorKey: 'kr-large' },
    { symbol: '000660.KS', name: 'SK하이닉스', sectorKey: 'kr-large' },
    { symbol: '005380.KS', name: '현대차', sectorKey: 'kr-large' },
    { symbol: '035420.KS', name: 'NAVER', sectorKey: 'kr-large' },
    { symbol: '105560.KS', name: 'KB금융', sectorKey: 'kr-large' },
    { symbol: '207940.KS', name: '삼성바이오로직스', sectorKey: 'kr-large' },
  ],
  'us-technology': [
    { symbol: 'AAPL', name: 'Apple', sectorKey: 'us-technology' },
    { symbol: 'MSFT', name: 'Microsoft', sectorKey: 'us-technology' },
    { symbol: 'NVDA', name: 'NVIDIA', sectorKey: 'us-technology' },
    { symbol: 'AVGO', name: 'Broadcom', sectorKey: 'us-technology' },
    { symbol: 'AMD', name: 'AMD', sectorKey: 'us-technology' },
    { symbol: 'ASML', name: 'ASML', sectorKey: 'us-technology' },
    { symbol: 'GOOGL', name: 'Alphabet', sectorKey: 'us-technology' },
    { symbol: 'META', name: 'Meta Platforms', sectorKey: 'us-technology' },
  ],
  'us-financial': [
    { symbol: 'JPM', name: 'JPMorgan Chase', sectorKey: 'us-financial' },
    { symbol: 'BAC', name: 'Bank of America', sectorKey: 'us-financial' },
    { symbol: 'WFC', name: 'Wells Fargo', sectorKey: 'us-financial' },
    { symbol: 'GS', name: 'Goldman Sachs', sectorKey: 'us-financial' },
    { symbol: 'MS', name: 'Morgan Stanley', sectorKey: 'us-financial' },
    { symbol: 'C', name: 'Citigroup', sectorKey: 'us-financial' },
  ],
  'us-healthcare': [
    { symbol: 'LLY', name: 'Eli Lilly', sectorKey: 'us-healthcare' },
    { symbol: 'UNH', name: 'UnitedHealth', sectorKey: 'us-healthcare' },
    { symbol: 'JNJ', name: 'Johnson & Johnson', sectorKey: 'us-healthcare' },
    { symbol: 'ABBV', name: 'AbbVie', sectorKey: 'us-healthcare' },
    { symbol: 'MRK', name: 'Merck', sectorKey: 'us-healthcare' },
  ],
  'us-energy': [
    { symbol: 'XOM', name: 'Exxon Mobil', sectorKey: 'us-energy' },
    { symbol: 'CVX', name: 'Chevron', sectorKey: 'us-energy' },
    { symbol: 'COP', name: 'ConocoPhillips', sectorKey: 'us-energy' },
    { symbol: 'SLB', name: 'SLB', sectorKey: 'us-energy' },
  ],
  'us-consumer': [
    { symbol: 'AMZN', name: 'Amazon', sectorKey: 'us-consumer' },
    { symbol: 'TSLA', name: 'Tesla', sectorKey: 'us-consumer' },
    { symbol: 'HD', name: 'Home Depot', sectorKey: 'us-consumer' },
    { symbol: 'MCD', name: "McDonald's", sectorKey: 'us-consumer' },
    { symbol: 'NKE', name: 'Nike', sectorKey: 'us-consumer' },
  ],
  'us-large': [
    { symbol: 'AAPL', name: 'Apple', sectorKey: 'us-large' },
    { symbol: 'MSFT', name: 'Microsoft', sectorKey: 'us-large' },
    { symbol: 'NVDA', name: 'NVIDIA', sectorKey: 'us-large' },
    { symbol: 'AMZN', name: 'Amazon', sectorKey: 'us-large' },
    { symbol: 'GOOGL', name: 'Alphabet', sectorKey: 'us-large' },
    { symbol: 'META', name: 'Meta Platforms', sectorKey: 'us-large' },
  ],
};

function clampValue(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function isKoreanSymbol(symbol: string): boolean {
  return /^\d{6}\.(KS|KQ)$/i.test(symbol);
}

function comparableTicker(symbol: string): string {
  return cleanTicker(symbol).replace(/\.(KS|KQ)$/i, '');
}

function sameSymbol(a: string, b: string): boolean {
  return comparableTicker(a) === comparableTicker(b);
}

function inferSectorSlug(query: string, symbol: string, metrics: RawMetrics): string {
  const text = `${query} ${symbol} ${metrics.name} ${metrics.sector ?? ''} ${metrics.industry ?? ''}`.toLowerCase();
  const normalized = normalizeName(text);

  if (/금융|은행|bank|financial|capitalmarkets|assetmanagement/.test(text) || normalized.includes('금융지주')) return 'financial';
  if (/반도체|semiconductor|chip|hynix|nvidia|nvda|amd|asml/.test(text) || normalized.includes('삼성전자')) return 'semiconductor';
  if (/배터리|2차전지|이차전지|battery|lithium|전지|에코프로|sdi/.test(text)) return 'battery';
  if (/자동차|현대차|기아|모비스|auto|vehicle|ev|motor/.test(text)) return 'auto';
  if (/naver|네이버|카카오|internet|software|platform|interactive media|communication services/.test(text)) return 'internet';
  if (/바이오|제약|셀트리온|bio|pharma|healthcare|drug/.test(text)) return 'bio';
  if (/방산|항공|우주|defense|aerospace|로템|넥스원/.test(text)) return 'defense';
  if (/조선|중공업|shipbuilding|ship|marine|오션/.test(text)) return 'shipbuilding';
  if (/에너지|전력|원전|utility|utilities|power|electric|두산에너/.test(text)) return 'energy';
  if (/엔터|entertainment|media|게임|game|하이브|jyp|sm/.test(text)) return 'entertainment';
  if (/철강|steel|metal|posco|포스코|제철/.test(text)) return 'steel';
  if (/consumer|retail|restaurant|apparel|internet retail/.test(text)) return 'consumer';
  if (/technology|software|consumer electronics|information technology/.test(text)) return 'technology';
  if (/healthcare|health care|biotechnology|drug manufacturers/.test(text)) return 'healthcare';

  return isKoreanSymbol(symbol) ? 'large' : 'large';
}

function peerGroupKey(query: string, symbol: string, metrics: RawMetrics): string {
  const marketPrefix = isKoreanSymbol(symbol) ? 'kr' : 'us';
  const slug = inferSectorSlug(query, symbol, metrics);

  if (marketPrefix === 'us') {
    if (slug === 'semiconductor' || slug === 'internet') return 'us-technology';
    if (slug === 'bio') return 'us-healthcare';
    if (slug === 'auto') return 'us-consumer';
  }

  const key = `${marketPrefix}-${slug}`;
  return PEER_GROUPS[key] ? key : `${marketPrefix}-large`;
}

function availableMetricCount(metrics: RawMetrics): number {
  return [
    metrics.price,
    metrics.marketCap,
    metrics.trailingPE ?? metrics.forwardPE,
    metrics.priceToBook,
    metrics.returnOnEquity,
    metrics.debtToEquity,
    metrics.dividendYield,
    metrics.fiftyTwoWeekHigh,
    metrics.fiftyTwoWeekLow,
  ].filter((value) => value !== undefined && value !== null && Number.isFinite(value)).length;
}

function recommendationScore(metrics: RawMetrics, scores: ReturnType<typeof scoreFromMetrics>): number {
  const pe = metrics.forwardPE ?? metrics.trailingPE ?? null;
  const pb = metrics.priceToBook ?? null;
  const roePercent = metrics.returnOnEquity != null ? metrics.returnOnEquity * 100 : null;
  const debt = metrics.debtToEquity ?? null;

  let valueScore = 50;
  if (pe !== null) valueScore += pe < 8 ? 20 : pe < 15 ? 12 : pe > 35 ? -18 : pe > 25 ? -8 : 2;
  if (pb !== null) valueScore += pb < 0.8 ? 16 : pb < 1.5 ? 8 : pb > 5 ? -18 : pb > 3 ? -8 : 0;
  if (roePercent !== null) valueScore += roePercent >= 15 ? 14 : roePercent >= 8 ? 6 : roePercent < 0 ? -15 : 0;
  if (debt !== null) valueScore += debt <= 80 ? 8 : debt > 250 ? -15 : debt > 150 ? -7 : 0;

  const confidenceScore = clampValue((availableMetricCount(metrics) / 9) * 100);
  const combined =
    scores.growthScore * 0.35 +
    (100 - scores.bubbleRisk) * 0.25 +
    scores.sectorScore * 0.2 +
    clampValue(valueScore) * 0.15 +
    confidenceScore * 0.05;

  return round(clampValue(combined), 1);
}

function peerReason(metrics: RawMetrics, scores: ReturnType<typeof scoreFromMetrics>): string {
  const pe = metrics.forwardPE ?? metrics.trailingPE ?? null;
  const pb = metrics.priceToBook ?? null;
  const roePercent = metrics.returnOnEquity != null ? metrics.returnOnEquity * 100 : null;
  const reasons: string[] = [];

  if (scores.growthScore >= 70) reasons.push('성장 점수 우위');
  if (scores.bubbleRisk <= 40) reasons.push('버블 위험 낮음');
  if (pe !== null && pe > 0 && pe <= 12) reasons.push('PER 부담 낮음');
  if (pb !== null && pb > 0 && pb <= 1.2) reasons.push('PBR 부담 낮음');
  if (roePercent !== null && roePercent >= 10) reasons.push('ROE 양호');
  if (metrics.dividendYield != null && metrics.dividendYield >= 0.03) reasons.push('배당수익률 참고 가능');
  if (scores.sectorScore >= 65) reasons.push('섹터 흐름 양호');

  return reasons.slice(0, 3).join(' · ') || '동일 섹터 내 비교 후보';
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchPeerRecommendation(seed: PeerSeed): Promise<PeerRecommendation> {
  const naverCode = naverCodeFromSymbol(seed.symbol);
  let quoteData: QuoteData = {};
  let summaryData: QuoteData = {};
  let naverBasicData: QuoteData = {};
  let naverIntegrationData: QuoteData = {};
  const sourceParts: string[] = [];

  const jobs: Array<Promise<void>> = [
    fetchYahooQuote(seed.symbol)
      .then((data) => {
        quoteData = data;
        sourceParts.push('Yahoo quote');
      })
      .catch(() => undefined),
    fetchYahooSummary(seed.symbol)
      .then((data) => {
        summaryData = data;
        sourceParts.push('Yahoo summary');
      })
      .catch(() => undefined),
  ];

  if (naverCode) {
    jobs.push(
      fetchNaverBasic(naverCode)
        .then((data) => {
          naverBasicData = data;
          sourceParts.push('Naver basic');
        })
        .catch(() => undefined),
      fetchNaverIntegration(naverCode)
        .then((data) => {
          naverIntegrationData = data;
          sourceParts.push('Naver metrics');
        })
        .catch(() => undefined),
    );
  }

  await Promise.allSettled(jobs);

  const metrics: RawMetrics = {
    symbol: seed.symbol,
    name: firstString(quoteData.name, naverBasicData.name, seed.name, seed.symbol) ?? seed.name,
    sector: firstString(summaryData.sector),
    industry: firstString(summaryData.industry),
    currency: firstString(quoteData.currency, naverBasicData.currency, naverIntegrationData.currency) ?? (naverCode ? 'KRW' : 'USD'),
    price: quoteData.price ?? naverBasicData.price ?? null,
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
    fiftyTwoWeekHigh: quoteData.fiftyTwoWeekHigh ?? naverIntegrationData.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: quoteData.fiftyTwoWeekLow ?? naverIntegrationData.fiftyTwoWeekLow ?? null,
    recommendationKey: summaryData.recommendationKey ?? null,
    targetMeanPrice: summaryData.targetMeanPrice ?? naverIntegrationData.targetMeanPrice ?? null,
  };

  const scores = scoreFromMetrics(metrics);

  return {
    rank: 0,
    symbol: seed.symbol,
    name: metrics.name,
    sectorKey: seed.sectorKey,
    score: recommendationScore(metrics, scores),
    growthScore: scores.growthScore,
    sectorScore: scores.sectorScore,
    bubbleRisk: scores.bubbleRisk,
    price: metrics.price ?? null,
    currency: metrics.currency,
    trailingPE: metrics.trailingPE ?? null,
    forwardPE: metrics.forwardPE ?? null,
    priceToBook: metrics.priceToBook ?? null,
    returnOnEquity: metrics.returnOnEquity ?? null,
    reason: peerReason(metrics, scores),
    source: sourceParts.join(' + ') || 'fallback',
  };
}

async function buildPeerRecommendations(
  query: string,
  metrics: RawMetrics,
): Promise<PeerRecommendation[]> {
  const groupKey = peerGroupKey(query, metrics.symbol, metrics);
  const seeds = (PEER_GROUPS[groupKey] ?? PEER_GROUPS[isKoreanSymbol(metrics.symbol) ? 'kr-large' : 'us-large'])
    .filter((seed) => !sameSymbol(seed.symbol, metrics.symbol))
    .slice(0, 5);

  const settled = await Promise.allSettled(
    seeds.map((seed) => withTimeout(fetchPeerRecommendation(seed), 3200, seed.symbol)),
  );

  return settled
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .filter((peer) => peer.price !== null || peer.trailingPE !== null || peer.priceToBook !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((peer, index) => ({ ...peer, rank: index + 1 }));
}

function percentSentence(value: number | null | undefined, label: string): string | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return `${label}은 ${round(value * 100, 1)}%입니다.`;
}

function buildCompanyAnalysis(
  metrics: RawMetrics,
  scores: ReturnType<typeof scoreFromMetrics>,
  chart: ChartPoint[],
  warnings: string[],
): CompanyAnalysis {
  const pe = metrics.forwardPE ?? metrics.trailingPE ?? null;
  const pb = metrics.priceToBook ?? null;
  const roePercent = metrics.returnOnEquity != null ? metrics.returnOnEquity * 100 : null;
  const revenueGrowthPercent = metrics.revenueGrowth != null ? metrics.revenueGrowth * 100 : null;
  const latest = chart.at(-1)?.close ?? metrics.price ?? null;
  const first = chart[0]?.close ?? null;
  const oneYearChange = latest && first ? ((latest - first) / first) * 100 : null;

  const positives: string[] = [];
  const risks: string[] = [];
  const checklist: string[] = [];

  if (scores.growthScore >= 70) positives.push('성장 가능성 점수가 높아 실적 성장성, 수익성, 밸류에이션 조합이 우호적으로 잡혔습니다.');
  else if (scores.growthScore >= 55) positives.push('성장 가능성은 중립 이상으로, 추가 재무 데이터가 확인되면 평가가 더 명확해질 수 있습니다.');
  else risks.push('성장 가능성 점수가 낮아 매출 성장, 이익 성장, 수익성 지표를 추가로 확인할 필요가 있습니다.');

  if (roePercent !== null && roePercent >= 10) positives.push(`ROE가 ${round(roePercent, 1)}%로 자기자본 수익성이 양호한 편입니다.`);
  if (roePercent !== null && roePercent < 5) risks.push(`ROE가 ${round(roePercent, 1)}%로 낮아 자본 효율성이 약할 수 있습니다.`);

  if (pe !== null && pe > 0 && pe <= 12) positives.push(`PER 기준으로는 ${round(pe, 1)}배 수준이라 이익 대비 가격 부담이 상대적으로 낮게 잡혔습니다.`);
  if (pe !== null && pe >= 30) risks.push(`PER이 ${round(pe, 1)}배로 높아 성장 기대가 꺾이면 주가 변동성이 커질 수 있습니다.`);

  if (pb !== null && pb > 0 && pb <= 1.2) positives.push(`PBR이 ${round(pb, 2)}배로 장부가 대비 과도한 프리미엄은 낮은 편입니다.`);
  if (pb !== null && pb >= 4) risks.push(`PBR이 ${round(pb, 2)}배로 높아 자산가치 대비 프리미엄 부담을 점검해야 합니다.`);

  if (revenueGrowthPercent !== null && revenueGrowthPercent >= 10) positives.push(`매출성장률이 ${round(revenueGrowthPercent, 1)}%로 외형 성장 신호가 있습니다.`);
  if (revenueGrowthPercent !== null && revenueGrowthPercent < 0) risks.push(`매출성장률이 ${round(revenueGrowthPercent, 1)}%로 역성장 구간일 수 있습니다.`);

  if (oneYearChange !== null && oneYearChange >= 20) positives.push(`최근 1년 차트 기준 주가가 약 ${round(oneYearChange, 1)}% 상승해 시장 관심이 강한 편입니다.`);
  if (oneYearChange !== null && oneYearChange <= -20) risks.push(`최근 1년 차트 기준 주가가 약 ${round(oneYearChange, 1)}% 하락해 추세 회복 여부를 확인해야 합니다.`);

  if (scores.bubbleRisk >= 65) risks.push('버블 위험 점수가 높아 PER/PBR 정상화 또는 52주 저점 재접근 시 스트레스 하락 폭이 커질 수 있습니다.');
  else if (scores.bubbleRisk <= 40) positives.push('버블 위험 점수가 낮아 현재 지표 조합상 과열 부담은 상대적으로 작게 계산됩니다.');

  if (warnings.length > 0) checklist.push('일부 Yahoo 데이터가 실패해 네이버/차트 기반 fallback이 섞였으므로, 최종 판단 전 원천 데이터를 다시 확인하세요.');
  checklist.push('동종업계 평균 PER/PBR과 비교해 싼지 비싼지를 확인하세요.');
  checklist.push('최근 분기 실적에서 매출, 영업이익, 순이익이 같은 방향으로 개선되는지 확인하세요.');
  checklist.push('금리, 환율, 원자재, 규제처럼 해당 섹터에 직접 영향을 주는 변수를 함께 보세요.');

  const headline =
    scores.growthScore >= 70 && scores.bubbleRisk < 60
      ? '성장성과 위험 균형이 비교적 양호한 후보입니다.'
      : scores.bubbleRisk >= 70
        ? '성장 기대는 있을 수 있지만 가격 부담 점검이 먼저입니다.'
        : scores.growthScore < 45
          ? '보수적으로 재무 개선 신호를 확인해야 하는 구간입니다.'
          : '중립 관점에서 핵심 지표 확인이 필요한 후보입니다.';

  const descriptors = [
    pe !== null ? `PER ${round(pe, 1)}배` : null,
    pb !== null ? `PBR ${round(pb, 2)}배` : null,
    percentSentence(metrics.returnOnEquity, 'ROE'),
    oneYearChange !== null ? `최근 1년 주가 변화율 ${round(oneYearChange, 1)}%` : null,
  ].filter((value): value is string => Boolean(value));

  const summary = `${metrics.name}은 현재 ${scores.growthScore}% 성장 가능성, ${scores.sectorScore}% 섹터 열기, ${scores.bubbleRisk}% 버블 위험으로 계산됩니다. ${descriptors.length ? descriptors.join(', ') + '를 함께 보면' : '확보된 지표만 기준으로 보면'} 단순 가격보다 수익성·성장성·밸류에이션을 같이 확인하는 접근이 적합합니다.`;

  return {
    headline,
    summary,
    positives: positives.slice(0, 4),
    risks: risks.slice(0, 4),
    checklist: checklist.slice(0, 4),
    disclaimer: '이 분석과 순위는 공개 데이터 기반의 자동 계산 결과이며, 매수·매도 권유나 수익 보장을 의미하지 않습니다.',
  };
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

  let chartData: ChartData | null = null;
  const naverCode = naverCodeFromSymbol(symbol);
  let naverBasicData: QuoteData = {};
  let naverIntegrationData: QuoteData = {};

  try {
    chartData = await fetchYahooChart(symbol);
    sourceStatus.yahooChart = 'ok';
  } catch (error) {
    sourceStatus.yahooChart = `failed: ${errorMessage(error)}`;

    if (naverCode) {
      try {
        chartData = await fetchNaverChart(naverCode);
        sourceStatus.naverChart = 'ok';
        warnings.push('Yahoo chart 조회 실패로 네이버 금융 차트 데이터를 사용했습니다.');
      } catch (naverError) {
        sourceStatus.naverChart = `failed: ${errorMessage(naverError)}`;

        try {
          naverBasicData = await fetchNaverBasic(naverCode);
          sourceStatus.naverBasic = 'ok';

          if (naverBasicData.price !== undefined && naverBasicData.price !== null) {
            const today = new Date().toISOString().slice(0, 10);
            chartData = {
              chart: [{ date: today, close: naverBasicData.price }],
              price: naverBasicData.price,
              currency: 'KRW',
              fiftyTwoWeekHigh: naverBasicData.price,
              fiftyTwoWeekLow: naverBasicData.price,
            };
            warnings.push('차트 조회가 불안정해 네이버 현재가 기준으로 임시 차트를 표시합니다.');
          }
        } catch (basicError) {
          sourceStatus.naverBasic = `failed: ${errorMessage(basicError)}`;
        }
      }
    }

    if (!chartData) {
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

  if (naverCode) {
    if (sourceStatus.naverBasic !== 'ok') {
      try {
        naverBasicData = await fetchNaverBasic(naverCode);
        sourceStatus.naverBasic = 'ok';
      } catch (error) {
        sourceStatus.naverBasic = `failed: ${errorMessage(error)}`;
      }
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

  const scores = scoreFromMetrics(metrics);
  const analysis = buildCompanyAnalysis(metrics, scores, chartData.chart, warnings);
  let peers: PeerRecommendation[] = [];

  try {
    peers = await buildPeerRecommendations(query, metrics);
  } catch (error) {
    warnings.push(`섹터 관련 종목 순위 계산에 실패했습니다: ${errorMessage(error)}`);
  }

  return {
    query,
    symbol,
    source: makeSource(sourceStatus),
    metrics,
    scores,
    chart: chartData.chart,
    analysis,
    peers,
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
