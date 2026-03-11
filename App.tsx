import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import html2pdf from 'html2pdf.js';
import { FileText, Download, CheckCircle, XCircle, Clock, BookOpen, ChevronLeft, ChevronRight, Eye, EyeOff, Zap, AlertTriangle, RotateCcw, FileWarning } from 'lucide-react';

interface Question { id: number; question: string; options: Record<string, string>; answer: string; }
type Screen = 'upload' | 'test' | 'results';
interface LogEntry { msg: string; kind: 'ok' | 'err' | 'warn' | 'info'; }

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
    s.onerror = () => rej(new Error("CDN Load Failed"));
    document.head.appendChild(s);
  });
};

const GLOBAL_CSS = `
  :root { --bg: #07090f; --surface: #0d1019; --card: #111520; --border: #1c2238; --gold: #f5b945; --green: #2ecc71; --red: #e74c3c; --text: #e8eaf6; --muted: #5a6280; }
  body { background: var(--bg); color: var(--text); font-family: sans-serif; margin: 0; }
  .upload-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 20px; padding: 30px; width: 100%; max-width: 400px; }
  .input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; color: #fff; margin-bottom: 15px; }
  .drop-zone { background: var(--surface); border: 2px dashed var(--border); border-radius: 12px; padding: 25px; text-align: center; cursor: pointer; margin-bottom: 20px; }
  .btn { width: 100%; background: var(--gold); color: #000; font-weight: 800; border: none; border-radius: 12px; padding: 15px; cursor: pointer; }
  .log-box { background: #000; border: 1px solid var(--border); border-radius: 8px; padding: 12px; height: 140px; overflow-y: auto; font-family: monospace; font-size: 11px; margin-top: 15px; }
  .test-layout { display: flex; gap: 20px; max-width: 900px; margin: 0 auto; padding: 20px; }
  .sidebar { width: 200px; display: flex; flex-direction: column; gap: 15px; }
  .q-card { flex: 1; background: var(--card); border-radius: 18px; padding: 25px; border: 1px solid var(--border); }
  .opt { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 8px; text-align: left; color: #fff; cursor: pointer; display: flex; gap: 10px; }
  .opt.sel { border-color: var(--gold); background: rgba(245,185,69,0.1); }
  .score-hero { background: var(--card); border-radius: 20px; padding: 40px; text-align: center; margin-bottom: 20px; border: 1px solid var(--border); }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner { width: 35px; height: 35px; border: 3px solid var(--border); border-top-color: var(--gold); border-radius: 50%; margin: 0 auto 15px; animation: spin 0.8s linear infinite; }
  @media (max-width: 700px) { .test-layout { flex-direction: column; } .sidebar { width: 100%; } }
`;

if (typeof document !== 'undefined' && !document.getElementById('app-styles')) {
  const el = document.createElement('style'); el.id = 'app-styles'; el.textContent = GLOBAL_CSS; document.head.appendChild(el);
}

const QuestionCard = memo(({ q, qIndex, total, selection, onSelect, onNext, onPrev, onEnd }: any) => (
  <div className="q-card">
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}>
      <span style={{ color: 'var(--gold)', fontWeight: 700 }}>Q {qIndex + 1} / {total}</span>
      <span style={{ fontSize: 12, color: selection ? 'var(--green)' : 'var(--muted)' }}>{selection ? '✓ Answered' : 'Unanswered'}</span>
    </div>
    <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, marginBottom: 20 }}>{q.question}</p>
    {Object.entries(q.options).map(([k, v]: any) => (
      <button key={k} className={`opt${selection === k ? ' sel' : ''}`} onClick={() => onSelect(q.id, k)}>
        <b style={{ color: 'var(--gold)' }}>{k}</b> <span>{v}</span>
      </button>
    ))}
    <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
      <button className="btn" style={{ background: 'var(--surface)', color: '#fff', flex: 1 }} disabled={qIndex === 0} onClick={onPrev}>Prev</button>
      <button className="btn" style={{ flex: 2 }} onClick={qIndex === total - 1 ? onEnd : onNext}>{qIndex === total - 1 ? 'Finish' : 'Next'}</button>
    </div>
  </div>
));

