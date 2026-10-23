# Verifiche dell'MVP e della Redazione AI

Ambiente locale: Windows, Node.js 24.19.0, Next.js 16.4.2, React 19.3.1 e TypeScript 5.9.3. Le prove del 21, 22 e 23 ottobre sono separate: la verifica visiva iniziale non certifica le modifiche successive.

## Preparazione Netlify del 23 ottobre 2026

| Verifica | Esito |
| --- | --- |
| Suite completa dopo l'adattamento serverless | **150/150 PASS**, nessuna prova saltata; database isolati |
| Build tramite `node scripts/netlify-build.mjs` | **PASS**, typecheck incluso |
| Bundling Node.js 24 ESM delle Functions, `pg` esterno | **PASS**, due bundle senza errori: scheduler 5.747 byte, background 1.227.022 byte; nessuna chiamata di rete |
| Preflight cloud senza configurazione | **PASS**: build bloccata prima di Next.js, nomi delle variabili mancanti visibili senza stampare valori riservati |
| HTTP sulla build locale finale, **07:06:27 UTC** | **91/91 controlli PASS**, 92 richieste, zero errori e salti |
| Accesso amministrativo locale dopo le modifiche | **PASS**, autenticazione, API private, no-store, Origin/CSRF e logout |
| PostgreSQL, Netlify Database e deployment cloud reale | **Non eseguiti**: account da collegare al repository, database da creare e saldo crediti da verificare |

I test aggiunti coprono la selezione della connessione persistente e il rifiuto di SQLite su Netlify, autenticazione e origine dei job, blocco delle anteprime, quote e abilitazioni, dispatch senza elaborazioni lunghe, errori parziali e fallimenti del briefing, payload limitati e heartbeat distinti dai worker locali. Le migrazioni PostgreSQL usano un advisory lock transazionale e un registro di versione per evitare DDL ripetute; il comportamento su un server PostgreSQL reale non è certificato da questi test locali.

Le operazioni lunghe del pannello e il cron vengono accodati in background sul cloud. HTTP 202 significa soltanto accettazione della richiesta. La pianificazione parte solo con `NETLIFY_JOBS_ENABLED=true` nel contesto di produzione: watchdog ogni minuto, notizie ogni cinque, controllo import dati ogni ora, sport ogni due minuti soltanto se configurato. Gli importatori mantengono i propri intervalli e limiti. Un watchdog ospitato su Netlify non dimostra disponibilità quando l'intero provider è irraggiungibile.

Nessun repository GitHub del giornale è stato creato o caricato e nessun nuovo permesso Netlify è stato concesso. La schermata GitHub di autorizzazione è rimasta in attesa. Il team Netlify mostrava 12 crediti, mentre la tariffa ufficiale indica 15 crediti per un deploy in produzione riuscito; non sono stati acquistati crediti né attivate ricariche. Procedura e variabili senza segreti in [NETLIFY.md](NETLIFY.md).

## Verifiche del 23 ottobre 2026

| Verifica | Esito confermato |
| --- | --- |
| Suite completa (`node node_modules/tsx/dist/cli.mjs --test tests/*.test.ts`) | **124/124 PASS**, database isolati e fixture di prova non pubblicate nel portale |
| Build finale Next.js di produzione (`next build --webpack`), inclusa la correzione delle etichette dell'asse Y | **PASS**, exit code 0, typecheck incluso; server riavviato sulla build di produzione |
| Smoke HTTP finale sulla produzione, concluso alle **06:47:26 UTC** (08:47:26 Europe/Rome) | **91/91 controlli PASS, 92 richieste HTTP, 0 errori, 0 saltati**; 66 pagine e cinque articoli pubblici controllati |
| Smoke amministrativo autenticato finale (`admin-smoke.mjs`) | **PASS**: login, nuove API private, no-store, protezione Origin/CSRF e logout |
| Integrazione dell'assistente sulla build finale | **PASS**: risposte d'archivio su carburanti, inflazione, Comune e stato dei provvedimenti; fonti presenti per i dati disponibili, assenza dichiarata per quelli mancanti. Streaming NDJSON contestuale concluso con evento `done`, senza errori e senza incremento della spesa AI |
| Importazione reale MIMIT, controllata alle **06:35:15 UTC** (08:35:15 Europe/Rome) | Snapshot con estrazione **21 ottobre 2026**: **23.810 impianti, 92.286 prezzi normalizzati, 535 righe scartate** |
| Importazione reale Eurostat | **108 osservazioni** nelle tre serie italiane; ultimo periodo **settembre 2026**, aggiornamento dichiarato dalla fonte **16 ottobre 2026** |
| Chiamate reali OpenAI e provider sportivo | Non verificate: nessuna chiave OpenAI reale o configurazione sportiva con diritti attivata |
| Installazione PWA, avvio standalone e verifica visiva/mobile dei nuovi moduli | Non verificati su dispositivi; controllo browser automatico bloccato dalla policy |

