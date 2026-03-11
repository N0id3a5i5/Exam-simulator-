import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import html2pdf from 'html2pdf.js';
import { PDFDocument } from 'pdf-lib';
import {
  FileText, Download, CheckCircle, XCircle,
  Clock, BookOpen, ChevronLeft, ChevronRight, Eye, EyeOff,
  Zap, AlertTriangle, RotateCcw, FileWarning
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface Question {
  id: number;
  question: string;
  options: Record<string, string>;
  answer: string;
}

type Screen = 'upload' | 'test' | 'results';

interface LogEntry {
  msg: string;
  kind: 'ok' | 'err' | 'warn' | 'info';
}

// ── 1. Safe Storage & Parsers ────────────────────────────────────────────────
const safeGet = (key: string): string => {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
};

const safeSet = (key: string, val: string): void => {
  try { localStorage.setItem(key, val); } catch { /* silently ignore */ }
};

const safeParseJSON = (text: string): Question[] | null => {
  try {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const startIdx = cleaned.indexOf('[');
    const endIdx = cleaned.lastIndexOf(']');
    
    if (startIdx !== -1 && endIdx !== -1) {
      const jsonStr = cleaned.substring(startIdx, endIdx + 1);
      return JSON.parse(jsonStr);
    }
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("JSON parse failed:", err);
    return null;
  }
};

const isQuotaError = (data: any): boolean => {
  const msg: string = data?.error?.message || '';
  return (
    data?.error?.code === 429 ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('resource_exhausted')
  );
};

// ── CSS Injection ────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap');

  :root {
    --bg: #07090f; --surface: #0d1019; --card: #111520; --card2: #161b2e;
    --border: #1c2238; --border2: #242c45;
    --gold: #f5b945; --gold2: #e8a020; --gold-dim: rgba(245,185,69,0.12);
    --blue: #3b6cf7; --blue-dim: rgba(59,108,247,0.12);
    --green: #2ecc71; --green-dim: rgba(46,204,113,0.12);
    --red: #e74c3c; --red-dim: rgba(231,76,60,0.12);
    --text: #e8eaf6; --text2: #a8afc8; --muted: #5a6280;
    --r: 14px; --rlg: 20px;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: var(--bg); color: var(--text); font-family: 'Sora', sans-serif; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 99px; }

  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes scaleIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
  @keyframes slideR { from { opacity:0; transform:translateX(-14px); } to { opacity:1; transform:translateX(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer { 0% { background-position:-200% center; } 100% { background-position:200% center; } }
  @keyframes pulseGold { 0%,100% { box-shadow: 0 0 0 0 rgba(245,185,69,0.35); } 50% { box-shadow: 0 0 0 8px rgba(245,185,69,0); } }
  @keyframes urgentBlink { 0%,100% { opacity:1; } 50% { opacity:0.45; } }

  .upload-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59,108,247,0.07) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(245,185,69,0.05) 0%, transparent 60%); }
  .upload-card { background: var(--card); border: 1px solid var(--border2); border-radius: 24px; padding: 40px 36px 36px; width: 100%; max-width: 420px; box-shadow: 0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.025) inset; animation: fadeUp 0.55s cubic-bezier(.16,1,.3,1) both; }
  .upload-logo { width: 70px; height: 70px; background: linear-gradient(135deg, var(--gold-dim), var(--blue-dim)); border: 1px solid rgba(245,185,69,0.18); border-radius: 18px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 8px 28px rgba(245,185,69,0.08); }
  .upload-title { font-size: 21px; font-weight: 800; text-align: center; margin-bottom: 5px; }
  .upload-sub { font-size: 12.5px; color: var(--muted); text-align: center; margin-bottom: 24px; }
  
  .field-label { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; margin-bottom: 7px; display: flex; align-items: center; gap: 5px; }
  .key-wrap { position: relative; margin-bottom: 6px; }
  .key-input { width: 100%; background: var(--surface); border: 1.5px solid var(--border2); border-radius: 11px; padding: 12px 44px 12px 13px; color: var(--text); font-size: 12.5px; font-family: 'JetBrains Mono', monospace; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
  .key-input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(245,185,69,0.1); }
  .key-input.valid { border-color: var(--green); }
  .key-toggle { position: absolute; right: 11px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--muted); display: flex; align-items: center; padding: 4px; transition: color 0.2s; }
  .key-toggle:hover { color: var(--text2); }
  .field-hint { font-size: 11px; margin-top: 5px; display: flex; align-items: center; gap: 5px; }
  
  .drop-zone { position: relative; background: var(--surface); border: 2px dashed var(--border2); border-radius: var(--r); padding: 22px 16px; margin: 14px 0 18px; cursor: pointer; text-align: center; transition: border-color 0.2s, background 0.2s; }
  .drop-zone:hover, .drop-zone.active { border-color: var(--gold); background: var(--gold-dim); }
  .drop-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .drop-text { font-size: 13px; font-weight: 600; color: var(--text2); pointer-events: none; }
  .drop-sub { font-size: 11px; color: var(--muted); margin-top: 3px; pointer-events: none; }
  
  .btn-primary { width: 100%; background: linear-gradient(135deg, var(--gold), var(--gold2)); color: #07090f; font-family: 'Sora', sans-serif; font-weight: 800; font-size: 14.5px; border: none; border-radius: var(--r); padding: 16px; cursor: pointer; letter-spacing: 0.2px; transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s; animation: pulseGold 2.8s ease infinite; }
  .btn-primary:hover { opacity: 0.92; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(245,185,69,0.25); }
  .btn-primary:active { transform: scale(0.98); animation: none; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; animation: none; transform: none; box-shadow: none; }

  .loading-wrap { text-align: center; max-width: 380px; width: 100%; animation: fadeUp 0.45s ease; }
  .spinner-ring { width: 52px; height: 52px; border: 3px solid var(--border2); border-top-color: var(--gold); border-radius: 50%; margin: 0 auto 18px; animation: spin 0.75s linear infinite; }
  .shimmer-text { background: linear-gradient(90deg, var(--muted), var(--gold), var(--text2), var(--gold), var(--muted)); background-size: 300% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 2.2s linear infinite; font-weight: 700; font-size: 15px; margin-bottom: 5px; }
  
  .error-box { background: var(--red-dim); border: 1px solid rgba(231,76,60,0.4); border-radius: 12px; padding: 16px; margin-bottom: 16px; display: flex; align-items: flex-start; gap: 12px; text-align: left; animation: fadeUp 0.3s ease; }
  .error-box p { color: #f8b4b4; font-size: 13px; line-height: 1.5; margin-top: 2px; }
  .error-box strong { color: var(--red); font-size: 14px; display: block; margin-bottom: 4px; }
  
  .log-console { background: #040609; border: 1px solid var(--border); border-radius: 11px; padding: 13px 15px; height: 168px; overflow-y: auto; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.75; margin-top: 14px; text-align: left; }
  .log-line { display: flex; align-items: flex-start; gap: 7px; }
  .log-line.ok { color: #2ecc71; } .log-line.err { color: #e74c3c; } .log-line.warn { color: #f5b945; } .log-line.info { color: #5a6280; }

  .test-layout { display: flex; gap: 18px; max-width: 980px; margin: 0 auto; padding: 20px 16px; animation: fadeIn 0.35s ease; align-items: flex-start; }
  .sidebar { width: 210px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 20px; }
  .s-card { background: var(--card); border: 1px solid var(--border2); border-radius: var(--r); padding: 16px; }
  .timer-lbl { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 8px; display: flex; align-items: center; gap: 5px; }
  .timer-val { font-family: 'JetBrains Mono', monospace; font-size: 30px; font-weight: 700; color: var(--gold); letter-spacing: 3px; line-height: 1; }
  .timer-val.urgent { color: var(--red); animation: urgentBlink 0.9s ease infinite; }
  .model-badge { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; background: var(--green-dim); color: var(--green); font-size: 10px; font-family: 'JetBrains Mono', monospace; padding: 4px 9px; border-radius: 6px; border: 1px solid rgba(46,204,113,0.2); }
  .prog-lbl { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 10px; }
  .prog-row { margin-bottom: 10px; }
  .prog-top { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-bottom: 5px; }
  .prog-top strong { color: var(--text2); font-weight: 700; }
  .prog-track { background: var(--surface); border-radius: 999px; height: 6px; overflow: hidden; }
  .prog-fill { height: 100%; border-radius: 999px; transition: width 0.5s cubic-bezier(.16,1,.3,1); }
  .prog-fill.v { background: linear-gradient(90deg, var(--blue), #5b8fff); }
  .prog-fill.a { background: linear-gradient(90deg, var(--green), #27ae60); }
  .end-btn { width: 100%; background: var(--red-dim); color: var(--red); border: 1px solid rgba(231,76,60,0.22); border-radius: var(--r); padding: 11px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 12.5px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; transition: background 0.2s, border-color 0.2s, transform 0.12s; }
  .end-btn:hover { background: rgba(231,76,60,0.2); border-color: rgba(231,76,60,0.45); transform: translateY(-1px); }

  .q-card { flex: 1; background: var(--card); border: 1px solid var(--border2); border-radius: var(--rlg); padding: 28px 26px; display: flex; flex-direction: column; min-height: 500px; animation: scaleIn 0.28s cubic-bezier(.16,1,.3,1); }
  .q-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; padding-bottom: 15px; border-bottom: 1px solid var(--border); }
  .q-badge { background: var(--gold-dim); color: var(--gold); font-weight: 700; font-size: 12.5px; padding: 5px 11px; border-radius: 8px; border: 1px solid rgba(245,185,69,0.18); font-family: 'JetBrains Mono', monospace; }
  .q-status { font-size: 12px; display: flex; align-items: center; gap: 5px; }
  .q-text { font-size: 16px; font-weight: 600; line-height: 1.7; color: var(--text); margin-bottom: 20px; flex: 1; }
  .opts { display: flex; flex-direction: column; gap: 9px; }
  .opt-btn { width: 100%; background: var(--surface); border: 1.5px solid var(--border2); border-radius: 11px; padding: 13px 15px; display: flex; align-items: center; gap: 13px; cursor: pointer; text-align: left; transition: border-color 0.18s, background 0.18s, transform 0.12s; animation: slideR 0.3s cubic-bezier(.16,1,.3,1) both; }
  .opt-btn:hover:not(.sel) { border-color: rgba(245,185,69,0.4); background: rgba(245,185,69,0.05); }
  .opt-btn:active { transform: scale(0.995); }
  .opt-btn.sel { border-color: var(--gold); background: var(--gold-dim); }
  .opt-key { width: 32px; height: 32px; flex-shrink: 0; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12.5px; background: var(--card2); color: var(--muted); transition: background 0.18s, color 0.18s; }
  .opt-btn.sel .opt-key { background: var(--gold); color: var(--bg); }
  .opt-text { font-size: 13.5px; color: var(--text); line-height: 1.5; }
  .q-nav { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border); gap: 10px; }
  .nav-btn { display: flex; align-items: center; gap: 7px; background: var(--surface); border: 1px solid var(--border2); color: var(--text2); font-family: 'Sora', sans-serif; font-weight: 700; font-size: 12.5px; padding: 10px 18px; border-radius: 9px; cursor: pointer; transition: background 0.18s, border-color 0.18s, transform 0.12s; }
  .nav-btn:hover:not(:disabled) { background: var(--card2); border-color: var(--gold); color: var(--text); }
  .nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .nav-btn.nxt { background: linear-gradient(135deg, var(--gold), var(--gold2)); color: var(--bg); border-color: transparent; flex: 1; justify-content: center; }
  .nav-btn.nxt:hover { opacity: 0.9; transform: translateY(-1px); }

  .results-wrap { max-width: 860px; margin: 0 auto; padding: 22px 16px 40px; animation: fadeIn 0.4s ease; }
  .results-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .btn-ghost { display: flex; align-items: center; gap: 7px; background: var(--card); border: 1px solid var(--border2); color: var(--text2); font-family: 'Sora', sans-serif; font-weight: 700; font-size: 12.5px; padding: 10px 16px; border-radius: 9px; cursor: pointer; transition: background 0.18s, color 0.18s; }
  .btn-ghost:hover { background: var(--card2); color: var(--text); }
  .btn-save { display: flex; align-items: center; gap: 7px; background: linear-gradient(135deg, var(--blue), #2850d4); color: white; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 12.5px; padding: 10px 18px; border-radius: 9px; border: none; cursor: pointer; transition: opacity 0.18s, transform 0.12s; }
  .btn-save:hover { opacity: 0.88; transform: translateY(-1px); }
  .score-hero { background: linear-gradient(145deg, var(--card) 0%, var(--card2) 100%); border: 1px solid var(--border2); border-radius: 22px; padding: 38px 28px 30px; text-align: center; margin-bottom: 20px; position: relative; overflow: hidden; }
  .score-hero::before { content: ''; position: absolute; top: -80px; left: 50%; transform: translateX(-50%); width: 300px; height: 300px; background: radial-gradient(circle, rgba(245,185,69,0.1) 0%, transparent 65%); pointer-events: none; }
  .score-pct { font-size: 80px; font-weight: 800; background: linear-gradient(135deg, var(--gold) 30%, #fff5d6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1; margin-bottom: 6px; letter-spacing: -2px; }
  .score-sub { font-size: 14px; color: var(--muted); margin-bottom: 22px; }
  .stats-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .stat-chip { background: rgba(255,255,255,0.04); border: 1px solid var(--border2); border-radius: 9px; padding: 9px 16px; font-size: 12.5px; display: flex; align-items: center; gap: 7px; }
  .stat-chip .v { font-weight: 800; font-size: 15px; }
  .stat-chip.c .v { color: var(--green); } .stat-chip.w .v { color: var(--red); } .stat-chip.s .v { color: var(--muted); }
  
  .review-list { display: flex; flex-direction: column; gap: 11px; }
  .review-item { background: var(--card); border: 1px solid var(--border2); border-radius: 13px; padding: 17px 18px; border-left: 3px solid var(--border2); animation: fadeUp 0.4s cubic-bezier(.16,1,.3,1) both; }
  .review-item.correct { border-left-color: var(--green); }
  .review-item.wrong { border-left-color: var(--red); }
  .review-item.skipped { border-left-color: var(--muted); }
  .review-q { font-weight: 600; font-size: 13.5px; color: var(--text); margin-bottom: 12px; line-height: 1.55; }
  .ans-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-bottom: 11px; }
  .ans-box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; }
  .ans-lbl { font-size: 9.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 4px; }
  .ans-val { font-size: 12.5px; font-weight: 600; line-height: 1.4; }
  
  .ai-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; background: var(--blue-dim); border: 1px solid rgba(59,108,247,0.22); color: #7b9ef7; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 11.5px; padding: 9px 12px; border-radius: 8px; cursor: pointer; transition: background 0.18s, transform 0.12s; }
  .ai-btn:hover:not(:disabled) { background: rgba(59,108,247,0.2); transform: translateY(-1px); }
  .ai-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ai-box { margin-top: 10px; background: rgba(245,185,69,0.05); border: 1px solid rgba(245,185,69,0.18); border-radius: 9px; padding: 11px 13px; font-size: 12.5px; line-height: 1.72; color: var(--text2); animation: fadeUp 0.35s ease; }
  .ai-box-title { color: var(--gold); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; display: flex; align-items: center; gap: 5px; }

  @media (max-width: 680px) {
    .test-layout { flex-direction: column; padding: 14px 12px; }
    .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; position: static; }
    .s-card { flex: 1; min-width: 140px; }
    .q-card { padding: 20px 16px; }
    .q-text { font-size: 15px; }
    .score-pct { font-size: 60px; }
    .ans-grid { grid-template-columns: 1fr; }
    .upload-card { padding: 28px 20px 24px; }
    .timer-val { font-size: 24px; }
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('app-styles')) {
  const el = document.createElement('style'); el.id = 'app-styles'; el.textContent = GLOBAL_CSS; document.head.appendChild(el);
}

// ── 2. Performance: Memoized Components ──────────────────────────────────────
const QuestionCard = memo(({ 
  q, qIndex, total, selection, onSelect, onNext, onPrev, onEnd 
}: { 
  q: Question, qIndex: number, total: number, selection?: string, 
  onSelect: (id: number, opt: string) => void, onNext: () => void, onPrev: () => void, onEnd: () => void 
}) => {
  return (
    <div className="q-card" key={q.id}>
      <div className="q-head">
        <span className="q-badge">Q {qIndex + 1} / {total}</span>
        <span className="q-status" style={{ color: selection ? 'var(--green)' : 'var(--muted)' }}>
          {selection ? <><CheckCircle size={13} />Answered</> : 'Unanswered'}
        </span>
      </div>
      <p className="q-text">{q.question}</p>
      <div className="opts">
        {Object.entries(q.options).map(([k, v], idx) => (
          <button
            key={k}
            className={`opt-btn${selection === k ? ' sel' : ''}`}
            style={{ animationDelay: `${idx * 0.055}s` }}
            onClick={() => onSelect(q.id, k)}
          >
            <span className="opt-key">{k}</span>
            <span className="opt-text">{v}</span>
          </button>
        ))}
      </div>
      <div className="q-nav">
        <button className="nav-btn" disabled={qIndex === 0} onClick={onPrev}>
          <ChevronLeft size={15} />Prev
        </button>
        <button className="nav-btn nxt" onClick={qIndex === total - 1 ? onEnd : onNext}>
          {qIndex === total - 1 ? 'Finish ✓' : <>Next<ChevronRight size={15} /></>}
        </button>
      </div>
    </div>
  );
});

// ── 3. Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [errorUI, setErrorUI] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([{ msg: 'System initialized', kind: 'info' }]);
  
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [clock, setClock] = useState(7200);
  
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [discoveredModel, setDiscoveredModel] = useState('');
  const [apiKey, setApiKey] = useState<string>(() => safeGet('gemini_api_key'));
  const [showKey, setShowKey] = useState(false);
  
  const [aiExplanations, setAiExplanations] = useState<Record<number, string>>({});
  const [loadingExplanation, setLoadingExplanation] = useState<Record<number, boolean>>({});

  const logsEndRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const endExam = useCallback(() => setScreen('results'), []);

  useEffect(() => {
    if (screen !== 'test') return;
    const interval = setInterval(() => {
      setClock(c => {
        if (c <= 1) { clearInterval(interval); endExam(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, endExam]);

  const addLog = (msg: string, kind: LogEntry['kind'] = 'ok') => setLogs(prev => [...prev, { msg, kind }]);

  // ── 4. File Input & PDF Compression ────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorUI(null);
    const f = e.target.files?.[0];
    if (!f) return;

    const sizeMB = f.size / 1024 / 1024;

    if (sizeMB > 4) {
      setCompressing(true);
      setLogs([{ msg: `Large file detected (${sizeMB.toFixed(1)}MB). Initiating local compression...`, kind: 'info' }]);
      
      try {
        const arrayBuffer = await f.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
        const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
        const compressedFile = new File([pdfBytes], f.name, { type: 'application/pdf' });
        const newSizeMB = compressedFile.size / 1024 / 1024;
        
        if (newSizeMB > 12) {
          setErrorUI(`File is still too large (${newSizeMB.toFixed(1)}MB) after compression. Please use a smaller file under 12MB.`);
          setFile(null);
          setFileName('');
        } else {
          addLog(`✓ Compression complete. File optimized to ${newSizeMB.toFixed(1)}MB`, 'ok');
          setFile(compressedFile);
          setFileName(compressedFile.name);
        }
      } catch (err: any) {
        console.error("Compression Error:", err);
        setErrorUI(`Failed to compress PDF. Please use a smaller file under 4MB.`);
        setFile(null);
        setFileName('');
      }
      setCompressing(false);
    } else {
      setFile(f); 
      setFileName(f.name); 
    }
  };

  // ── 5. Generation API Call Logic ───────────────────────────────────────────
  const MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash", 
    "gemini-1.5-flash", 
    "gemini-1.5-pro"
  ];

  const callGemini = async (base64: string, key: string) => {
    const prompt = `Read this PDF. Extract up to 30 multiple-choice questions. 
CRITICAL: Output ONLY a raw, minified JSON array. NO markdown, NO text, NO explanation.
Format: [{"id":1,"question":"Text?","options":{"A":"Opt A","B":"Opt B"},"answer":"A"}]`;

    for (const model of MODELS) {
      addLog(`Trying ${model}...`, 'info');
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'application/pdf', data: base64 } }] }]
          })
        });
        
        const data = await res.json();
        
        if (isQuotaError(data)) {
          addLog(`Model ${model} quota exceeded, switching...`, 'warn');
          continue;
        }
        if (data.error) throw new Error(data.error.message);
        
        setDiscoveredModel(model);
        return data.candidates[0].content.parts[0].text;
      } catch (err: any) {
        console.warn(`Model ${model} failed:`, err);
      }
    }
    throw new Error("All fallback models failed or quota exceeded.");
  };

  const startExtraction = async () => {
    if (!file) { setErrorUI('Please select a PDF first.'); return; }
    if (!apiKey.trim()) { setErrorUI('Please enter your Gemini API key.'); return; }
    
    setErrorUI(null);
    safeSet('gemini_api_key', apiKey.trim());
    setLoading(true);
    setLogs([{ msg: 'Initiating document processing...', kind: 'info' }]);
    
    try {
      addLog('Reading and encoding PDF...', 'info');
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.readAsDataURL(file);
        r.onload = () => resolve((r.result as string).split(',')[1]);
        r.onerror = reject;
      });

      const rawResponse = await callGemini(base64, apiKey.trim());
      addLog(`✓ Received AI response`, 'ok');
      addLog('Parsing MCQ JSON data...', 'info');

      const data = safeParseJSON(rawResponse);
      
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error("Invalid AI response. Failed to parse MCQ format or no questions found.");
      }

      setQuestions(data);
      addLog(`✓ Successfully parsed ${data.length} questions! Starting exam...`, 'ok');
      
      setTimeout(() => { setScreen('test'); setLoading(false); }, 800);
      
    } catch (err: any) {
      addLog(`Error: ${err.message}`, 'err');
      setErrorUI(err.message || "Failed to process document. Please try again.");
      setLoading(false);
    }
  };

  const fetchExplanation = async (q: Question) => {
    setLoadingExplanation(prev => ({ ...prev, [q.id]: true }));
    const key = apiKey.trim();
    const prompt = `Explain why "${q.answer}" is correct for this MCQ. 2–3 sentences, direct and educational.
Question: ${q.question}
Options: ${Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join(' | ')}
Correct: ${q.answer}. ${q.options[q.answer]}`;

    try {
      for (const model of MODELS) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) 
        });
        const data = await res.json();
        if (isQuotaError(data)) continue;
        if (data.error) throw new Error(data.error.message);
        
        setAiExplanations(prev => ({ ...prev, [q.id]: data.candidates[0].content.parts[0].text }));
        setLoadingExplanation(prev => ({ ...prev, [q.id]: false }));
        return;
      }
      throw new Error('All models failed — try again later');
    } catch (err: any) {
      setAiExplanations(prev => ({ ...prev, [q.id]: `⚠ ${err.message}` }));
      setLoadingExplanation(prev => ({ ...prev, [q.id]: false }));
    }
  };

  const saveResults = () => {
    if (!resultsRef.current) return;
    html2pdf().from(resultsRef.current).set({
      margin: 10, filename: 'Exam_Report.pdf',
      html2canvas: { scale: 2, backgroundColor: '#07090f' },
      jsPDF: { orientation: 'portrait' }
    }).save();
  };

  const restartApp = () => {
    setScreen('upload'); setLoading(false); setErrorUI(null);
    setLogs([{ msg: 'System initialized', kind: 'info' }]);
    setQuestions([]); setSelections({});
    setQIndex(0); setClock(7200);
    setFile(null); setFileName('');
    setDiscoveredModel('');
    setAiExplanations({}); setLoadingExplanation({});
  };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  const renderUpload = () => (
    <div className="upload-wrap">
      {errorUI && !loading && !compressing && (
        <div className="error-box">
          <FileWarning size={20} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Processing Failed</strong>
            <p>{errorUI}</p>
          </div>
        </div>
      )}

      {loading || compressing || (errorUI && logs.length > 1) ? (
        <div className="loading-wrap">
          {(loading || compressing) && (
            <>
              <div className="spinner-ring" />
              <p className="shimmer-text">{compressing ? 'Compressing PDF…' : 'Analyzing Document…'}</p>
              <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>
                {compressing ? 'Optimizing file structure locally' : 'Optimized extraction active'}
              </p>
            </>
          )}
          <div className="log-console">
            {logs.map((entry, i) => (
              <div key={i} className={`log-line ${entry.kind}`}>
                <span style={{ opacity: 0.4, flexShrink: 0 }}>›</span>
                <span>{entry.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
          {!loading && !compressing && (
            <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => { setErrorUI(null); setLoading(false); }}>
              <RotateCcw size={13} style={{ display: 'inline', marginRight: 6 }} />Try Again
            </button>
          )}
        </div>
      ) : (
        <div className="upload-card">
          <div className="upload-logo"><BookOpen size={30} color="var(--gold)" /></div>
          <h1 className="upload-title">MCQ Exam Simulator</h1>
          <p className="upload-sub">Upload a question-paper PDF to start your timed practice session</p>
          <div style={{ marginBottom: 16 }}>
            <div className="field-label"><Zap size={11} />Gemini API Key</div>
            <div className="key-wrap">
              <input
                className={`key-input${apiKey ? ' valid' : ''}`}
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy…"
                autoComplete="off" spellCheck={false}
              />
              <button className="key-toggle" onClick={() => setShowKey(s => !s)} tabIndex={-1}>
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {!apiKey
              ? <p className="field-hint" style={{ color: 'var(--gold)' }}><AlertTriangle size={11} />Get free key at aistudio.google.com</p>
              : <p className="field-hint" style={{ color: 'var(--green)' }}><CheckCircle size={11} />Key stored securely</p>
            }
          </div>
          <div className={`drop-zone${fileName ? ' active' : ''}`}>
            <input type="file" accept="application/pdf" onChange={handleFileChange} />
            <FileText size={22} color={fileName ? 'var(--gold)' : 'var(--muted)'} style={{ margin: '0 auto 8px', display: 'block' }} />
            <p className="drop-text">{fileName || 'Tap to choose a PDF'}</p>
            {!fileName && <p className="drop-sub">Auto-compresses files over 4MB</p>}
          </div>
          <button className="btn-primary" onClick={startExtraction} disabled={!file || !apiKey.trim() || loading || compressing}>
            {loading ? 'Processing...' : compressing ? 'Compressing...' : 'Start Extraction →'}
          </button>
        </div>
      )}
    </div>
  );

  const renderTest = () => {
    if (!questions.length) return null;
    const q = questions[qIndex];
    const answered = Object.keys(selections).length;
    const visitedPct = ((qIndex + 1) / questions.length) * 100;
    const answeredPct = (answered / questions.length) * 100;
    return (
      <div className="test-layout">
        <div className="sidebar">
          <div className="s-card">
            <div className="timer-lbl"><Clock size={10} />Time Left</div>
            <div className="timer-val">{formatTime(clock)}</div>
            {discoveredModel && <div className="model-badge"><Zap size={9} />{discoveredModel}</div>}
          </div>
          <div className="s-card">
            <div className="prog-lbl">Progress</div>
            <div className="prog-row">
              <div className="prog-top"><span>Visited</span><strong>{qIndex + 1} / {questions.length}</strong></div>
              <div className="prog-track"><div className="prog-fill v" style={{ width: `${visitedPct}%` }} /></div>
            </div>
            <div className="prog-row">
              <div className="prog-top"><span>Answered</span><strong>{answered} / {questions.length}</strong></div>
              <div className="prog-track"><div className="prog-fill a" style={{ width: `${answeredPct}%` }} /></div>
            </div>
          </div>
          <button className="end-btn" onClick={endExam}><XCircle size={14} />End Test</button>
        </div>
        <QuestionCard 
          q={q} 
          qIndex={qIndex} 
          total={questions.length}
          selection={selections[q.id]}
          onSelect={(id, opt) => setSelections(prev => ({ ...prev, [id]: opt }))}
          onPrev={() => setQIndex(Math.max(0, qIndex - 1))}
          onNext={() => setQIndex(qIndex + 1)}
          onEnd={endExam}
        />
      </div>
    );
  };

  const renderResults = () => {
    let score = 0, skipped = 0;
    questions.forEach(q => {
      if (!selections[q.id]) skipped++;
      else if (selections[q.id] === q.answer) score++;
    });
    const wrong = questions.length - score - skipped;
    const pct = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
    return (
      <div className="results-wrap">
        <div className="results-bar no-print">
          <button className="btn-ghost" onClick={restartApp}><RotateCcw size={14} />New Exam</button>
          <button className="btn-save" onClick={saveResults}><Download size={14} />Save PDF</button>
        </div>
        <div ref={resultsRef}>
          <div className="score-hero">
            <div className="score-pct">{pct}%</div>
            <p className="score-sub">{score} correct out of {questions.length} questions</p>
            <div className="stats-row">
              <div className="stat-chip c"><CheckCircle size={13} color="var(--green)" /><span className="v">{score}</span> Correct</div>
              <div className="stat-chip w"><XCircle size={13} color="var(--red)" /><span className="v">{wrong}</span> Wrong</div>
              <div className="stat-chip s"><span className="v">{skipped}</span> Skipped</div>
            </div>
          </div>
          <div className="review-list">
            {questions.map((q, i) => {
              const ok = selections[q.id] === q.answer;
              const sk = !selections[q.id];
              return (
                <div key={q.id} className={`review-item ${sk ? 'skipped' : ok ? 'correct' : 'wrong'}`}>
                  <p className="review-q">Q{i + 1}: {q.question}</p>
                  <div className="ans-grid">
                    <div className="ans-box">
                      <div className="ans-lbl">Your Answer</div>
                      <div className="ans-val" style={{ color: sk ? 'var(--muted)' : ok ? 'var(--green)' : 'var(--red)' }}>
                        {sk ? '— Skipped' : `${selections[q.id]}. ${q.options[selections[q.id]] || ''}`}
                      </div>
                    </div>
                    <div className="ans-box">
                      <div className="ans-lbl">Correct Answer</div>
                      <div className="ans-val" style={{ color: 'var(--green)' }}>{q.answer}. {q.options[q.answer]}</div>
                    </div>
                  </div>
                  {aiExplanations[q.id] ? (
                    <div className="ai-box">
                      <div className="ai-box-title"><Zap size={10} />AI Explanation</div>
                      {aiExplanations[q.id]}
                    </div>
                  ) : (
                    <button className="ai-btn no-print" disabled={!!loadingExplanation[q.id]} onClick={() => fetchExplanation(q)}>
                      <Zap size={12} />{loadingExplanation[q.id] ? 'Thinking…' : 'Explain with AI'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {screen === 'upload' && renderUpload()}
      {screen === 'test' && renderTest()}
      {screen === 'results' && renderResults()}
    </div>
  );
}

