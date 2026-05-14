'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtNumber, fmtPct } from '@/lib/scoring';

type ChartPoint = { date: string; close: number };

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

type Result = {
  query: string;
  symbol: string;
  source: string;
  metrics: any;
  scores: any;
  chart: ChartPoint[];
  warnings?: string[];
  analysis?: CompanyAnalysis;
  peers?: PeerRecommendation[];
};

const examples = ['삼성전자', '하나금융지주', '두산에너빌리티', '에코프로비엠', 'NAVER', 'NVDA', 'AAPL'];

const terms = [
  ['PER', '주가가 1년 이익의 몇 배로 거래되는지 보는 지표입니다. 낮을수록 이익 대비 가격 부담이 작지만, 성장 둔화 기업은 낮게 나올 수 있습니다.'],
  ['PBR', '주가가 장부가치의 몇 배인지 보는 지표입니다. 금융·지주·자산주는 특히 참고도가 높습니다.'],
  ['ROE', '자기자본으로 얼마나 이익을 내는지 보는 수익성 지표입니다. 높을수록 자본 효율성이 좋습니다.'],
  ['부채비율', '자본 대비 부채 부담입니다. 높을수록 금리 상승이나 경기 둔화 때 위험이 커질 수 있습니다.'],
  ['매출성장률', '외형이 얼마나 빠르게 커지는지 보여줍니다. 성장주는 이 지표가 특히 중요합니다.'],
  ['성장 가능성 %', '매출 성장, 이익 성장, ROE, 마진, 부채, PER을 종합한 자동 점수입니다.'],
  ['섹터 열기 %', '해당 업종의 시장 관심도와 주가 위치를 반영한 점수입니다. 높을수록 과열 가능성도 같이 봐야 합니다.'],
  ['버블 위험 %', 'PER, PBR, 베타, 52주 고점 접근도 등을 기반으로 가격 부담을 계산한 점수입니다.'],
  ['스트레스 하락 가격', 'PER/PBR 정상화, 52주 저점, 위험 점수 기반 하락률을 조합한 가상 하락 시나리오입니다.'],
];

function scoreLabel(n: number) {
  if (n >= 75) return '강함';
  if (n >= 55) return '보통 이상';
  if (n >= 40) return '중립';
  return '약함';
}

function riskLabel(n: number) {
  if (n >= 65) return '높음';
  if (n >= 45) return '보통';
  return '낮음';
}

function fmtRatio(n?: number | null, digits = 2) {
  if (n == null || !Number.isFinite(n)) return '데이터 없음';
  return `${n.toFixed(digits)}배`;
}

function Metric({ label, value, desc }: { label: string; value: string; desc: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <p>{desc}</p>
    </div>
  );
}

function ScoreCard({ title, value, help }: { title: string; value: string; help: string }) {
  return (
    <div className="score-card">
      <div className="score-title">{title}</div>
      <div className="score-value">{value}</div>
      <p>{help}</p>
    </div>
  );
}

