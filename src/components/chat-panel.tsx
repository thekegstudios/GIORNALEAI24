'use client';
import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BookOpen, Check, CircleHelp, Copy, Send, Sparkles, Square, Trash2 } from 'lucide-react';
import type { ChatAnswer, ChatContext, ChatStreamEvent } from '@/lib/newsroom-types';
import { fullDate } from '@/lib/format';
import './chat-panel.css';

type Turn = { id: number; question: string; response: ChatAnswer | null; text: string; mode?: 'archive' | 'ai'; stopped?: boolean };
const welcome = 'Ciao! 👋 Sono l’assistente AI di GIORNALE AI24.\n\nPosso aiutarti a scoprire le ultime notizie italiane, approfondire gli articoli e comprendere meglio ciò che sta succedendo.\n\nCosa vorresti sapere?';
const suggestions = [{ label: '📰 Ultime notizie', question: 'Quali sono le ultime notizie pubblicate?' }, { label: '📍 Notizie della mia zona', question: 'Quali notizie sono disponibili per la mia zona?' }, { label: '🤖 Spiegami una notizia', question: 'Spiegami una notizia disponibile nell’archivio.' }];
const contextualSuggestions = ['Spiegamelo in parole semplici.', 'Quali sono le conseguenze?', 'Cosa cambia per i cittadini?', 'Quali sono le fonti?', 'Ci sono aggiornamenti?'];

export function AISourceReferences({ citations }: { citations: ChatAnswer['citations'] }) {
  if (!citations.length) return null;
  return <div className="chat-citations"><h3>Fonti verificabili</h3>{citations.map((citation, index) => <div key={`${citation.articleId}-${citation.url}`}><span>{String(index + 1).padStart(2, '0')}</span><div><h4><Link href={citation.articleUrl}>{citation.title}</Link></h4><p>{citation.sourceName}{citation.publishedAt ? ` · ${fullDate(citation.publishedAt)}` : ' · Data non dichiarata dalla fonte'}</p><div className="chat-source-links"><Link href={citation.articleUrl}>Leggi la notizia →</Link><a href={citation.url} target="_blank" rel="noopener noreferrer">Fonte originale <ArrowUpRight size={11} /></a></div></div></div>)}</div>;
}