I conteggi riportano prove già concluse. Anche lo smoke precedente, concluso alle 06:32:21 UTC, aveva superato 91 controlli su 92 richieste senza errori o salti; la ripetizione finale qui registrata include la successiva correzione grafica. Il numero di articoli è quello osservato nel momento della prova, non una misura permanente dell'archivio.

Il worker notizie ha completato un secondo ciclo reale alle **06:42:26.845 UTC** (08:42:26.845 Europe/Rome): **0 elementi importati, 0 pubblicati, 71 duplicati, 0 errori, 0 token AI e costo registrato 0**. L'assenza di nuovi articoli non è un errore e non viene compensata con notizie inventate.

Il controllo amministrativo finale conferma heartbeat correnti per worker notizie, worker dati e watchdog, database raggiungibile e importazioni valide. Lo stato complessivo rimane `degraded` per gli eventi di fallimento conservati nelle ultime 24 ore; non è stato forzato a `active`. OpenAI e sport risultano disabilitati per configurazione mancante; briefing e connettori diretti ISTAT/ARERA non sono dichiarati operativi. Il probe HTTP esterno e le notifiche amministrative non sono attivi.

La suite comprende ora anche assistente contestuale e streaming strutturato, briefing con selezione verificata, versioni e revisione, dati pubblici e calcoli, servizi civici, sport con quote e diritti, supervisore indipendente e PWA. I test del service worker usano Cache API e rete simulate: dimostrano controlli tecnici di salvataggio volontario, esclusione di dati privati/live, scadenza e limiti delle copie; non dimostrano una reale installazione su telefono. Le risposte AI e sportive simulate restano confinate ai test e non costituiscono una conferma dei provider in produzione.

I due CSV MIMIT originali hanno risposto HTTP 200 nella raccolta reale. I prezzi vengono serviti da una **estrazione salvata**, con data della singola comunicazione visibile: il controllo del 23 ottobre non trasforma lo snapshot del 21 ottobre in prezzi in tempo reale. Il worker dati ricontrolla MIMIT dopo 12 ore ed Eurostat dopo 24 ore in caso di successo. Le medie carburanti sono elaborazioni aritmetiche del giornale, distinte dalle medie ponderate ministeriali; metano e carburanti analoghi mantengono l'unità €/kg. Gli indicatori Eurostat provengono da `prc_hicp_minr`, `geo=IT`, `coicop18=TOTAL/CP01/CP045`, `unit=RCH_A`: periodo statistico, aggiornamento della fonte e importazione restano separati.

Sono presenti mappa carburanti OpenStreetMap su richiesta, simulatore locale senza invio degli importi, pagine dei servizi civici e sportivi, assistente flottante e gestione degli articoli offline. Non sono stati inseriti partite, provvedimenti o articoli dimostrativi per riempire le pagine. **Nessuna edizione del nuovo briefing è stata pubblicata**, perché l'archivio disponibile non contiene ancora articoli originali idonei con le verifiche richieste. L'assenza di contenuti viene dichiarata e non aggirata.

Audio del briefing e invio push sono **disattivi**. Le preferenze locali di notifica non costituiscono una sottoscrizione; le variabili VAPID non attivano da sole un servizio. Hosting cloud, database remoto e disponibilità pubblica 24/7 restano da configurare e verificare. Documentazione aggiornata: [servizi pubblici](SERVIZI-PUBBLICI.md), [briefing](BRIEFING.md), [sport](SPORT.md), [PWA](PWA.md) e [autocontrollo](AUTOCONTROLLO.md).

## Verifiche del 22 ottobre 2026

| Verifica | Esito |
| --- | --- |
| Build finale Next.js di produzione dopo l'integrazione del logo (`next build --webpack`) | PASS, exit code 0; incluse `/api/newsroom`, `/api/chat` e `/chiedi`, con typecheck |
| Test automatici (`tsx --test tests/*.test.ts`) | 52/52 PASS, database isolati |
| Typecheck (`tsc --noEmit`) | PASS |
| HTTP sulla versione di sviluppo, alle 09:33 Europe/Rome | 66/66 PASS; questo controllo non è una prova HTTP della build di produzione |
| Nuovo HTTP sulla versione di sviluppo, alle 23:30:23 Europe/Rome | 67/67 PASS, nessun salto: 52 pagine, cinque articoli pubblici, 20 regioni, 14 categorie, controlli chat/API private e logo PNG |
| Nuovo controllo amministrativo autenticato | PASS: login, API Redazione AI con nove moduli, budget, statistiche non disponibili espresse come `null`, chat archivio, protezione Origin/CSRF e logout |
| Ripetizione mirata dopo le ultime correzioni del monitoraggio | 4/4 test di gestione PASS dopo le correzioni al contatore degli aggiornamenti e alla modalità scheduler HTTP |
| Verifica visiva dopo le modifiche alla Redazione AI e al logo | Non eseguita: accesso automatico alla scheda bloccato dalla policy del browser |