function ListBox({ title, items, empty }: { title: string; items?: string[]; empty: string }) {
  return (
    <div className="list-box">
      <h3>{title}</h3>
      {items && items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState('삼성전자');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

    const handler = (event: any) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function analyze(nextQuery = query) {
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      setError('기업명 또는 티커를 입력해 주세요.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${data.error ?? '조회 실패'} ${data.hint ? `(${data.hint})` : ''}`);
      setResult(data);
    } catch (event: any) {
      setError(event.message ?? '조회 실패');
    } finally {
      setLoading(false);
    }
  }

  const m = result?.metrics;
  const s = result?.scores;
  const currency = m?.currency ?? '';
  const chartData = useMemo(() => result?.chart?.slice(-180) ?? [], [result]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="eyebrow">모바일 PWA · URL 접속형 기업 진단</div>
        <h1>기업 이름만 넣고 재무·가치·위험을 한눈에</h1>
        <p>
          PER, PBR 같은 어려운 지표를 쉬운 설명과 함께 보여주고 성장 가능성, 섹터 열기,
          버블 위험, 관련 섹터 관심주 순위를 자동 계산합니다.
        </p>

        <div className="search-box">
          <input
            value={query}
            onChange={(event: any) => setQuery(event.target.value)}
            onKeyDown={(event: any) => event.key === 'Enter' && analyze()}
            placeholder="예: 삼성전자, 하나금융지주, 005930.KS, NVDA"
          />
          <button onClick={() => analyze()} disabled={loading}>
            {loading ? '조회중' : '진단'}
          </button>
        </div>

        <div className="chips">
          {examples.map((example) => (
            <button
              key={example}
              onClick={() => {
                setQuery(example);
                analyze(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      {deferredPrompt && (
        <section className="notice">
          <div>
            <h2>홈 화면에 앱처럼 추가</h2>
            <p>설치 버튼을 누르면 휴대폰 홈 화면에서 바로 열 수 있습니다.</p>
          </div>
          <button
            onClick={async () => {
              deferredPrompt.prompt();
              await deferredPrompt.userChoice;
              setDeferredPrompt(null);
            }}
          >
            홈 화면에 추가
          </button>
        </section>
      )}

      {loading && <div className="loading">실시간 데이터를 가져오는 중입니다.</div>}
      {error && <div className="error">{error}</div>}

      {result && m && s && (
        <>
          <section className="panel summary-panel">
            <div>
              <div className="eyebrow">진단 결과</div>
              <h2>
                {m.name} <span>({result.symbol})</span>
              </h2>
              <p>
                {m.sector ?? '섹터 정보 없음'} · {m.industry ?? '산업 정보 없음'} · 데이터: {result.source}
              </p>
            </div>
            <div className="price-box">
              <span>현재가</span>
              <strong>{fmtNumber(m.price, currency)}</strong>
            </div>
          </section>

          {result.warnings && result.warnings.length > 0 && (
            <section className="warning-list">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          )}

          <section className="score-grid">
            <ScoreCard title="성장 가능성" value={`${s.growthScore}% · ${scoreLabel(s.growthScore)}`} help="수익성, 성장성, 부채, 밸류에이션을 종합한 점수입니다." />
            <ScoreCard title="섹터 열기" value={`${s.sectorScore}% · ${scoreLabel(s.sectorScore)}`} help="업종 관심도와 주가 위치를 반영합니다." />
            <ScoreCard title="버블 위험" value={`${s.bubbleRisk}% · ${riskLabel(s.bubbleRisk)}`} help="PER/PBR/변동성/고점 접근도를 반영합니다." />
          </section>

          <section className="panel">
            <h2>핵심 지표</h2>
            <div className="metric-grid">
              <Metric label="PER" value={fmtRatio(m.forwardPE ?? m.trailingPE)} desc="이익 대비 가격 부담입니다." />
              <Metric label="PBR" value={fmtRatio(m.priceToBook)} desc="장부가 대비 가격 부담입니다." />
              <Metric label="ROE" value={fmtPct(m.returnOnEquity)} desc="자기자본 수익성입니다." />
              <Metric label="부채비율" value={m.debtToEquity == null ? '데이터 없음' : `${m.debtToEquity.toFixed(1)}%`} desc="자본 대비 부채 부담입니다." />
              <Metric label="매출성장률" value={fmtPct(m.revenueGrowth)} desc="외형 성장 속도입니다." />
              <Metric label="시가총액" value={fmtNumber(m.marketCap, currency)} desc="시장의 기업가치 평가입니다." />
            </div>
          </section>

          <section className="panel">
            <h2>최근 주가 흐름</h2>
            {chartData.length ? (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" minTickGap={28} tickFormatter={(value: any) => String(value).slice(5)} />
                    <YAxis domain={['auto', 'auto']} width={68} />
                    <Tooltip formatter={(value: any) => [fmtNumber(Number(value), currency), '종가']} />
                    <Area type="monotone" dataKey="close" strokeWidth={2} fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p>차트 데이터가 없습니다.</p>
            )}
          </section>

          <section className="panel stress-panel">
            <h2>버블 붕괴 스트레스 시나리오</h2>
            <div className="stress-grid">
              <Metric label="중간 스트레스" value={fmtNumber(s.stress?.moderate, currency)} desc="위험 점수 기반 가상 하락 가격입니다." />
              <Metric label="강한 스트레스" value={fmtNumber(s.stress?.severe, currency)} desc="PER/PBR 정상화와 52주 저점을 함께 반영합니다." />
            </div>
            <p>{s.stress?.explanation} 실제 미래 가격을 보장하지 않으며, 투자 판단용 보조 지표로만 사용하세요.</p>
          </section>

          <section className="panel">
            <h2>용어 설명</h2>
            <div className="term-grid">
              {terms.map(([title, desc]) => (
                <div className="term-card" key={title}>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel analysis-panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">자동 분석</div>
                <h2>해당 기업 분석</h2>
              </div>
            </div>
            {result.analysis ? (
              <>
                <div className="analysis-summary">
                  <h3>{result.analysis.headline}</h3>
                  <p>{result.analysis.summary}</p>
                </div>
                <div className="analysis-grid">
                  <ListBox title="긍정 포인트" items={result.analysis.positives} empty="뚜렷한 긍정 신호가 부족합니다." />
                  <ListBox title="주의 포인트" items={result.analysis.risks} empty="현재 계산값 기준 큰 위험 신호는 제한적입니다." />
                  <ListBox title="추가 확인 체크리스트" items={result.analysis.checklist} empty="추가 확인 항목이 없습니다." />
                </div>
                <p className="disclaimer">{result.analysis.disclaimer}</p>
              </>
            ) : (
              <p>분석 문장 데이터가 없습니다.</p>
            )}
          </section>

          <section className="panel peers-panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">동종업계 비교</div>
                <h2>섹터 관련 추천/관심주 순위</h2>
              </div>
              <span>자동 점수 기준</span>
            </div>
            <p className="muted">
              같은 섹터 후보를 성장 가능성, 밸류에이션 부담, 버블 위험, 데이터 확보 정도로 정렬했습니다. 매수 추천이 아니라 비교 출발점입니다.
            </p>
            {result.peers && result.peers.length > 0 ? (
              <div className="peer-list">
                {result.peers.map((peer) => (
                  <article className="peer-card" key={peer.symbol}>
                    <div className="peer-rank">#{peer.rank}</div>
                    <div className="peer-main">
                      <h3>{peer.name}</h3>
                      <p>{peer.symbol} · {peer.reason}</p>
                      <div className="peer-metrics">
                        <span>추천점수 {peer.score}</span>
                        <span>성장 {peer.growthScore}%</span>
                        <span>버블 {peer.bubbleRisk}%</span>
                        <span>PER {fmtRatio(peer.forwardPE ?? peer.trailingPE, 1)}</span>
                        <span>PBR {fmtRatio(peer.priceToBook, 2)}</span>
                      </div>
                    </div>
                    <div className="peer-side">
                      <strong>{fmtNumber(peer.price, peer.currency ?? '')}</strong>
                      <button
                        onClick={() => {
                          setQuery(peer.symbol);
                          analyze(peer.symbol);
                        }}
                      >
                        이 종목 진단
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>현재 섹터 비교 후보를 충분히 불러오지 못했습니다.</p>
            )}
          </section>
        </>
      )}

      <style jsx>{`
        .app-shell {
          min-height: 100vh;
          max-width: 1040px;
          margin: 0 auto;
          padding: 28px 16px 80px;
          color: #172033;
        }
        .hero,
        .panel,
        .notice,
        .loading,
        .error,
        .warning-list {
          border: 1px solid #e5e9f2;
          border-radius: 24px;
          background: #ffffff;
          box-shadow: 0 12px 36px rgba(19, 35, 66, 0.08);
        }
        .hero {
          padding: 28px;
          background: linear-gradient(135deg, #eef4ff, #ffffff 54%, #f6fbf8);
        }
        .eyebrow {
          font-size: 13px;
          font-weight: 800;
          color: #486284;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        h1,
        h2,
        h3,
        p {
          margin: 0;
        }
        h1 {
          margin-top: 10px;
          font-size: clamp(32px, 8vw, 56px);
          line-height: 1.05;
          letter-spacing: -0.05em;
        }
        .hero p {
          margin-top: 16px;
          color: #59677e;
          line-height: 1.65;
        }
        .search-box {
          display: flex;
          gap: 10px;
          margin-top: 24px;
        }
        input,
        button {
          font: inherit;
        }
        input {
          flex: 1;
          min-width: 0;
          border: 1px solid #d7dfeb;
          border-radius: 16px;
          padding: 15px 16px;
          background: #ffffff;
          color: #172033;
          outline: none;
        }
        input:focus {
          border-color: #5f7ea8;
          box-shadow: 0 0 0 4px rgba(95, 126, 168, 0.16);
        }
        button {
          border: 0;
          border-radius: 16px;
          padding: 14px 18px;
          background: #172033;
          color: #ffffff;
          font-weight: 800;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }
        .chips button,
        .peer-side button {
          background: #f0f4f9;
          color: #26364f;
          padding: 9px 12px;
          border-radius: 999px;
          font-size: 13px;
        }
        .notice,
        .loading,
        .error,
        .warning-list,
        .panel {
          margin-top: 18px;
          padding: 22px;
        }
        .notice {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }
        .notice p,
        .muted,
        .disclaimer,
        .panel > p,
        .list-box p,
        .term-card p,
        .metric-card p,
        .score-card p,
        .peer-main p {
          color: #66758b;
          line-height: 1.6;
        }
        .error {
          background: #fff4f2;
          color: #b42318;
          border-color: #ffd8d3;
        }
        .loading {
          color: #486284;
        }
        .warning-list {
          background: #fffaf0;
          border-color: #ffe4b5;
        }
        .warning-list p + p {
          margin-top: 8px;
        }
        .summary-panel,
        .section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }
        .summary-panel h2 {
          margin-top: 6px;
          font-size: 28px;
          letter-spacing: -0.04em;
        }
        .summary-panel h2 span {
          color: #728096;
          font-size: 18px;
        }
        .price-box {
          min-width: 190px;
          padding: 16px;
          border-radius: 18px;
          background: #f5f7fb;
          text-align: right;
        }
        .price-box span {
          display: block;
          color: #66758b;
          font-size: 13px;
        }
        .price-box strong {
          display: block;
          margin-top: 4px;
          font-size: 22px;
        }
        .score-grid,
        .metric-grid,
        .term-grid,
        .analysis-grid,
        .stress-grid {
          display: grid;
          gap: 12px;
          margin-top: 18px;
        }
        .score-grid {
          grid-template-columns: repeat(3, 1fr);
        }
        .metric-grid,
        .term-grid {
          grid-template-columns: repeat(3, 1fr);
        }
        .analysis-grid {
          grid-template-columns: repeat(3, 1fr);
        }
        .stress-grid {
          grid-template-columns: repeat(2, 1fr);
        }
        .score-card,
        .metric-card,
        .term-card,
        .list-box,
        .analysis-summary,
        .peer-card {
          border: 1px solid #e5e9f2;
          border-radius: 18px;
          background: #fbfcff;
          padding: 16px;
        }
        .score-title,
        .metric-label {
          color: #66758b;
          font-size: 13px;
          font-weight: 800;
        }
        .score-value,
        .metric-value {
          margin-top: 7px;
          font-size: 24px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }
        .chart-wrap {
          margin-top: 12px;
          width: 100%;
          height: 280px;
        }
        .analysis-summary {
          margin-top: 16px;
          background: #f7fafc;
        }
        .analysis-summary h3,
        .list-box h3,
        .peer-main h3 {
          margin-bottom: 8px;
          font-size: 18px;
        }
        ul {
          margin: 0;
          padding-left: 18px;
          color: #34425a;
          line-height: 1.62;
        }
        li + li {
          margin-top: 8px;
        }
        .disclaimer {
          margin-top: 14px;
          font-size: 13px;
        }
        .peer-list {
          display: grid;
          gap: 12px;
          margin-top: 16px;
        }
        .peer-card {
          display: grid;
          grid-template-columns: 54px 1fr auto;
          align-items: center;
          gap: 14px;
        }
        .peer-rank {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #172033;
          color: #ffffff;
          font-weight: 900;
        }
        .peer-metrics {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 10px;
        }
        .peer-metrics span {
          padding: 6px 8px;
          border-radius: 999px;
          background: #eef2f7;
          color: #43526a;
          font-size: 12px;
          font-weight: 700;
        }
        .peer-side {
          text-align: right;
        }
        .peer-side strong {
          display: block;
          margin-bottom: 10px;
        }
        @media (max-width: 760px) {
          .search-box,
          .notice,
          .summary-panel,
          .section-head {
            flex-direction: column;
          }
          .search-box button,
          .notice button {
            width: 100%;
          }
          .price-box {
            width: 100%;
            text-align: left;
          }
          .score-grid,
          .metric-grid,
          .term-grid,
          .analysis-grid,
          .stress-grid {
            grid-template-columns: 1fr;
          }
          .peer-card {
            grid-template-columns: 1fr;
          }
          .peer-side {
            text-align: left;
          }
        }
      `}</style>
    </main>
  );
}
