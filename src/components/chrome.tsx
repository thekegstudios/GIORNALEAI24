'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, Moon, Search, Sun, X, MapPin, ChevronDown } from 'lucide-react';
import { formatDate, formatTime } from '@/lib/format';
import { GlobalSearch } from './global-search';

export function Brand({ small = false }: { small?: boolean }) {
  return <Link href="/" className={`brand brand-image ${small ? 'brand-small' : ''}`} aria-label="GIORNALE AI24, homepage"><Image src="/brand/giornale-ai24-logo.png" alt="GIORNALE AI24 — by KEG Studios" width={2172} height={724} sizes={small ? '(max-width: 640px) 250px, 300px' : '(max-width: 640px) 64vw, (max-width: 850px) 320px, 430px'} preload={!small} /></Link>;
}
export function Header({ checkedAt, activeSources }: { checkedAt: string | null; activeSources: number }) {
  const [now, setNow] = useState<Date | null>(null);
  const [light, setLight] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30000);
    try { setLight(localStorage.getItem('italia-ora-theme') === 'light'); } catch { /* Theme stays readable without browser storage. */ }
    return () => clearInterval(timer);
  }, []);
  function toggleTheme() {
    const next = !light; setLight(next);
    document.documentElement.dataset.theme = next ? 'light' : 'dark';
    try { localStorage.setItem('italia-ora-theme', next ? 'light' : 'dark'); } catch { /* The visual choice still works for this page. */ }
  }
  const nav = [['Ultim’ora', '/ultim-ora'], ['Cronaca', '/categoria/cronaca'], ['Politica', '/categoria/politica'], ['Economia', '/categoria/economia'], ['La Guerra Silenziosa', '/guerra-silenziosa'], ['AI24 Sport', '/sport'], ['Scienza e tecnologia', '/categoria/tecnologia'], ['Clima e ambiente', '/categoria/ambiente'], ['Territori', '/regioni']];
  return <header className="site-header"><div className="utility wrap"><span className="italian-date" suppressHydrationWarning>{now ? `${formatDate(now, { weekday: 'long' })} · ${formatTime(now)}` : 'Orario italiano · Europe/Rome'}</span><span className="utility-right"><span className="free-note">Informazione libera. Sempre gratuita.</span><Link href="/metodo">Il nostro metodo <ArrowUpRight size={12} /></Link></span></div>
    <div className="masthead wrap"><button className="icon-button mobile-menu" aria-label={open ? 'Chiudi navigazione' : 'Apri navigazione'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={23} /> : <Menu size={23} />}</button><Brand /><GlobalSearch/><div className="masthead-tools"><Link className="zone-link" href="/la-mia-italia"><MapPin size={16} /> La mia Italia <ChevronDown size={13} /></Link><button className="icon-button" onClick={toggleTheme} aria-label={light ? 'Attiva tema scuro' : 'Attiva tema chiaro'}>{light ? <Moon size={19} /> : <Sun size={19} />}</button><Link className="icon-button mobile-search-link" href="/cerca" aria-label="Cerca una notizia"><Search size={20} /></Link></div></div>
    <nav className={`main-nav ${open ? 'is-open' : ''}`} aria-label="Navigazione principale"><div className="wrap nav-inner">{nav.map(([name, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{name}</Link>)}<Link className="nav-special" href="/briefing" onClick={() => setOpen(false)}>AI24 Briefing <ArrowUpRight size={14} /></Link></div></nav>
    <div className="source-bar"><div className="wrap source-inner"><span><span className={`status-dot ${checkedAt ? 'checked' : ''}`} />{checkedAt ? `Ultimo controllo fonti: ${formatDate(checkedAt)} alle ${formatTime(checkedAt)}` : 'Primo controllo delle fonti ancora da eseguire'}</span><Link href="/fonti">{activeSources} {activeSources === 1 ? 'fonte attiva' : 'fonti attive'} <ArrowUpRight size={12} /></Link></div></div>
  </header>;
}
export function Footer() {
  return <footer className="site-footer"><div className="wrap"><div className="footer-top"><div><Brand small /><p>Capire l’Italia, una notizia alla volta.<br />Informazione accessibile, fonti trasparenti.</p></div><div className="footer-links"><div><strong>Esplora</strong><Link href="/briefing">AI24 Briefing</Link><Link href="/sport">AI24 Sport</Link><Link href="/guerra-silenziosa">La Guerra Silenziosa</Link><Link href="/carburanti">Prezzi carburanti</Link><Link href="/il-mio-comune">Il mio Comune</Link><Link href="/offline">App e articoli offline</Link><Link href="/italia">Italia</Link><Link href="/regioni">La tua zona</Link><Link href="/riepilogo">L’Italia in 60 secondi</Link><Link href="/la-mia-italia">La mia Italia</Link><Link href="/chiedi">Chiedi a GIORNALE AI24</Link></div><div><strong>Trasparenza</strong><Link href="/metodo">Metodo e intelligenza artificiale</Link><Link href="/fonti">Le nostre fonti</Link><Link href="/correzioni">Registro delle correzioni</Link><Link href="/segnala">Invia una segnalazione</Link></div><div><strong>Il progetto</strong><Link href="/legale/contatti">Contatti</Link><Link href="/legale/privacy">Privacy</Link><Link href="/legale/cookie">Cookie e preferenze</Link><Link href="/legale/termini">Termini di utilizzo</Link></div></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} KEG Studios · GIORNALE AI24</span><span>Fonti trasparenti. AI dichiarata quando utilizzata. <Link href="/metodo">Scopri come →</Link></span><span className="footer-free">Nessun abbonamento. Nessun paywall.</span></div></div></footer>;
}
export function PreferencesNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(localStorage.getItem('italia-ora-preferences-notice') !== 'seen'); }, []);
  if (!visible) return null;
  return <aside className="preferences-notice" aria-label="Preferenze del browser"><p><strong>Le tue preferenze, sul tuo dispositivo.</strong> Tema, zona e notizie seguite vengono salvati nel browser solo quando li scegli. Nessuna pubblicità attiva. <Link href="/legale/cookie">Scopri di più</Link></p><button className="button button-small" onClick={() => { localStorage.setItem('italia-ora-preferences-notice', 'seen'); setVisible(false); }}>Ho capito</button></aside>;
}

