export const tickerMap: Record<string, string> = {
  '삼성전자': '005930.KS',
  '삼성전자우': '005935.KS',
  'SK하이닉스': '000660.KS',
  '에스케이하이닉스': '000660.KS',
  '현대차': '005380.KS',
  '현대자동차': '005380.KS',
  '기아': '000270.KS',
  'NAVER': '035420.KS',
  '네이버': '035420.KS',
  '카카오': '035720.KS',
  'LG에너지솔루션': '373220.KS',
  '엘지에너지솔루션': '373220.KS',
  '삼성바이오로직스': '207940.KS',
  '셀트리온': '068270.KS',
  'POSCO홀딩스': '005490.KS',
  '포스코홀딩스': '005490.KS',
  'KB금융': '105560.KS',
  '신한지주': '055550.KS',
  '현대모비스': '012330.KS',
  '삼성SDI': '006400.KS',
  'LG화학': '051910.KS',
  '한화에어로스페이스': '012450.KS',
  'HD현대중공업': '329180.KS',
  '삼성물산': '028260.KS',
  '에코프로비엠': '247540.KQ',
  '에코프로': '086520.KQ',
  '알테오젠': '196170.KQ',
  'JYP': '035900.KQ',
  'JYP Ent.': '035900.KQ',
  '에스엠': '041510.KQ',
  'SM': '041510.KQ'
};

export function normalizeTicker(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (tickerMap[trimmed]) return tickerMap[trimmed];
  const upper = trimmed.toUpperCase();
  if (tickerMap[upper]) return tickerMap[upper];
  if (/^\d{6}$/.test(trimmed)) return `${trimmed}.KS`;
  if (/^\d{6}\.(KS|KQ)$/i.test(trimmed)) return trimmed.toUpperCase();
  return upper;
}