export default function App() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([{ msg: 'Ready', kind: 'info' }]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [clock, setClock] = useState(7200);
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState<string>(() => safeGet('gemini_api_key'));
  const [aiExs, setAiExs] = useState<Record<number, string>>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView(); }, [logs]);
  const endExam = useCallback(() => setScreen('results'), []);
  useEffect(() => {
    if (screen !== 'test') return;
    const inv = setInterval(() => setClock(c => { if (c <= 1) { clearInterval(inv); endExam(); return 0; } return c - 1; }), 1000);
    return () => clearInterval(inv);
  }, [screen, endExam]);

  const addLog = (msg: string, kind: LogEntry['kind'] = 'ok') => setLogs(p => [...p, { msg, kind }]);

  const onFile = async (e: any) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size / 1024 / 1024 > 4) {
      setCompressing(true); addLog('Large PDF. Compressing...', 'info');
      try {
        const PL = await loadPdfLib();
        const doc = await PL.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        setFile(new File([await doc.save({ useObjectStreams: true })], f.name, { type: 'application/pdf' }));
        addLog('✓ Compressed', 'ok');
      } catch { setFile(f); addLog('Compression failed', 'warn'); }
      setCompressing(false);
    } else setFile(f);
  };

  const start = async () => {
    setLoading(true); safeSet('gemini_api_key', apiKey.trim());
    try {
      const b64 = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]); r.readAsDataURL(file!); });
      const mods = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
      let raw = "";
      for (const m of mods) {
        addLog(`Trying ${m}...`, 'info');
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
          method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'Extract MCQs as JSON array only.' }, { inline_data: { mime_type: 'application/pdf', data: b64 } }] }] })
        });
        const d = await res.json();
        if (d.error?.code === 429) continue;
        raw = d.candidates[0].content.parts[0].text; break;
      }
      const data = safeParseJSON(raw);
      if (!data) throw new Error("Parse Error");
      setQuestions(data); setScreen('test');
    } catch (e: any) { addLog(e.message, 'err'); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {screen === 'upload' && (
        <div className="upload-wrap">
          {loading || compressing ? (
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="spinner" />
              <b>{compressing ? 'Compressing...' : 'Extracting...'}</b>
              <div className="log-box">{logs.map((l, i) => <div key={i} style={{ color: l.kind === 'err' ? 'var(--red)' : l.kind === 'ok' ? 'var(--green)' : '#888' }}>› {l.msg}</div>)}<div ref={endRef} /></div>
            </div>
          ) : (
            <div className="card">
              <h2 style={{ textAlign: 'center', margin: '0 0 20px' }}>Exam Simulator</h2>
              <input className="input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="API Key" />
              <div className="drop-zone"><input type="file" accept="application/pdf" style={{ position: 'absolute', inset: 0, opacity: 0 }} onChange={onFile} />{file ? file.name : 'Choose PDF'}</div>
              <button className="btn" disabled={!file || !apiKey} onClick={start}>Start Test</button>
            </div>
          )}
        </div>
      )}
      {screen === 'test' && (
        <div className="test-layout">
          <div className="sidebar">
            <div className="card" style={{ padding: 15 }}>Time: {Math.floor(clock / 60)}:{(clock % 60).toString().padStart(2, '0')}</div>
            <button className="btn" style={{ background: 'var(--red)', color: '#fff' }} onClick={endExam}>End Test</button>
          </div>
          <QuestionCard q={questions[qIndex]} qIndex={qIndex} total={questions.length} selection={selections[questions[qIndex].id]} onSelect={(id: any, o: any) => setSelections(p => ({ ...p, [id]: o }))} onNext={() => setQIndex(qIndex + 1)} onPrev={() => setQIndex(qIndex - 1)} onEnd={endExam} />
        </div>
      )}
      {screen === 'results' && (
        <div style={{ maxWidth: 700, margin: '0 auto', padding: 20 }}>
          <div className="score-hero">
            <h1 style={{ fontSize: 60, color: 'var(--gold)' }}>{Math.round((Object.values(selections).filter((s, i) => s === questions[i].answer).length / questions.length) * 100)}%</h1>
            <button className="btn" style={{ width: 'auto', padding: '10px 30px' }} onClick={() => setScreen('upload')}>New Test</button>
          </div>
          {questions.map((q, i) => (
            <div key={q.id} style={{ background: 'var(--card)', padding: 15, borderRadius: 12, marginBottom: 10, borderLeft: `4px solid ${selections[q.id] === q.answer ? 'var(--green)' : 'var(--red)'}` }}>
              <p style={{ margin: '0 0 10px', fontSize: 14 }}>{i + 1}. {q.question}</p>
              <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                <div style={{ background: 'var(--surface)', padding: '5px 10px', borderRadius: 5 }}>Yours: {selections[q.id] || 'N/A'}</div>
                <div style={{ background: 'var(--surface)', padding: '5px 10px', borderRadius: 5 }}>Correct: {q.answer}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
