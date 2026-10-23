# GIORNALE AI24 come applicazione

## Funzioni implementate

`src/app/manifest.ts` fornisce nome, icone, lingua italiana, colori, avvio `/`, modalità standalone e scorciatoie per Ultim’ora e articoli offline. Next aggiunge automaticamente i riferimenti al manifest, all’icona SVG e all’icona Apple. La schermata di avvio effettiva dipende dal sistema operativo: non è un’app nativa separata né una pubblicazione negli store.

Le icone riprendono globo, Italia, tricolore e circuiti del logo ufficiale con un simbolo SVG semplificato. Il PNG originale del logo rimane invariato. `scripts/generate-app-icons.mjs` rasterizza esclusivamente l’SVG scritto nel progetto, tramite Sharp già dipendente da Next: genera PNG 192/512 e Apple 180, senza servizi esterni o modifica del logo fornito. Per rigenerare: `node scripts/generate-app-icons.mjs`.

Il layout monta `<PWASupport />`. Il componente registra `/sw.js` su origini sicure compatibili, mostra lo stato offline e propone l’installazione soltanto dopo un vero evento `beforeinstallprompt`. Nessun pulsante finge di installare il sito su browser non supportati. `/offline` contiene istruzioni Safari e altre piattaforme, stato di installazione, elenco e cancellazione delle copie. In pubblico occorre HTTPS; localhost può essere usato per sviluppo.

## Copie offline volontarie

Sotto una notizia pubblicata compare “Salva per leggere offline” sui browser compatibili. Non si salvano automaticamente le pagine visitate. Il clic chiede al service worker una copia del solo articolo, generata da `/offline-articoli/SLUG` sulla versione pubblicata del database. Il documento è autonomo e non contiene JavaScript, payload RSC, sessioni, chat, analytics, stato del motore editoriale o pannello amministrativo.

Il server ricontrolla autorizzazione corrente delle fonti. Con contenuti originali e fonti che permettono la sintesi salva il testo pubblico e le attribuzioni; altrimenti salva soltanto titolo e riferimenti autorizzati. Bozze, ritiri e fonti senza autorizzazione non producono una copia. Non si scaricano né copiano i documenti integrali dei siti delle fonti.

La copia riporta sempre un avviso “COPIA SALVATA · NON È UN AGGIORNAMENTO IN TEMPO REALE”, data del salvataggio e data della versione. Potrebbero esserci correzioni, ritiri o sviluppi successivi. È consultabile per sette giorni; le copie scadute vengono eliminate al successivo controllo locale, senza promettere processi in background quando l’app è chiusa. Sono ammesse al massimo 20 copie, con limite 300 KB per documento; le più vecchie lasciano spazio alle nuove. I riferimenti esterni richiedono una connessione.

La navigazione di rete ha sempre priorità. Un articolo viene servito dalla copia solo quando la richiesta di navigazione non raggiunge la rete. Le risposte HTTP 404/410 eliminano la copia; una navigazione online riuscita controlla anche l’endpoint HEAD della snapshot e invalida copie ritirate, non autorizzate o superate da una versione corretta. Mentre si resta offline non è possibile conoscere un ritiro appena pubblicato: l’avviso della copia lo chiarisce.

`/offline` online permette di eliminare una singola copia o tutte. Una scheda già aperta può usare questi comandi anche quando la connessione manca. Se l’app viene avviata completamente offline, il service worker genera un elenco autonomo dei salvataggi con collegamenti HTML normali. Questo elenco non richiede JavaScript: la gestione completa torna disponibile quando si ripristina la connessione. Le risorse possono essere eliminate anche dalle impostazioni del browser.

## Confini della cache

Le cache sono `ai24-static-v1` e `ai24-articles-v1`. La prima contiene soltanto icone/logo e risorse statiche Next con nome hash, con limite di 120 elementi. La seconda contiene soltanto snapshot esplicitamente richieste, sotto chiavi `/notizie/SLUG`. Non memorizza query string, POST, corpi delle richieste, risposte JSON, contenuti amministrativi o HTML generale.

Il service worker non intercetta `/api`, `/admin`, `/carburanti` e `/sport`, né i relativi sottopercorsi. Non conserva prezzi, classifiche o risultati live. Le altre pagine dinamiche non vengono memorizzate: senza rete mostrano soltanto la schermata offline generata al momento e gli articoli salvati. Il service worker non contiene credenziali e usa `credentials: omit` per le snapshot. Accetta comandi solo da client della stessa origine fuori dalle aree escluse, valida gli slug e ignora contenuti di snapshot forniti dal client.

Configurare `/sw.js` con `Cache-Control: no-cache, no-store, must-revalidate`, MIME JavaScript e CSP `default-src 'self'; script-src 'self'`. La registrazione usa `updateViaCache: 'none'`. Alla nuova attivazione vengono eliminate solo le vecchie cache con prefisso `ai24-`; non si toccano archivi di altre applicazioni.

## Notifiche: predisposizione, servizio non attivo

`/offline` permette di conservare facoltativamente interessi locali per notizie della zona, storie seguite, allerte ufficiali e riepilogo del mattino. La pagina dichiara che questa scelta non crea sottoscrizioni e non invia notifiche. Le preferenze restano nel localStorage `giornale-ai24-notification-interests` e possono essere azzerate. Nessun permesso viene richiesto automaticamente e nessun token viene registrato o inviato.

Sono previsti questi nomi per una futura configurazione VAPID, vuoti nell’esempio:

```dotenv
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

Compilarli da soli non attiva il servizio. Per inviare notifiche servono ancora un gestore Web Push effettivo, endpoint autenticati/validati per iscrizione e revoca, archivio protetto delle sottoscrizioni con cancellazione, preferenze applicate sul server, limiti e accorpamento dei messaggi e un mittente configurato. Solo un’azione esplicita del lettore potrà richiedere il permesso del browser. Il service worker attuale non registra handler push e non invia notifiche simulate. Nessun costo o servizio esterno è stato attivato.

## Verifica

`node node_modules/tsx/dist/cli.mjs --test tests/pwa.test.ts` verifica manifest e dimensioni PNG, snapshot sanificate e licenze correnti, esclusione di dati privati/live/API/POST/query, opt-in reale per il salvataggio, conservazione offline, cancellazione, revoche/versioni, scadenza e limite delle copie. I sette test isolano il service worker in un contesto JavaScript con Cache API e rete simulate; non dichiarano un’installazione reale su dispositivi.

Il controllo browser automatico della sessione è bloccato dalla policy: installazione effettiva, avvio standalone e passaggio offline richiedono anche verifica manuale su un browser compatibile. Guida Next locale consultata: `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`.
