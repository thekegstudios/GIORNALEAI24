'use client';
import { useEffect,useState } from 'react';
import { usePathname } from 'next/navigation';
import { BookmarkCheck,Download,HardDriveDownload,Smartphone,Trash2,WifiOff } from 'lucide-react';
import './pwa-support.css';
export interface OfflineArticle { slug:string;title:string;savedAt:string;updatedAt:string;url:string }
type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
type PWAReply={ok:boolean;articles?:OfflineArticle[];error?:string};
const notificationKey='giornale-ai24-notification-interests';
async function worker():Promise<ServiceWorker>{
  if(!('serviceWorker'in navigator)||!window.isSecureContext)throw new Error('Il salvataggio offline richiede un browser compatibile e una connessione sicura.');
  const registration=await Promise.race([navigator.serviceWorker.ready,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Supporto offline non ancora pronto. Riprova tra poco.')),8000))]);
  const active=navigator.serviceWorker.controller||registration.active;if(!active)throw new Error('Supporto offline non ancora pronto.');return active;
}
export async function requestOffline(type:'LIST_ARTICLES'|'SAVE_ARTICLE'|'REMOVE_ARTICLE'|'CLEAR_ARTICLES',slug?:string):Promise<OfflineArticle[]>{
  const active=await worker();
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();const timeout=setTimeout(()=>{channel.port1.close();reject(new Error('Operazione offline scaduta. Riprova.'));},12000);
    channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();const data=event.data as PWAReply;if(data.ok)resolve(data.articles||[]);else reject(new Error(data.error||'Operazione non riuscita.'));};
    active.postMessage({type,...(slug?{slug}:{})},[channel.port2]);
  });
}
export function PWASupport(){
  const pathname=usePathname();const [offline,setOffline]=useState(false);const [install,setInstall]=useState<InstallPrompt|null>(null);const [installed,setInstalled]=useState(false);const [installError,setInstallError]=useState('');
  const privatePage=pathname.startsWith('/admin')||pathname.startsWith('/api');
  useEffect(()=>{
    const update=()=>setOffline(!navigator.onLine);update();window.addEventListener('online',update);window.addEventListener('offline',update);
    const before=(event:Event)=>{event.preventDefault();setInstall(event as InstallPrompt);};const done=()=>{setInstalled(true);setInstall(null);};
    setInstalled(window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone));
    window.addEventListener('beforeinstallprompt',before);window.addEventListener('appinstalled',done);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);window.removeEventListener('beforeinstallprompt',before);window.removeEventListener('appinstalled',done);};
  },[]);
  useEffect(()=>{if(!privatePage&&'serviceWorker'in navigator&&window.isSecureContext)void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{/* The website remains usable without a service worker. */});},[privatePage]);
  async function installApp(){if(!install)return;setInstallError('');try{await install.prompt();await install.userChoice;setInstall(null);}catch{setInstallError('Usa il menu del browser per verificare la disponibilità dell’installazione.');}}
  if(privatePage)return null;
  return <>{offline&&<div className="pwa-offline-banner" role="status"><WifiOff size={16} aria-hidden="true" /><span>Sei offline. Le copie salvate non mostrano aggiornamenti in tempo reale.</span><a href="/offline">Articoli salvati →</a></div>}{install&&!installed&&<div className="pwa-install-callout"><button type="button" onClick={()=>void installApp()}><Smartphone size={15} aria-hidden="true" />Installa AI24</button><button type="button" aria-label="Nascondi proposta di installazione" onClick={()=>setInstall(null)}>×</button></div>}{installError&&<p className="pwa-install-error" role="status">{installError}</p>}</>;
}
export function SaveOfflineArticle({slug,updatedAt}:{slug:string;updatedAt:string}){
  const [supported,setSupported]=useState(false);const [saved,setSaved]=useState<OfflineArticle|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  useEffect(()=>{let active=true;const available='serviceWorker'in navigator&&window.isSecureContext;setSupported(available);if(available)void requestOffline('LIST_ARTICLES').then(articles=>{if(active)setSaved(articles.find(item=>item.slug===slug)||null);}).catch(()=>{});return()=>{active=false;};},[slug]);
  async function change(remove=false){setBusy(true);setMessage('');try{const articles=await requestOffline(remove?'REMOVE_ARTICLE':'SAVE_ARTICLE',slug);setSaved(articles.find(item=>item.slug===slug)||null);setMessage(remove?'Copia rimossa da questo dispositivo.':'Copia salvata su questo dispositivo. Non contiene aggiornamenti successivi.');}catch(error){setMessage(error instanceof Error?error.message:'Salvataggio non riuscito.');}finally{setBusy(false);}}
  if(!supported)return null;
  const outdated=saved&&saved.updatedAt!==updatedAt;
  return <section className="offline-article-controls" aria-label="Lettura offline"><div className="button-row"><button type="button" className="button button-outline" disabled={busy} onClick={()=>void change()}>{saved?<BookmarkCheck size={16}/>:<HardDriveDownload size={16}/>} {busy?'Attendi…':saved?outdated?'Salva la versione aggiornata':'Aggiorna la copia offline':'Salva per leggere offline'}</button>{saved&&<button type="button" className="button button-quiet" disabled={busy} onClick={()=>void change(true)}><Trash2 size={14}/>Rimuovi copia</button>}<a className="text-link" href="/offline">Gestisci le copie →</a></div><p>Salvataggio volontario su questo browser: massimo 20 notizie, eliminate dopo 7 giorni. Le schede con soli metadati salvano titolo e fonti.</p>{saved&&<p>Copia del {new Date(saved.savedAt).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}.</p>}{message&&<p role="status">{message}</p>}</section>;
}
export function OfflineLibrary(){
  const [articles,setArticles]=useState<OfflineArticle[]>([]);const [ready,setReady]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{let active=true;void requestOffline('LIST_ARTICLES').then(items=>{if(active){setArticles(items);setReady(true);}}).catch(reason=>{if(active){setError(reason instanceof Error?reason.message:'Archivio locale non disponibile.');setReady(true);}});return()=>{active=false;};},[]);
  async function remove(slug?:string){setBusy(true);setError('');try{setArticles(await requestOffline(slug?'REMOVE_ARTICLE':'CLEAR_ARTICLES',slug));}catch(reason){setError(reason instanceof Error?reason.message:'Rimozione non riuscita.');}finally{setBusy(false);}}
  return <section className="offline-library"><h2>Le copie su questo dispositivo</h2><p>Ogni salvataggio è una fotografia datata della notizia. I dati potrebbero essere stati corretti o ritirati dopo il salvataggio. Prezzi carburanti, risultati sportivi, chat e dati amministrativi richiedono una connessione e non vengono memorizzati qui.</p>{!ready?<p role="status">Controllo le copie locali…</p>:articles.length?<><ul>{articles.map(item=><li key={item.slug}><div><a href={item.url}>{item.title}</a><p>Salvata {new Date(item.savedAt).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}</p></div><button type="button" disabled={busy} onClick={()=>void remove(item.slug)} aria-label={`Rimuovi la copia di ${item.title}`}><Trash2 size={16}/></button></li>)}</ul><button type="button" className="button button-outline" disabled={busy} onClick={()=>void remove()}><Trash2 size={15}/>Elimina tutte le copie offline</button></>:<p>Non ci sono articoli salvati. Apri una notizia online e scegli “Salva per leggere offline”.</p>}{error&&<p className="pwa-error" role="alert">{error}</p>}</section>;
}
export function PWAInstallationHelp(){
  const [standalone,setStandalone]=useState(false);const [safari,setSafari]=useState(false);const [preferences,setPreferences]=useState<string[]>([]);
  useEffect(()=>{setStandalone(window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone));setSafari(/Safari/.test(navigator.userAgent)&&!/Chrome|Chromium|Edg/.test(navigator.userAgent));try{const value=JSON.parse(localStorage.getItem(notificationKey)||'[]');if(Array.isArray(value))setPreferences(value.filter(item=>typeof item==='string'));}catch{}},[]);
  const choices=['Notizie rilevanti della zona','Aggiornamenti delle notizie seguite','Allerte ufficiali','Riepilogo del mattino'];
  function toggle(choice:string){const next=preferences.includes(choice)?preferences.filter(item=>item!==choice):[...preferences,choice];setPreferences(next);try{localStorage.setItem(notificationKey,JSON.stringify(next));}catch{}}
  return <><section className="pwa-help"><h2><Download size={21} aria-hidden="true"/>AI24 come applicazione</h2>{standalone?<p>Il sito è già aperto in modalità applicazione su questo dispositivo.</p>:<><p>Quando il browser rende disponibile l’installazione compare il pulsante “Installa AI24”. Non tutti i browser mostrano quel comando.</p>{safari?<p>Su Safari apri il menu Condividi e cerca “Aggiungi alla schermata Home” su iPhone/iPad, oppure “Aggiungi al Dock” su Mac quando disponibile. Le voci dipendono dalla versione del sistema.</p>:<p>Puoi anche verificare nel menu del browser la voce per installare il sito o aggiungerlo alla schermata Home. La disponibilità dipende dal browser e dal dispositivo.</p>}</>}<p>L’avvio usa l’icona e lo sfondo del manifest. Il sistema operativo decide l’aspetto effettivo della schermata iniziale. In pubblico serve HTTPS; localhost è previsto per lo sviluppo.</p></section><section className="pwa-help"><h2>Notifiche facoltative · preparazione</h2><p><strong>Il servizio di invio non è attivo.</strong> Queste sono soltanto preferenze locali per una futura attivazione: non iscrivono a un servizio e non richiedono il permesso del browser. Non vengono inviate notifiche.</p><fieldset><legend>Interessi da conservare su questo browser</legend>{choices.map(choice=><label key={choice}><input type="checkbox" checked={preferences.includes(choice)} onChange={()=>toggle(choice)}/>{choice}</label>)}</fieldset><button type="button" className="button button-quiet" onClick={()=>{setPreferences([]);localStorage.removeItem(notificationKey);}}>Azzera le preferenze notifiche</button><p>Un servizio futuro richiederà un’attivazione volontaria e il permesso esplicito del browser, con possibilità di disiscriversi. Nessuna attivazione automatica.</p></section></>;
}
