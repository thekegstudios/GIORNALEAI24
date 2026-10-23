# Logo GIORNALE AI24

Il logo fornito dal gestore è conservato senza modifiche in `public/brand/giornale-ai24-logo.png` (PNG, 2172 × 724). È utilizzato nell'intestazione, nel footer e nella breve animazione iniziale.

Le dimensioni vengono adattate dal layout e da `next/image`; il file originale mantiene colori e trasparenza. Il testo alternativo identifica “GIORNALE AI24 — by KEG Studios”. Non rappresenta una fotografia di un avvenimento.

L'animazione è decorativa e compare a ogni apertura o ricarica della pagina pubblica. Il logo entra con un leggero ingrandimento, un alone azzurro e una linea tricolore, poi si dissolve dopo circa tre secondi. La sequenza parte solo quando il PNG è caricato; errore dell'immagine o attesa eccessiva rimuovono l'intro. Il file originale è caricato subito per questa sequenza.

Non ricompare durante la navigazione interna e non compare nell'amministrazione. Non intercetta i clic e rispetta `prefers-reduced-motion`, anche via CSS prima dell'avvio di JavaScript. L'intro non legge né scrive dati nel browser; il precedente controllo in `sessionStorage` è stato rimosso.

Verifica dell'aggiornamento: TypeScript e build di produzione completati; HTTP 200 per homepage, PNG originale (911187 byte) e amministrazione. L'intro è presente nell'HTML iniziale pubblico e assente da quello amministrativo. La verifica visiva automatica nel browser integrato rimane indisponibile.
