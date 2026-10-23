'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import './intro.css';

/** Plays on document entry; the persistent layout keeps navigation uninterrupted. */
export function Intro() {
  const pathname = usePathname();
  const entryPath = useRef(pathname);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const respectMotion = () => { if (motion.matches) setVisible(false); };
    respectMotion();
    motion.addEventListener('change', respectMotion);
    // A missing image or interrupted script must never leave an opening screen.
    const deadline = window.setTimeout(() => setVisible(false), 6500);
    return () => {
      motion.removeEventListener('change', respectMotion);
      window.clearTimeout(deadline);
    };
  }, []);

  useEffect(() => {
    if (pathname !== entryPath.current || pathname.startsWith('/admin')) setVisible(false);
  }, [pathname]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setVisible(false), 3100);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!visible || pathname.startsWith('/admin') || pathname !== entryPath.current) return null;

  return <div className="opening-intro" data-ready={ready}>
    <div className="opening-intro-grid" />
    <div className="opening-intro-glow" />
    <div className="opening-intro-halo" />
    <div className="opening-intro-content" aria-hidden="true">
      <span className="opening-intro-kicker">IL TUO PUNTO SULL’ITALIA</span>
      <div className="opening-intro-logo">
        <Image
          src="/brand/giornale-ai24-logo.png"
          alt=""
          width={2172}
          height={724}
          loading="eager"
          fetchPriority="high"
          unoptimized
          onLoad={() => setReady(true)}
          onError={() => setVisible(false)}
        />
      </div>
      <span className="opening-intro-rule"><i /><i /><i /></span>
      <span className="opening-intro-caption">L’INFORMAZIONE PRENDE VITA</span>
    </div>
    <button className="opening-intro-skip" onClick={()=>setVisible(false)}>Vai alle notizie →</button>
  </div>;
}