export function ChatPanel({ articleId, articleSlug, articleIds, sportEventId, contextTitle, compact = false, enabled = true, request }: ChatContext & { contextTitle?: string; compact?: boolean; enabled?: boolean; request?: { id: number; question: string } }) {
  const [question, setQuestion] = useState(''); const [conversation, setConversation] = useState<Turn[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null); const bottom = useRef<HTMLDivElement>(null); const controller = useRef<AbortController | null>(null); const turns = useRef<Turn[]>([]); const active = useRef(false); const seenRequest = useRef<number | null>(null); const id = useId();
  const contextual = Boolean(articleId || articleSlug || articleIds?.length || sportEventId);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { if (!enabled) controller.current?.abort(); }, [enabled]);
  useEffect(() => { turns.current = conversation; if (conversation.length || busy) bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, [conversation, busy]);
  const ask = useCallback(async (value: string) => {
    const text = value.trim(); if (text.length < 5 || text.length > 500 || active.current) return;
    active.current = true; setBusy(true); setError(''); setQuestion('');
    const turnId = Date.now(); const abort = new AbortController(); controller.current = abort;
    const last = turns.current.at(-1)?.response;
    // Short follow-ups reuse public identifiers, never a server-side user transcript.
    const followup = !contextual && /\b(questa|questo|spiegamela|spiegamelo|conseguenze|cittadini|fonti|aggiornamenti)\b/i.test(text) ? [...new Set(last?.citations.map(item => item.articleId) || [])].slice(0, 6) : [];
    const sportsFollowup = followup.length && last?.citations[0]?.articleUrl.startsWith('/sport/') ? last.citations[0].articleId : undefined;
    const context = { ...(articleId ? { articleId } : {}), ...(articleSlug ? { articleSlug } : {}), ...((sportEventId || sportsFollowup) ? { sportEventId: sportEventId || sportsFollowup } : {}), ...((articleIds?.length || followup.length && !sportsFollowup) ? { articleIds: articleIds?.length ? articleIds : followup } : {}) };
    setConversation(previous => [...previous.slice(-7), { id: turnId, question: text, response: null, text: '' }]);
    let completed = false;
    const update = (change: Partial<Turn>) => setConversation(previous => previous.map(turn => turn.id === turnId ? { ...turn, ...change } : turn));
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, ...context, stream: true }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(50_000)]) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'La risposta non è disponibile. Riprova tra poco.'); }
      if (!response.body) throw new Error('Il flusso della risposta non è disponibile.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', partial = '';
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
            const event = JSON.parse(line) as ChatStreamEvent;
            if (event.type === 'status') update({ mode: event.mode });
            else if (event.type === 'delta') { partial += event.text; update({ text: partial, mode: 'ai' }); }
            else if (event.type === 'done') { completed = true; update({ response: event.response, text: event.response.answer, mode: event.response.mode }); }
            else if (event.type === 'error') throw new Error(event.error);
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!completed) throw new Error('La connessione si è interrotta prima della risposta completa.');
    } catch (reason) {
      update({ stopped: !completed });
      if (abort.signal.aborted) setError('Generazione interrotta. Il testo parziale non è una risposta completata.');
      else setError(reason instanceof Error && reason.name === 'TimeoutError' ? 'Il servizio sta impiegando troppo tempo. Riprova tra poco.' : reason instanceof Error ? reason.message : 'Connessione non riuscita.');
    } finally { active.current = false; setBusy(false); controller.current = null; input.current?.focus(); }
  }, [articleId, articleSlug, articleIds, sportEventId, contextual]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && request && request.id !== seenRequest.current) { seenRequest.current = request.id; void ask(request.question); } });
    return () => { cancelled = true; };
  }, [request, ask]);
  async function copy(turn: Turn) { try { await navigator.clipboard.writeText(turn.response?.answer || turn.text); setCopied(turn.id); } catch { setError('Copia non disponibile: puoi selezionare il testo della risposta.'); } }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void ask(question); }
  return <section className={`reader-chat${compact ? ' reader-chat-compact' : ''}`}>
    <div className="chat-method"><BookOpen size={18} aria-hidden="true" /><p><strong>Gratuito, con fonti.</strong> L’AI usa le notizie pubblicate quando il servizio è abilitato. In alternativa risponde l’archivio, dichiarandolo. Nessuna ricerca web in tempo reale.</p></div>
    {contextual && <p className="chat-context"><Sparkles size={13} aria-hidden="true" />{contextTitle ? `Stai chiedendo di: ${contextTitle}` : articleIds?.length ? `Contesto: ${articleIds.length} notizie del briefing.` : 'Contesto: la notizia che stai leggendo.'}</p>}
    <div className="chat-scroll-area" aria-label="Conversazione con Assistente AI24">
      {!conversation.length && <div className="chat-welcome"><span className="chat-welcome-symbol"><Sparkles size={26} aria-hidden="true" /></span><p className="chat-welcome-message">{welcome}</p><div className="chat-suggestions">{suggestions.map(suggestion => <button type="button" key={suggestion.label} disabled={busy} onClick={() => void ask(contextual && suggestion.label.includes('Spiegami') ? 'Spiegamelo in parole semplici.' : suggestion.question)}>{suggestion.label}<ArrowUpRight size={13} aria-hidden="true" /></button>)}</div><p className="chat-local-note">Per le notizie della tua zona, indica città o regione: la posizione non viene rilevata.</p></div>}
      <div className="chat-conversation" role="log" aria-label="Domande e risposte" aria-live="off">{conversation.map(turn => <article className="chat-turn" key={turn.id}><div className="chat-question"><span>LA TUA DOMANDA</span><h2>{turn.question}</h2></div><div className="chat-answer"><div className="chat-answer-meta"><span><Sparkles size={14} aria-hidden="true" />{turn.response ? turn.response.mode === 'ai' ? 'Risposta AI · OpenAI' : 'Modalità archivio · senza generazione AI' : turn.mode === 'ai' ? 'OpenAI sta generando…' : 'Consulto le notizie…'}</span>{turn.response?.cached && <span>Dalla cache pubblica</span>}</div>{turn.text ? <p className="chat-answer-text">{turn.text}</p> : !turn.stopped && <div className="chat-thinking" aria-label="Risposta in preparazione"><i /><i /><i /></div>}{!turn.response && turn.text && <p className="chat-partial-note">{turn.stopped ? 'Risposta interrotta e incompleta.' : 'Risposta in generazione; le fonti complete arrivano al termine.'}</p>}{turn.response && <>{turn.response.uncertainties.length > 0 && <div className="chat-uncertainties"><h3><CircleHelp size={15} aria-hidden="true" />Limiti e informazioni da verificare</h3><ul>{turn.response.uncertainties.map((uncertainty, index) => <li key={index}>{uncertainty}</li>)}</ul></div>}<AISourceReferences citations={turn.response.citations} /><div className="chat-answer-footer"><p className="chat-answer-time">{fullDate(turn.response.generatedAt)}</p><button type="button" className="chat-copy" onClick={() => void copy(turn)} aria-label="Copia la risposta">{copied === turn.id ? <Check size={14} /> : <Copy size={14} />}{copied === turn.id ? 'Copiata' : 'Copia'}</button></div></>}</div></article>)}</div>
      <div ref={bottom} />
    </div>
    {contextual && <div className="chat-context-suggestions" aria-label="Domande sulla notizia">{contextualSuggestions.map(value => <button type="button" disabled={busy} key={value} onClick={() => void ask(value)}>{value}</button>)}</div>}
    <form className="chat-composer" onSubmit={submit}><label htmlFor={`${id}-question`}>Cosa vuoi sapere?</label><textarea autoFocus={compact} ref={input} id={`${id}-question`} value={question} onChange={event => setQuestion(event.target.value)} minLength={5} maxLength={500} rows={compact ? 2 : 3} required placeholder="Scrivi una domanda sulle notizie…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) void ask(question); } }} /><div className="chat-composer-bottom"><span>{question.length}/500 · Invio per inviare</span>{busy ? <button type="button" className="button button-outline" onClick={() => controller.current?.abort()}><Square size={13} aria-hidden="true" />Interrompi</button> : <button className="button" disabled={question.trim().length < 5}><Send size={15} aria-hidden="true" />Invia</button>}</div><span className="sr-only" role="status">{busy ? 'Risposta in preparazione.' : conversation.length ? 'Risposta pronta o interrotta.' : ''}</span>{error && <p className="chat-error" role="alert">{error}</p>}</form>
    <div className="chat-bottom-note"><p>Può commettere errori. Controlla le fonti. Limiti tecnici e budget possono ridurre la disponibilità. La conversazione resta nella memoria della pagina.</p>{conversation.length > 0 && <button type="button" disabled={busy} onClick={() => { setConversation([]); turns.current = []; setError(''); }}><Trash2 size={12} aria-hidden="true" />Cancella</button>}</div>
  </section>;
}
