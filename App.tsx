import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, Upload, AlertCircle, RotateCcw, Zap, FileText, BookOpen, Key, Shield } from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Question { id: number; question: string; options: Record<string, string>; answer: string; }
type Screen = 'upload' | 'test' | 'results';
interface LogEntry { msg: string; kind: 'ok' | 'err' | 'warn' | 'info'; }

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const safeGet = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { } };

const safeParseJSON = (text: string): Question[] | null => {
  try {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('['), end = cleaned.lastIndexOf(']');
    return (start !== -1 && end !== -1) ? JSON.parse(cleaned.substring(start, end + 1)) : JSON.parse(cleaned);
  } catch { return null; }
};

const loadPdfLib = async () => {
  if ((window as any).PDFLib) return (window as any).PDFLib;
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/pdf-lib/dist/pdf-lib.min.js';
    s.onload = () => res((window as any).PDFLib);
    s.onerror = () => rej(new Error('CDN Load Failed'));
    document.head.appendChild(s);
  });
};

const fmt = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

/* ─── Global Styles ──────────────────────────────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#060810; --surface:#0b0e18; --card:#0f1320; --card2:#141829;
    --border:#1e2540; --border2:#2a3358;
    --gold:#f0b429; --gold2:#ffd166; --gold-glow:rgba(240,180,41,0.2);
    --green:#0ecf7c; --green-dim:rgba(14,207,124,0.12);
    --red:#f0454a; --red-dim:rgba(240,69,74,0.1);
    --blue:#4d7cfe; --text:#e6e9f8; --text2:#7a84a8; --muted:#2d3550;
    --font:'Syne',sans-serif; --mono:'JetBrains Mono',monospace;
    --r:14px;
  }
  html,body { background:var(--bg); color:var(--text); font-family:var(--font); min-height:100vh; }

  /* Noise texture overlay */
  body::before {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.025'/%3E%3C/svg%3E");
    opacity:0.4;
  }
  /* Ambient orbs */
  body::after {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
    background:
      radial-gradient(ellipse 60% 40% at 15% 10%, rgba(77,124,254,0.07) 0%, transparent 70%),
      radial-gradient(ellipse 50% 35% at 85% 85%, rgba(240,180,41,0.06) 0%, transparent 65%);
  }

  /* ══ UPLOAD ══ */
  .up-wrap {
    display:flex; align-items:center; justify-content:center;
    min-height:100vh; padding:24px; position:relative; z-index:1;
  }
  .up-panel {
    width:100%; max-width:460px;
    background:linear-gradient(160deg, #111827 0%, #0c1120 100%);
    border:1px solid var(--border); border-radius:24px; padding:36px;
    box-shadow:0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04);
  }
  .up-brand { display:flex; align-items:center; gap:14px; margin-bottom:32px; }
  .brand-icon {
    width:48px; height:48px; border-radius:14px; flex-shrink:0;
    background:linear-gradient(135deg,#f5b942 0%,#e07b10 100%);
    display:flex; align-items:center; justify-content:center; font-size:22px;
    box-shadow:0 6px 20px rgba(240,180,41,0.35);
  }
  .brand-name { font-size:24px; font-weight:800; letter-spacing:-0.8px; }
  .brand-sub { font-size:12px; color:var(--text2); margin-top:2px; letter-spacing:0.2px; }

  .section { margin-bottom:22px; }
  .lbl {
    display:flex; align-items:center; gap:6px;
    font-size:10px; font-weight:700; letter-spacing:1.5px;
    color:var(--text2); text-transform:uppercase; margin-bottom:10px;
  }
  .key-input {
    width:100%; background:var(--surface); border:1.5px solid var(--border);
    border-radius:12px; padding:13px 16px; color:var(--text);
    font-family:var(--mono); font-size:13px; outline:none;
    transition:border-color 0.2s, box-shadow 0.2s;
  }
  .key-input:focus { border-color:var(--blue); box-shadow:0 0 0 3px rgba(77,124,254,0.1); }
  .key-input::placeholder { color:var(--muted); }

  .drop-zone {
    background:var(--surface); border:1.5px dashed var(--border2);
    border-radius:14px; padding:24px 20px; text-align:center;
    cursor:pointer; transition:all 0.25s; position:relative; overflow:hidden;
  }
  .drop-zone::before {
    content:''; position:absolute; inset:0;
    background:linear-gradient(135deg, transparent 0%, rgba(240,180,41,0.03) 100%);
    opacity:0; transition:opacity 0.25s;
  }
  .drop-zone:hover,.drop-zone.dz-active { border-color:var(--gold); }
  .drop-zone:hover::before,.drop-zone.dz-active::before { opacity:1; }
  .drop-zone input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
  .dz-icon { margin-bottom:10px; opacity:0.5; }
  .dz-text { font-size:14px; font-weight:600; margin-bottom:4px; }
  .dz-hint { font-size:12px; color:var(--text2); }
  .dz-file { display:flex; align-items:center; justify-content:center; gap:10px; color:var(--gold); font-weight:700; font-size:14px; }
  .dz-file-name { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  .go-btn {
    width:100%; padding:15px; border:none; border-radius:14px; cursor:pointer;
    background:linear-gradient(135deg,#f5b942 0%,#e07b10 100%);
    color:#000; font-family:var(--font); font-weight:800; font-size:15px;
    letter-spacing:0.2px; transition:all 0.25s;
    display:flex; align-items:center; justify-content:center; gap:8px;
    box-shadow:0 4px 16px rgba(240,180,41,0.2);
  }
  .go-btn:hover:not(:disabled) {
    transform:translateY(-2px);
    box-shadow:0 10px 32px rgba(240,180,41,0.4);
  }
  .go-btn:active:not(:disabled) { transform:translateY(0); }
  .go-btn:disabled { opacity:0.35; cursor:not-allowed; transform:none; box-shadow:none; }

  /* Loading */
  .load-panel {
    width:100%; max-width:460px;
    background:linear-gradient(160deg, #111827 0%, #0c1120 100%);
    border:1px solid var(--border); border-radius:24px; padding:36px;
    text-align:center; box-shadow:0 32px 80px rgba(0,0,0,0.6);
  }
  .spinner {
    width:48px; height:48px; border:3px solid var(--border2);
    border-top-color:var(--gold); border-radius:50%;
    margin:0 auto 20px; animation:spin 0.65s linear infinite;
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  .load-h { font-size:17px; font-weight:700; margin-bottom:4px; }
  .load-s { font-size:12px; color:var(--text2); margin-bottom:18px; }

  .log-box {
    background:#000; border:1px solid var(--border);
    border-radius:12px; padding:14px 16px;
    max-height:160px; overflow-y:auto;
    font-family:var(--mono); font-size:11px; text-align:left;
    scrollbar-width:thin; scrollbar-color:var(--border) transparent;
  }
  .log-line { padding:2.5px 0; display:flex; gap:8px; align-items:baseline; }
  .log-prefix { color:var(--muted); flex-shrink:0; }

  /* Mini log on upload screen */
  .mini-log { margin-top:16px; }

  /* ══ TEST ══ */
  .test-wrap { display:flex; min-height:100vh; position:relative; z-index:1; }

  .sidebar {
    width:256px; flex-shrink:0; background:var(--card);
    border-right:1px solid var(--border); padding:20px 18px;
    display:flex; flex-direction:column; gap:14px;
    position:sticky; top:0; height:100vh; overflow-y:auto;
  }
  .sb-brand { display:flex; align-items:center; gap:10px; padding-bottom:4px; }
  .sb-icon { width:32px; height:32px; border-radius:9px; background:linear-gradient(135deg,#f5b942,#e07b10); display:flex; align-items:center; justify-content:center; font-size:15px; }

  .timer-card {
    background:var(--surface); border:1px solid var(--border2);
    border-radius:14px; padding:14px 12px; text-align:center;
  }
  .timer-lbl { font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:var(--text2); margin-bottom:6px; display:flex; align-items:center; justify-content:center; gap:4px; }
  .timer-val { font-family:var(--mono); font-size:32px; font-weight:600; letter-spacing:3px; }
  .timer-val.red { color:var(--red); animation:blink 1s ease infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }

  .prog-wrap { }
  .prog-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; font-size:11px; color:var(--text2); }
  .prog-pct { font-family:var(--mono); font-weight:600; color:var(--text); }
  .prog-track { height:5px; background:var(--border); border-radius:99px; overflow:hidden; }
  .prog-fill {
    height:100%; border-radius:99px;
    background:linear-gradient(90deg,var(--gold),var(--gold2));
    transition:width 0.5s cubic-bezier(.4,0,.2,1);
  }

  .duo { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .mini-stat { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 6px; text-align:center; }
  .mini-num { font-size:22px; font-weight:800; font-family:var(--mono); line-height:1; }
  .mini-lbl { font-size:9px; text-transform:uppercase; letter-spacing:0.8px; color:var(--text2); margin-top:4px; }

  .nav-grid-label { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:var(--text2); margin-bottom:8px; }
  .nav-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:4px; }
  .nd {
    aspect-ratio:1; border-radius:7px; cursor:pointer;
    font-family:var(--mono); font-size:9px; font-weight:600;
    border:1px solid var(--border); background:var(--surface); color:var(--muted);
    display:flex; align-items:center; justify-content:center; transition:all 0.15s;
  }
  .nd:hover { border-color:var(--gold); color:var(--gold); }
  .nd.ans { background:var(--green-dim); border-color:var(--green); color:var(--green); }
  .nd.cur { background:rgba(240,180,41,0.15); border-color:var(--gold); color:var(--gold); }

  .quit-btn {
    width:100%; margin-top:auto;
    background:var(--red-dim); border:1px solid rgba(240,69,74,0.25);
    color:var(--red); font-family:var(--font); font-weight:700; font-size:13px;
    border-radius:12px; padding:11px; cursor:pointer; transition:all 0.2s;
    display:flex; align-items:center; justify-content:center; gap:7px;
  }
  .quit-btn:hover { background:rgba(240,69,74,0.18); border-color:rgba(240,69,74,0.45); }

  .q-main { flex:1; padding:28px 24px; display:flex; justify-content:center; align-items:flex-start; }

  .q-card {
    width:100%; max-width:680px;
    background:linear-gradient(160deg,#111827 0%,#0c1120 100%);
    border:1px solid var(--border); border-radius:22px; padding:30px;
    box-shadow:0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03);
  }
  .q-topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:22px; }
  .q-pill {
    background:rgba(240,180,41,0.1); border:1px solid rgba(240,180,41,0.25);
    color:var(--gold); font-size:11px; font-weight:700;
    padding:5px 13px; border-radius:99px; font-family:var(--mono);
  }
  .q-answered-badge {
    font-size:11px; font-weight:600; display:flex; align-items:center; gap:5px;
  }
  .q-body { font-size:17px; font-weight:600; line-height:1.7; margin-bottom:22px; color:var(--text); }

  .opt {
    width:100%; display:flex; align-items:flex-start; gap:13px;
    background:rgba(255,255,255,0.02); border:1px solid var(--border);
    border-radius:13px; padding:14px 16px; margin-bottom:9px;
    text-align:left; color:var(--text); cursor:pointer;
    transition:border-color 0.18s, background 0.18s; font-family:var(--font);
  }
  .opt:hover { border-color:var(--border2); background:rgba(255,255,255,0.04); }
  .opt.picked { border-color:var(--gold); background:rgba(240,180,41,0.07); }
  .opt-k {
    min-width:28px; height:28px; border-radius:7px; flex-shrink:0;
    background:var(--border); display:flex; align-items:center; justify-content:center;
    font-family:var(--mono); font-size:12px; font-weight:700; color:var(--text2);
    transition:background 0.18s, color 0.18s;
  }
  .opt.picked .opt-k { background:var(--gold); color:#000; }
  .opt-v { font-size:14px; line-height:1.55; padding-top:4px; }

  .q-footer { display:flex; gap:10px; margin-top:22px; }
  .f-btn {
    flex:1; padding:13px; border-radius:12px; cursor:pointer;
    font-family:var(--font); font-weight:800; font-size:14px;
    border:1px solid var(--border); transition:all 0.2s;
    display:flex; align-items:center; justify-content:center; gap:6px;
  }
  .f-prev { background:var(--surface); color:var(--text2); flex:0.55; }
  .f-prev:hover:not(:disabled) { border-color:var(--border2); color:var(--text); }
  .f-prev:disabled { opacity:0.25; cursor:not-allowed; }
  .f-next { background:linear-gradient(135deg,var(--gold),#e07b10); color:#000; border-color:transparent; }
  .f-next:hover { transform:translateY(-1px); box-shadow:0 8px 24px var(--gold-glow); }
  .f-finish { background:linear-gradient(135deg,var(--green),#08a060); color:#000; border-color:transparent; }
  .f-finish:hover { transform:translateY(-1px); box-shadow:0 8px 24px rgba(14,207,124,0.25); }

  /* ══ RESULTS ══ */
  .res-page { max-width:780px; margin:0 auto; padding:36px 24px; position:relative; z-index:1; }

  .res-top { text-align:center; margin-bottom:36px; }
  .res-eyebrow { font-size:10px; text-transform:uppercase; letter-spacing:2.5px; color:var(--text2); margin-bottom:20px; }
  .ring-wrap { display:flex; justify-content:center; margin-bottom:16px; }
  .ring {
    width:168px; height:168px; border-radius:50%; position:relative;
    display:flex; align-items:center; justify-content:center;
    background:conic-gradient(var(--gold) calc(var(--pct,0) * 1%), var(--border) 0%);
    box-shadow:0 0 40px var(--gold-glow);
  }
  .ring::before { content:''; position:absolute; inset:14px; background:var(--bg); border-radius:50%; }
  .ring-val { position:relative; z-index:1; font-family:var(--mono); font-size:38px; font-weight:700; color:var(--gold); }
  .res-verdict { font-size:15px; font-weight:600; color:var(--text2); }

  .res-4 { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
  .r4 { background:var(--card); border:1px solid var(--border); border-radius:16px; padding:20px 10px; text-align:center; }
  .r4-n { font-size:28px; font-weight:800; font-family:var(--mono); }
  .r4-l { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:var(--text2); margin-top:5px; }

  .res-btns { display:flex; gap:10px; margin-bottom:28px; }
  .r-btn {
    flex:1; padding:13px; border-radius:13px; cursor:pointer;
    font-family:var(--font); font-weight:800; font-size:14px;
    border:1px solid var(--border); transition:all 0.2s;
    display:flex; align-items:center; justify-content:center; gap:8px;
  }
  .r-primary { background:linear-gradient(135deg,var(--gold),#e07b10); color:#000; border-color:transparent; }
  .r-primary:hover { transform:translateY(-1px); box-shadow:0 8px 24px var(--gold-glow); }
  .r-ghost { background:var(--surface); color:var(--text2); }
  .r-ghost:hover { color:var(--text); border-color:var(--border2); }

  .rev-title { font-size:10px; text-transform:uppercase; letter-spacing:2px; color:var(--text2); margin-bottom:12px; }
  .rev-item {
    background:var(--card); border-radius:14px; padding:16px 18px;
    margin-bottom:9px; border-left:3px solid var(--muted); transition:border-color 0.2s;
  }
  .rev-item.c { border-left-color:var(--green); }
  .rev-item.w { border-left-color:var(--red); }
  .rev-meta { font-size:10px; color:var(--text2); font-family:var(--mono); margin-bottom:7px; }
  .rev-q { font-size:14px; font-weight:600; line-height:1.55; margin-bottom:10px; }
  .chips { display:flex; gap:7px; flex-wrap:wrap; }
  .chip { font-size:11px; font-family:var(--mono); padding:3px 10px; border-radius:6px; border:1px solid; }
  .c-yours { background:rgba(77,124,254,0.1); border-color:rgba(77,124,254,0.3); color:#8ab4ff; }
  .c-ans { background:var(--green-dim); border-color:rgba(14,207,124,0.3); color:var(--green); }
  .c-skip { background:rgba(45,53,80,0.5); border-color:var(--muted); color:var(--text2); }

  @media (max-width:768px) {
    .test-wrap { flex-direction:column; }
    .sidebar { width:100%; height:auto; position:relative; border-right:none; border-bottom:1px solid var(--border); }
    .q-main { padding:16px; }
    .res-4 { grid-template-columns:repeat(2,1fr); }
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('exam-v2')) {
  const el = document.createElement('style');
  el.id = 'exam-v2';
  el.textContent = GLOBAL_CSS;
  document.head.appendChild(el);
}

/* ─── QuestionCard ───────────────────────────────────────────────────────── */
const QuestionCard = memo(({ q, qi, total, sel, onSel, onNext, onPrev, onEnd }: any) => (
  <div className="q-card">
    <div className="q-topbar">
      <span className="q-pill">Q {qi + 1} / {total}</span>
      <span className="q-answered-badge" style={{ color: sel ? 'var(--green)' : 'var(--muted)' }}>
        {sel ? <><CheckCircle size={13} /> Answered</> : <><AlertCircle size={13} /> Unanswered</>}
      </span>
    </div>

    <p className="q-body">{q.question}</p>

    {Object.entries(q.options).map(([k, v]: any) => (
      <button key={k} className={`opt${sel === k ? ' picked' : ''}`} onClick={() => onSel(q.id, k)}>
        <span className="opt-k">{k}</span>
        <span className="opt-v">{v}</span>
      </button>
    ))}

    <div className="q-footer">
      <button className="f-btn f-prev" disabled={qi === 0} onClick={onPrev}>
        <ChevronLeft size={15} /> Prev
      </button>
      {qi === total - 1
        ? <button className="f-btn f-finish" onClick={onEnd}><CheckCircle size={14} /> Finish</button>
        : <button className="f-btn f-next" onClick={onNext}>Next <ChevronRight size={15} /></button>}
    </div>
  </div>
));

/* ─── App ────────────────────────────────────────────────────────────────── */
export default function App() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([{ msg: 'Ready.', kind: 'info' }]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [qi, setQi] = useState(0);
  const [clock, setClock] = useState(7200);
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState(() => safeGet('gemini_api_key'));
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const endExam = useCallback(() => setScreen('results'), []);

  useEffect(() => {
    if (screen !== 'test') return;
    const inv = setInterval(() => setClock(c => {
      if (c <= 1) { clearInterval(inv); endExam(); return 0; }
      return c - 1;
    }), 1000);
    return () => clearInterval(inv);
  }, [screen, endExam]);

  const log = (msg: string, kind: LogEntry['kind'] = 'ok') =>
    setLogs(p => [...p, { msg, kind }]);

  const handleFile = async (f: File) => {
    if (f.size / 1024 / 1024 > 4) {
      setCompressing(true);
      log('Large file — compressing...', 'info');
      try {
        const PL = await loadPdfLib();
        const doc = await PL.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        setFile(new File([await doc.save({ useObjectStreams: true })], f.name, { type: 'application/pdf' }));
        log('Compression done', 'ok');
      } catch { setFile(f); log('Compression skipped', 'warn'); }
      setCompressing(false);
    } else {
      setFile(f);
      log(`Loaded: ${f.name}`, 'ok');
    }
  };

  const start = async () => {
    // ✅ FIX: Always trim key before use — prevents "Unknown name 'end !'" URL corruption
    const key = apiKey.replace(/\s+/g, '').trim();
    if (!key) { log('API key is empty', 'err'); return; }

    setLoading(true);
    safeSet('gemini_api_key', key);
    setApiKey(key);

    try {
      const b64 = await new Promise<string>(res => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.readAsDataURL(file!);
      });

      const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
      let raw = '';

      for (const model of models) {
        log(`Trying ${model}...`, 'info');
        try {
          // ✅ FIX: Use cleaned `key` variable (not raw `apiKey` state) in URL
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    text: `Extract all multiple choice questions from this PDF.
Return a valid JSON array only (no markdown, no explanation).
Each object must have exactly these fields:
- "id": integer (1, 2, 3...)
- "question": string (full question text)
- "options": object with keys "A", "B", "C", "D" and string values
- "answer": string — the correct option key, e.g. "A"

Example:
[{"id":1,"question":"What is 2+2?","options":{"A":"3","B":"4","C":"5","D":"6"},"answer":"B"}]`
                  },
                  { inline_data: { mime_type: 'application/pdf', data: b64 } }
                ]
              }]
            })
          });

          const d = await res.json();

          if (d.error) {
            if (d.error.code === 429) { log(`${model}: rate limited`, 'warn'); continue; }
            throw new Error(d.error.message || JSON.stringify(d.error));
          }

          raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
          log(`Response from ${model}`, 'ok');
          break;
        } catch (e: any) {
          log(`${model}: ${e.message}`, 'warn');
        }
      }

      if (!raw) throw new Error('All models failed — check API key and try again');

      const data = safeParseJSON(raw);
      if (!data || data.length === 0) throw new Error('Could not parse questions from this PDF');

      log(`Extracted ${data.length} questions`, 'ok');
      setQuestions(data);
      setSelections({});
      setQi(0);
      setClock(data.length * 90); // 90 seconds per question
      setTimeout(() => setScreen('test'), 400);
    } catch (e: any) {
      log(`Error: ${e.message}`, 'err');
    }
    setLoading(false);
  };

  const stats = useMemo(() => {
    const correct = questions.filter(q => selections[q.id] === q.answer).length;
    const attempted = Object.keys(selections).length;
    const pct = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    return { correct, wrong: attempted - correct, skipped: questions.length - attempted, pct };
  }, [questions, selections]);

  const lc = (k: LogEntry['kind']) =>
    k === 'err' ? '#f0454a' : k === 'ok' ? '#0ecf7c' : k === 'warn' ? '#f5b942' : '#7a84a8';

  /* ── UPLOAD SCREEN ── */
  if (screen === 'upload') {
    const busy = loading || compressing;
    return (
      <div className="up-wrap">
        {busy ? (
          <div className="load-panel">
            <div className="spinner" />
            <div className="load-h">{compressing ? 'Compressing PDF...' : 'Extracting Questions...'}</div>
            <div className="load-s">Powered by Gemini AI — please wait</div>
            <div className="log-box">
              {logs.map((l, i) => (
                <div key={i} className="log-line" style={{ color: lc(l.kind) }}>
                  <span className="log-prefix">›</span>
                  <span>{l.msg}</span>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>
        ) : (
          <div className="up-panel">
            {/* Brand */}
            <div className="up-brand">
              <div className="brand-icon">📝</div>
              <div>
                <div className="brand-name">Exam Simulator</div>
                <div className="brand-sub">AI-powered MCQ practice · Gemini</div>
              </div>
            </div>

            {/* API Key */}
            <div className="section">
              <div className="lbl"><Key size={10} /> Gemini API Key</div>
              <input
                className="key-input"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                onBlur={e => setApiKey(e.target.value.replace(/\s+/g, '').trim())}
                placeholder="AIzaSy..."
                autoComplete="off"
              />
            </div>

            {/* File Drop */}
            <div className="section">
              <div className="lbl"><FileText size={10} /> Upload PDF</div>
              <div
                className={`drop-zone${dragging ? ' dz-active' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                  e.preventDefault(); setDragging(false);
                  const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
                }}
              >
                <input type="file" accept="application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                {file ? (
                  <div className="dz-file">
                    <FileText size={15} />
                    <span className="dz-file-name">{file.name}</span>
                  </div>
                ) : (
                  <>
                    <div className="dz-icon"><Upload size={24} color="var(--text2)" /></div>
                    <div className="dz-text">Drop PDF here or tap to browse</div>
                    <div className="dz-hint">Supports PDF up to 20MB · auto-compressed if large</div>
                  </>
                )}
              </div>
            </div>

            {/* CTA */}
            <button className="go-btn" disabled={!file || !apiKey.trim()} onClick={start}>
              <Zap size={15} /> Generate & Start Test
            </button>

            {/* Inline log */}
            {logs.length > 1 && (
              <div className="log-box mini-log">
                {logs.map((l, i) => (
                  <div key={i} className="log-line" style={{ color: lc(l.kind) }}>
                    <span className="log-prefix">›</span><span>{l.msg}</span>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ── TEST SCREEN ── */
  if (screen === 'test') {
    const answered = Object.keys(selections).length;
    const pct = Math.round((answered / questions.length) * 100);

    return (
      <div className="test-wrap">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sb-brand">
            <div className="sb-icon">📝</div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Exam Mode</span>
          </div>

          <div className="timer-card">
            <div className="timer-lbl"><Clock size={9} /> Time Remaining</div>
            <div className={`timer-val${clock < 300 ? ' red' : ''}`}>{fmt(clock)}</div>
          </div>

          <div className="prog-wrap">
            <div className="prog-top">
              <span>Progress</span>
              <span className="prog-pct">{pct}%</span>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="duo">
            <div className="mini-stat">
              <div className="mini-num" style={{ color: 'var(--green)' }}>{answered}</div>
              <div className="mini-lbl">Done</div>
            </div>
            <div className="mini-stat">
              <div className="mini-num" style={{ color: 'var(--muted)' }}>{questions.length - answered}</div>
              <div className="mini-lbl">Left</div>
            </div>
          </div>

          <div>
            <div className="nav-grid-label">Navigator</div>
            <div className="nav-grid">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`nd${selections[q.id] ? ' ans' : ''}${i === qi ? ' cur' : ''}`}
                  onClick={() => setQi(i)}
                  title={`Question ${i + 1}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          <button className="quit-btn" onClick={endExam}>
            <XCircle size={13} /> End Exam
          </button>
        </div>

        {/* Main */}
        <div className="q-main">
          <QuestionCard
            q={questions[qi]}
            qi={qi}
            total={questions.length}
            sel={selections[questions[qi]?.id]}
            onSel={(id: number, opt: string) => setSelections(p => ({ ...p, [id]: opt }))}
            onNext={() => setQi(i => Math.min(i + 1, questions.length - 1))}
            onPrev={() => setQi(i => Math.max(i - 1, 0))}
            onEnd={endExam}
          />
        </div>
      </div>
    );
  }

  /* ── RESULTS SCREEN ── */
  return (
    <div className="res-page">
      {/* Hero */}
      <div className="res-top">
        <div className="res-eyebrow">Exam Complete</div>
        <div className="ring-wrap">
          <div className="ring" style={{ '--pct': stats.pct } as any}>
            <span className="ring-val">{stats.pct}%</span>
          </div>
        </div>
        <div className="res-verdict">
          {stats.pct >= 80 ? '🎉 Outstanding — great work!' :
           stats.pct >= 60 ? '👍 Solid effort — keep it up!' :
           stats.pct >= 40 ? '📖 More practice needed' :
           '💪 Don\'t give up — try again!'}
        </div>
      </div>

      {/* Stats */}
      <div className="res-4">
        <div className="r4">
          <div className="r4-n" style={{ color: 'var(--green)' }}>{stats.correct}</div>
          <div className="r4-l">Correct</div>
        </div>
        <div className="r4">
          <div className="r4-n" style={{ color: 'var(--red)' }}>{stats.wrong}</div>
          <div className="r4-l">Wrong</div>
        </div>
        <div className="r4">
          <div className="r4-n" style={{ color: 'var(--text2)' }}>{stats.skipped}</div>
          <div className="r4-l">Skipped</div>
        </div>
        <div className="r4">
          <div className="r4-n" style={{ color: 'var(--gold)' }}>{questions.length}</div>
          <div className="r4-l">Total</div>
        </div>
      </div>

      {/* Actions */}
      <div className="res-btns">
        <button className="r-btn r-primary" onClick={() => {
          setScreen('upload'); setFile(null);
          setQuestions([]); setSelections({});
          setLogs([{ msg: 'Ready.', kind: 'info' }]);
        }}>
          <RotateCcw size={14} /> New Test
        </button>
        <button className="r-btn r-ghost" onClick={() => { setScreen('test'); setQi(0); }}>
          <BookOpen size={14} /> Review Answers
        </button>
      </div>

      {/* Question Review */}
      <div className="rev-title">Question Review</div>
      {questions.map((q, i) => {
        const yours = selections[q.id];
        const correct = yours === q.answer;
        const status = !yours ? 'skip' : correct ? 'c' : 'w';
        return (
          <div key={q.id} className={`rev-item ${status}`}>
            <div className="rev-meta">
              Q{i + 1} &nbsp;·&nbsp;
              {status === 'c' ? '✓ Correct' : status === 'w' ? '✗ Wrong' : '— Not Attempted'}
            </div>
            <div className="rev-q">{q.question}</div>
            <div className="chips">
              {yours && !correct && <span className="chip c-yours">Your answer: {yours}</span>}
              <span className="chip c-ans">Correct: {q.answer}</span>
              {!yours && <span className="chip c-skip">Skipped</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
