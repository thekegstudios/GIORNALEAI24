import { PageIntro } from '@/components/news';
import { OfflineLibrary,PWAInstallationHelp } from '@/components/pwa-support';
export const metadata={title:'App e lettura offline',robots:{index:false,follow:true}};
export default function OfflinePage(){return <div className="wrap page"><PageIntro eyebrow="AI24 SUL TUO DISPOSITIVO" title="App e lettura offline" description="Salva volontariamente le notizie da leggere senza connessione. Le copie riportano sempre quando sono state salvate e non mostrano dati in tempo reale."/><OfflineLibrary/><PWAInstallationHelp/></div>;}
