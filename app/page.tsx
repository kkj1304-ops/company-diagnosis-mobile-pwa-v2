'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtNumber, fmtPct } from '@/lib/scoring';

type Result = {
  query: string;
  symbol: string;
  source: string;
  metrics: any;
  scores: any;
  chart: Array<{ date: string; close: number }>;
};

const examples = ['삼성전자', 'SK하이닉스', '현대차', 'NAVER', '에코프로비엠', 'NVDA', 'AAPL'];

function scoreLabel(n: number) {
  if (n >= 75) return '강함';
  if (n >= 55) return '보통 이상';
  if (n >= 40) return '중립';
  return '약함';
}

function Metric({ label, value, desc }: { label: string; value: string; desc: string }) {
  return <div className="metric"><div className="label">{label}</div><div className="value">{value}</div><div className="desc">{desc}</div></div>;
}

function Row({ title, value, help }: { title: string; value: string; help: string }) {
  return <div className="row"><div><b>{title}</b><small>{help}</small></div><em>{value}</em></div>;
}

export default function Home() {
  const [query, setQuery] = useState('삼성전자');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function analyze(q = query) {
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
      const data = await res.json();
      if (!res.ok) throw new Error(`${data.error ?? '조회 실패'} ${data.hint ? `(${data.hint})` : ''}`);
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? '조회 실패');
    } finally {
      setLoading(false);
    }
  }

  const m = result?.metrics;
  const s = result?.scores;
  const currency = m?.currency ?? '';
  const price = m?.price;
  const chartData = useMemo(() => result?.chart?.slice(-180) ?? [], [result]);

  return <main className="app-shell">
    <section className="hero" id="top">
      <div className="badge">📱 모바일 PWA · URL 접속형 기업 진단</div>
      <h1>기업 이름만 넣고<br />재무·가치·위험을 한눈에</h1>
      <p>PER, PBR 같은 어려운 지표를 쉬운 설명과 함께 보여주고, 성장 가능성·섹터 열기·버블 위험을 점수화합니다.</p>
    </section>

    <section className="search-card">
      <div className="input-row">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && analyze()} placeholder="예: 삼성전자, 005930.KS, NVDA" />
        <button className="primary" onClick={() => analyze()} disabled={loading}>{loading ? '조회중' : '진단'}</button>
      </div>
      <div className="chips">{examples.map((x) => <button key={x} className="chip" onClick={() => { setQuery(x); analyze(x); }}>{x}</button>)}</div>
    </section>

    {deferredPrompt && <section className="card">
      <h2>홈 화면에 앱처럼 추가</h2>
      <p>설치 버튼을 누르면 휴대폰 홈 화면에서 바로 열 수 있습니다.</p>
      <button className="primary" style={{ height: 46, width: '100%' }} onClick={async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; setDeferredPrompt(null); }}>홈 화면에 추가</button>
    </section>}

    {loading && <section className="card loading"><div className="spinner" />실시간 데이터를 가져오는 중입니다.</section>}
    {error && <section className="card notice error">{error}</section>}

    {result && m && s && <>
      <section className="card" id="summary">
        <h2>{m.name} <span style={{ color: '#94a3b8', fontSize: 13 }}>({result.symbol})</span></h2>
        <p>{m.sector ?? '섹터 정보 없음'} · {m.industry ?? '산업 정보 없음'} · 데이터: {result.source}</p>
        <div className="score-row">
          <div className="score"><div><strong>{s.growthScore}%</strong><span>성장 가능성 · {scoreLabel(s.growthScore)}</span><div className="bar"><div style={{ width: `${s.growthScore}%` }} /></div></div></div>
          <div className="score"><div><strong>{s.sectorScore}%</strong><span>섹터 열기 · {scoreLabel(s.sectorScore)}</span><div className="bar"><div style={{ width: `${s.sectorScore}%` }} /></div></div></div>
          <div className="score"><div><strong>{s.bubbleRisk}%</strong><span>버블 위험 · {s.bubbleRisk >= 65 ? '높음' : s.bubbleRisk >= 45 ? '보통' : '낮음'}</span><div className="bar warnbar"><div style={{ width: `${s.bubbleRisk}%` }} /></div></div></div>
        </div>
      </section>

      <section className="card" id="metrics">
        <h2>핵심 지표</h2>
        <div className="grid">
          <Metric label="현재가" value={fmtNumber(price, currency)} desc="지금 시장에서 거래되는 가격입니다." />
          <Metric label="시가총액" value={fmtNumber(m.marketCap, currency)} desc="회사 전체를 시장이 얼마로 평가하는지 보여줍니다." />
          <Metric label="PER" value={fmtNumber(m.forwardPE ?? m.trailingPE)} desc="주가가 이익의 몇 배인지 보는 값입니다. 낮다고 무조건 좋지는 않지만, 너무 높으면 기대가 많이 반영된 상태일 수 있습니다." />
          <Metric label="PBR" value={fmtNumber(m.priceToBook)} desc="주가가 장부상 순자산의 몇 배인지 보는 값입니다. 금융·제조업에서 특히 자주 봅니다." />
          <Metric label="ROE" value={fmtPct(m.returnOnEquity)} desc="자본을 얼마나 효율적으로 굴려 이익을 냈는지 보여줍니다. 일반적으로 높을수록 좋습니다." />
          <Metric label="부채비율" value={fmtNumber(m.debtToEquity)} desc="자본 대비 부채 수준입니다. 너무 높으면 금리 상승이나 경기 둔화 때 위험해질 수 있습니다." />
        </div>
      </section>

      <section className="card" id="chart">
        <h2>최근 주가 흐름</h2>
        {chartData.length ? <div style={{ width: '100%', height: 220 }}><ResponsiveContainer><AreaChart data={chartData}><XAxis dataKey="date" hide /><YAxis domain={['dataMin', 'dataMax']} hide /><Tooltip /><Area type="monotone" dataKey="close" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.18} /></AreaChart></ResponsiveContainer></div> : <p>차트 데이터가 없습니다.</p>}
      </section>

      <section className="card" id="stress">
        <h2>버블 붕괴 스트레스 시나리오</h2>
        <div className="notice">{s.stress.explanation} 실제 미래 가격을 보장하지 않으며, 투자 판단용 보조 지표로만 사용하세요.</div>
        <div className="table" style={{ marginTop: 10 }}>
          <Row title="중간 스트레스 가격" value={fmtNumber(s.stress.moderate, currency)} help="버블 위험 점수에 따른 보통 수준의 하락 시나리오입니다." />
          <Row title="심각 스트레스 가격" value={fmtNumber(s.stress.severe, currency)} help="PER/PBR 정상화와 52주 저점까지 함께 고려한 더 보수적인 가격입니다." />
          <Row title="52주 고점" value={fmtNumber(m.fiftyTwoWeekHigh, currency)} help="최근 1년 중 가장 높았던 가격입니다. 현재가가 고점에 가까울수록 기대가 많이 반영됐을 수 있습니다." />
          <Row title="52주 저점" value={fmtNumber(m.fiftyTwoWeekLow, currency)} help="최근 1년 중 가장 낮았던 가격입니다. 스트레스 가격의 참고선으로 봅니다." />
        </div>
      </section>

      <section className="card" id="terms">
        <h2>용어 설명</h2>
        <div className="table">
          <Row title="성장 가능성 %" value={`${s.growthScore}%`} help="미래 확률이 아니라 매출 성장, 이익 성장, ROE, 마진, 부채, 밸류에이션을 종합한 점수입니다." />
          <Row title="섹터 열기 %" value={`${s.sectorScore}%`} help="산업이 시장에서 주목받는 정도를 대략 점수화합니다. 기술·반도체·방산·바이오 등은 높은 점수가 나올 수 있습니다." />
          <Row title="버블 위험 %" value={`${s.bubbleRisk}%`} help="PER/PBR, 베타, 52주 고점 근접도 등을 기준으로 기대가 과열됐을 가능성을 봅니다." />
          <Row title="배당수익률" value={fmtPct(m.dividendYield)} help="주가 대비 1년에 받을 수 있는 배당 비율입니다. 성장주는 낮고 성숙 기업은 높을 수 있습니다." />
        </div>
      </section>
    </>}

    <nav className="bottom-nav">
      <a href="#top">검색</a><a href="#summary">요약</a><a href="#metrics">지표</a><a href="#stress">위험</a>
    </nav>
  </main>;
}
