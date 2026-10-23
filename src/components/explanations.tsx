'use client';
import { useState } from 'react';
import { Sparkles, ChevronDown } from 'lucide-react';
import { Article } from '@/lib/types';
export function Explanations({ explanations }: { explanations: Article['explanations'] }) {
  const [open, setOpen] = useState(false);
  const available = [['simple', 'In parole semplici'], ['detailed', 'Il contesto, in dettaglio'], ['causes', 'Le cause'], ['consequences', 'Le possibili conseguenze'], ['practical', 'Cosa cambia per me?']] as const;
  const tabs = available.filter(([key]) => explanations[key]?.trim());
  const [active, setActive] = useState<string>(tabs[0]?.[0] || 'simple');
  if (!tabs.length) return null;
  return <section className="explanation-box"><button className="explanation-trigger" onClick={() => setOpen(!open)} aria-expanded={open}><span><Sparkles size={21} /><span><strong>Spiegamelo meglio</strong><small>L’AI ti aiuta a capire il contesto</small></span></span><ChevronDown size={20} className={open ? 'rotate' : ''} /></button>{open && <div className="explanation-body"><div className="category-pills" role="tablist" aria-label="Tipo di spiegazione">{tabs.map(([key, label]) => <button key={key} className={`pill ${active === key ? 'selected' : ''}`} role="tab" aria-selected={active === key} onClick={() => setActive(key)}>{label}</button>)}</div><p className="preserve-lines" role="tabpanel">{explanations[active as keyof Article['explanations']]}</p><span className="small-muted">Spiegazione preparata durante l’elaborazione della notizia. Nessuna richiesta AI viene avviata da questo pulsante.</span></div>}</section>;
}
