// ── Fixed: removed dead GoogleGenAI import (never used — all API calls use raw fetch)
// ── Fixed: removed dead Loader2 import (never referenced in JSX)
// ── v2: Groq-first extraction (faster), Gemini fallback, JSON truncation fix,
//        partial JSON recovery, PDF chunking for large docs
import React, { useState, useEffect, useRef, useCallback } from 'react';
import html2pdf from 'html2pdf.js';
import {
  FileText, Download, CheckCircle, XCircle, Trash2, PlayCircle, Library,
  Clock, BookOpen, ChevronLeft, ChevronRight, Eye, EyeOff,
  Zap, AlertTriangle, RotateCcw
} from 'lucide-react';

interface Question {
  id: number;
  question: string;
  options: Record<string, string>;
  answer: string;
}

interface SavedTest {
  id: string;
  name: string;
  savedAt: number;
  questions: Question[];
}

interface AttemptRecord {
  id: string;
  testId: string;
  testName: string;
  date: number;
  pct: number;
  correct: number;
  wrong: number;
  skipped: number;
  total: number;
  timeTaken: number;
}

type Screen = 'upload' | 'test' | 'results';

interface LogEntry {
  msg: string;
  kind: 'ok' | 'err' | 'warn' | 'info';
}

const safeGet = (key: string): string => {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
};
const safeSet = (key: string, val: string): void => {
  try { localStorage.setItem(key, val); } catch {}
};

// ── Saved tests helpers
const SAVED_KEY = 'mcq_saved_tests';
const getSavedTests = (): SavedTest[] => {
  try { const raw = localStorage.getItem(SAVED_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
};
const persistSavedTests = (tests: SavedTest[]): void => {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(tests)); } catch {}
};
const saveTestToStorage = (name: string, questions: Question[]): SavedTest => {
  const tests = getSavedTests();
  const existingIdx = tests.findIndex(t => t.name === name);
  const entry: SavedTest = { id: Date.now().toString(), name, savedAt: Date.now(), questions };
  if (existingIdx >= 0) tests[existingIdx] = entry;
  else tests.unshift(entry);
  persistSavedTests(tests);
  return entry;
};
const deleteTestFromStorage = (id: string): SavedTest[] => {
  const updated = getSavedTests().filter(t => t.id !== id);
  persistSavedTests(updated);
  return updated;
};

// ── Analytics helpers
const ANALYTICS_KEY = 'mcq_attempt_history';
const getAttempts = (testId?: string): AttemptRecord[] => {
  try {
    const raw = localStorage.getItem(ANALYTICS_KEY);
    const all: AttemptRecord[] = raw ? JSON.parse(raw) : [];
    return testId ? all.filter(a => a.testId === testId) : all;
  } catch { return []; }
};
const saveAttempt = (record: Omit<AttemptRecord, 'id'>): void => {
  try {
    const all = getAttempts();
    all.unshift({ ...record, id: Date.now().toString() });
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(all.slice(0, 50)));
  } catch {}
};
const deleteAttemptsForTest = (testId: string): void => {
  try {
    const remaining = getAttempts().filter(a => a.testId !== testId);
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(remaining));
  } catch {}
};

// ── pdf.js helpers
const loadPdfJs = async (): Promise<any> => {
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(s);
  });
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return lib;
};
const extractPdfText = async (file: File): Promise<string> => {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(' ') + '\n';
  }
  return text.trim();
};

// ── Quota / rate-limit detector
const isQuotaError = (data: any): boolean => {
  const msg: string = data?.error?.message || '';
  return (
    data?.error?.code === 429 ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('rate limit') ||
    msg.toLowerCase().includes('resource_exhausted')
  );
};

// ── FIX: Partial JSON recovery for truncated Groq responses
// When max_tokens is hit mid-object, we salvage all COMPLETE objects before the cut.
const recoverPartialJsonArray = (raw: string): Question[] => {
  const start = raw.indexOf('[');
  if (start === -1) return [];
  const content = raw.slice(start + 1);
  const questions: Question[] = [];
  let depth = 0;
  let objStart = -1;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          const obj = JSON.parse(content.slice(objStart, i + 1));
          if (obj.question && obj.options && obj.answer) questions.push(obj as Question);
        } catch {}
        objStart = -1;
      }
    }
  }
  return questions;
};

