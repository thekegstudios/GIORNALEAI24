'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { MessageCircle, Sparkles, X } from 'lucide-react';
import { ChatPanel } from './chat-panel';
import { ASSISTANT_CONTEXT_EVENT, ASSISTANT_OPEN_EVENT, type AssistantContext } from './article-ai-context';
import './floating-assistant.css';

export function FloatingAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); const [hasOpened, setHasOpened] = useState(false); const [context, setContext] = useState<AssistantContext>({}); const [request, setRequest] = useState<{ id: number; question: string }>();
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null); const sequence = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const privatePage = pathname.startsWith('/admin') || pathname.startsWith('/api');
  useEffect(() => {
    const match = /^\/notizie\/([^/]+)$/.exec(pathname);
    setContext(match ? { slug: decodeURIComponent(match[1]) } : {}); setRequest(undefined);
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const receiveContext = (event: Event) => { const detail = (event as CustomEvent<AssistantContext | null>).detail; setContext(detail || {}); };
    const receiveOpen = (event: Event) => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current;
      const detail = (event as CustomEvent<AssistantContext>).detail;
      if (detail && typeof detail === 'object') {
        setContext(detail);
        setRequest(typeof detail.question === 'string' ? { id: ++sequence.current, question: detail.question.slice(0, 500) } : undefined);
      }
      setHasOpened(true); setOpen(true);
    };
    window.addEventListener(ASSISTANT_CONTEXT_EVENT, receiveContext); window.addEventListener(ASSISTANT_OPEN_EVENT, receiveOpen);
    return () => { window.removeEventListener(ASSISTANT_CONTEXT_EVENT, receiveContext); window.removeEventListener(ASSISTANT_OPEN_EVENT, receiveOpen); };
  }, []);
  useEffect(() => {
    if (!dialog.current) return;
    if (open && !privatePage && !dialog.current.open) {
      dialog.current.showModal();
      dialog.current.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    } else if ((!open || privatePage) && dialog.current.open) dialog.current.close();
  }, [open, privatePage]);
  function restoreFocus() { (returnFocus.current?.isConnected ? returnFocus.current : trigger.current)?.focus(); }
  function close() { setOpen(false); setRequest(undefined); }
  if (privatePage) return null;
  return <>
    <button ref={trigger} className="floating-ai-button" type="button" onClick={() => { returnFocus.current = trigger.current; setHasOpened(true); setRequest(undefined); setOpen(true); }} aria-label="Apri GIORNALE AI24 — Assistente AI" aria-haspopup="dialog" aria-expanded={open} aria-controls="ai24-assistant-dialog"><MessageCircle size={25} strokeWidth={1.6} aria-hidden="true" /><span className="floating-ai-spark"><Sparkles size={12} aria-hidden="true" /></span><span className="floating-ai-label">Chiedi ad AI24</span></button>
    <dialog ref={dialog} id="ai24-assistant-dialog" className="ai24-chat-dialog" aria-labelledby="ai24-assistant-title" aria-describedby="ai24-assistant-description" onCancel={event => { event.preventDefault(); close(); }} onClose={() => { setOpen(false); restoreFocus(); }}>
      <header className="ai24-chat-header"><div className="ai24-chat-logo"><Image src="/brand/giornale-ai24-logo.png" width={2172} height={724} alt="GIORNALE AI24" sizes="120px" /></div><div><h2 id="ai24-assistant-title">Assistente AI24</h2><p id="ai24-assistant-description">Chiedimi quello che vuoi sull’attualità italiana</p></div><button type="button" onClick={close} aria-label="Chiudi l’assistente e torna alla lettura"><X size={22} /></button></header>
      {hasOpened && <ChatPanel key={context.articleId || context.slug || context.sportEventId || context.articleIds?.join(',') || 'public'} compact enabled={open} articleId={context.articleId} articleSlug={context.slug} articleIds={context.articleIds} sportEventId={context.sportEventId} contextTitle={context.title} request={request} />}
    </dialog>
  </>;
}
