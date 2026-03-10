import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import html2pdf from 'html2pdf.js';
import { FileText, Home, Download, Loader2, CheckCircle, XCircle, Clock, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';

interface Question {
  id: number;
  question: string;
  options: Record<string, string>;
  answer: string;
}

type Screen = 'upload' | 'test' | 'results';

// ── Inject global styles ──────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap');

  :root {
    --bg:       #07090f;
    --surface:  #0e1220;
    --card:     #141828;
    --border:   #1e2640;
    --gold:     #f5b945;
    --gold2:    #e8a020;
    --blue:     #3b6cf7;
    --green:    #2ecc71;
    --red:      #e74c3c;
    --text:     #e8eaf6;
    --muted:    #6b7394;
    --radius:   16px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Sora', sans-serif;
    min-height: 100vh;
  }

  .mono { font-family: 'JetBrains Mono', monospace; }

  /* ── Animations ── */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes pulse-gold {
    0%, 100% { box-shadow: 0 0 0 0 rgba(245,185,69,0.4); }
    50%       { box-shadow: 0 0 0 10px rgba(245,185,69,0); }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position:  200% center; }
  }
  @keyframes barGrow {
    from { width: 0; }
    to   { width: var(--target-w); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(30px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.94); }
    to   { opacity: 1; transform: scale(1); }
  }

  .anim-fade-up   { animation: fadeUp  0.5s cubic-bezier(.16,1,.3,1) forwards; }
  .anim-fade-in   { animation: fadeIn  0.4s ease forwards; }
  .anim-slide-in  { animation: slideIn 0.4s cubic-bezier(.16,1,.3,1) forwards; }
  .anim-scale-in  { animation: scaleIn 0.35s cubic-bezier(.16,1,.3,1) forwards; }

  /* ── Upload Card ── */
  .upload-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 24px;
    padding: 48px 40px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 32px 80px rgba(0,0,0,0.6);
    animation: fadeUp 0.6s cubic-bezier(.16,1,.3,1) forwards;
  }

  .upload-icon-wrap {
    width: 80px; height: 80px;
    background: linear-gradient(135deg, rgba(245,185,69,0.15), rgba(59,108,247,0.1));
    border: 1px solid rgba(245,185,69,0.2);
    border-radius: 20px;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 24px;
  }

  .file-input-wrapper {
    position: relative;
    background: var(--surface);
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    padding: 20px;
    transition: border-color 0.2s, background 0.2s;
    cursor: pointer;
  }
  .file-input-wrapper:hover {
    border-color: var(--gold);
    background: rgba(245,185,69,0.04);
  }
  .file-input-wrapper input {
    position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
  }
  .file-label {
    text-align: center;
    pointer-events: none;
  }

  .btn-primary {
    width: 100%;
    background: linear-gradient(135deg, var(--gold), var(--gold2));
    color: #07090f;
    font-weight: 800;
    font-size: 15px;
    border: none;
    border-radius: var(--radius);
    padding: 18px;
    cursor: pointer;
    transition: opacity 0.2s, transform 0.15s;
    letter-spacing: 0.3px;
    animation: pulse-gold 2.5s infinite;
  }
  .btn-primary:hover  { opacity: 0.9; transform: translateY(-1px); }
  .btn-primary:active { transform: scale(0.97); animation: none; }

  /* ── Log console ── */
  .log-console {
    background: #050709;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    height: 160px;
    overflow-y: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1.7;
  }
  .log-console::-webkit-scrollbar { width: 4px; }
  .log-console::-webkit-scrollbar-track { background: transparent; }
  .log-console::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  /* ── Test Layout ── */
  .test-layout {
    display: flex;
    gap: 20px;
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 16px;
    animation: fadeIn 0.4s ease;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .timer-box {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 16px;
    text-align: center;
  }
  .timer-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .timer-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 28px;
    font-weight: 700;
    color: var(--gold);
    letter-spacing: 2px;
  }
  .timer-value.urgent { color: var(--red); animation: fadeIn 0.3s ease infinite alternate; }

  .progress-sidebar {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
  }
  .progress-sidebar-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
  .progress-bar-track {
    background: var(--surface);
    border-radius: 999px;
    height: 8px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .progress-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--blue), var(--gold));
    transition: width 0.5s cubic-bezier(.16,1,.3,1);
  }
  .progress-answered-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--green), #27ae60);
    transition: width 0.5s cubic-bezier(.16,1,.3,1);
  }
  .progress-stats {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }

  .end-btn {
    width: 100%;
    background: rgba(231,76,60,0.12);
    color: var(--red);
    border: 1px solid rgba(231,76,60,0.25);
    border-radius: var(--radius);
    padding: 12px;
    font-family: 'Sora', sans-serif;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .end-btn:hover { background: rgba(231,76,60,0.22); border-color: rgba(231,76,60,0.5); }

  /* ── Question Card ── */
  .q-card {
    flex: 1;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 32px 28px;
    min-height: 480px;
    display: flex;
    flex-direction: column;
  }

  .q-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .q-number {
    background: rgba(245,185,69,0.12);
    color: var(--gold);
    font-weight: 700;
    font-size: 13px;
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid rgba(245,185,69,0.2);
  }

  .q-text {
    font-size: 17px;
    font-weight: 600;
    line-height: 1.65;
    color: var(--text);
    margin-bottom: 24px;
    flex: 1;
    animation: fadeIn 0.3s ease;
  }

  .option-btn {
    width: 100%;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s, transform 0.15s;
    text-align: left;
    margin-bottom: 10px;
    animation: slideIn 0.3s ease both;
  }
  .option-btn:hover { border-color: var(--gold); background: rgba(245,185,69,0.04); }
  .option-btn:active { transform: scale(0.99); }
  .option-btn.selected {
    border-color: var(--gold);
    background: rgba(245,185,69,0.1);
  }

  .option-key {
    width: 34px; height: 34px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 13px;
    flex-shrink: 0;
    background: var(--card);
    color: var(--muted);
    transition: background 0.2s, color 0.2s;
  }
  .option-btn.selected .option-key {
    background: var(--gold);
    color: var(--bg);
  }
  .option-text { font-size: 14px; color: var(--text); line-height: 1.5; }

  .q-nav {
    display: flex;
    justify-content: space-between;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .nav-btn {
    display: flex; align-items: center; gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: 'Sora', sans-serif;
    font-weight: 700;
    font-size: 13px;
    padding: 10px 20px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .nav-btn:hover:not(:disabled) { background: var(--card); border-color: var(--gold); }
  .nav-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .nav-btn.next-btn {
    background: linear-gradient(135deg, var(--gold), var(--gold2));
    color: var(--bg);
    border-color: transparent;
  }
  .nav-btn.next-btn:hover { opacity: 0.9; }

  /* ── Results ── */
  .results-wrap { max-width: 840px; margin: 0 auto; padding: 24px 16px; animation: fadeIn 0.5s ease; }

  .score-hero {
    background: linear-gradient(135deg, var(--card) 0%, #0f1526 100%);
    border: 1px solid var(--border);
    border-radius: 24px;
    padding: 40px 32px;
    text-align: center;
    margin-bottom: 24px;
    position: relative;
    overflow: hidden;
  }
  .score-hero::before {
    content: '';
    position: absolute;
    top: -60px; left: 50%; transform: translateX(-50%);
    width: 200px; height: 200px;
    background: radial-gradient(circle, rgba(245,185,69,0.12) 0%, transparent 70%);
    pointer-events: none;
  }
  .score-pct {
    font-size: 72px;
    font-weight: 800;
    background: linear-gradient(135deg, var(--gold), #fff8e1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1;
    margin-bottom: 8px;
  }
  .score-sub { font-size: 15px; color: var(--muted); margin-bottom: 24px; }

  .stats-row {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .stat-chip {
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 18px;
    font-size: 13px;
  }
  .stat-chip span { font-weight: 700; }
  .stat-chip.correct span { color: var(--green); }
  .stat-chip.wrong   span { color: var(--red); }
  .stat-chip.skip    span { color: var(--muted); }

  .review-list { display: flex; flex-direction: column; gap: 12px; }

  .review-item {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 20px;
    border-left: 4px solid var(--border);
    animation: fadeUp 0.4s cubic-bezier(.16,1,.3,1) both;
  }
  .review-item.correct { border-left-color: var(--green); }
  .review-item.wrong   { border-left-color: var(--red); }
  .review-q { font-weight: 600; font-size: 14px; color: var(--text); margin-bottom: 10px; line-height: 1.5; }
  .review-answers {
    display: flex; flex-wrap: wrap; gap: 10px;
    font-size: 12px;
  }
  .ans-tag {
    padding: 4px 10px;
    border-radius: 6px;
    font-weight: 700;
  }
  .ans-tag.your-correct { background: rgba(46,204,113,0.15); color: var(--green); }
  .ans-tag.your-wrong   { background: rgba(231,76,60,0.15);  color: var(--red); }
  .ans-tag.correct-ans  { background: rgba(46,204,113,0.15); color: var(--green); }
  .ans-tag.skipped      { background: rgba(107,115,148,0.15); color: var(--muted); }

  .ai-explain-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    margin-top: 12px; width: 100%;
    background: rgba(59,108,247,0.1); border: 1px solid rgba(59,108,247,0.25);
    color: #7b9ef7; font-family: 'Sora', sans-serif;
    font-weight: 700; font-size: 12px;
    padding: 9px 14px; border-radius: 8px;
    cursor: pointer; transition: background 0.2s;
  }
  .ai-explain-btn:hover { background: rgba(59,108,247,0.2); }
  .ai-explain-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .ai-explanation-box {
    margin-top: 12px;
    background: rgba(245,185,69,0.06); border: 1px solid rgba(245,185,69,0.2);
    border-radius: 10px; padding: 12px 14px;
    font-size: 13px; line-height: 1.7; color: var(--text);
    animation: fadeUp 0.4s ease;
  }
  .ai-explanation-box strong { color: var(--gold); display: block; margin-bottom: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .answer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
  .answer-box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .answer-box-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; margin-bottom: 4px; }
  @media(max-width:500px){ .answer-grid{ grid-template-columns:1fr; } }

  .results-actions {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 20px;
  }
  .btn-ghost {
    display: flex; align-items: center; gap: 8px;
    background: var(--card); border: 1px solid var(--border);
    color: var(--text); font-family: 'Sora', sans-serif;
    font-weight: 700; font-size: 13px;
    padding: 10px 18px; border-radius: 10px;
    cursor: pointer; transition: background 0.2s;
  }
  .btn-ghost:hover { background: var(--surface); }
  .btn-save {
    display: flex; align-items: center; gap: 8px;
    background: linear-gradient(135deg, var(--blue), #2952d6);
    color: white; font-family: 'Sora', sans-serif;
    font-weight: 700; font-size: 13px;
    padding: 10px 20px; border-radius: 10px;
    border: none; cursor: pointer; transition: opacity 0.2s;
  }
  .btn-save:hover { opacity: 0.88; }

  /* ── Loading overlay ── */
  .loading-wrap { text-align: center; max-width: 400px; width: 100%; animation: fadeUp 0.5s ease; }
  .spinner {
    width: 48px; height: 48px;
    border: 3px solid var(--border);
    border-top-color: var(--gold);
    border-radius: 50%;
    margin: 0 auto 20px;
    animation: spin 0.8s linear infinite;
  }
  .shimmer-text {
    background: linear-gradient(90deg, var(--muted), var(--gold), var(--muted));
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 2s linear infinite;
    font-weight: 700; font-size: 16px;
  }

  /* ── Responsive ── */
  @media (max-width: 700px) {
    .test-layout { flex-direction: column; }
    .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; }
    .timer-box { flex: 1; min-width: 130px; }
    .progress-sidebar { flex: 2; min-width: 200px; }
    .end-btn { width: auto; flex: 1; }
    .q-text { font-size: 15px; }
    .score-pct { font-size: 52px; }
  }
`;

function injectStyles() {
  if (document.getElementById('app-styles')) return;
  const el = document.createElement('style');
  el.id = 'app-styles';
  el.textContent = GLOBAL_CSS;
  document.head.appendChild(el);
}

export default function App() {
  injectStyles();

  const [screen, setScreen] = useState<Screen>('upload');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>(['> System initialized...']);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [clock, setClock] = useState(7200);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [animKey, setAnimKey] = useState(0);
  const [discoveredModel, setDiscoveredModel] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>(() => {
    try { return localStorage.getItem('gemini_api_key') || process.env.GEMINI_API_KEY || ''; }
    catch { return process.env.GEMINI_API_KEY || ''; }
  });
  const [showKey, setShowKey] = useState(false);
  const [aiExplanations, setAiExplanations] = useState<Record<number, string>>({});
  const [loadingExplanation, setLoadingExplanation] = useState<Record<number, boolean>>({});

  const logsEndRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (screen === 'test' && clock > 0) {
      interval = setInterval(() => {
        setClock(c => {
          if (c <= 1) { clearInterval(interval); endExam(); return 0; }
          return c - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [screen]);

  // Re-animate question card on navigation
  useEffect(() => { setAnimKey(k => k + 1); }, [qIndex]);

  const addLog = (msg: string, isError = false) => {
    setLogs(prev => [...prev, `<span style="color:${isError ? '#e74c3c' : '#2ecc71'}">> ${msg}</span>`]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setFileName(e.target.files[0].name);
    }
  };

  const startExtraction = async () => {
    if (!file) { alert('Please select a PDF first!'); return; }
    const key = apiKey.trim();
    if (!key) { alert('Please enter your Gemini API key first!'); return; }
    try { localStorage.setItem('gemini_api_key', key); } catch {}

    setLoading(true);
    addLog('Checking key permissions...');
    try {
      addLog('Scanning available Gemini models...');
      const mRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      );
      const mData = await mRes.json();
      if (mData.error) throw new Error(mData.error.message);

      const supportedModels: string[] = mData.models
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name as string);

      const bestModel =
        supportedModels.find(n => n.includes('gemini-2.0-flash')) ||
        supportedModels.find(n => n.includes('2.5-flash')) ||
        supportedModels.find(n => n.includes('1.5-pro')) ||
        supportedModels.find(n => n.includes('1.5-flash')) ||
        supportedModels[0];

      if (!bestModel) throw new Error('No compatible Gemini model found');

      const modelShortName = bestModel.split('/').pop() || bestModel;
      setDiscoveredModel(modelShortName);
      addLog(`✓ Engine discovered: ${modelShortName}`);

      addLog('Reading PDF contents...');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
      });

      addLog('Extracting MCQs (10–30s)...');
      const prompt = `Read this PDF. Extract ALL MCQ questions. Return ONLY a raw JSON array with no markdown:
[{"id":1,"question":"full question text","options":{"A":"option a","B":"option b","C":"option c","D":"option d"},"answer":"B"}]
Make sure every question has all options and the correct answer letter.`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${bestModel}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: 'application/pdf', data: base64 } }
              ]
            }]
          })
        }
      );

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      let raw: string = data.candidates[0].content.parts[0].text;
      raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

      const parsed = JSON.parse(raw) as Question[];
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No questions found in PDF');

      setQuestions(parsed);
      addLog(`✓ Found ${parsed.length} questions! Starting exam...`);
      setTimeout(() => { setScreen('test'); setLoading(false); }, 800);

    } catch (err: any) {
      addLog(`CRITICAL ERROR: ${err.message}`, true);
      alert('Processing failed. Check the log for details.');
      setLoading(false);
    }
  };

  const endExam = () => setScreen('results');

  const fetchExplanation = async (q: Question) => {
    setLoadingExplanation(prev => ({ ...prev, [q.id]: true }));
    try {
      const key = apiKey.trim();
      const model = discoveredModel ? `models/${discoveredModel}` : 'models/gemini-2.0-flash';
      const prompt = `Explain clearly why "${q.answer}" is the correct answer for this MCQ question. Keep it to 2-3 sentences only. Be direct and educational.
Question: ${q.question}
Options: ${Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join(', ')}
Correct Answer: ${q.answer}. ${q.options[q.answer]}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const explanation = data.candidates[0].content.parts[0].text;
      setAiExplanations(prev => ({ ...prev, [q.id]: explanation }));
    } catch (err: any) {
      setAiExplanations(prev => ({ ...prev, [q.id]: `Error: ${err.message}` }));
    }
    setLoadingExplanation(prev => ({ ...prev, [q.id]: false }));
  };

  const saveResults = () => {
    if (resultsRef.current) {
      html2pdf().from(resultsRef.current).set({
        margin: 10,
        filename: 'Exam_Report.pdf',
        html2canvas: { scale: 2, backgroundColor: '#07090f' },
        jsPDF: { orientation: 'portrait' }
      }).save();
    }
  };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  // ── Upload Screen ────────────────────────────────────────────────────────────
  const renderUploadScreen = () => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 16 }}>
      {loading ? (
        <div className="loading-wrap">
          <div className="spinner" />
          <p className="shimmer-text">Analyzing Document...</p>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '8px 0 16px' }}>This may take 10–30 seconds</p>
          <div className="log-console">
            {logs.map((log, i) => <div key={i} dangerouslySetInnerHTML={{ __html: log }} />)}
            <div ref={logsEndRef} />
          </div>
        </div>
      ) : (
        <div className="upload-card">
          <div className="upload-icon-wrap">
            <BookOpen size={36} color="var(--gold)" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, textAlign: 'center', marginBottom: 6 }}>MCQ Exam Simulator</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginBottom: 20 }}>Upload a question paper PDF to begin your timed test</p>

          {/* API Key input */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              🔑 Gemini API Key
            </p>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Paste your API key here (AIzaSy...)"
                style={{
                  width: '100%', background: 'var(--surface)', border: `1.5px solid ${apiKey ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius: 10, padding: '12px 44px 12px 14px', color: 'var(--text)',
                  fontSize: 13, fontFamily: 'JetBrains Mono, monospace', outline: 'none'
                }}
              />
              <button
                onClick={() => setShowKey(s => !s)}
                style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--muted)' }}
              >
                {showKey ? '🙈' : '👁️'}
              </button>
            </div>
            {!apiKey && (
              <p style={{ fontSize: 11, color: 'var(--gold)', marginTop: 5 }}>
                ⚠️ Get free key at <span style={{ textDecoration: 'underline' }}>aistudio.google.com/app/apikey</span>
              </p>
            )}
            {apiKey && <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 5 }}>✓ Key saved — won't need to re-enter</p>}
          </div>
            <input type="file" accept="application/pdf" onChange={handleFileChange} />
            <div className="file-label">
              <FileText size={24} color={fileName ? 'var(--gold)' : 'var(--muted)'} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: fileName ? 'var(--text)' : 'var(--muted)' }}>
                {fileName || 'Click to choose PDF'}
              </p>
              {!fileName && <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Supports: .pdf</p>}
            </div>
          </div>

          <button className="btn-primary" onClick={startExtraction}>
            Start Extraction →
          </button>
        </div>
      )}
    </div>
  );

  // ── Test Screen ──────────────────────────────────────────────────────────────
  const renderTestScreen = () => {
    if (questions.length === 0) return null;
    const q = questions[qIndex];
    const answered = Object.keys(selections).length;
    const visitedPct = ((qIndex + 1) / questions.length) * 100;
    const answeredPct = (answered / questions.length) * 100;
    const isUrgent = clock < 300;

    return (
      <div className="test-layout">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="timer-box">
            <div className="timer-label"><Clock size={11} style={{ display: 'inline', marginRight: 4 }} />Time Left</div>
            <div className={`timer-value${isUrgent ? ' urgent' : ''}`}>{formatTime(clock)}</div>
            {discoveredModel && (
              <div style={{
                marginTop: 8, fontSize: 10, color: 'var(--green)',
                background: 'rgba(46,204,113,0.08)', borderRadius: 6,
                padding: '3px 8px', fontFamily: 'JetBrains Mono, monospace'
              }}>
                🔷 {discoveredModel}
              </div>
            )}
          </div>

          <div className="progress-sidebar">
            <div className="progress-sidebar-label">Progress</div>

            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
              Visited: <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{qIndex + 1}</span> / {questions.length}
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${visitedPct}%` }} />
            </div>

            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, marginTop: 10 }}>
              Answered: <span style={{ color: 'var(--green)', fontWeight: 700 }}>{answered}</span> / {questions.length}
            </div>
            <div className="progress-bar-track">
              <div className="progress-answered-fill" style={{ width: `${answeredPct}%` }} />
            </div>

            <div className="progress-stats">
              <span>{Math.round(answeredPct)}% done</span>
              <span>{questions.length - answered} left</span>
            </div>
          </div>

          <button className="end-btn" onClick={endExam}>⬛ End Test</button>
        </div>

        {/* Question Card */}
        <div className="q-card" key={animKey} style={{ animation: 'scaleIn 0.3s cubic-bezier(.16,1,.3,1)' }}>
          <div className="q-header">
            <span className="q-number">Q {qIndex + 1} of {questions.length}</span>
            <span style={{ fontSize: 12, color: selections[q.id] ? 'var(--green)' : 'var(--muted)' }}>
              {selections[q.id] ? <><CheckCircle size={13} style={{ display: 'inline', marginRight: 4 }} />Answered</> : 'Not answered'}
            </span>
          </div>

          <p className="q-text">{q.question}</p>

          <div>
            {Object.entries(q.options).map(([k, v], idx) => {
              const active = selections[q.id] === k;
              return (
                <button
                  key={k}
                  className={`option-btn${active ? ' selected' : ''}`}
                  style={{ animationDelay: `${idx * 0.06}s` }}
                  onClick={() => setSelections(prev => ({ ...prev, [q.id]: k }))}
                >
                  <span className="option-key">{k}</span>
                  <span className="option-text">{v}</span>
                </button>
              );
            })}
          </div>

          <div className="q-nav">
            <button className="nav-btn" disabled={qIndex === 0} onClick={() => setQIndex(Math.max(0, qIndex - 1))}>
              <ChevronLeft size={16} /> Prev
            </button>
            <button
              className="nav-btn next-btn"
              onClick={() => {
                if (qIndex === questions.length - 1) endExam();
                else setQIndex(qIndex + 1);
              }}
            >
              {qIndex === questions.length - 1 ? 'Finish Test ✓' : <>Next <ChevronRight size={16} /></>}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Results Screen ───────────────────────────────────────────────────────────
  const renderResultsScreen = () => {
    let score = 0;
    let skipped = 0;
    questions.forEach(q => {
      if (!selections[q.id]) skipped++;
      else if (selections[q.id] === q.answer) score++;
    });
    const wrong = questions.length - score - skipped;
    const pct = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;

    return (
      <div className="results-wrap">
        <div className="results-actions no-print">
          <button className="btn-ghost" onClick={() => window.location.reload()}>
            <Home size={15} /> Restart
          </button>
          <button className="btn-save" onClick={saveResults}>
            <Download size={15} /> Save PDF Report
          </button>
        </div>

        <div ref={resultsRef}>
          <div className="score-hero">
            <div className="score-pct">{pct}%</div>
            <p className="score-sub">Score: {score} correct out of {questions.length} questions</p>
            <div className="stats-row">
              <div className="stat-chip correct"><CheckCircle size={13} style={{ display: 'inline', marginRight: 6 }} /><span>{score}</span> Correct</div>
              <div className="stat-chip wrong"><XCircle size={13} style={{ display: 'inline', marginRight: 6 }} /><span>{wrong}</span> Wrong</div>
              <div className="stat-chip skip"><span>{skipped}</span> Skipped</div>
            </div>
          </div>

          <div className="review-list">
            {questions.map((q, i) => {
              const ok = selections[q.id] === q.answer;
              const sk = !selections[q.id];
              const explanation = aiExplanations[q.id];
              const isLoadingExp = loadingExplanation[q.id];
              return (
                <div
                  key={i}
                  className={`review-item ${sk ? '' : ok ? 'correct' : 'wrong'}`}
                  style={{ animationDelay: `${Math.min(i * 0.04, 0.6)}s` }}
                >
                  <p className="review-q">Q{i + 1}: {q.question}</p>

                  {/* Answer grid */}
                  <div className="answer-grid">
                    <div className="answer-box">
                      <div className="answer-box-label">Your Answer</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: sk ? 'var(--muted)' : ok ? 'var(--green)' : 'var(--red)' }}>
                        {sk ? '— Skipped' : `${selections[q.id]}. ${q.options[selections[q.id]] || ''}`}
                      </div>
                    </div>
                    <div className="answer-box">
                      <div className="answer-box-label">Correct Answer</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
                        {q.answer}. {q.options[q.answer]}
                      </div>
                    </div>
                  </div>

                  {/* AI Explanation */}
                  {explanation ? (
                    <div className="ai-explanation-box">
                      <strong>✨ AI Explanation</strong>
                      {explanation}
                    </div>
                  ) : (
                    <button
                      className="ai-explain-btn no-print"
                      disabled={isLoadingExp}
                      onClick={() => fetchExplanation(q)}
                    >
                      {isLoadingExp ? '✨ Thinking...' : '✨ Explain with AI'}
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Sora', sans-serif" }}>
      {screen === 'upload'  && renderUploadScreen()}
      {screen === 'test'    && renderTestScreen()}
      {screen === 'results' && renderResultsScreen()}
    </div>
  );
}
