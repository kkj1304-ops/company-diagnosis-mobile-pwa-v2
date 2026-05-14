'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtNumber, fmtPct } from '@/lib/scoring';

type ChartPoint = { date: string; close: number };

type VisitStats = {
  enabled: boolean;
  totalVisits: number | null;
  uniqueVisitors: number | null;
  message?: string;
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
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{desc}</p>
    </div>
  );
}

function ScoreCard({
  title,
  value,
  help,
  tone,
}: {
  title: string;
  value: string;
  help: string;
  tone?: 'risk' | 'good' | 'neutral';
}) {
  return (
    <div className={`score-card ${tone ?? 'neutral'}`}>
      <div className="score-top">
        <span>{title}</span>
        <b>{value}</b>
      </div>
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
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

    const handler = (event: any) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
  async function loadVisitStats() {
    try {
      const visitorStorageKey = 'company-diagnosis-visitor-id';
      const sessionCountedKey = 'company-diagnosis-session-counted';

      let visitorId = localStorage.getItem(visitorStorageKey);

      if (!visitorId) {
        visitorId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        localStorage.setItem(visitorStorageKey, visitorId);
      }

      const alreadyCounted = sessionStorage.getItem(sessionCountedKey) === '1';

      const res = await fetch('/api/visits', {
        method: alreadyCounted ? 'GET' : 'POST',
        headers: alreadyCounted ? undefined : { 'Content-Type': 'application/json' },
        body: alreadyCounted ? undefined : JSON.stringify({ visitorId }),
      });

      const data = await res.json();

      setVisitStats(data);

      if (!alreadyCounted && data?.enabled) {
        sessionStorage.setItem(sessionCountedKey, '1');
      }
    } catch {
      setVisitStats(null);
    }
  }

  loadVisitStats();
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

      if (!res.ok) {
        throw new Error(`${data.error ?? '조회 실패'} ${data.hint ? `(${data.hint})` : ''}`);
      }

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
  const mainPe = m ? m.forwardPE ?? m.trailingPE : null;

  return (
  <main className="app-shell">
    <div className="top-status-bar">
      <div className="developer-credit">개발자 : 지모바</div>
  
      {visitStats?.enabled && (
        <div className="visit-counter">
          <span>총 방문 {visitStats.totalVisits?.toLocaleString() ?? 0}</span>
          <span>방문자 {visitStats.uniqueVisitors?.toLocaleString() ?? 0}</span>
        </div>
      )}
    </div>
  
    <section className="hero">
        <div className="eyebrow">모바일 PWA · 기업 진단</div>
        <h1>기업명만 입력하면 가치·성장·위험을 한 화면에</h1>
        <p>
          국내 종목은 DART·Yahoo·네이버 금융 fallback을 조합하고, 미국 종목은 Yahoo 데이터를 중심으로 진단합니다.
        </p>

        <div className="search-box">
          <input
            value={query}
            onChange={(event: any) => setQuery(event.target.value)}
            onKeyDown={(event: any) => event.key === 'Enter' && analyze()}
            placeholder="예: 하나금융지주, 086790.KS, 삼성전자, NVDA"
          />
          <button onClick={() => analyze()} disabled={loading}>
            {loading ? '조회중' : '진단'}
          </button>
        </div>

        <div className="chips" aria-label="빠른 검색">
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
      {!result && !loading && !error && (
  <section className="panel intro-notice">
    <div className="notice-badge">안내</div>

    <h2>기업진단 서비스는 현재 개발 중입니다</h2>

    <p>
      이 앱은 공개 데이터와 자동 계산 로직을 기반으로 기업의 가치, 성장 가능성,
      버블 위험, 섹터 관련 종목을 참고용으로 보여주는 모바일 PWA입니다.
    </p>

    <div className="intro-warning">
      <strong>투자 유의사항</strong>
      <p>
        본 서비스의 분석 결과, 점수, 차트, 추천/관심주 순위는 투자 참고용 정보이며
        특정 종목의 매수·매도·보유를 권유하지 않습니다. 데이터는 지연되거나 부정확할 수 있고,
        모든 투자 판단과 책임은 이용자 본인에게 있습니다.
      </p>
    </div>

    <div className="intro-guide">
      <span>예시 입력</span>
      <p>삼성전자, 하나금융지주, 두산에너빌리티, NVDA, AAPL처럼 입력해 보세요.</p>
    </div>
  </section>
)}
      {deferredPrompt && (
        <section className="notice compact-panel">
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

      {loading && <div className="loading compact-panel">실시간 데이터를 가져오는 중입니다.</div>}

      {error && <div className="error compact-panel">{error}</div>}

      {result && m && s && (
        <>
          <section className="panel summary-panel">
            <div className="summary-main">
              <div className="eyebrow">진단 결과</div>
              <h2>
                {m.name} <span>({result.symbol})</span>
              </h2>
              <p>
                {m.sector ?? '섹터 정보 없음'} · {m.industry ?? '산업 정보 없음'}
              </p>
            </div>

            <div className="price-box">
              <span>현재가</span>
              <strong>{fmtNumber(m.price, currency)}</strong>
              <em>데이터: {result.source}</em>
            </div>
          </section>

          {result.warnings && result.warnings.length > 0 && (
            <section className="warning-list compact-panel">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          )}

          <section className="score-grid">
            <ScoreCard
              title="성장 가능성"
              value={`${s.growthScore}% · ${scoreLabel(s.growthScore)}`}
              tone="good"
              help="수익성, 성장성, 부채, 밸류에이션을 종합했습니다."
            />
            <ScoreCard
              title="섹터 열기"
              value={`${s.sectorScore}% · ${scoreLabel(s.sectorScore)}`}
              help="업종 관심도와 주가 위치를 반영합니다."
            />
            <ScoreCard
              title="버블 위험"
              value={`${s.bubbleRisk}% · ${riskLabel(s.bubbleRisk)}`}
              tone="risk"
              help="PER/PBR/변동성/고점 접근도를 반영합니다."
            />
          </section>

          <section className="panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">핵심 지표</div>
                <h2>먼저 볼 숫자</h2>
              </div>
              <span className="section-note">부족한 값은 데이터 없음으로 표시</span>
            </div>

            <div className="metric-grid">
              <Metric label="PER" value={fmtRatio(mainPe)} desc="이익 대비 가격 부담" />
              <Metric label="PBR" value={fmtRatio(m.priceToBook)} desc="장부가 대비 가격 부담" />
              <Metric label="ROE" value={fmtPct(m.returnOnEquity)} desc="자기자본 수익성" />
              <Metric
                label="부채비율"
                value={m.debtToEquity == null ? '데이터 없음' : `${m.debtToEquity.toFixed(1)}%`}
                desc="자본 대비 부채 부담"
              />
              <Metric label="매출성장률" value={fmtPct(m.revenueGrowth)} desc="외형 성장 속도" />
              <Metric label="시가총액" value={fmtNumber(m.marketCap, currency)} desc="시장의 기업가치 평가" />
            </div>
          </section>

          <section className="panel chart-panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">가격 흐름</div>
                <h2>최근 주가 흐름</h2>
              </div>
            </div>

            {chartData.length ? (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" minTickGap={28} tickFormatter={(value: any) => String(value).slice(5)} />
                    <YAxis domain={['auto', 'auto']} width={68} />
                    <Tooltip formatter={(value: any) => [fmtNumber(Number(value), currency), '종가']} />
                    <Area type="monotone" dataKey="close" strokeWidth={2} fillOpacity={0.16} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p>차트 데이터가 없습니다.</p>
            )}
          </section>

          <section className="panel stress-panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">위험 점검</div>
                <h2>스트레스 하락 시나리오</h2>
              </div>
            </div>

            <div className="stress-grid">
              <Metric label="중간 스트레스" value={fmtNumber(s.stress?.moderate, currency)} desc="위험 점수 기반 가상 하락 가격" />
              <Metric label="강한 스트레스" value={fmtNumber(s.stress?.severe, currency)} desc="PER/PBR 정상화와 52주 저점 반영" />
            </div>

            <p className="muted">
              {s.stress?.explanation} 실제 미래 가격을 보장하지 않으며, 투자 판단용 보조 지표로만 사용하세요.
            </p>
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
                  <ListBox title="추가 확인" items={result.analysis.checklist} empty="추가 확인 항목이 없습니다." />
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
              <span className="section-note">자동 점수 기준</span>
            </div>

            <p className="muted">
              같은 섹터 후보를 성장 가능성, 밸류에이션 부담, 버블 위험, 데이터 확보 정도로 정렬했습니다.
              매수 추천이 아니라 비교 출발점입니다.
            </p>

            {result.peers && result.peers.length > 0 ? (
              <div className="peer-list">
                {result.peers.map((peer) => (
                  <article className="peer-card" key={peer.symbol}>
                    <div className="peer-rank">#{peer.rank}</div>

                    <div className="peer-main">
                      <div className="peer-title-row">
                        <h3>{peer.name}</h3>
                        <span>{peer.score}점</span>
                      </div>

                      <p>
                        {peer.symbol} · {peer.reason}
                      </p>

                      <div className="peer-metrics">
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
                        진단
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>현재 섹터 비교 후보를 충분히 불러오지 못했습니다.</p>
            )}
          </section>

          <section className="panel terms-panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">참고</div>
                <h2>용어 설명</h2>
              </div>
            </div>

            <div className="term-grid">
              {terms.map(([title, desc]) => (
                <div className="term-card" key={title}>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <style jsx>{`
        .app-shell {
          min-height: 100vh;
          max-width: 1040px;
          margin: 0 auto;
          padding: 22px 14px 72px;
          color: #172033;
          background: #f6f8fb;
        }

        .developer-credit {
          display: inline-flex;
          align-items: center;
          margin-bottom: 12px;
          padding: 8px 12px;
          border: 1px solid #d9e3f0;
          border-radius: 999px;
          background: #ffffff;
          color: #506785;
          font-size: 13px;
          font-weight: 900;
          box-shadow: 0 6px 18px rgba(19, 35, 66, 0.06);
        }
        .top-status-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }
        
        .visit-counter {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        
        .visit-counter span {
          display: inline-flex;
          align-items: center;
          padding: 8px 11px;
          border: 1px solid #d9e3f0;
          border-radius: 999px;
          background: #ffffff;
          color: #506785;
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 6px 18px rgba(19, 35, 66, 0.05);
        }
        .hero,
        .panel,
        .compact-panel,
        .score-card {
          border: 1px solid #e1e7f0;
          border-radius: 24px;
          background: #ffffff;
          box-shadow: 0 10px 30px rgba(19, 35, 66, 0.07);
        }

        .hero {
          padding: 26px;
          background: linear-gradient(135deg, #edf4ff, #ffffff 58%, #f5fbf7);
        }

        .eyebrow {
          font-size: 12px;
          font-weight: 900;
          color: #506785;
          letter-spacing: 0.06em;
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
          max-width: 760px;
          font-size: clamp(30px, 7vw, 54px);
          line-height: 1.06;
          letter-spacing: -0.055em;
        }

        h2 {
          letter-spacing: -0.035em;
        }

        .hero p,
        .muted,
        .disclaimer,
        .panel > p,
        .list-box p,
        .term-card p,
        .metric-card p,
        .score-card p,
        .peer-main p,
        .price-box em,
        .summary-main p {
          color: #66758b;
          line-height: 1.62;
        }

        .hero p {
          margin-top: 14px;
          max-width: 720px;
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
          border: 1px solid #d4deeb;
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
          font-weight: 900;
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
          background: #eef3f8;
          color: #26364f;
          padding: 9px 12px;
          border-radius: 999px;
          font-size: 13px;
        }

        .compact-panel,
        .panel {
          margin-top: 16px;
          padding: 22px;
        }

        .notice {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
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
          font-size: 29px;
        }

        .summary-panel h2 span {
          color: #728096;
          font-size: 18px;
        }

        .price-box {
          min-width: 210px;
          padding: 16px;
          border-radius: 18px;
          background: #f4f7fb;
          text-align: right;
        }

        .price-box span,
        .metric-card span,
        .section-note {
          display: block;
          color: #66758b;
          font-size: 13px;
          font-weight: 800;
        }

        .price-box strong {
          display: block;
          margin-top: 3px;
          font-size: 24px;
          letter-spacing: -0.03em;
        }

        .price-box em {
          display: block;
          margin-top: 4px;
          font-size: 12px;
          font-style: normal;
        }

        .score-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-top: 16px;
        }

        .score-card {
          padding: 18px;
        }

        .score-card.good {
          background: linear-gradient(180deg, #ffffff, #f6fbf8);
        }

        .score-card.risk {
          background: linear-gradient(180deg, #ffffff, #fff8f5);
        }

        .score-top span {
          display: block;
          color: #66758b;
          font-size: 13px;
          font-weight: 900;
        }

        .score-top b {
          display: block;
          margin-top: 7px;
          font-size: 23px;
          letter-spacing: -0.035em;
        }

        .metric-grid,
        .term-grid,
        .analysis-grid,
        .stress-grid {
          display: grid;
          gap: 12px;
          margin-top: 16px;
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

        .metric-card,
        .term-card,
        .list-box,
        .analysis-summary,
        .peer-card {
          border: 1px solid #e4eaf2;
          border-radius: 18px;
          background: #fbfcff;
          padding: 16px;
        }

        .metric-card strong {
          display: block;
          margin-top: 6px;
          font-size: 23px;
          letter-spacing: -0.035em;
        }

        .chart-wrap {
          margin-top: 12px;
          width: 100%;
          height: 280px;
          overflow: hidden;
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
          letter-spacing: -0.02em;
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
          grid-template-columns: 52px minmax(0, 1fr) auto;
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

        .peer-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .peer-title-row span {
          flex: 0 0 auto;
          border-radius: 999px;
          background: #e9f1ff;
          color: #253a60;
          padding: 5px 9px;
          font-size: 12px;
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
          font-weight: 800;
        }

        .peer-side {
          text-align: right;
        }

        .peer-side strong {
          display: block;
          margin-bottom: 10px;
          white-space: nowrap;
        }

        .terms-panel {
          margin-top: 22px;
          opacity: 0.96;
        }

        @media (max-width: 760px) {
          .app-shell {
            padding: 16px 10px 56px;
          }
          .top-status-bar {
            align-items: flex-start;
            flex-direction: column;
          }
          .developer-credit {
            margin-bottom: 10px;
            font-size: 12px;
          }

          .hero,
          .panel,
          .compact-panel {
            border-radius: 20px;
            padding: 18px;
          }

          .search-box,
          .notice,
          .summary-panel,
          .section-head,
          .peer-title-row {
            flex-direction: column;
            align-items: stretch;
          }

          .search-box button,
          .notice button {
            width: 100%;
          }

          .price-box {
            width: 100%;
            min-width: 0;
            text-align: left;
          }

          .score-grid,
          .metric-grid,
          .term-grid,
          .analysis-grid,
          .stress-grid {
            grid-template-columns: 1fr;
          }

          .score-card,
          .metric-card,
          .term-card,
          .list-box,
          .analysis-summary,
          .peer-card {
            border-radius: 16px;
          }

          .peer-card {
            grid-template-columns: 1fr;
          }

          .peer-rank {
            width: auto;
            height: auto;
            display: inline-flex;
            justify-content: center;
            padding: 8px 12px;
          }

          .peer-side {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            text-align: left;
          }

          .peer-side strong {
            margin-bottom: 0;
          }

          .peer-side button {
            min-width: 76px;
          }
        }
      `}</style>
    </main>
  );
}
