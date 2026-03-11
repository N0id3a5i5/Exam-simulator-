import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, Upload, AlertCircle, RotateCcw, Zap, FileText, BookOpen } from 'lucide-react';

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
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#060810; --surface:#0b0e18; --card:#0f1320; --card2:#141829;
    --border:#1e2540; --border2:#252d4a; --gold:#f0b429; --gold2:#ffd166;
    --green:#0ecf7c; --red:#f0454a; --blue:#4d7cfe;
    --text:#e6e9f8; --text2:#8892b8; --muted:#3d4a6e;
    --font:'Syne',sans-serif; --mono:'JetBrains Mono',monospace;
  }
  body { background:var(--bg); color:var(--text); font-family:var(--font); min-height:100vh; overflow-x:hidden; }
  body::before {
    content:''; position:fixed; top:-200px; left:-200px; width:600px; height:600px;
    background:radial-gradient(circle,rgba(77,124,254,0.06) 0%,transparent 70%);
    pointer-events:none; z-index:0;
  }
  body::after {
    content:''; position:fixed; bottom:-200px; right:-200px; width:600px; height:600px;
    background:radial-gradient(circle,rgba(240,180,41,0.05) 0%,transparent 70%);
    pointer-events:none; z-index:0;
  }

  /* Upload */
  .up-wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; position:relative; z-index:1; }
  .up-panel { width:100%; max-width:440px; background:var(--card); border:1px solid var(--border); border-radius:24px; padding:36px; box-shadow:0 24px 64px rgba(0,0,0,0.5); }
  .up-logo { display:flex; align-items:center; gap:10px; margin-bottom:28px; }
  .up-logo-icon { width:40px; height:40px; border-radius:10px; background:linear-gradient(135deg,var(--gold) 0%,#e6850a 100%); display:flex; align-items:center; justify-content:center; font-size:18px; }
  .up-title { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
  .up-sub { font-size:13px; color:var(--text2); margin-top:2px; }
  .field-label { font-size:11px; font-weight:600; letter-spacing:1px; color:var(--text2); text-transform:uppercase; margin-bottom:8px; display:block; }
  .api-input { width:100%; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:12px 14px; color:var(--text); font-family:var(--mono); font-size:13px; outline:none; transition:border-color 0.2s; margin-bottom:20px; }
  .api-input:focus { border-color:var(--blue); }
  .drop-zone { background:var(--surface); border:1.5px dashed var(--border2); border-radius:12px; padding:28px 20px; text-align:center; cursor:pointer; transition:all 0.2s; position:relative; margin-bottom:20px; overflow:hidden; }
  .drop-zone:hover,.drop-zone.active { border-color:var(--gold); background:rgba(240,180,41,0.04); }
  .drop-zone input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
  .drop-file { display:flex; align-items:center; gap:8px; justify-content:center; color:var(--gold); font-weight:600; font-size:14px; }
  .start-btn { width:100%; padding:14px; background:linear-gradient(135deg,var(--gold) 0%,#e6a020 100%); color:#000; font-family:var(--font); font-weight:800; font-size:15px; letter-spacing:0.3px; border:none; border-radius:12px; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:8px; }
  .start-btn:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 8px 24px rgba(240,180,41,0.3); }
  .start-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
  .load-panel { width:100%; max-width:440px; background:var(--card); border:1px solid var(--border); border-radius:24px; padding:36px; text-align:center; }
  .spinner { width:44px; height:44px; border:3px solid var(--border2); border-top-color:var(--gold); border-radius:50%; margin:0 auto 20px; animation:spin 0.7s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .load-title { font-size:16px; font-weight:700; margin-bottom:4px; }
  .load-sub { font-size:12px; color:var(--text2); margin-bottom:16px; }
  .log-box { background:#000; border:1px solid var(--border); border-radius:10px; padding:12px 14px; height:150px; overflow-y:auto; font-family:var(--mono); font-size:11px; text-align:left; }

  /* Test */
  .test-wrap { display:flex; min-height:100vh; position:relative; z-index:1; }
  .test-sidebar { width:260px; flex-shrink:0; background:var(--card); border-right:1px solid var(--border); padding:20px; display:flex; flex-direction:column; gap:16px; position:sticky; top:0; height:100vh; overflow-y:auto; }
  .sb-brand { display:flex; align-items:center; gap:8px; }
  .sb-icon { width:28px; height:28px; border-radius:7px; background:linear-gradient(135deg,var(--gold),#e6a020); display:flex; align-items:center; justify-content:center; font-size:13px; }
  .timer-box { background:var(--surface); border:1px solid var(--border2); border-radius:12px; padding:14px; text-align:center; }
  .timer-label { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--text2); margin-bottom:4px; display:flex; align-items:center; justify-content:center; gap:4px; }
  .timer-val { font-family:var(--mono); font-size:30px; font-weight:500; letter-spacing:2px; }
  .timer-val.urgent { color:var(--red); animation:pulse 1s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
  .prog-row { display:flex; justify-content:space-between; font-size:11px; color:var(--text2); margin-bottom:6px; }
  .prog-track { height:5px; background:var(--border); border-radius:9px; overflow:hidden; }
  .prog-fill { height:100%; background:linear-gradient(90deg,var(--gold),var(--gold2)); border-radius:9px; transition:width 0.4s ease; }
  .stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .stat-chip { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 8px; text-align:center; }
  .stat-num { font-size:20px; font-weight:800; font-family:var(--mono); }
  .stat-lbl { font-size:10px; color:var(--text2); margin-top:2px; text-transform:uppercase; letter-spacing:0.5px; }
  .q-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:5px; }
  .q-dot { aspect-ratio:1; border-radius:6px; font-family:var(--mono); font-size:10px; font-weight:500; border:1px solid var(--border); background:var(--surface); color:var(--text2); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s; }
  .q-dot:hover { border-color:var(--gold); color:var(--gold); }
  .q-dot.answered { background:rgba(14,207,124,0.12); border-color:var(--green); color:var(--green); }
  .q-dot.current { background:rgba(240,180,41,0.15); border-color:var(--gold); color:var(--gold); }
  .end-btn { width:100%; background:rgba(240,69,74,0.1); border:1px solid rgba(240,69,74,0.3); color:var(--red); font-family:var(--font); font-weight:700; border-radius:12px; padding:12px; cursor:pointer; transition:all 0.2s; font-size:14px; display:flex; align-items:center; justify-content:center; gap:6px; }
  .end-btn:hover { background:rgba(240,69,74,0.2); }
  .test-main { flex:1; padding:32px; display:flex; align-items:flex-start; justify-content:center; }
  .q-panel { width:100%; max-width:660px; background:var(--card); border:1px solid var(--border); border-radius:24px; padding:32px; box-shadow:0 16px 48px rgba(0,0,0,0.3); }
  .q-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; }
  .q-badge { background:rgba(240,180,41,0.12); border:1px solid rgba(240,180,41,0.3); color:var(--gold); font-size:12px; font-weight:700; padding:5px 12px; border-radius:20px; font-family:var(--mono); }
  .q-status { font-size:12px; font-weight:600; display:flex; align-items:center; gap:5px; }
  .q-text { font-size:17px; font-weight:600; line-height:1.65; margin-bottom:24px; }
  .opt-btn { width:100%; display:flex; align-items:flex-start; gap:14px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-bottom:10px; text-align:left; color:var(--text); cursor:pointer; transition:all 0.18s; font-family:var(--font); }
  .opt-btn:hover { border-color:var(--border2); background:var(--card2); }
  .opt-btn.sel { border-color:var(--gold); background:rgba(240,180,41,0.08); }
  .opt-key { min-width:26px; height:26px; border-radius:6px; background:var(--border); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; color:var(--text2); flex-shrink:0; font-family:var(--mono); transition:all 0.18s; }
  .opt-btn.sel .opt-key { background:var(--gold); color:#000; }
  .opt-val { font-size:14px; line-height:1.5; padding-top:3px; }
  .q-nav { display:flex; gap:10px; margin-top:24px; }
  .nav-btn { flex:1; padding:12px; border-radius:12px; font-family:var(--font); font-weight:700; font-size:14px; cursor:pointer; transition:all 0.2s; border:1px solid var(--border); display:flex; align-items:center; justify-content:center; gap:6px; }
  .nav-prev { background:var(--surface); color:var(--text2); flex:0.6; }
  .nav-prev:hover:not(:disabled) { border-color:var(--border2); color:var(--text); }
  .nav-prev:disabled { opacity:0.3; cursor:not-allowed; }
  .nav-next { background:linear-gradient(135deg,var(--gold),#e6a020); color:#000; border-color:transparent; flex:1; }
  .nav-next:hover { box-shadow:0 6px 20px rgba(240,180,41,0.3); transform:translateY(-1px); }
  .nav-finish { background:linear-gradient(135deg,var(--green),#08a85e); color:#000; border-color:transparent; flex:1; }
  .nav-finish:hover { box-shadow:0 6px 20px rgba(14,207,124,0.3); transform:translateY(-1px); }

  /* Results */
  .res-wrap { max-width:760px; margin:0 auto; padding:32px 24px; position:relative; z-index:1; }
  .res-hero { text-align:center; margin-bottom:32px; }
  .res-eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:2px; color:var(--text2); margin-bottom:16px; }
  .score-ring { display:inline-flex; align-items:center; justify-content:center; width:160px; height:160px; border-radius:50%; background:conic-gradient(var(--gold) calc(var(--pct,0) * 1%),var(--border) 0%); position:relative; margin:0 auto 12px; }
  .score-ring::before { content:''; position:absolute; inset:12px; background:var(--bg); border-radius:50%; }
  .score-ring-val { position:relative; z-index:1; font-size:36px; font-weight:800; color:var(--gold); font-family:var(--mono); }
  .res-msg { font-size:14px; color:var(--text2); margin-top:8px; }
  .res-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
  .res-stat { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:18px; text-align:center; }
  .res-stat-num { font-size:26px; font-weight:800; font-family:var(--mono); }
  .res-stat-lbl { font-size:10px; color:var(--text2); margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; }
  .res-actions { display:flex; gap:10px; margin-bottom:28px; }
  .res-btn { flex:1; padding:12px; border-radius:12px; font-family:var(--font); font-weight:700; font-size:14px; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:8px; border:1px solid var(--border); }
  .res-btn-primary { background:linear-gradient(135deg,var(--gold),#e6a020); color:#000; border-color:transparent; }
  .res-btn-primary:hover { box-shadow:0 6px 20px rgba(240,180,41,0.3); transform:translateY(-1px); }
  .res-btn-ghost { background:var(--surface); color:var(--text2); }
  .res-btn-ghost:hover { color:var(--text); border-color:var(--border2); }
  .review-title { font-size:11px; text-transform:uppercase; letter-spacing:1.5px; color:var(--text2); margin-bottom:12px; }
  .res-q { background:var(--card); border-radius:14px; padding:16px 18px; margin-bottom:10px; border-left:3px solid var(--muted); }
  .res-q.correct { border-left-color:var(--green); }
  .res-q.wrong { border-left-color:var(--red); }
  .res-q-meta { font-size:11px; color:var(--text2); font-family:var(--mono); margin-bottom:6px; }
  .res-q-text { font-size:14px; font-weight:600; margin-bottom:10px; line-height:1.5; }
  .chip-row { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { font-size:12px; font-family:var(--mono); font-weight:500; padding:4px 10px; border-radius:6px; border:1px solid; }
  .chip-yours { background:rgba(77,124,254,0.1); border-color:rgba(77,124,254,0.3); color:#7fa8ff; }
  .chip-ans { background:rgba(14,207,124,0.1); border-color:rgba(14,207,124,0.3); color:var(--green); }
  .chip-skip { background:rgba(61,74,110,0.3); border-color:var(--muted); color:var(--text2); }

  @media (max-width:768px) {
    .test-wrap { flex-direction:column; }
    .test-sidebar { width:100%; height:auto; position:relative; border-right:none; border-bottom:1px solid var(--border); }
    .test-main { padding:16px; }
    .res-stats { grid-template-columns:repeat(2,1fr); }
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('exam-styles')) {
  const el = document.createElement('style');
  el.id = 'exam-styles';
  el.textContent = GLOBAL_CSS;
  document.head.appendChild(el);
}

/* ─── QuestionCard ───────────────────────────────────────────────────────── */
const QuestionCard = memo(({ q, qIndex, total, selection, onSelect, onNext, onPrev, onEnd }: any) => (
  <div className="q-panel">
    <div className="q-head">
      <span className="q-badge">Q {qIndex + 1} / {total}</span>
      <span className="q-status" style={{ color: selection ? 'var(--green)' : 'var(--muted)' }}>
        {selection
          ? <><CheckCircle size={13} /> Answered</>
          : <><AlertCircle size={13} /> Unanswered</>}
      </span>
    </div>

    <p className="q-text">{q.question}</p>

    {Object.entries(q.options).map(([k, v]: any) => (
      <button
        key={k}
        className={`opt-btn${selection === k ? ' sel' : ''}`}
        onClick={() => onSelect(q.id, k)}
      >
        <span className="opt-key">{k}</span>
        <span className="opt-val">{v}</span>
      </button>
    ))}

    <div className="q-nav">
      <button className="nav-btn nav-prev" disabled={qIndex === 0} onClick={onPrev}>
        <ChevronLeft size={15} /> Prev
      </button>
      {qIndex === total - 1
        ? <button className="nav-btn nav-finish" onClick={onEnd}><CheckCircle size={15} /> Finish</button>
        : <button className="nav-btn nav-next" onClick={onNext}>Next <ChevronRight size={15} /></button>}
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
  const [qIndex, setQIndex] = useState(0);
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

  const addLog = (msg: string, kind: LogEntry['kind'] = 'ok') =>
    setLogs(p => [...p, { msg, kind }]);

  const handleFile = async (f: File) => {
    if (f.size / 1024 / 1024 > 4) {
      setCompressing(true);
      addLog('Large file — compressing…', 'info');
      try {
        const PL = await loadPdfLib();
        const doc = await PL.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        setFile(new File([await doc.save({ useObjectStreams: true })], f.name, { type: 'application/pdf' }));
        addLog('✓ Compressed', 'ok');
      } catch { setFile(f); addLog('⚠ Compression skipped', 'warn'); }
      setCompressing(false);
    } else {
      setFile(f);
      addLog(`✓ Loaded: ${f.name}`, 'ok');
    }
  };

  const start = async () => {
    setLoading(true);
    safeSet('gemini_api_key', apiKey.trim());
    try {
      const b64 = await new Promise<string>(res => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.readAsDataURL(file!);
      });
      const models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
      let raw = '';
      for (const m of models) {
        addLog(`Trying ${m}…`, 'info');
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: 'Extract all MCQs from this PDF as a JSON array. Each item must have: id (number), question (string), options (object with keys A/B/C/D), answer (string e.g. "A"). Return ONLY valid JSON array, no markdown fences.' },
                  { inline_data: { mime_type: 'application/pdf', data: b64 } }
                ]
              }]
            })
          }
        );
        const d = await res.json();
        if (d.error) {
          if (d.error.code === 429) { addLog(`${m}: rate limited, trying next…`, 'warn'); continue; }
          throw new Error(d.error.message);
        }
        raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        addLog(`✓ Got response from ${m}`, 'ok');
        break;
      }
      const data = safeParseJSON(raw);
      if (!data || data.length === 0) throw new Error('Could not parse questions — check PDF content');
      addLog(`✓ Extracted ${data.length} questions`, 'ok');
      setQuestions(data);
      setSelections({});
      setQIndex(0);
      setClock(7200);
      setTimeout(() => setScreen('test'), 400);
    } catch (e: any) {
      addLog(`✗ ${e.message}`, 'err');
    }
    setLoading(false);
  };

  const stats = useMemo(() => {
    const correct = questions.filter(q => selections[q.id] === q.answer).length;
    const attempted = Object.keys(selections).length;
    const wrong = attempted - correct;
    const skipped = questions.length - attempted;
    const pct = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    return { correct, wrong, skipped, pct };
  }, [questions, selections]);

  const logColor = (k: LogEntry['kind']) =>
    k === 'err' ? '#f0454a' : k === 'ok' ? '#0ecf7c' : k === 'warn' ? '#f0b429' : '#8892b8';

  /* ── UPLOAD ── */
  if (screen === 'upload') {
    return (
      <div className="up-wrap">
        {loading || compressing ? (
          <div className="load-panel">
            <div className="spinner" />
            <div className="load-title">{compressing ? 'Compressing PDF…' : 'Extracting Questions…'}</div>
            <div className="load-sub">This may take a few seconds</div>
            <div className="log-box">
              {logs.map((l, i) => (
                <div key={i} style={{ padding: '2px 0', color: logColor(l.kind), display: 'flex', gap: 6 }}>
                  <span style={{ color: 'var(--muted)' }}>›</span>{l.msg}
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>
        ) : (
          <div className="up-panel">
            <div className="up-logo">
              <div className="up-logo-icon">📝</div>
              <div>
                <div className="up-title">Exam Simulator</div>
                <div className="up-sub">AI-powered MCQ practice</div>
              </div>
            </div>

            <label className="field-label">Gemini API Key</label>
            <input
              className="api-input"
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIzaSy…"
            />

            <label className="field-label">Upload PDF</label>
            <div
              className={`drop-zone${dragging ? ' active' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
            >
              <input type="file" accept="application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {file ? (
                <div className="drop-file"><FileText size={15} />{file.name}</div>
              ) : (
                <>
                  <div style={{ marginBottom: 8 }}><Upload size={26} color="var(--text2)" /></div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Drop PDF here or click to browse</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>Supports PDF up to 20MB</div>
                </>
              )}
            </div>

            <button className="start-btn" disabled={!file || !apiKey.trim()} onClick={start}>
              <Zap size={15} /> Generate & Start Test
            </button>

            {logs.length > 1 && (
              <div className="log-box" style={{ marginTop: 16 }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ padding: '2px 0', color: logColor(l.kind), display: 'flex', gap: 6 }}>
                    <span style={{ color: 'var(--muted)' }}>›</span>{l.msg}
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

  /* ── TEST ── */
  if (screen === 'test') {
    const answered = Object.keys(selections).length;
    const progress = Math.round((answered / questions.length) * 100);

    return (
      <div className="test-wrap">
        <div className="test-sidebar">
          <div className="sb-brand">
            <div className="sb-icon">📝</div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Exam Mode</span>
          </div>

          <div className="timer-box">
            <div className="timer-label"><Clock size={10} /> Time Left</div>
            <div className={`timer-val${clock < 300 ? ' urgent' : ''}`}>{fmt(clock)}</div>
          </div>

          <div>
            <div className="prog-row">
              <span>Progress</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{progress}%</span>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-chip">
              <div className="stat-num" style={{ color: 'var(--green)' }}>{answered}</div>
              <div className="stat-lbl">Done</div>
            </div>
            <div className="stat-chip">
              <div className="stat-num" style={{ color: 'var(--muted)' }}>{questions.length - answered}</div>
              <div className="stat-lbl">Left</div>
            </div>
          </div>

          <div>
            <label className="field-label" style={{ marginBottom: 8 }}>Navigator</label>
            <div className="q-grid">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`q-dot${selections[q.id] ? ' answered' : ''}${i === qIndex ? ' current' : ''}`}
                  onClick={() => setQIndex(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          <button className="end-btn" style={{ marginTop: 'auto' }} onClick={endExam}>
            <XCircle size={14} /> End Exam
          </button>
        </div>

        <div className="test-main">
          <QuestionCard
            q={questions[qIndex]}
            qIndex={qIndex}
            total={questions.length}
            selection={selections[questions[qIndex]?.id]}
            onSelect={(id: number, opt: string) => setSelections(p => ({ ...p, [id]: opt }))}
            onNext={() => setQIndex(i => Math.min(i + 1, questions.length - 1))}
            onPrev={() => setQIndex(i => Math.max(i - 1, 0))}
            onEnd={endExam}
          />
        </div>
      </div>
    );
  }

  /* ── RESULTS ── */
  return (
    <div className="res-wrap">
      <div className="res-hero">
        <div className="res-eyebrow">Test Completed</div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="score-ring" style={{ '--pct': stats.pct } as any}>
            <span className="score-ring-val">{stats.pct}%</span>
          </div>
        </div>
        <div className="res-msg">
          {stats.pct >= 80 ? '🎉 Excellent performance!' : stats.pct >= 60 ? '👍 Good effort — keep pushing!' : '📚 Review the material and try again!'}
        </div>
      </div>

      <div className="res-stats">
        <div className="res-stat">
          <div className="res-stat-num" style={{ color: 'var(--green)' }}>{stats.correct}</div>
          <div className="res-stat-lbl">Correct</div>
        </div>
        <div className="res-stat">
          <div className="res-stat-num" style={{ color: 'var(--red)' }}>{stats.wrong}</div>
          <div className="res-stat-lbl">Wrong</div>
        </div>
        <div className="res-stat">
          <div className="res-stat-num" style={{ color: 'var(--text2)' }}>{stats.skipped}</div>
          <div className="res-stat-lbl">Skipped</div>
        </div>
        <div className="res-stat">
          <div className="res-stat-num" style={{ color: 'var(--gold)' }}>{questions.length}</div>
          <div className="res-stat-lbl">Total</div>
        </div>
      </div>

      <div className="res-actions">
        <button className="res-btn res-btn-primary" onClick={() => {
          setScreen('upload'); setQuestions([]); setSelections({});
          setFile(null); setLogs([{ msg: 'Ready.', kind: 'info' }]);
        }}>
          <RotateCcw size={15} /> New Test
        </button>
        <button className="res-btn res-btn-ghost" onClick={() => { setScreen('test'); setQIndex(0); }}>
          <BookOpen size={15} /> Review Answers
        </button>
      </div>

      <div className="review-title">Question Review</div>
      {questions.map((q, i) => {
        const yours = selections[q.id];
        const status = !yours ? 'skipped' : yours === q.answer ? 'correct' : 'wrong';
        return (
          <div key={q.id} className={`res-q ${status}`}>
            <div className="res-q-meta">
              Q{i + 1} · {status === 'correct' ? '✓ Correct' : status === 'wrong' ? '✗ Wrong' : '— Skipped'}
            </div>
            <div className="res-q-text">{q.question}</div>
            <div className="chip-row">
              {yours && yours !== q.answer && <span className="chip chip-yours">Your: {yours}</span>}
              <span className="chip chip-ans">Answer: {q.answer}</span>
              {!yours && <span className="chip chip-skip">Not attempted</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
