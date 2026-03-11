import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, Upload, AlertCircle, RotateCcw, Zap, FileText, BookOpen, Key, Trash2, Play, ChevronDown, ChevronUp, History, Plus } from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Question { id: number; question: string; options: Record<string, string>; answer: string; }
type Screen = 'home' | 'test' | 'results';
interface LogEntry { msg: string; kind: 'ok' | 'err' | 'warn' | 'info'; }
interface SavedTest {
  id: string;
  name: string;
  questions: Question[];
  savedAt: number;
  attempts: number;
  lastScore?: number;
}

/* ─── Storage Helpers ────────────────────────────────────────────────────── */
const safeGet = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { } };

const loadSavedTests = (): SavedTest[] => {
  try { return JSON.parse(localStorage.getItem('exam_saved_tests') || '[]'); } catch { return []; }
};
const persistSavedTests = (tests: SavedTest[]) => {
  try { localStorage.setItem('exam_saved_tests', JSON.stringify(tests)); } catch { }
};

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

const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
const timeAgo = (ts: number) => {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#060810;--surface:#0b0e18;--card:#0f1320;--card2:#141829;
    --border:#1e2540;--border2:#2a3358;
    --gold:#f0b429;--gold2:#ffd166;--gold-glow:rgba(240,180,41,0.2);
    --green:#0ecf7c;--green-dim:rgba(14,207,124,0.12);
    --red:#f0454a;--red-dim:rgba(240,69,74,0.1);
    --blue:#4d7cfe;--purple:#8b5cf6;
    --text:#e6e9f8;--text2:#7a84a8;--muted:#2d3550;
    --font:'Syne',sans-serif;--mono:'JetBrains Mono',monospace;
  }
  html,body{background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;}
  body::after{
    content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
    background:
      radial-gradient(ellipse 60% 40% at 15% 10%,rgba(77,124,254,0.07) 0%,transparent 70%),
      radial-gradient(ellipse 50% 35% at 85% 85%,rgba(240,180,41,0.06) 0%,transparent 65%);
  }

  /* ── HOME / UPLOAD ── */
  .home-wrap{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:40px 24px;position:relative;z-index:1;}
  .home-inner{width:100%;max-width:520px;display:flex;flex-direction:column;gap:20px;}

  /* Header */
  .app-header{display:flex;align-items:center;gap:14px;margin-bottom:4px;}
  .app-icon{width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,#f5b942,#e07b10);display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 8px 24px rgba(240,180,41,0.3);flex-shrink:0;}
  .app-name{font-size:26px;font-weight:800;letter-spacing:-1px;}
  .app-sub{font-size:12px;color:var(--text2);margin-top:2px;}

  /* Panel */
  .panel{background:linear-gradient(160deg,#111827 0%,#0c1120 100%);border:1px solid var(--border);border-radius:20px;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.03);}
  .panel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
  .panel-title{font-size:13px;font-weight:700;letter-spacing:0.5px;display:flex;align-items:center;gap:7px;}
  .panel-badge{font-size:10px;background:var(--surface);border:1px solid var(--border);border-radius:99px;padding:2px 8px;color:var(--text2);font-family:var(--mono);}

  /* Form */
  .lbl{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--text2);text-transform:uppercase;margin-bottom:9px;}
  .key-input{width:100%;background:var(--surface);border:1.5px solid var(--border);border-radius:11px;padding:12px 15px;color:var(--text);font-family:var(--mono);font-size:13px;outline:none;transition:border-color 0.2s,box-shadow 0.2s;margin-bottom:18px;}
  .key-input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(77,124,254,0.1);}
  .key-input::placeholder{color:var(--muted);}

  .drop-zone{background:var(--surface);border:1.5px dashed var(--border2);border-radius:13px;padding:22px 20px;text-align:center;cursor:pointer;transition:all 0.25s;position:relative;overflow:hidden;margin-bottom:16px;}
  .drop-zone:hover,.drop-zone.dz-on{border-color:var(--gold);background:rgba(240,180,41,0.04);}
  .drop-zone input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;}
  .dz-file{display:flex;align-items:center;justify-content:center;gap:9px;color:var(--gold);font-weight:700;font-size:14px;}
  .dz-fname{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

  .go-btn{width:100%;padding:14px;border:none;border-radius:13px;cursor:pointer;background:linear-gradient(135deg,#f5b942,#e07b10);color:#000;font-family:var(--font);font-weight:800;font-size:15px;transition:all 0.25s;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 16px rgba(240,180,41,0.2);}
  .go-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 10px 32px rgba(240,180,41,0.4);}
  .go-btn:disabled{opacity:0.35;cursor:not-allowed;transform:none;box-shadow:none;}

  .key-saved-row{display:flex;align-items:center;justify-content:space-between;background:rgba(14,207,124,0.07);border:1px solid rgba(14,207,124,0.2);border-radius:11px;padding:11px 14px;margin-bottom:18px;}
  .key-saved-info{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--green);}
  .key-masked{font-family:var(--mono);font-size:12px;color:var(--text2);background:var(--surface);padding:2px 8px;border-radius:5px;border:1px solid var(--border);}
  .key-change-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:5px 12px;color:var(--text2);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.18s;}
  .key-change-btn:hover{border-color:var(--border2);color:var(--text);}

  /* Loading */
  .load-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;position:relative;z-index:1;}
  .load-panel{width:100%;max-width:460px;background:linear-gradient(160deg,#111827,#0c1120);border:1px solid var(--border);border-radius:24px;padding:36px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,0.6);}
  .spinner{width:48px;height:48px;border:3px solid var(--border2);border-top-color:var(--gold);border-radius:50%;margin:0 auto 20px;animation:spin 0.65s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}
  .load-h{font-size:17px;font-weight:700;margin-bottom:4px;}
  .load-s{font-size:12px;color:var(--text2);margin-bottom:18px;}

  .log-box{background:#000;border:1px solid var(--border);border-radius:12px;padding:14px 16px;max-height:160px;overflow-y:auto;font-family:var(--mono);font-size:11px;text-align:left;scrollbar-width:thin;scrollbar-color:var(--border) transparent;}
  .log-line{padding:2.5px 0;display:flex;gap:8px;align-items:baseline;}
  .log-pfx{color:var(--muted);flex-shrink:0;}

  /* ── SAVED TESTS LIST ── */
  .saved-empty{text-align:center;padding:28px 16px;color:var(--text2);font-size:13px;}
  .saved-empty-icon{font-size:32px;margin-bottom:8px;opacity:0.4;}

  .test-card{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:15px 16px;display:flex;align-items:center;gap:14px;transition:border-color 0.2s,background 0.2s;margin-bottom:9px;}
  .test-card:last-child{margin-bottom:0;}
  .test-card:hover{border-color:var(--border2);background:rgba(255,255,255,0.03);}
  .tc-icon{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(77,124,254,0.2),rgba(77,124,254,0.08));border:1px solid rgba(77,124,254,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .tc-body{flex:1;min-width:0;}
  .tc-name{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;}
  .tc-meta{font-size:11px;color:var(--text2);display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .tc-dot{width:3px;height:3px;background:var(--muted);border-radius:50%;}
  .tc-score{font-family:var(--mono);font-weight:600;}
  .tc-actions{display:flex;gap:7px;flex-shrink:0;}
  .tc-btn{width:34px;height:34px;border-radius:9px;border:1px solid var(--border);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.18s;color:var(--text2);}
  .tc-btn:hover{background:var(--border);color:var(--text);}
  .tc-btn.play{background:rgba(240,180,41,0.1);border-color:rgba(240,180,41,0.3);color:var(--gold);}
  .tc-btn.play:hover{background:rgba(240,180,41,0.2);}
  .tc-btn.del:hover{background:var(--red-dim);border-color:rgba(240,69,74,0.3);color:var(--red);}

  /* mini log on home */
  .mini-log{margin-top:14px;}

  /* ── TEST ── */
  .test-wrap{display:flex;min-height:100vh;position:relative;z-index:1;}
  .sidebar{width:256px;flex-shrink:0;background:var(--card);border-right:1px solid var(--border);padding:20px 18px;display:flex;flex-direction:column;gap:14px;position:sticky;top:0;height:100vh;overflow-y:auto;}
  .sb-brand{display:flex;align-items:center;gap:10px;padding-bottom:4px;}
  .sb-icon{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#f5b942,#e07b10);display:flex;align-items:center;justify-content:center;font-size:15px;}

  .timer-card{background:var(--surface);border:1px solid var(--border2);border-radius:14px;padding:14px 12px;text-align:center;}
  .timer-lbl{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text2);margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:4px;}
  .timer-val{font-family:var(--mono);font-size:32px;font-weight:600;letter-spacing:3px;}
  .timer-val.red{color:var(--red);animation:blink 1s ease infinite;}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0.4}}

  .prog-wrap{}
  .prog-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-size:11px;color:var(--text2);}
  .prog-pct{font-family:var(--mono);font-weight:600;color:var(--text);}
  .prog-track{height:5px;background:var(--border);border-radius:99px;overflow:hidden;}
  .prog-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--gold),var(--gold2));transition:width 0.5s cubic-bezier(.4,0,.2,1);}

  .duo{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .mini-stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 6px;text-align:center;}
  .mini-num{font-size:22px;font-weight:800;font-family:var(--mono);line-height:1;}
  .mini-lbl{font-size:9px;text-transform:uppercase;letter-spacing:0.8px;color:var(--text2);margin-top:4px;}

  .nav-grid-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text2);margin-bottom:8px;}
  .nav-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;}
  .nd{aspect-ratio:1;border-radius:7px;cursor:pointer;font-family:var(--mono);font-size:9px;font-weight:600;border:1px solid var(--border);background:var(--surface);color:var(--muted);display:flex;align-items:center;justify-content:center;transition:all 0.15s;}
  .nd:hover{border-color:var(--gold);color:var(--gold);}
  .nd.ans{background:var(--green-dim);border-color:var(--green);color:var(--green);}
  .nd.cur{background:rgba(240,180,41,0.15);border-color:var(--gold);color:var(--gold);}

  .quit-btn{width:100%;margin-top:auto;background:var(--red-dim);border:1px solid rgba(240,69,74,0.25);color:var(--red);font-family:var(--font);font-weight:700;font-size:13px;border-radius:12px;padding:11px;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:7px;}
  .quit-btn:hover{background:rgba(240,69,74,0.18);border-color:rgba(240,69,74,0.45);}

  .q-main{flex:1;padding:28px 24px;display:flex;justify-content:center;align-items:flex-start;}
  .q-card{width:100%;max-width:680px;background:linear-gradient(160deg,#111827,#0c1120);border:1px solid var(--border);border-radius:22px;padding:30px;box-shadow:0 20px 60px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.03);}
  .q-topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;}
  .q-pill{background:rgba(240,180,41,0.1);border:1px solid rgba(240,180,41,0.25);color:var(--gold);font-size:11px;font-weight:700;padding:5px 13px;border-radius:99px;font-family:var(--mono);}
  .q-status{font-size:11px;font-weight:600;display:flex;align-items:center;gap:5px;}
  .q-body{font-size:17px;font-weight:600;line-height:1.7;margin-bottom:22px;color:var(--text);}

  .opt{width:100%;display:flex;align-items:flex-start;gap:13px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:13px;padding:14px 16px;margin-bottom:9px;text-align:left;color:var(--text);cursor:pointer;transition:border-color 0.18s,background 0.18s;font-family:var(--font);}
  .opt:hover{border-color:var(--border2);background:rgba(255,255,255,0.04);}
  .opt.picked{border-color:var(--gold);background:rgba(240,180,41,0.07);}
  /* Result mode */
  .opt.correct{border-color:var(--green);background:var(--green-dim);}
  .opt.wrong{border-color:var(--red);background:var(--red-dim);}
  .opt-k{min-width:28px;height:28px;border-radius:7px;flex-shrink:0;background:var(--border);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--text2);transition:background 0.18s,color 0.18s;}
  .opt.picked .opt-k{background:var(--gold);color:#000;}
  .opt.correct .opt-k{background:var(--green);color:#000;}
  .opt.wrong .opt-k{background:var(--red);color:#fff;}
  .opt-v{font-size:14px;line-height:1.55;padding-top:4px;}

  .q-footer{display:flex;gap:10px;margin-top:22px;}
  .f-btn{flex:1;padding:13px;border-radius:12px;cursor:pointer;font-family:var(--font);font-weight:800;font-size:14px;border:1px solid var(--border);transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:6px;}
  .f-prev{background:var(--surface);color:var(--text2);flex:0.55;}
  .f-prev:hover:not(:disabled){border-color:var(--border2);color:var(--text);}
  .f-prev:disabled{opacity:0.25;cursor:not-allowed;}
  .f-next{background:linear-gradient(135deg,var(--gold),#e07b10);color:#000;border-color:transparent;}
  .f-next:hover{transform:translateY(-1px);box-shadow:0 8px 24px var(--gold-glow);}
  .f-finish{background:linear-gradient(135deg,var(--green),#08a060);color:#000;border-color:transparent;}
  .f-finish:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(14,207,124,0.25);}

  /* ── RESULTS ── */
  .res-page{max-width:780px;margin:0 auto;padding:36px 24px;position:relative;z-index:1;}
  .res-top{text-align:center;margin-bottom:32px;}
  .res-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:2.5px;color:var(--text2);margin-bottom:20px;}
  .ring-wrap{display:flex;justify-content:center;margin-bottom:16px;}
  .ring{width:168px;height:168px;border-radius:50%;position:relative;display:flex;align-items:center;justify-content:center;background:conic-gradient(var(--gold) calc(var(--pct,0)*1%),var(--border) 0%);box-shadow:0 0 40px var(--gold-glow);}
  .ring::before{content:'';position:absolute;inset:14px;background:var(--bg);border-radius:50%;}
  .ring-val{position:relative;z-index:1;font-family:var(--mono);font-size:38px;font-weight:700;color:var(--gold);}
  .res-verdict{font-size:15px;font-weight:600;color:var(--text2);}

  .res-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}
  .r4{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 10px;text-align:center;}
  .r4-n{font-size:28px;font-weight:800;font-family:var(--mono);}
  .r4-l{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--text2);margin-top:5px;}

  .res-btns{display:flex;gap:10px;margin-bottom:28px;}
  .r-btn{flex:1;padding:13px;border-radius:13px;cursor:pointer;font-family:var(--font);font-weight:800;font-size:14px;border:1px solid var(--border);transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;}
  .r-primary{background:linear-gradient(135deg,var(--gold),#e07b10);color:#000;border-color:transparent;}
  .r-primary:hover{transform:translateY(-1px);box-shadow:0 8px 24px var(--gold-glow);}
  .r-ghost{background:var(--surface);color:var(--text2);}
  .r-ghost:hover{color:var(--text);border-color:var(--border2);}

  .rev-title{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:var(--text2);margin-bottom:12px;}
  .rev-item{background:var(--card);border-radius:14px;padding:16px 18px;margin-bottom:9px;border-left:3px solid var(--muted);}
  .rev-item.c{border-left-color:var(--green);}
  .rev-item.w{border-left-color:var(--red);}
  .rev-meta{font-size:10px;color:var(--text2);font-family:var(--mono);margin-bottom:7px;}
  .rev-q{font-size:14px;font-weight:600;line-height:1.55;margin-bottom:10px;}
  .chips{display:flex;gap:7px;flex-wrap:wrap;}
  .chip{font-size:11px;font-family:var(--mono);padding:3px 10px;border-radius:6px;border:1px solid;}
  .c-yours{background:rgba(77,124,254,0.1);border-color:rgba(77,124,254,0.3);color:#8ab4ff;}
  .c-ans{background:var(--green-dim);border-color:rgba(14,207,124,0.3);color:var(--green);}
  .c-skip{background:rgba(45,53,80,0.5);border-color:var(--muted);color:var(--text2);}

  /* Review mode banner */
  .review-banner{background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#c4b5fd;}
  .review-banner b{color:#a78bfa;}

  @media(max-width:768px){
    .test-wrap{flex-direction:column;}
    .sidebar{width:100%;height:auto;position:relative;border-right:none;border-bottom:1px solid var(--border);}
    .q-main{padding:16px;}
    .res-4{grid-template-columns:repeat(2,1fr);}
    .res-btns{flex-wrap:wrap;}
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('exam-v3')) {
  const el = document.createElement('style');
  el.id = 'exam-v3';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* ─── QuestionCard ───────────────────────────────────────────────────────── */
const QuestionCard = memo(({ q, qi, total, sel, onSel, onNext, onPrev, onEnd, reviewMode }: any) => (
  <div className="q-card">
    <div className="q-topbar">
      <span className="q-pill">Q {qi + 1} / {total}</span>
      <span className="q-status" style={{ color: sel ? 'var(--green)' : 'var(--muted)' }}>
        {sel ? <><CheckCircle size={13} /> Answered</> : <><AlertCircle size={13} /> Unanswered</>}
      </span>
    </div>

    <p className="q-body">{q.question}</p>

    {Object.entries(q.options).map(([k, v]: any) => {
      let cls = 'opt';
      if (reviewMode) {
        if (k === q.answer) cls += ' correct';
        else if (k === sel && sel !== q.answer) cls += ' wrong';
      } else if (sel === k) cls += ' picked';
      return (
        <button key={k} className={cls} onClick={() => !reviewMode && onSel(q.id, k)} style={reviewMode ? { cursor: 'default' } : {}}>
          <span className="opt-k">{k}</span>
          <span className="opt-v">{v}</span>
        </button>
      );
    })}

    <div className="q-footer">
      <button className="f-btn f-prev" disabled={qi === 0} onClick={onPrev}>
        <ChevronLeft size={15} /> Prev
      </button>
      {qi === total - 1
        ? <button className="f-btn f-finish" onClick={onEnd}><CheckCircle size={14} /> {reviewMode ? 'Done' : 'Finish'}</button>
        : <button className="f-btn f-next" onClick={onNext}>Next <ChevronRight size={15} /></button>}
    </div>
  </div>
));

/* ─── App ────────────────────────────────────────────────────────────────── */
export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([{ msg: 'Ready.', kind: 'info' }]);

  // Active test state
  const [activeTest, setActiveTest] = useState<SavedTest | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [qi, setQi] = useState(0);
  const [clock, setClock] = useState(0);
  const [reviewMode, setReviewMode] = useState(false);

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState(() => safeGet('gemini_api_key'));
  const [dragging, setDragging] = useState(false);

  // Saved tests
  const [savedTests, setSavedTests] = useState<SavedTest[]>(loadSavedTests);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const endExam = useCallback(() => setScreen('results'), []);

  useEffect(() => {
    if (screen !== 'test' || reviewMode) return;
    const inv = setInterval(() => setClock(c => {
      if (c <= 1) { clearInterval(inv); endExam(); return 0; }
      return c - 1;
    }), 1000);
    return () => clearInterval(inv);
  }, [screen, endExam, reviewMode]);

  const log = (msg: string, kind: LogEntry['kind'] = 'ok') =>
    setLogs(p => [...p, { msg, kind }]);

  /* Save a test to localStorage */
  const saveTest = (name: string, questions: Question[]) => {
    const id = `test_${Date.now()}`;
    const newTest: SavedTest = { id, name, questions, savedAt: Date.now(), attempts: 0 };
    const updated = [newTest, ...savedTests];
    setSavedTests(updated);
    persistSavedTests(updated);
    return newTest;
  };

  /* Update attempt count + last score */
  const recordAttempt = (testId: string, score: number) => {
    const updated = savedTests.map(t =>
      t.id === testId ? { ...t, attempts: t.attempts + 1, lastScore: score } : t
    );
    setSavedTests(updated);
    persistSavedTests(updated);
  };

  /* Delete a saved test */
  const deleteTest = (id: string) => {
    const updated = savedTests.filter(t => t.id !== id);
    setSavedTests(updated);
    persistSavedTests(updated);
  };

  /* Launch a saved test */
  const launchTest = (test: SavedTest, review = false) => {
    setActiveTest(test);
    setSelections({});
    setQi(0);
    setClock(test.questions.length * 90);
    setReviewMode(review);
    setScreen('test');
  };

  const handleFile = async (f: File) => {
    if (f.size / 1024 / 1024 > 4) {
      setCompressing(true); log('Large file — compressing...', 'info');
      try {
        const PL = await loadPdfLib();
        const doc = await PL.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        setFile(new File([await doc.save({ useObjectStreams: true })], f.name, { type: 'application/pdf' }));
        log('Compression done', 'ok');
      } catch { setFile(f); log('Compression skipped', 'warn'); }
      setCompressing(false);
    } else { setFile(f); log(`Loaded: ${f.name}`, 'ok'); }
  };

  const start = async () => {
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
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { text: `Extract all multiple choice questions from this PDF.\nReturn a valid JSON array only (no markdown, no explanation).\nEach object must have:\n- "id": integer\n- "question": string\n- "options": object with keys "A","B","C","D"\n- "answer": the correct key e.g. "A"\nExample: [{"id":1,"question":"What is 2+2?","options":{"A":"3","B":"4","C":"5","D":"6"},"answer":"B"}]` },
                    { inline_data: { mime_type: 'application/pdf', data: b64 } }
                  ]
                }]
              })
            }
          );
          const d = await res.json();
          if (d.error) { if (d.error.code === 429) { log(`${model}: rate limited`, 'warn'); continue; } throw new Error(d.error.message); }
          raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
          log(`Response from ${model}`, 'ok');
          break;
        } catch (e: any) { log(`${model}: ${e.message}`, 'warn'); }
      }

      if (!raw) throw new Error('All models failed — check API key');
      const data = safeParseJSON(raw);
      if (!data || data.length === 0) throw new Error('Could not parse questions from this PDF');

      log(`Extracted ${data.length} questions — saving test...`, 'ok');

      // ✅ Save the test so user never needs to re-upload
      const testName = file!.name.replace(/\.pdf$/i, '');
      const saved = saveTest(testName, data);

      log(`Saved as "${testName}"`, 'ok');
      setTimeout(() => {
        setLoading(false);
        launchTest(saved);
      }, 400);
      return;
    } catch (e: any) {
      log(`Error: ${e.message}`, 'err');
    }
    setLoading(false);
  };

  /* Stats from current selections */
  const stats = useMemo(() => {
    if (!activeTest) return { correct: 0, wrong: 0, skipped: 0, pct: 0 };
    const correct = activeTest.questions.filter(q => selections[q.id] === q.answer).length;
    const attempted = Object.keys(selections).length;
    const pct = activeTest.questions.length ? Math.round((correct / activeTest.questions.length) * 100) : 0;
    return { correct, wrong: attempted - correct, skipped: activeTest.questions.length - attempted, pct };
  }, [activeTest, selections]);

  const lc = (k: LogEntry['kind']) =>
    k === 'err' ? '#f0454a' : k === 'ok' ? '#0ecf7c' : k === 'warn' ? '#f5b942' : '#7a84a8';

  /* ══ HOME SCREEN ══ */
  if (screen === 'home') {
    const busy = loading || compressing;
    if (busy) return (
      <div className="load-wrap">
        <div className="load-panel">
          <div className="spinner" />
          <div className="load-h">{compressing ? 'Compressing PDF...' : 'Extracting Questions...'}</div>
          <div className="load-s">Powered by Gemini AI · please wait</div>
          <div className="log-box">
            {logs.map((l, i) => <div key={i} className="log-line" style={{ color: lc(l.kind) }}><span className="log-pfx">›</span><span>{l.msg}</span></div>)}
            <div ref={endRef} />
          </div>
        </div>
      </div>
    );

    return (
      <div className="home-wrap">
        <div className="home-inner">
          {/* Header */}
          <div className="app-header">
            <div className="app-icon">📝</div>
            <div>
              <div className="app-name">Exam Simulator</div>
              <div className="app-sub">AI-powered MCQ practice · Gemini</div>
            </div>
          </div>

          {/* Saved Tests */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <History size={14} color="var(--blue)" /> Saved Tests
              </div>
              <span className="panel-badge">{savedTests.length} saved</span>
            </div>

            {savedTests.length === 0 ? (
              <div className="saved-empty">
                <div className="saved-empty-icon">📂</div>
                <div>No saved tests yet.</div>
                <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>Upload a PDF below to generate & save your first test.</div>
              </div>
            ) : (
              savedTests.map(t => (
                <div key={t.id} className="test-card">
                  <div className="tc-icon"><FileText size={18} color="var(--blue)" /></div>
                  <div className="tc-body">
                    <div className="tc-name" title={t.name}>{t.name}</div>
                    <div className="tc-meta">
                      <span>{t.questions.length} questions</span>
                      <span className="tc-dot" />
                      <span>{timeAgo(t.savedAt)}</span>
                      {t.attempts > 0 && <><span className="tc-dot" /><span>{t.attempts} attempt{t.attempts > 1 ? 's' : ''}</span></>}
                      {t.lastScore !== undefined && (
                        <><span className="tc-dot" />
                        <span className="tc-score" style={{ color: t.lastScore >= 70 ? 'var(--green)' : t.lastScore >= 40 ? 'var(--gold)' : 'var(--red)' }}>
                          Last: {t.lastScore}%
                        </span></>
                      )}
                    </div>
                  </div>
                  <div className="tc-actions">
                    <button className="tc-btn play" title="Start test" onClick={() => launchTest(t)}>
                      <Play size={14} fill="var(--gold)" />
                    </button>
                    <button className="tc-btn del" title="Delete" onClick={() => deleteTest(t.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* New Test */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title"><Plus size={14} color="var(--gold)" /> New Test from PDF</div>
            </div>

            {apiKey.trim() ? (
              <div className="key-saved-row">
                <div className="key-saved-info">
                  <Key size={13} color="var(--green)" />
                  <span>API key saved</span>
                  <span className="key-masked">{apiKey.slice(0, 8)}••••••••</span>
                </div>
                <button className="key-change-btn" onClick={() => setApiKey('')}>Change</button>
              </div>
            ) : (
              <>
                <div className="lbl"><Key size={10} /> Gemini API Key</div>
                <input
                  className="key-input"
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  onBlur={e => {
                    const clean = e.target.value.replace(/\s+/g, '').trim();
                    setApiKey(clean);
                    if (clean) safeSet('gemini_api_key', clean);
                  }}
                  placeholder="AIzaSy..."
                  autoComplete="off"
                />
              </>
            )}

            <div className="lbl"><FileText size={10} /> Upload PDF</div>
            <div
              className={`drop-zone${dragging ? ' dz-on' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
            >
              <input type="file" accept="application/pdf" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {file ? (
                <div className="dz-file"><FileText size={15} /><span className="dz-fname">{file.name}</span></div>
              ) : (
                <>
                  <div style={{ marginBottom: 9 }}><Upload size={22} color="var(--text2)" /></div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Drop PDF here or tap to browse</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>Questions auto-extracted & saved</div>
                </>
              )}
            </div>

            <button className="go-btn" disabled={!file || !apiKey.trim()} onClick={start}>
              <Zap size={15} /> Generate & Save Test
            </button>

            {logs.length > 1 && (
              <div className="log-box mini-log">
                {logs.map((l, i) => <div key={i} className="log-line" style={{ color: lc(l.kind) }}><span className="log-pfx">›</span><span>{l.msg}</span></div>)}
                <div ref={endRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ══ TEST SCREEN ══ */
  if (screen === 'test' && activeTest) {
    const answered = Object.keys(selections).length;
    const pct = Math.round((answered / activeTest.questions.length) * 100);

    return (
      <div className="test-wrap">
        <div className="sidebar">
          <div className="sb-brand">
            <div className="sb-icon">📝</div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {reviewMode ? 'Review Mode' : 'Exam Mode'}
            </span>
          </div>

          {!reviewMode && (
            <div className="timer-card">
              <div className="timer-lbl"><Clock size={9} /> Time Remaining</div>
              <div className={`timer-val${clock < 300 ? ' red' : ''}`}>{fmt(clock)}</div>
            </div>
          )}

          <div className="prog-wrap">
            <div className="prog-top">
              <span>{reviewMode ? 'Questions' : 'Progress'}</span>
              <span className="prog-pct">{reviewMode ? `${qi + 1}/${activeTest.questions.length}` : `${pct}%`}</span>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: reviewMode ? `${((qi + 1) / activeTest.questions.length) * 100}%` : `${pct}%` }} />
            </div>
          </div>

          {!reviewMode && (
            <div className="duo">
              <div className="mini-stat">
                <div className="mini-num" style={{ color: 'var(--green)' }}>{answered}</div>
                <div className="mini-lbl">Done</div>
              </div>
              <div className="mini-stat">
                <div className="mini-num" style={{ color: 'var(--muted)' }}>{activeTest.questions.length - answered}</div>
                <div className="mini-lbl">Left</div>
              </div>
            </div>
          )}

          <div>
            <div className="nav-grid-label">Navigator</div>
            <div className="nav-grid">
              {activeTest.questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`nd${selections[q.id] ? ' ans' : ''}${i === qi ? ' cur' : ''}`}
                  onClick={() => setQi(i)}
                >{i + 1}</button>
              ))}
            </div>
          </div>

          <button className="quit-btn" onClick={() => {
            if (reviewMode) { setScreen('results'); }
            else { endExam(); }
          }}>
            <XCircle size={13} /> {reviewMode ? 'Back to Results' : 'End Exam'}
          </button>
        </div>

        <div className="q-main">
          <div style={{ width: '100%', maxWidth: 680 }}>
            {reviewMode && (
              <div className="review-banner">
                <span>👁 <b>Review Mode</b> — answers are shown</span>
                <button onClick={() => setScreen('results')} style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>← Results</button>
              </div>
            )}
            <QuestionCard
              q={activeTest.questions[qi]}
              qi={qi}
              total={activeTest.questions.length}
              sel={selections[activeTest.questions[qi]?.id]}
              onSel={(id: number, opt: string) => setSelections(p => ({ ...p, [id]: opt }))}
              onNext={() => setQi(i => Math.min(i + 1, activeTest.questions.length - 1))}
              onPrev={() => setQi(i => Math.max(i - 1, 0))}
              onEnd={() => { if (reviewMode) setScreen('results'); else endExam(); }}
              reviewMode={reviewMode}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ══ RESULTS SCREEN ══ */
  if (screen === 'results' && activeTest) {
    // Record score when results first shown
    useEffect(() => {
      recordAttempt(activeTest.id, stats.pct);
    }, []);

    return (
      <div className="res-page">
        <div className="res-top">
          <div className="res-eyebrow">Exam Complete · {activeTest.name}</div>
          <div className="ring-wrap">
            <div className="ring" style={{ '--pct': stats.pct } as any}>
              <span className="ring-val">{stats.pct}%</span>
            </div>
          </div>
          <div className="res-verdict">
            {stats.pct >= 80 ? '🎉 Outstanding!' : stats.pct >= 60 ? '👍 Good effort!' : stats.pct >= 40 ? '📖 Needs more practice' : "💪 Don't give up!"}
          </div>
        </div>

        <div className="res-4">
          <div className="r4"><div className="r4-n" style={{ color: 'var(--green)' }}>{stats.correct}</div><div className="r4-l">Correct</div></div>
          <div className="r4"><div className="r4-n" style={{ color: 'var(--red)' }}>{stats.wrong}</div><div className="r4-l">Wrong</div></div>
          <div className="r4"><div className="r4-n" style={{ color: 'var(--text2)' }}>{stats.skipped}</div><div className="r4-l">Skipped</div></div>
          <div className="r4"><div className="r4-n" style={{ color: 'var(--gold)' }}>{activeTest.questions.length}</div><div className="r4-l">Total</div></div>
        </div>

        <div className="res-btns">
          {/* Re-attempt same test — no PDF upload needed */}
          <button className="r-btn r-primary" onClick={() => launchTest(activeTest)}>
            <RotateCcw size={14} /> Re-attempt
          </button>
          <button className="r-btn r-ghost" onClick={() => { setReviewMode(true); setQi(0); setScreen('test'); }}>
            <BookOpen size={14} /> Review Answers
          </button>
          <button className="r-btn r-ghost" onClick={() => { setScreen('home'); setFile(null); setLogs([{ msg: 'Ready.', kind: 'info' }]); }}>
            ← All Tests
          </button>
        </div>

        <div className="rev-title">Question Review</div>
        {activeTest.questions.map((q, i) => {
          const yours = selections[q.id];
          const correct = yours === q.answer;
          const s = !yours ? 'skip' : correct ? 'c' : 'w';
          return (
            <div key={q.id} className={`rev-item ${s}`}>
              <div className="rev-meta">Q{i + 1} · {s === 'c' ? '✓ Correct' : s === 'w' ? '✗ Wrong' : '— Not Attempted'}</div>
              <div className="rev-q">{q.question}</div>
              <div className="chips">
                {yours && !correct && <span className="chip c-yours">Your: {yours}</span>}
                <span className="chip c-ans">Answer: {q.answer}</span>
                {!yours && <span className="chip c-skip">Skipped</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}