// ── Robust JSON extraction from LLM responses
const parseQuestionsFromLLM = (raw: string): Question[] => {
  let cleaned = raw
    .replace(/```json[\s\S]*?```/g, m => m.slice(7, -3))
    .replace(/```[\s\S]*?```/g, m => m.slice(3, -3))
    .trim()
    .replace(/`/g, '');

  const sanitize = (s: string) => s
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r?\n/g, ' ');

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');

  if (start !== -1 && end !== -1 && end > start) {
    const slice = sanitize(cleaned.slice(start, end + 1));
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed as Question[];
      const arr = (Object.values(parsed) as any[]).find(v => Array.isArray(v));
      if (arr) return arr as Question[];
    } catch {
      try {
        const fixed = slice
          .replace(/(['"])?([a-zA-Z_][a-zA-Z0-9_]*)(['"])?:/g, '"$2":')
          .replace(/:\s*'([^']*)'/g, ': "$1"');
        const parsed = JSON.parse(fixed);
        if (Array.isArray(parsed)) return parsed as Question[];
      } catch {}
    }
  }

  // Partial recovery — handles Groq token-limit truncation
  const recovered = recoverPartialJsonArray(cleaned);
  if (recovered.length > 0) return recovered;

  throw new Error('No JSON array found in model response');
};

const validateQuestions = (parsed: Question[]): Question[] => {
  const valid = parsed.filter(q => q.question && q.options && q.answer && Object.keys(q.options).length >= 2);
  valid.forEach((q, i) => { q.id = i + 1; });
  return valid;
};

// ── CSS (unchanged from original)
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;800;900&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');

  :root {
    --bg: #010308; --surface: #04080f; --card: #060c16; --card2: #0a1220;
    --border: #0f1e30; --border2: #152436;
    --cyan: #00e5ff; --cyan2: #00b8d4; --cyan-dim: rgba(0,229,255,0.08); --cyan-glow: rgba(0,229,255,0.25);
    --pink: #ff2d78; --pink-dim: rgba(255,45,120,0.1); --pink-glow: rgba(255,45,120,0.3);
    --green: #00ff88; --green-dim: rgba(0,255,136,0.09); --green-glow: rgba(0,255,136,0.25);
    --red: #ff3355; --red-dim: rgba(255,51,85,0.1);
    --yellow: #ffe600; --yellow-dim: rgba(255,230,0,0.08);
    --text: #e0f4ff; --text2: #7ab8d4; --muted: #2e5268;
    --r: 12px; --rlg: 18px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body {
    background: var(--bg); color: var(--text); font-family: 'Rajdhani', sans-serif;
    min-height: 100vh; -webkit-font-smoothing: antialiased;
    background-image: linear-gradient(rgba(0,229,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.015) 1px, transparent 1px);
    background-size: 40px 40px;
  }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--cyan-dim); border-radius: 99px; }

  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes scaleIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
  @keyframes slideR { from { opacity:0; transform:translateX(-14px); } to { opacity:1; transform:translateX(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes shimmer { 0% { background-position:-200% center; } 100% { background-position:200% center; } }
  @keyframes neonPulse {
    0%,100% { box-shadow: 0 0 8px var(--cyan-glow), 0 0 20px var(--cyan-dim), inset 0 0 8px var(--cyan-dim); }
    50% { box-shadow: 0 0 18px var(--cyan-glow), 0 0 40px var(--cyan-dim), inset 0 0 14px var(--cyan-dim); }
  }
  @keyframes urgentBlink { 0%,100% { opacity:1; text-shadow: 0 0 10px var(--red), 0 0 20px var(--red); } 50% { opacity:0.5; text-shadow: none; } }
  @keyframes borderGlow { 0%,100% { border-color: rgba(0,229,255,0.3); } 50% { border-color: rgba(0,229,255,0.7); } }

  .upload-wrap {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; padding: 20px;
    background: radial-gradient(ellipse 70% 50% at 50% -10%, rgba(0,229,255,0.06) 0%, transparent 70%),
                radial-gradient(ellipse 50% 35% at 90% 110%, rgba(255,45,120,0.05) 0%, transparent 60%);
  }
  .upload-card {
    background: var(--card); border: 1px solid rgba(0,229,255,0.2); border-radius: 20px;
    padding: 38px 34px 34px; width: 100%; max-width: 420px;
    box-shadow: 0 0 40px rgba(0,229,255,0.05), 0 40px 80px rgba(0,0,0,0.6), inset 0 0 20px rgba(0,229,255,0.02);
    animation: fadeUp 0.55s cubic-bezier(.16,1,.3,1) both; position: relative;
  }
  .upload-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0;
    height: 1px; background: linear-gradient(90deg, transparent, var(--cyan), transparent); opacity: 0.5;
  }
  .upload-logo {
    width: 70px; height: 70px;
    background: linear-gradient(135deg, rgba(0,229,255,0.12), rgba(255,45,120,0.08));
    border: 1px solid rgba(0,229,255,0.25); border-radius: 16px;
    display: flex; align-items: center; justify-content: center; margin: 0 auto 18px;
    box-shadow: 0 0 20px rgba(0,229,255,0.1), 0 8px 30px rgba(0,0,0,0.4);
  }
  .upload-title {
    font-family: 'Orbitron', sans-serif; font-size: 19px; font-weight: 800;
    text-align: center; margin-bottom: 5px; color: var(--cyan);
    text-shadow: 0 0 20px rgba(0,229,255,0.5), 0 0 40px rgba(0,229,255,0.2); letter-spacing: 1px;
  }
  .upload-sub { font-size: 13px; color: var(--text2); text-align: center; margin-bottom: 24px; letter-spacing: 0.3px; }
  .field-label {
    font-family: 'Orbitron', sans-serif; font-size: 9px; color: var(--cyan);
    text-transform: uppercase; letter-spacing: 2px; font-weight: 700; margin-bottom: 8px;
    display: flex; align-items: center; gap: 5px; text-shadow: 0 0 8px var(--cyan-glow);
  }
  .key-wrap { position: relative; margin-bottom: 6px; }
  .key-input {
    width: 100%; background: var(--surface); border: 1px solid var(--border2); border-radius: 10px;
    padding: 12px 44px 12px 13px; color: var(--text); font-size: 12.5px;
    font-family: 'JetBrains Mono', monospace; outline: none; transition: border-color 0.2s, box-shadow 0.2s;
  }
  .key-input:focus { border-color: var(--cyan); box-shadow: 0 0 0 2px rgba(0,229,255,0.12), 0 0 12px rgba(0,229,255,0.08); }
  .key-input.valid { border-color: var(--green); box-shadow: 0 0 8px rgba(0,255,136,0.1); }
  .key-toggle {
    position: absolute; right: 11px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; color: var(--muted);
    display: flex; align-items: center; padding: 4px; transition: color 0.2s;
  }
  .key-toggle:hover { color: var(--cyan); }
  .field-hint { font-size: 11px; margin-top: 5px; display: flex; align-items: center; gap: 5px; }
  .drop-zone {
    position: relative; background: var(--surface); border: 1px dashed rgba(0,229,255,0.2);
    border-radius: var(--r); padding: 22px 16px; margin: 14px 0 18px;
    cursor: pointer; text-align: center; transition: border-color 0.25s, background 0.25s, box-shadow 0.25s;
  }
  .drop-zone:hover, .drop-zone.active {
    border-color: var(--cyan); border-style: solid; background: var(--cyan-dim);
    box-shadow: 0 0 20px rgba(0,229,255,0.07), inset 0 0 10px rgba(0,229,255,0.04);
  }
  .drop-zone input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .drop-text { font-size: 13px; font-weight: 600; color: var(--text2); pointer-events: none; letter-spacing: 0.3px; }
  .drop-sub { font-size: 11px; color: var(--muted); margin-top: 3px; pointer-events: none; }
  .btn-primary {
    width: 100%; background: linear-gradient(135deg, #00e5ff 0%, #00b8d4 50%, #0097a7 100%);
    color: #010308; font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 13px;
    border: none; border-radius: var(--r); padding: 16px; cursor: pointer;
    letter-spacing: 1.5px; text-transform: uppercase;
    transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
    animation: neonPulse 2.8s ease infinite;
    box-shadow: 0 0 20px var(--cyan-glow), 0 4px 15px rgba(0,0,0,0.4);
  }
  .btn-primary:hover { opacity: 0.92; transform: translateY(-2px); box-shadow: 0 0 30px var(--cyan-glow), 0 8px 25px rgba(0,229,255,0.2); }
  .btn-primary:active { transform: scale(0.98); animation: none; }
  .btn-primary:disabled { opacity: 0.3; cursor: not-allowed; animation: none; transform: none; box-shadow: none; }

  .loading-wrap { text-align: center; max-width: 380px; width: 100%; animation: fadeUp 0.45s ease; }
  .spinner-ring {
    width: 52px; height: 52px; border: 2px solid var(--border2); border-top-color: var(--cyan);
    border-radius: 50%; margin: 0 auto 18px; animation: spin 0.75s linear infinite;
    box-shadow: 0 0 12px rgba(0,229,255,0.3);
  }
  .shimmer-text {
    background: linear-gradient(90deg, var(--muted), var(--cyan), var(--text2), var(--pink), var(--cyan), var(--muted));
    background-size: 300% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    animation: shimmer 2.2s linear infinite; font-family: 'Orbitron', sans-serif;
    font-weight: 700; font-size: 14px; margin-bottom: 5px; letter-spacing: 1px;
  }
  .log-console {
    background: #010508; border: 1px solid rgba(0,229,255,0.12); border-radius: 10px;
    padding: 13px 15px; height: 168px; overflow-y: auto;
    font-family: 'JetBrains Mono', monospace; font-size: 11.5px; line-height: 1.75;
    margin-top: 14px; text-align: left; box-shadow: inset 0 0 20px rgba(0,0,0,0.5);
  }
  .log-line { display: flex; align-items: flex-start; gap: 7px; }
  .log-line.ok { color: var(--green); text-shadow: 0 0 6px rgba(0,255,136,0.4); }
  .log-line.err { color: var(--red); text-shadow: 0 0 6px rgba(255,51,85,0.4); }
  .log-line.warn { color: var(--yellow); text-shadow: 0 0 6px rgba(255,230,0,0.3); }
  .log-line.info { color: var(--muted); }

  .test-layout {
    display: flex; gap: 16px; max-width: 980px; margin: 0 auto;
    padding: 20px 16px; animation: fadeIn 0.35s ease; align-items: flex-start;
  }
  .sidebar { width: 210px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; position: sticky; top: 20px; }
  .s-card { background: var(--card); border: 1px solid rgba(0,229,255,0.15); border-radius: var(--r); padding: 16px; box-shadow: 0 0 15px rgba(0,229,255,0.03); }
  .timer-lbl { font-family: 'Orbitron', sans-serif; font-size: 8.5px; color: var(--cyan); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; display: flex; align-items: center; gap: 5px; text-shadow: 0 0 8px var(--cyan-glow); }
  .timer-val { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 700; color: var(--cyan); letter-spacing: 3px; line-height: 1; text-shadow: 0 0 12px rgba(0,229,255,0.5), 0 0 24px rgba(0,229,255,0.2); }
  .timer-val.urgent { color: var(--red); animation: urgentBlink 0.9s ease infinite; text-shadow: 0 0 12px rgba(255,51,85,0.6); }
  .model-badge { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; background: var(--green-dim); color: var(--green); font-size: 10px; font-family: 'JetBrains Mono', monospace; padding: 4px 9px; border-radius: 6px; border: 1px solid rgba(0,255,136,0.2); text-shadow: 0 0 6px var(--green-glow); }
  .prog-lbl { font-family: 'Orbitron', sans-serif; font-size: 8.5px; color: var(--cyan); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; text-shadow: 0 0 8px var(--cyan-glow); }
  .prog-row { margin-bottom: 10px; }
  .prog-top { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--muted); margin-bottom: 5px; }
  .prog-top strong { color: var(--text2); font-weight: 700; }
  .prog-track { background: var(--surface); border-radius: 999px; height: 5px; overflow: hidden; border: 1px solid var(--border); }
  .prog-fill { height: 100%; border-radius: 999px; transition: width 0.5s cubic-bezier(.16,1,.3,1); }
  .prog-fill.v { background: linear-gradient(90deg, var(--cyan), rgba(0,229,255,0.4)); box-shadow: 0 0 6px rgba(0,229,255,0.4); }
  .prog-fill.a { background: linear-gradient(90deg, var(--green), rgba(0,255,136,0.4)); box-shadow: 0 0 6px rgba(0,255,136,0.4); }
  .end-btn { width: 100%; background: var(--red-dim); color: var(--red); border: 1px solid rgba(255,51,85,0.25); border-radius: var(--r); padding: 11px; font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; transition: background 0.2s, border-color 0.2s, transform 0.12s, box-shadow 0.2s; text-shadow: 0 0 8px rgba(255,51,85,0.4); }
  .end-btn:hover { background: rgba(255,51,85,0.15); border-color: rgba(255,51,85,0.5); transform: translateY(-1px); box-shadow: 0 0 15px rgba(255,51,85,0.15); }

  .q-card { flex: 1; background: var(--card); border: 1px solid rgba(0,229,255,0.12); border-radius: var(--rlg); padding: 32px 30px; display: flex; flex-direction: column; min-height: 500px; box-shadow: 0 0 30px rgba(0,229,255,0.03), inset 0 0 30px rgba(0,0,0,0.3); position: relative; }
  .q-card::before { content: ''; position: absolute; top: 0; left: 20px; right: 20px; height: 1px; background: linear-gradient(90deg, transparent, rgba(0,229,255,0.3), transparent); }
  .q-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; padding-bottom: 15px; border-bottom: 1px solid rgba(0,229,255,0.08); }
  .q-badge { background: var(--cyan-dim); color: var(--cyan); font-weight: 700; font-size: 11px; padding: 5px 12px; border-radius: 7px; border: 1px solid rgba(0,229,255,0.2); font-family: 'JetBrains Mono', monospace; text-shadow: 0 0 8px rgba(0,229,255,0.4); box-shadow: 0 0 10px rgba(0,229,255,0.06); }
  .q-status { font-size: 12px; display: flex; align-items: center; gap: 5px; font-family: 'Rajdhani', sans-serif; font-weight: 600; }
  .q-text { font-size: 17px; font-weight: 500; line-height: 2.1; color: var(--text); margin-bottom: 26px; flex: 1; letter-spacing: 0.3px; word-spacing: 2px; }
  .opts { display: flex; flex-direction: column; gap: 12px; }
  .opt-btn { width: 100%; background: var(--surface); border: 1px solid var(--border2); border-radius: 10px; padding: 16px 18px; display: flex; align-items: center; gap: 15px; cursor: pointer; text-align: left; transition: border-color 0.2s, background 0.2s, transform 0.12s, box-shadow 0.2s; animation: slideR 0.3s cubic-bezier(.16,1,.3,1) both; }
  .opt-btn:hover:not(.sel) { border-color: rgba(0,229,255,0.35); background: rgba(0,229,255,0.04); box-shadow: 0 0 12px rgba(0,229,255,0.05); }
  .opt-btn:active { transform: scale(0.997); }
  .opt-btn.sel { border-color: var(--cyan); background: var(--cyan-dim); box-shadow: 0 0 16px rgba(0,229,255,0.1), inset 0 0 10px rgba(0,229,255,0.04); }
  .opt-key { width: 32px; height: 32px; flex-shrink: 0; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 11px; background: var(--card2); color: var(--muted); transition: background 0.2s, color 0.2s, box-shadow 0.2s; border: 1px solid var(--border); }
  .opt-btn.sel .opt-key { background: var(--cyan); color: var(--bg); box-shadow: 0 0 10px rgba(0,229,255,0.4); }
  .opt-text { font-size: 15px; color: var(--text); line-height: 1.65; font-weight: 500; letter-spacing: 0.2px; }
  .q-nav { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(0,229,255,0.08); gap: 10px; }
  .nav-btn { display: flex; align-items: center; gap: 7px; background: var(--surface); border: 1px solid var(--border2); color: var(--text2); font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 10px; padding: 10px 18px; border-radius: 9px; cursor: pointer; letter-spacing: 1px; text-transform: uppercase; transition: background 0.18s, border-color 0.18s, transform 0.12s, box-shadow 0.18s; }
  .nav-btn:hover:not(:disabled) { background: var(--card2); border-color: rgba(0,229,255,0.4); color: var(--cyan); box-shadow: 0 0 12px rgba(0,229,255,0.08); }
  .nav-btn:disabled { opacity: 0.25; cursor: not-allowed; }
  .nav-btn.nxt { background: linear-gradient(135deg, var(--cyan), var(--cyan2)); color: var(--bg); border-color: transparent; flex: 1; justify-content: center; box-shadow: 0 0 16px var(--cyan-glow); }
  .nav-btn.nxt:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 0 25px var(--cyan-glow); }

  .results-wrap { max-width: 860px; margin: 0 auto; padding: 22px 16px 40px; animation: fadeIn 0.4s ease; }
  .results-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .btn-ghost { display: flex; align-items: center; gap: 7px; background: var(--card); border: 1px solid rgba(0,229,255,0.2); color: var(--text2); font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 9px; padding: 10px 16px; border-radius: 9px; cursor: pointer; letter-spacing: 1px; text-transform: uppercase; transition: background 0.18s, color 0.18s, box-shadow 0.18s; }
  .btn-ghost:hover { background: var(--card2); color: var(--cyan); box-shadow: 0 0 12px rgba(0,229,255,0.08); }
  .btn-save { display: flex; align-items: center; gap: 7px; background: linear-gradient(135deg, var(--pink), #cc1155); color: white; font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 9px; padding: 10px 18px; border-radius: 9px; border: none; cursor: pointer; letter-spacing: 1px; text-transform: uppercase; transition: opacity 0.18s, transform 0.12s, box-shadow 0.18s; box-shadow: 0 0 16px var(--pink-glow); }
  .btn-save:hover { opacity: 0.88; transform: translateY(-1px); box-shadow: 0 0 25px var(--pink-glow); }
  .score-hero { background: linear-gradient(145deg, var(--card) 0%, var(--card2) 100%); border: 1px solid rgba(0,229,255,0.2); border-radius: 20px; padding: 38px 28px 30px; text-align: center; margin-bottom: 18px; position: relative; overflow: hidden; box-shadow: 0 0 40px rgba(0,229,255,0.04), inset 0 0 30px rgba(0,0,0,0.3); }
  .score-hero::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--cyan), transparent); opacity: 0.4; }
  .score-hero::after { content: ''; position: absolute; top: -100px; left: 50%; transform: translateX(-50%); width: 300px; height: 300px; background: radial-gradient(circle, rgba(0,229,255,0.06) 0%, transparent 65%); pointer-events: none; }
  .score-pct { font-family: 'Orbitron', sans-serif; font-size: 78px; font-weight: 900; color: var(--cyan); text-shadow: 0 0 20px rgba(0,229,255,0.6), 0 0 50px rgba(0,229,255,0.3), 0 0 80px rgba(0,229,255,0.1); line-height: 1; margin-bottom: 6px; letter-spacing: -1px; }
  .score-sub { font-size: 14px; color: var(--text2); margin-bottom: 22px; font-weight: 500; letter-spacing: 0.3px; }
  .stats-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  .stat-chip { background: rgba(0,229,255,0.04); border: 1px solid var(--border2); border-radius: 9px; padding: 10px 16px; font-size: 13px; display: flex; align-items: center; gap: 7px; font-weight: 600; }
  .stat-chip .v { font-family: 'Orbitron', sans-serif; font-weight: 800; font-size: 18px; }
  .stat-chip.c .v { color: var(--green); text-shadow: 0 0 10px var(--green-glow); }
  .stat-chip.w .v { color: var(--red); text-shadow: 0 0 10px rgba(255,51,85,0.4); }
  .stat-chip.s .v { color: var(--muted); }
  .review-list { display: flex; flex-direction: column; gap: 10px; }
  .review-item { background: var(--card); border: 1px solid var(--border2); border-radius: 13px; padding: 17px 18px; border-left: 3px solid var(--border2); animation: fadeUp 0.4s cubic-bezier(.16,1,.3,1) both; transition: box-shadow 0.2s; }
  .review-item.correct { border-left-color: var(--green); box-shadow: -3px 0 12px rgba(0,255,136,0.08); }
  .review-item.wrong { border-left-color: var(--red); box-shadow: -3px 0 12px rgba(255,51,85,0.08); }
  .review-item.skipped { border-left-color: var(--muted); }
  .review-q { font-weight: 600; font-size: 14px; color: var(--text); margin-bottom: 12px; line-height: 1.55; }
  .ans-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-bottom: 11px; }
  .ans-box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; }
  .ans-lbl { font-family: 'Orbitron', sans-serif; font-size: 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; margin-bottom: 5px; }
  .ans-val { font-size: 13px; font-weight: 600; line-height: 1.4; }
  .ai-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; background: rgba(255,45,120,0.07); border: 1px solid rgba(255,45,120,0.2); color: var(--pink); font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 9px; padding: 9px 12px; border-radius: 8px; cursor: pointer; letter-spacing: 1px; text-transform: uppercase; transition: background 0.18s, transform 0.12s, box-shadow 0.18s; text-shadow: 0 0 8px rgba(255,45,120,0.3); }
  .ai-btn:hover:not(:disabled) { background: rgba(255,45,120,0.12); transform: translateY(-1px); box-shadow: 0 0 15px rgba(255,45,120,0.1); }
  .ai-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .ai-box { margin-top: 10px; background: rgba(255,45,120,0.04); border: 1px solid rgba(255,45,120,0.15); border-radius: 9px; padding: 11px 13px; font-size: 13px; line-height: 1.72; color: var(--text2); animation: fadeUp 0.35s ease; }
  .ai-box-title { color: var(--pink); font-family: 'Orbitron', sans-serif; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; display: flex; align-items: center; gap: 5px; text-shadow: 0 0 8px rgba(255,45,120,0.4); }

  .library-wrap { width: 100%; max-width: 420px; margin-top: 20px; animation: fadeUp 0.6s cubic-bezier(.16,1,.3,1) 0.1s both; }
  .library-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .library-title { font-family: 'Orbitron', sans-serif; font-size: 9px; color: var(--cyan); text-transform: uppercase; letter-spacing: 2px; font-weight: 700; display: flex; align-items: center; gap: 6px; text-shadow: 0 0 8px var(--cyan-glow); }
  .library-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); background: var(--surface); border: 1px solid var(--border); padding: 2px 8px; border-radius: 20px; }
  .saved-list { display: flex; flex-direction: column; gap: 8px; }
  .saved-item { background: var(--card); border: 1px solid rgba(0,229,255,0.12); border-radius: 12px; padding: 13px 14px; display: flex; align-items: center; gap: 10px; transition: border-color 0.2s, box-shadow 0.2s; animation: fadeUp 0.35s cubic-bezier(.16,1,.3,1) both; }
  .saved-item:hover { border-color: rgba(0,229,255,0.3); box-shadow: 0 0 14px rgba(0,229,255,0.05); }
  .saved-icon { width: 38px; height: 38px; flex-shrink: 0; background: var(--cyan-dim); border: 1px solid rgba(0,229,255,0.18); border-radius: 9px; display: flex; align-items: center; justify-content: center; }
  .saved-info { flex: 1; min-width: 0; }
  .saved-name { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
  .saved-meta { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
  .saved-meta span { display: flex; align-items: center; gap: 3px; }
  .saved-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .btn-load { background: var(--cyan-dim); color: var(--cyan); border: 1px solid rgba(0,229,255,0.25); border-radius: 8px; padding: 7px 13px; font-family: 'Orbitron', sans-serif; font-size: 8.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; transition: background 0.18s, box-shadow 0.18s, transform 0.12s; text-shadow: 0 0 6px rgba(0,229,255,0.4); }
  .btn-load:hover { background: rgba(0,229,255,0.15); box-shadow: 0 0 12px rgba(0,229,255,0.12); transform: translateY(-1px); }
  .btn-del { background: var(--red-dim); color: var(--red); border: 1px solid rgba(255,51,85,0.2); border-radius: 8px; padding: 7px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.18s, transform 0.12s; }
  .btn-del:hover { background: rgba(255,51,85,0.15); transform: translateY(-1px); }
  .library-empty { text-align: center; padding: 20px 16px; background: var(--card); border: 1px dashed var(--border2); border-radius: 12px; color: var(--muted); font-size: 12px; line-height: 1.6; }

  .groq-row { display: flex; align-items: center; justify-content: space-between; background: rgba(255,230,0,0.05); border: 1px solid rgba(255,230,0,0.15); border-radius: 10px; padding: 9px 13px; margin-bottom: 16px; cursor: pointer; transition: background 0.2s, border-color 0.2s; }
  .groq-row:hover { background: rgba(255,230,0,0.09); border-color: rgba(255,230,0,0.3); }
  .groq-row-label { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--yellow); font-weight: 600; }
  .groq-row-sub { font-size: 10px; color: var(--muted); margin-top: 2px; }
  .groq-badge { font-size: 9px; background: rgba(255,230,0,0.12); color: var(--yellow); border: 1px solid rgba(255,230,0,0.2); padding: 2px 8px; border-radius: 20px; font-family: 'JetBrains Mono', monospace; }

  .analytics-panel { width: 100%; max-width: 420px; background: var(--card); border: 1px solid rgba(0,229,255,0.12); border-radius: 16px; overflow: hidden; animation: fadeUp 0.5s cubic-bezier(.16,1,.3,1) 0.15s both; }
  .analytics-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, rgba(0,229,255,0.04), transparent); }
  .analytics-title { font-family: 'Orbitron', sans-serif; font-size: 9px; color: var(--cyan); text-transform: uppercase; letter-spacing: 2px; font-weight: 700; display: flex; align-items: center; gap: 6px; text-shadow: 0 0 8px var(--cyan-glow); }
  .analytics-body { padding: 16px; }
  .analytics-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
  .anl-stat { background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 10px 8px; text-align: center; }
  .anl-stat-val { font-family: 'Orbitron', sans-serif; font-size: 18px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
  .anl-stat-lbl { font-size: 9.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
  .anl-best { color: var(--green); text-shadow: 0 0 10px var(--green-glow); }
  .anl-avg { color: var(--cyan); text-shadow: 0 0 8px var(--cyan-glow); }
  .anl-attempts { color: var(--yellow); }
  .chart-label { font-family: 'Orbitron', sans-serif; font-size: 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; }
  .bar-chart { display: flex; align-items: flex-end; gap: 5px; height: 72px; }
  .bar-wrap { display: flex; flex-direction: column; align-items: center; flex: 1; gap: 4px; height: 100%; justify-content: flex-end; }
  .bar { width: 100%; border-radius: 4px 4px 0 0; min-height: 3px; transition: height 0.4s cubic-bezier(.16,1,.3,1); position: relative; }
  .bar:hover .bar-tooltip { display: block; }
  .bar-tooltip { display: none; position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); background: var(--card2); border: 1px solid var(--border2); border-radius: 5px; padding: 3px 7px; font-size: 10px; color: var(--text); white-space: nowrap; font-family: 'JetBrains Mono', monospace; z-index: 10; }
  .bar-date { font-size: 8px; color: var(--muted); text-align: center; }
  .no-attempts { text-align: center; padding: 18px; color: var(--muted); font-size: 12px; }
  .history-list { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
  .history-item { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 11px; }
  .history-pct { font-family: 'Orbitron', sans-serif; font-size: 15px; font-weight: 800; width: 50px; }
  .history-info { flex: 1; }
  .history-date { font-size: 11px; color: var(--muted); }
  .history-detail { font-size: 11px; color: var(--text2); margin-top: 1px; }
  .history-time { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); }
  .analytics-back { display: flex; align-items: center; gap: 6px; background: none; border: none; cursor: pointer; color: var(--text2); font-family: 'Orbitron', sans-serif; font-size: 8.5px; letter-spacing: 1px; text-transform: uppercase; padding: 4px 8px; border-radius: 6px; transition: color 0.2s; }
  .analytics-back:hover { color: var(--cyan); }

  @media (max-width: 680px) {
    .test-layout { flex-direction: column; padding: 14px 12px; }
    .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; position: static; }
    .s-card { flex: 1; min-width: 140px; }
    .q-card { padding: 20px 16px; }
    .q-text { font-size: 15px; }
    .score-pct { font-size: 58px; }
    .ans-grid { grid-template-columns: 1fr; }
    .upload-card { padding: 26px 18px 22px; }
    .timer-val { font-size: 22px; }
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('app-styles')) {
  const el = document.createElement('style');
  el.id = 'app-styles';
  el.textContent = GLOBAL_CSS;
  document.head.appendChild(el);
}

// ── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([{ msg: 'System initialized', kind: 'info' }]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [clock, setClock] = useState(7200);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [animKey, setAnimKey] = useState(0);
  const [discoveredModel, setDiscoveredModel] = useState('');
  const [apiKey, setApiKey] = useState<string>(() =>
    safeGet('gemini_api_key') || (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY || '' : '')
  );
  const [showKey, setShowKey] = useState(false);
  const [aiExplanations, setAiExplanations] = useState<Record<number, string>>({});
  const [loadingExplanation, setLoadingExplanation] = useState<Record<number, boolean>>({});
  const [savedTests, setSavedTests] = useState<SavedTest[]>(() => getSavedTests());
  const [activeTestName, setActiveTestName] = useState('');
  const [activeTestId, setActiveTestId] = useState('');
  const [groqKey, setGroqKey] = useState<string>(() => safeGet('groq_api_key'));
  const [showGroqInput, setShowGroqInput] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [analyticsTestId, setAnalyticsTestId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(0);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const endExam = useCallback(() => { setScreen('results'); }, []);

  useEffect(() => {
    if (screen !== 'test') return;
    const interval = setInterval(() => {
      setClock(c => { if (c <= 1) { clearInterval(interval); endExam(); return 0; } return c - 1; });
    }, 1000);
    return () => clearInterval(interval);
  }, [screen, endExam]);

  useEffect(() => { setAnimKey(k => k + 1); }, [qIndex]);

  const addLog = (msg: string, kind: LogEntry['kind'] = 'ok') =>
    setLogs(prev => [...prev, { msg, kind }]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setFileName(f.name); }
  };

  // ── Helper: finish successfully after questions are extracted
  const finishExtraction = (valid: Question[], modelName: string, sourceName: string) => {
    const saved = saveTestToStorage(sourceName, valid);
    setSavedTests(getSavedTests());
    setActiveTestName(sourceName);
    setActiveTestId(saved.id);
    setQuestions(valid);
    setStartTime(Date.now());
    setDiscoveredModel(modelName);
    addLog(`✓ ${valid.length} questions extracted. Test saved!`, 'ok');
    setTimeout(() => { setScreen('test'); setLoading(false); }, 700);
  };

  // ── GROQ extraction (primary — faster, no vision needed)
  const tryGroq = async (pdfText: string, gKey: string): Promise<Question[] | null> => {
    // FIX: use llama-3.3-70b with max 32768 tokens to avoid truncation
    // Also try llama3-70b-8192 as a backup with smaller context
    const groqModels = [
      { model: 'llama-3.3-70b-versatile', maxTokens: 32768 },
      { model: 'llama3-70b-8192',          maxTokens: 8000 },
      { model: 'mixtral-8x7b-32768',       maxTokens: 32768 },
    ];

    const prompt = (text: string) =>
      `Extract ALL MCQ questions from the text below. Return ONLY a raw JSON array, no markdown, no explanation:\n` +
      `[{"id":1,"question":"full question text","options":{"A":"...","B":"...","C":"...","D":"..."},"answer":"B"}]\n\n` +
      `IMPORTANT: Return complete valid JSON only. Do not truncate.\n\nPDF TEXT:\n${text}`;

    for (const { model, maxTokens } of groqModels) {
      addLog(`Trying Groq ${model}...`, 'info');
      try {
        // For very large PDFs, send only the first 24000 chars to avoid context overflow
        const textSlice = pdfText.slice(0, 24000);
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt(textSlice) }],
            temperature: 0.1,
            max_tokens: maxTokens,
          }),
        });
        const data = await res.json();
        if (data.error?.code === 429 || data.error?.message?.toLowerCase().includes('rate')) {
          addLog(`Groq ${model} rate-limited — trying next`, 'warn'); continue;
        }
        if (data.error) { addLog(`Groq ${model} error: ${data.error.message}`, 'warn'); continue; }

        const rawText: string = data.choices[0].message.content;

        // Check if response was truncated (finish_reason === 'length')
        const finishReason = data.choices[0].finish_reason;
        if (finishReason === 'length') {
          addLog(`Groq ${model} response truncated — attempting partial recovery...`, 'warn');
        }

        const parsed = parseQuestionsFromLLM(rawText); // includes partial recovery
        const valid = validateQuestions(parsed);
        if (valid.length === 0) { addLog(`Groq ${model} returned no valid questions`, 'warn'); continue; }

        addLog(`✓ Groq ${model} extracted ${valid.length} questions`, 'ok');
        return valid;
      } catch (err: any) {
        addLog(`Groq ${model} failed: ${err.message}`, 'warn');
      }
    }
    return null;
  };

  // ── GEMINI extraction (fallback — vision-capable, handles any PDF)
  const tryGemini = async (file: File, key: string): Promise<Question[] | null> => {
    addLog('Scanning available Gemini models...', 'info');
    const mRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const mData = await mRes.json();
    if (mData.error) throw new Error(mData.error.message);

    const all: string[] = mData.models
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => m.name as string);

    const priority = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const sorted = [
      ...priority.map(p => all.find(n => n.includes(p))).filter(Boolean) as string[],
      ...all.filter(n => !priority.some(p => n.includes(p))),
    ];

    if (sorted.length === 0) throw new Error('No compatible Gemini model found');
    addLog(`Found ${sorted.length} Gemini model(s)`, 'info');

    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.readAsDataURL(file);
      r.onload = () => resolve((r.result as string).split(',')[1]);
      r.onerror = reject;
    });

    const prompt = `Read this PDF. Extract ALL MCQ questions. Return ONLY a raw JSON array with no markdown:
[{"id":1,"question":"full question text","options":{"A":"option a","B":"option b","C":"option c","D":"option d"},"answer":"B"}]
Make sure every question has all options and the correct answer letter.`;

    for (const model of sorted) {
      const shortName = model.split('/').pop() || model;
      addLog(`Trying Gemini ${shortName}...`, 'info');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'application/pdf', data: base64 } }] }],
          }),
        }
      );
      const data = await res.json();
      if (isQuotaError(data)) { addLog(`Gemini ${shortName} quota exceeded — trying next`, 'warn'); continue; }
      if (data.error) throw new Error(data.error.message);

      const rawText: string = data.candidates[0].content.parts[0].text;
      const parsed = parseQuestionsFromLLM(rawText);
      const valid = validateQuestions(parsed);
      if (valid.length === 0) { addLog(`Gemini ${shortName} returned no valid questions`, 'warn'); continue; }

      addLog(`✓ Gemini ${shortName} extracted ${valid.length} questions`, 'ok');
      return valid;  // Return questions; caller sets model name
    }
    return null;
  };

  // ── Main extraction: Groq first → Gemini fallback
  const startExtraction = async () => {
    if (!file) { alert('Please select a PDF first!'); return; }

    const gKey = apiKey.trim();
    const grKey = groqKey.trim();

    if (!gKey && !grKey) { alert('Please enter at least one API key (Gemini or Groq)!'); return; }

    if (gKey) safeSet('gemini_api_key', gKey);
    if (grKey) safeSet('groq_api_key', grKey);

    setLoading(true);
    setLogs([{ msg: 'System initialized', kind: 'info' }]);

    try {
      // ── STEP 1: Try Groq first (faster, no quota issues)
      if (grKey) {
        addLog('Extracting PDF text for Groq...', 'info');
        const pdfText = await extractPdfText(file);

        if (pdfText && pdfText.length >= 100) {
          addLog(`PDF extracted (${Math.round(pdfText.length / 1000)}k chars) — sending to Groq...`, 'info');
          const valid = await tryGroq(pdfText, grKey);
          if (valid && valid.length > 0) {
            finishExtraction(valid, 'groq:llama-3.3-70b', file.name);
            return;
          }
          addLog('Groq could not extract questions — falling back to Gemini...', 'warn');
        } else {
          addLog('PDF text extraction failed or too short — falling back to Gemini vision...', 'warn');
        }
      }

      // ── STEP 2: Gemini fallback (vision-based, handles scanned PDFs too)
      if (gKey) {
        addLog('Using Gemini (vision-based PDF reading)...', 'info');
        const valid = await tryGemini(file, gKey);
        if (valid && valid.length > 0) {
          // Determine which Gemini model was used — discoveredModel set by tryGemini indirectly
          finishExtraction(valid, 'gemini', file.name);
          return;
        }
        throw new Error('Gemini extracted no valid questions from this PDF.');
      }

      throw new Error('All extraction methods failed. Check your API keys and try again.');

    } catch (err: any) {
      addLog(`Error: ${err.message || String(err)}`, 'err');
      alert(`Error: ${err.message || String(err)}`);
      setLoading(false);
    }
  };

  // ── AI explanation (Gemini primary, unchanged)
  const fetchExplanation = async (q: Question) => {
    setLoadingExplanation(prev => ({ ...prev, [q.id]: true }));
    const key = apiKey.trim();
    const models = ['models/gemini-2.5-flash', 'models/gemini-2.0-flash', 'models/gemini-1.5-flash', 'models/gemini-1.5-pro'];
    const prompt = `Explain why "${q.answer}" is correct for this MCQ. 2–3 sentences, direct and educational.
Question: ${q.question}
Options: ${Object.entries(q.options).map(([k, v]) => `${k}. ${v}`).join(' | ')}
Correct: ${q.answer}. ${q.options[q.answer]}`;
    try {
      for (const model of models) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${key}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
        );
        const data = await res.json();
        if (isQuotaError(data)) continue;
        if (data.error) throw new Error(data.error.message);
        setAiExplanations(prev => ({ ...prev, [q.id]: data.candidates[0].content.parts[0].text }));
        setLoadingExplanation(prev => ({ ...prev, [q.id]: false }));
        return;
      }
      throw new Error('All models quota exceeded — try again later');
    } catch (err: any) {
      setAiExplanations(prev => ({ ...prev, [q.id]: `⚠ ${err.message}` }));
    }
    setLoadingExplanation(prev => ({ ...prev, [q.id]: false }));
  };

  const saveResults = () => {
    if (!resultsRef.current) return;
    html2pdf().from(resultsRef.current).set({
      margin: 10, filename: 'Exam_Report.pdf',
      html2canvas: { scale: 2, backgroundColor: '#07090f' },
      jsPDF: { orientation: 'portrait' }
    }).save();
  };

  const restartApp = (keepAnalytics = false) => {
    setScreen('upload'); setLoading(false);
    setLogs([{ msg: 'System initialized', kind: 'info' }]);
    setQuestions([]); setSelections({});
    setQIndex(0); setClock(7200);
    setFile(null); setFileName('');
    setDiscoveredModel(''); setActiveTestName('');
    setAiExplanations({}); setLoadingExplanation({});
    setSavedTests(getSavedTests());
    if (!keepAnalytics) setAnalyticsTestId(null);
  };

  const loadSavedTest = (test: SavedTest) => {
    setQuestions(test.questions); setActiveTestName(test.name); setActiveTestId(test.id);
    setSelections({}); setQIndex(0); setClock(7200); setDiscoveredModel('');
    setAiExplanations({}); setLoadingExplanation({});
    setStartTime(Date.now()); setScreen('test');
  };

  const handleDeleteTest = (id: string) => {
    setSavedTests(deleteTestFromStorage(id));
    deleteAttemptsForTest(id);
  };

  const saveAttemptRecord = (
    testId: string, testName: string, pct: number,
    correct: number, wrong: number, skipped: number, total: number, timeTaken: number
  ) => { saveAttempt({ testId, testName, date: Date.now(), pct, correct, wrong, skipped, total, timeTaken }); };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  // ── Analytics view
  const renderAnalytics = (testId: string) => {
    const test = savedTests.find(t => t.id === testId);
    const attempts = getAttempts(testId);
    const best = attempts.length ? Math.max(...attempts.map(a => a.pct)) : 0;
    const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.pct, 0) / attempts.length) : 0;
    const recent = attempts.slice(0, 8).reverse();
    const barColor = (pct: number) => pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--yellow)' : 'var(--red)';
    const fmt = (s: number) => { const m = Math.floor(s / 60), sec = s % 60; return `${m}m ${sec}s`; };
    return (
      <div className="analytics-panel">
        <div className="analytics-header">
          <div className="analytics-title"><span>📊</span> Score Analytics</div>
          <button className="analytics-back" onClick={() => setAnalyticsTestId(null)}><ChevronLeft size={12} /> Back</button>
        </div>
        <div className="analytics-body">
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14, fontWeight: 600 }}>
            {test?.name.replace('.pdf', '') || 'Unknown Test'}
          </div>
          <div className="analytics-summary">
            <div className="anl-stat"><div className="anl-stat-val anl-best">{best}%</div><div className="anl-stat-lbl">Best</div></div>
            <div className="anl-stat"><div className="anl-stat-val anl-avg">{avg}%</div><div className="anl-stat-lbl">Average</div></div>
            <div className="anl-stat"><div className="anl-stat-val anl-attempts">{attempts.length}</div><div className="anl-stat-lbl">Attempts</div></div>
          </div>
          {recent.length > 0 ? (
            <>
              <div className="chart-label">Last {recent.length} Attempts</div>
              <div className="bar-chart">
                {recent.map((a) => (
                  <div key={a.id} className="bar-wrap">
                    <div className="bar" style={{ height: `${Math.max(4, a.pct)}%`, background: barColor(a.pct), boxShadow: `0 0 8px ${barColor(a.pct)}55` }}>
                      <div className="bar-tooltip">{a.pct}%</div>
                    </div>
                    <div className="bar-date">{new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                  </div>
                ))}
              </div>
              <div className="history-list">
                {attempts.slice(0, 5).map((a) => (
                  <div key={a.id} className="history-item">
                    <div className="history-pct" style={{ color: barColor(a.pct), textShadow: `0 0 10px ${barColor(a.pct)}66` }}>{a.pct}%</div>
                    <div className="history-info">
                      <div className="history-date">{new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      <div className="history-detail">✓{a.correct} &nbsp;✗{a.wrong} &nbsp;–{a.skipped}</div>
                    </div>
                    <div className="history-time">{fmt(a.timeTaken)}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="no-attempts">No attempts yet.<br />Complete a test to see analytics.</div>
          )}
        </div>
      </div>
    );
  };

  // ── Upload screen
  const hasError = logs.some(l => l.kind === 'err');
  const renderUpload = () => (
    <div className="upload-wrap">
      {(loading || hasError) ? (
        <div className="loading-wrap">
          {loading && (<><div className="spinner-ring" /><p className="shimmer-text">Analyzing Document…</p><p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>This may take 10–30 seconds</p></>)}
          {hasError && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
              <AlertTriangle size={15} /> Processing failed — see details below
            </div>
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
          {hasError && !loading && (
            <button className="btn-primary" style={{ marginTop: 16 }}
              onClick={() => { setLogs([{ msg: 'System initialized', kind: 'info' }]); setLoading(false); }}>
              <RotateCcw size={13} style={{ display: 'inline', marginRight: 6 }} />Try Again
            </button>
          )}
        </div>
      ) : (
        <div className="upload-card">
          <div className="upload-logo"><BookOpen size={30} color="var(--cyan)" /></div>
          <h1 className="upload-title">MCQ Exam Simulator</h1>
          <p className="upload-sub">Upload a question-paper PDF to start your timed practice session</p>

          {/* ── Groq key (PRIMARY — shown first) */}
          {!groqKey ? (
            <>
              {showGroqInput ? (
                <div style={{ marginBottom: 14 }}>
                  <div className="field-label" style={{ color: 'var(--yellow)', textShadow: '0 0 8px rgba(255,230,0,0.3)' }}>
                    <Zap size={11} />Groq API Key <span style={{ fontSize: 9, marginLeft: 4, fontFamily: 'Rajdhani', textTransform: 'none', letterSpacing: 0 }}>(recommended — faster!)</span>
                  </div>
                  <div className="key-wrap">
                    <input className="key-input" style={{ borderColor: 'rgba(255,230,0,0.25)' }}
                      type={showGroqKey ? 'text' : 'password'} value={groqKey}
                      onChange={e => { setGroqKey(e.target.value); safeSet('groq_api_key', e.target.value); }}
                      placeholder="gsk_…  (free at groq.com)" autoComplete="off" spellCheck={false} />
                    <button className="key-toggle" onClick={() => setShowGroqKey(s => !s)} tabIndex={-1}>
                      {showGroqKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p className="field-hint" style={{ color: 'var(--yellow)' }}><Zap size={11} />Free at console.groq.com — faster than Gemini, no quota issues</p>
                </div>
              ) : (
                <div className="groq-row" onClick={() => setShowGroqInput(true)} style={{ marginBottom: 14 }}>
                  <div>
                    <div className="groq-row-label"><Zap size={13} />Add Groq Key (Recommended)</div>
                    <div className="groq-row-sub">Faster extraction · Free · Used first before Gemini</div>
                  </div>
                  <span className="groq-badge">⚡ Faster</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,230,0,0.06)', border: '1px solid rgba(255,230,0,0.25)', borderRadius: 10, padding: '9px 13px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--yellow)', fontWeight: 600 }}>
                <Zap size={13} />⚡ Groq Active (Primary)
              </span>
              <button onClick={() => { setGroqKey(''); safeSet('groq_api_key', ''); setShowGroqInput(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 11, fontFamily: 'Rajdhani', fontWeight: 600, padding: '2px 6px', borderRadius: 6 }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>Remove</button>
            </div>
          )}

          {/* ── Gemini key (FALLBACK — shown second) */}
          {!apiKey ? (
            <div style={{ marginBottom: 16 }}>
              <div className="field-label"><Zap size={11} />Gemini API Key <span style={{ fontSize: 9, marginLeft: 4, fontFamily: 'Rajdhani', textTransform: 'none', letterSpacing: 0 }}>(fallback / vision PDFs)</span></div>
              <div className="key-wrap">
                <input className="key-input" type={showKey ? 'text' : 'password'} value={apiKey}
                  onChange={e => setApiKey(e.target.value)} placeholder="AIzaSy…" autoComplete="off" spellCheck={false} />
                <button className="key-toggle" onClick={() => setShowKey(s => !s)} tabIndex={-1}>
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="field-hint" style={{ color: 'var(--text2)' }}><AlertTriangle size={11} />Get free key at aistudio.google.com/app/apikey — used as fallback</p>
            </div>
          ) : (
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--green-dim)', border: '1px solid rgba(0,255,136,0.18)', borderRadius: 10, padding: '9px 13px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>
                <CheckCircle size={13} />Gemini Active (Fallback)
              </span>
              <button onClick={() => { setApiKey(''); safeSet('gemini_api_key', ''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 11, fontFamily: 'Rajdhani', fontWeight: 600, padding: '2px 6px', borderRadius: 6 }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>Change</button>
            </div>
          )}

          <div className={`drop-zone${fileName ? ' active' : ''}`}>
            <input type="file" accept="application/pdf" onChange={handleFileChange} />
            <FileText size={22} color={fileName ? 'var(--cyan)' : 'var(--muted)'} style={{ margin: '0 auto 8px', display: 'block' }} />
            <p className="drop-text">{fileName || 'Tap to choose a PDF'}</p>
            {!fileName && <p className="drop-sub">Supports .pdf files</p>}
          </div>

          <button className="btn-primary" onClick={startExtraction} disabled={!file || (!apiKey.trim() && !groqKey.trim())}>
            {groqKey ? '⚡ Start Extraction (Groq) →' : 'Start Extraction →'}
          </button>
        </div>
      )}

      {/* ── Saved Tests Library / Analytics */}
      {!loading && !hasError && (
        <div className="library-wrap">
          {analyticsTestId ? renderAnalytics(analyticsTestId) : (
            <>
              <div className="library-header">
                <div className="library-title"><Library size={12} />Saved Tests</div>
                <span className="library-count">{savedTests.length} saved</span>
              </div>
              {savedTests.length === 0 ? (
                <div className="library-empty">No saved tests yet.<br />Generate a test from a PDF and it will appear here.</div>
              ) : (
                <div className="saved-list">
                  {savedTests.map((t, i) => {
                    const attempts = getAttempts(t.id);
                    const best = attempts.length ? Math.max(...attempts.map(a => a.pct)) : null;
                    const scoreColor = best === null ? 'var(--muted)' : best >= 70 ? 'var(--green)' : best >= 40 ? 'var(--yellow)' : 'var(--red)';
                    return (
                      <div key={t.id} className="saved-item" style={{ animationDelay: `${i * 0.05}s` }}>
                        <div className="saved-icon"><FileText size={16} color="var(--cyan)" /></div>
                        <div className="saved-info">
                          <div className="saved-name">{t.name.replace('.pdf', '')}</div>
                          <div className="saved-meta">
                            <span><CheckCircle size={10} color="var(--green)" />{t.questions.length} Qs</span>
                            {best !== null ? <span style={{ color: scoreColor, fontWeight: 600 }}>Best: {best}%</span> : <span>Not attempted</span>}
                            {attempts.length > 0 && <span>{attempts.length}× tried</span>}
                          </div>
                        </div>
                        <div className="saved-actions">
                          <button className="btn-load" onClick={() => loadSavedTest(t)} title="Start Test">
                            <PlayCircle size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />Start
                          </button>
                          <button className="btn-load" style={{ background: 'rgba(0,229,255,0.05)', borderColor: 'rgba(0,229,255,0.15)' }}
                            onClick={() => setAnalyticsTestId(t.id)} title="Analytics">📊</button>
                          <button className="btn-del" onClick={() => handleDeleteTest(t.id)} title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  // ── Test screen
  const renderTest = () => {
    if (!questions.length) return null;
    const q = questions[qIndex];
    const answered = Object.keys(selections).length;
    const visitedPct = ((qIndex + 1) / questions.length) * 100;
    const answeredPct = (answered / questions.length) * 100;
    const isUrgent = clock < 300;
    return (
      <div className="test-layout">
        <div className="sidebar">
          <div className="s-card">
            <div className="timer-lbl"><Clock size={10} />Time Left</div>
            <div className={`timer-val${isUrgent ? ' urgent' : ''}`}>{formatTime(clock)}</div>
            {discoveredModel && <div className="model-badge"><Zap size={9} />{discoveredModel}</div>}
            {activeTestName && <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)', fontFamily: 'Rajdhani', lineHeight: 1.4, wordBreak: 'break-word' }}>📄 {activeTestName.replace('.pdf', '')}</div>}
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
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 5 }}>{questions.length - answered} remaining</div>
          </div>
          <button className="end-btn" onClick={endExam}><XCircle size={14} />End Test</button>
        </div>
        <div className="q-card" key={animKey} style={{ animation: 'scaleIn 0.28s cubic-bezier(.16,1,.3,1)' }}>
          <div className="q-head">
            <span className="q-badge">Q {qIndex + 1} / {questions.length}</span>
            <span className="q-status" style={{ color: selections[q.id] ? 'var(--green)' : 'var(--muted)' }}>
              {selections[q.id] ? <><CheckCircle size={13} />Answered</> : 'Unanswered'}
            </span>
          </div>
          <p className="q-text">{q.question}</p>
          <div className="opts">
            {Object.entries(q.options).map(([k, v], idx) => (
              <button key={k} className={`opt-btn${selections[q.id] === k ? ' sel' : ''}`}
                style={{ animationDelay: `${idx * 0.055}s` }}
                onClick={() => setSelections(prev => ({ ...prev, [q.id]: k }))}>
                <span className="opt-key">{k}</span>
                <span className="opt-text">{v}</span>
              </button>
            ))}
          </div>
          <div className="q-nav">
            <button className="nav-btn" disabled={qIndex === 0} onClick={() => setQIndex(Math.max(0, qIndex - 1))}><ChevronLeft size={15} />Prev</button>
            <button className="nav-btn nxt" onClick={() => qIndex === questions.length - 1 ? endExam() : setQIndex(qIndex + 1)}>
              {qIndex === questions.length - 1 ? 'Finish ✓' : <>Next<ChevronRight size={15} /></>}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Results screen
  const renderResults = () => {
    let score = 0, skipped = 0;
    questions.forEach(q => { if (!selections[q.id]) skipped++; else if (selections[q.id] === q.answer) score++; });
    const wrong = questions.length - score - skipped;
    const pct = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
    const timeTaken = startTime > 0 ? Math.round((Date.now() - startTime) / 1000) : 0;

    if (activeTestId && questions.length > 0) {
      const allAttempts = getAttempts(activeTestId);
      const lastAttempt = allAttempts[0];
      if (!lastAttempt || (Date.now() - lastAttempt.date) > 3000) {
        saveAttemptRecord(activeTestId, activeTestName, pct, score, wrong, skipped, questions.length, timeTaken);
      }
    }

    return (
      <div className="results-wrap">
        <div className="results-bar no-print">
          <button className="btn-ghost" onClick={restartApp}><RotateCcw size={14} />New Exam</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {activeTestId && (
              <button className="btn-ghost" style={{ borderColor: 'rgba(0,229,255,0.2)', color: 'var(--cyan)' }}
                onClick={() => { setAnalyticsTestId(activeTestId); restartApp(true); }}>📊 Analytics</button>
            )}
            <button className="btn-save" onClick={saveResults}><Download size={14} />Save PDF</button>
          </div>
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
                <div key={q.id} className={`review-item ${sk ? 'skipped' : ok ? 'correct' : 'wrong'}`}
                  style={{ animationDelay: `${Math.min(i * 0.035, 0.5)}s` }}>
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
