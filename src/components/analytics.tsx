'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
export function Analytics({ enabled }: { enabled: boolean }) {
  const path = usePathname();
  const initialPath = useRef(path);
  useEffect(() => {
    if (!enabled || path.startsWith('/admin')) return;
    const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
    const loadMs=initialPath.current===path&&navigation?.duration&&navigation.duration<=60_000?navigation.duration:undefined;
    void fetch('/api/metrics', { method: 'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({path,loadMs}),keepalive: true }).catch(() => {});
  }, [path, enabled]);
  return null;
}
