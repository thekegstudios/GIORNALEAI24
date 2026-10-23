'use client';
import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';

export interface AssistantContext { articleId?: string; slug?: string; title?: string; articleIds?: string[]; sportEventId?: string; question?: string }
export const ASSISTANT_OPEN_EVENT = 'ai24:assistant:open';
export const ASSISTANT_CONTEXT_EVENT = 'ai24:assistant:context';
export function openArticleAssistant(context: AssistantContext = {}) {
  window.dispatchEvent(new CustomEvent<AssistantContext>(ASSISTANT_OPEN_EVENT, { detail: context }));
}
/** Publishes only the identity of the public article. The server reloads its actual content. */
export function ArticleAIContext({ articleId, slug, title }: { articleId: string; slug: string; title: string }) {
  useEffect(() => {
    const context = { articleId, slug, title };
    window.dispatchEvent(new CustomEvent(ASSISTANT_CONTEXT_EVENT, { detail: context }));
    return () => { window.dispatchEvent(new CustomEvent(ASSISTANT_CONTEXT_EVENT, { detail: null })); };
  }, [articleId, slug, title]);
  return <div className="article-assistant-callout"><Sparkles size={22} aria-hidden="true" /><div><strong>Una domanda su questa notizia?</strong><p>Consulta il contesto e le fonti senza interrompere la lettura.</p></div><button className="button button-outline" onClick={() => openArticleAssistant({ articleId, slug, title, question: 'Spiegamelo in parole semplici.' })}>Chiedi all’AI di spiegarti questa notizia <span aria-hidden="true">↗</span></button></div>;
}