La suite ora copre anche coda persistente e ripresa dopo interruzioni, lease e retry limitati, conservazione dello snapshot della fonte, pubblicazione e checkpoint atomici, pausa e modalità di sicurezza prima del commit, assenza di doppia spesa nelle riprese, budget giornaliero e mensile condiviso fra redazione e chat, citazioni della chat tratte dall'archivio pubblico, invalidazione della cache dopo correzioni e ritiri, selezione spiegabile della homepage, priorità manuali, registro geografico e metriche facoltative senza dati personali. I test che simulano risposte del provider usano database isolati e non pubblicano notizie di prova sul sito locale.

L'ultimo ciclo reale del worker riportato il 22 ottobre, alle **23:28:46 Europe/Rome**, ha registrato **4 elementi importati, 2 pubblicati, 2 in revisione, 69 duplicati e nessun errore**. Token e costo AI registrati: **0**. Si tratta di acquisizione e trattamento dei metadati delle fonti, senza chiamate OpenAI reali. Il numero di articoli pubblici osservato dagli smoke test può cambiare fra controlli, perché acquisizione e revisione continuano sul database locale.

Il logo fornito dall'utente è conservato come asset PNG del progetto e integrato nell'intestazione, nel footer e nell'animazione iniziale. Build e risposte HTTP confermano l'integrazione tecnica; la resa visiva finale di queste modifiche resta da osservare nel browser.

## Verifiche del 21 ottobre 2026

| Verifica | Esito |
| --- | --- |
| Build Next.js di produzione (`next build --webpack`) | PASS, tutte le route compilate e typecheck incluso |
| Test automatici (`tsx --test tests/*.test.ts`) | 18/18 PASS, database isolati |
| HTTP sulla versione di produzione (`node scripts/http-smoke.mjs`) | 62/62 PASS, nessun salto |
| Accesso amministrativo locale (`node --env-file=.env.local scripts/admin-smoke.mjs`) | PASS: login, cookie HttpOnly/SameSite, API privata no-store, protezione Origin, logout |
| Feed reali | ISPRA e Protezione Civile HTTP 200; metadati importati nel database locale |
| Fonte non accessibile | ISTAT HTTP 403, connettore lasciato disattivato senza aggiramento |
| Worker indipendente | Due cicli reali completati, alle 21:39 e 21:44 Europe/Rome; intervallo minimo e duplicati registrati |
| Prima verifica visiva | Desktop e viewport mobile 390 × 844; nessun overflow orizzontale nella homepage osservata allora |

I test coprono RSS/RDF/Atom, esclusione di link esterni alla fonte e diritti non riconosciuti, fonte irraggiungibile senza arresto globale, deduplicazione, lease contesa fra processi Node distinti, data fonte assente/futura/storica, cronaca sensibile, revisioni che preservano la copia pubblica, correzione/ritiro, prenotazioni di budget concorrenti, riferimenti AI non validi, rielaborazione esplicita, budget iniziale a zero, segnalazioni private, honeypot, Origin, limiti del corpo JSON, autenticazione e rate limit atomico.

Gli smoke test HTTP del 21 ottobre verificano homepage e pagine pubbliche, 20 regioni, 14 categorie, quattro schede reali pubblicate al momento del controllo, API e filtri, rifiuto di accessi privi di autenticazione, esclusioni SEO e assenza di segreti nelle risposte controllate. Non pubblicano contenuti di prova. Il conteggio delle schede è quello di quel controllo, non una misura permanente dell'archivio.

La scheda DPC di archivio acquisita nella prima prova è stata ritirata dalla selezione recente, con motivo nel registro pubblico. I controlli sulle date ora precedono la generazione AI. Il portale distingue data dichiarata dalla fonte, pubblicazione e controllo.

## Limiti della verifica

- Nessuna chiamata OpenAI reale: manca una chiave API fornita dall'utente. L'integrazione e i limiti di budget sono testati con risposte simulate esclusivamente nei database isolati.
- SQLite verificato realmente; PostgreSQL/Supabase, Docker, systemd e scheduler remoto predisposti ma non eseguiti su infrastruttura esterna.
- Dopo il riavvio del 21 ottobre, la scheda del browser è rimasta sulla pagina d'errore interna; la policy del browser ha bloccato l'osservazione automatica di quella pagina. Anche le verifiche visive successive del 22 e 23 ottobre sono rimaste bloccate. Build e controlli HTTP sono prove distinte dalla resa grafica: la prima verifica desktop/mobile del 21 ottobre non si estende ai nuovi moduli. Serve una verifica manuale dell'anteprima, dell'installazione PWA e dei dispositivi effettivi.
- AdSense, CMP, monitoraggio esterno, dominio e documenti legali definitivi non attivati. Non è verificato un servizio pubblico 24/7: web e worker sono processi locali.

I limiti delle prove iniziali non descrivono tutti lo stato attuale: **la mappa carburanti OSM è ora implementata** e viene caricata soltanto su richiesta. Una mappa completa delle notizie geolocalizzate, invio di notifiche, audio, campagne pubblicitarie locali, editor delle categorie e connettori commerciali richiedono ancora sviluppi o configurazioni. I nuovi moduli presenti restano soggetti ai limiti e alle verifiche specifiche sopra riportati.
