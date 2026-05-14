export type RawMetrics = {
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  currency?: string;
  price?: number | null;
  marketCap?: number | null;
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  returnOnEquity?: number | null;
  debtToEquity?: number | null;
  revenueGrowth?: number | null;
  earningsGrowth?: number | null;
  operatingMargins?: number | null;
  profitMargins?: number | null;
  dividendYield?: number | null;
  beta?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  recommendationKey?: string | null;
  targetMeanPrice?: number | null;
};

export function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

export function scoreFromMetrics(m: RawMetrics) {
  const pe = m.forwardPE ?? m.trailingPE ?? null;
  const pb = m.priceToBook ?? null;
  const roe = m.returnOnEquity != null ? m.returnOnEquity * 100 : null;
  const debt = m.debtToEquity ?? null;
  const rev = m.revenueGrowth != null ? m.revenueGrowth * 100 : null;
  const earn = m.earningsGrowth != null ? m.earningsGrowth * 100 : null;
  const margin = m.operatingMargins != null ? m.operatingMargins * 100 : null;
  const beta = m.beta ?? null;
  const price = m.price ?? null;
  const high = m.fiftyTwoWeekHigh ?? null;
  const low = m.fiftyTwoWeekLow ?? null;

  const growthParts = [
    rev == null ? null : clamp(50 + rev * 1.6),
    earn == null ? null : clamp(50 + earn * 1.1),
    roe == null ? null : clamp(roe * 3.2),
    margin == null ? null : clamp(40 + margin * 2.0),
    debt == null ? null : clamp(90 - debt * 0.35),
    pe == null ? null : clamp(82 - Math.max(0, pe - 18) * 1.8)
  ].filter((v): v is number => v != null);
  const growthScore = growthParts.length ? Math.round(growthParts.reduce((a, b) => a + b, 0) / growthParts.length) : 50;

  const hotSectorNames = ['Semiconductors', 'Technology', 'Software', 'Aerospace', 'Defense', 'Biotechnology', 'Electric', 'Auto Manufacturers', 'Consumer Electronics', 'AI'];
  const sectorText = `${m.sector ?? ''} ${m.industry ?? ''}`;
  let sectorScore = hotSectorNames.some((s) => sectorText.toLowerCase().includes(s.toLowerCase())) ? 72 : 50;
  if (price && high && low && high > low) sectorScore += ((price - low) / (high - low)) * 22 - 8;
  if (rev != null && rev > 15) sectorScore += 8;
  if (beta != null && beta > 1.4) sectorScore += 5;
  sectorScore = Math.round(clamp(sectorScore));

  const bubbleParts = [
    pe == null ? null : clamp((pe - 15) * 2.5),
    pb == null ? null : clamp((pb - 1.5) * 18),
    beta == null ? null : clamp((beta - 0.8) * 42),
    price && high ? clamp((price / high) * 92) : null,
    rev == null ? null : rev < 0 ? 72 : clamp(55 - rev)
  ].filter((v): v is number => v != null);
  const bubbleRisk = bubbleParts.length ? Math.round(bubbleParts.reduce((a, b) => a + b, 0) / bubbleParts.length) : 50;

  const stress = makeStressPrices(m, bubbleRisk);
  return { growthScore, sectorScore, bubbleRisk, stress };
}

export function makeStressPrices(m: RawMetrics, bubbleRisk: number) {
  const price = m.price ?? 0;
  const pe = m.forwardPE ?? m.trailingPE ?? null;
  const pb = m.priceToBook ?? null;
  const low = m.fiftyTwoWeekLow ?? null;
  const baseDrop = bubbleRisk >= 75 ? 0.45 : bubbleRisk >= 55 ? 0.32 : 0.22;
  const stressA = price ? price * (1 - baseDrop) : null;
  const peStress = price && pe && pe > 12 ? price * (12 / pe) : null;
  const pbStress = price && pb && pb > 1.2 ? price * (1.2 / pb) : null;
  const candidates = [stressA, peStress, pbStress, low].filter((v): v is number => !!v && isFinite(v));
  const severe = candidates.length ? Math.min(...candidates) : null;
  const moderate = stressA;
  return {
    moderate,
    severe,
    explanation: '버블 붕괴 가격은 예언이 아니라 PER/PBR 정상화, 52주 저점, 위험 점수 기반 하락률을 조합한 스트레스 테스트입니다.'
  };
}

export function fmtNumber(n?: number | null, currency = '') {
  if (n == null || !isFinite(n)) return '데이터 없음';
  if (Math.abs(n) >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}조 ${currency}`.trim();
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억 ${currency}`.trim();
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}백만 ${currency}`.trim();
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`.trim();
}

export function fmtPct(n?: number | null, alreadyPercent = false) {
  if (n == null || !isFinite(n)) return '데이터 없음';
  const value = alreadyPercent ? n : n * 100;
  return `${value.toFixed(1)}%`;
}
