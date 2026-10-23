# GIORNALE AI24 · by KEG Studios

MVP locale funzionante di un portale gratuito di informazione italiana. **Nessun articolo dimostrativo è inserito nel database pubblico.** I contenuti iniziali derivano da feed ufficiali accessibili; gli argomenti sensibili entrano in revisione. Il progetto non è ancora pubblicato su un dominio pubblico.

Distribuzione Netlify predisposta: [guida di pubblicazione](docs/NETLIFY.md), con database PostgreSQL e aggiornamenti in background. La preparazione del repository non indica che il deploy cloud sia già stato eseguito.

## Avvio rapido

Richiede **Node.js 24+** e pnpm (oppure npm).

```powershell
corepack enable
pnpm install --frozen-lockfile
node scripts/setup-local.mjs
pnpm db:init
pnpm ingest
pnpm dev
```

Apri [http://localhost:3000](http://localhost:3000). Per eseguire tutti i servizi, avvia ciascun comando in un terminale distinto:

```powershell
pnpm worker
pnpm data:worker
pnpm sports:worker
pnpm watchdog
```

L'architettura comprende cinque processi: web, worker notizie, worker dati pubblici, worker sport e supervisore indipendente. Il worker notizie controlla le fonti ogni 5 minuti anche senza visitatori; rilegge pausa e intervallo ogni 15 secondi. Il worker dati condivide le importazioni MIMIT ed Eurostat, il worker sport rispetta quote e abilitazioni, il watchdog controlla gli stati registrati. Lo sport rimane disabilitato senza chiave, competizioni e diritti configurati. Nessun processo locale continua se il computer è spento: per 24/7 servono un server e un gestore dei processi. L’anteprima Codex non sostituisce l'hosting. Vedi [DEPLOYMENT](docs/DEPLOYMENT.md).

Se usi npm: `npm install`, quindi `npm run db:init`, `npm run ingest`, `npm run dev` e `npm run worker`. Non mantenere contemporaneamente due lockfile diversi; `pnpm-lock.yaml` è il lockfile verificato di questo progetto.

## Pannello editoriale

Apri [/admin](http://localhost:3000/admin). Lo script `setup-local.mjs` genera credenziali casuali e segreti in `.env.local`, escluso da Git; **leggi `ADMIN_USERNAME` e `ADMIN_PASSWORD` in quel file**. Nessun segreto è mostrato nella console. Non condividere il file. Se il file esiste già, lo script non lo modifica.

Il Control Center mostra stato effettivo del worker, nove responsabilità dell'orchestratore, coda persistente, verifiche, esecuzioni, anomalie, fonti, token e costo stimato. Permette aggiornamento manuale, pausa, modalità sicurezza, intervallo, limiti AI giornalieri e mensili, quota chat, attivazione delle sole fonti autorizzate, approvazione, correzione e ritiro. La homepage ha un ordine motivato e consente posizioni o esclusioni editoriali con un motivo registrato. Le modifiche sostanziali conservano la versione precedente e producono un registro pubblico. Le segnalazioni dei lettori sono private, limitate contro lo spam e non vengono mai pubblicate automaticamente; il worker elimina quelle più vecchie di 90 giorni.

Le nove responsabilità non sono nove modelli sempre attivi: controlli, classificazione e supervisione sono in gran parte deterministici. Una fonte ufficiale prova la provenienza della dichiarazione, non una verifica indipendente dei fatti. Dettagli su stati, revisioni, retry e controlli: [REDAZIONE-AI](docs/REDAZIONE-AI.md).

Autenticazione con cookie HttpOnly, firma HMAC, scadenza di 8 ore, confronto credenziali tramite scrypt, controllo Origin e rate limit persistente. In produzione servono HTTPS e `SITE_URL` corretto. Senza un proxy esplicitamente fidato, il limite usa un unico contatore globale conservativo; non ci si fida di `X-Forwarded-For` inviato dal client.

## Database e fonti

- SQLite persistente (`DATABASE_PATH=./data/italia-ora.sqlite`) per partire senza servizi esterni.
- PostgreSQL/Supabase tramite `DATABASE_URL` per il server di produzione. `pnpm db:init` applica gli schemi 001, 003, 004 (sport), 005 (servizi pubblici) e 006 (briefing); prima dell'aggiornamento conserva un backup. L'inizializzazione protegge le tabelle private con RLS su PostgreSQL e revoca l'accesso ai ruoli Supabase pubblici presenti; vedi anche l'hardening in `migrations/002_supabase_rls.sql`.
- Registro separato per fonti, importazioni, eventi, riepiloghi, citazioni, revisioni, versioni, correzioni, esecuzioni, uso AI, job, lease, azioni, anomalie e selezioni della homepage.
- Feed ISPRA e Protezione Civile; ISTAT configurata ma inizialmente disattiva perché il controllo ha ricevuto 403. Il Comune di Castronovo di Sicilia ha condizioni di riuso documentate, ma il suo RSS è disattivato perché contiene elementi di archivio. Le testate commerciali elencate nel brief rimangono disattive finché non vengono documentati diritti e modalità di accesso.
- Non vengono scaricati articoli, immagini o pagine protette. Licenza della fonte e URL originale sono conservati e visualizzati.

Condizioni, attribuzioni e test reali: [SOURCES](docs/SOURCES.md).

## OpenAI: cosa fornire

L’integrazione server-side usa la Responses API con output JSON strutturato e validazione. Nessuna chiave raggiunge il browser. Senza configurazione il sito continua a raccogliere e pubblicare i soli metadati consentiti; non presenta riepiloghi di regole come se fossero generati dall’AI.

In `.env.local` imposta:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
AI_INPUT_USD_PER_MILLION=0
AI_OUTPUT_USD_PER_MILLION=0
```

Sostituisci gli zeri con tariffe **conservative e verificate per quel modello**. La chiave da sola non abilita richieste a pagamento. Il modello configurato deve coincidere con quello tariffato; se lo cambi, aggiorna insieme modello e tariffe sul server. Budget giornaliero e mensile, quota chat e numero massimo di elementi elaborati sono modificabili dal pannello. Le prenotazioni atomiche del costo sono condivise fra redazione, chat e briefing e impediscono che elaborazioni simultanee superino i tetti configurati; una chiamata dall’esito incerto mantiene la prenotazione. Giorni e mesi seguono `Europe/Rome`. Le cifre sono stime applicative, non fatture OpenAI: configura anche i limiti dell’account del fornitore.

Per elaborare con AI schede già importate dopo aver configurato la chiave, usa “Elabora schede con AI” nel pannello o `pnpm ingest --reprocess`. La rielaborazione è esplicita, limitata ai contenuti recenti e non sensibili ancora presenti nei feed. I testi AI richiedono revisione umana nella configurazione iniziale (`AI_AUTO_PUBLISH=false`); un ID di fonte valido non prova da solo che ogni affermazione sia corretta.

Riepiloghi e spiegazioni sono preparati durante l’importazione e salvati nel database. Il pulsante “Spiegamelo meglio” legge questi dati e non effettua richieste AI. La pagina [/chiedi](http://localhost:3000/chiedi) consulta l'archivio pubblico con fonti, anche senza chiave. La generazione AI della chat richiede attivazione esplicita e un sottobudget positivo, inizialmente entrambi disattivati. Non esegue ricerche web: domanda originale e conversazione restano fuori dal provider e dalla cache condivisa. Rate limit, cache con controllo delle versioni e risposte d'archivio limitano i costi. Vedi [CHAT](docs/CHAT.md). I controlli automatici non equivalgono a una verifica giornalistica indipendente: fonti ufficiali e dichiarazioni restano attribuite, e i casi dubbi passano alla revisione.

Documentazione API utilizzata: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Funzionalità presenti

- Homepage SSR, notizie, categorie, ricerca e 20 pagine regionali con stati vuoti espliciti.
- Tema chiaro/scuro, navigazione mobile, data/ora italiana e orario dei controlli effettivi.
- Logo fornito dal gestore nell'intestazione, nel footer e nell'animazione iniziale di circa tre secondi, a ogni apertura o ricarica e con rispetto delle preferenze di movimento ridotto; vedi [LOGO](docs/LOGO.md).
- “La mia Italia” con zona e categorie, notizie seguite conservate nel browser senza account. Province e comuni vengono proposti solo quando esistono dati verificati.
- Cronologia evento, fonti e licenze, spiegazioni memorizzate, registro delle correzioni, selezione quotidiana condivisa “L’Italia in 60 secondi”.
- Assistente flottante contestuale, disponibile anche su `/chiedi`: risposte d'archivio dichiarate, fonti e annullamento. Quando l'AI è attivata usa streaming SSE reale dal provider e invia al browser soltanto affermazioni strutturate con riferimenti ammessi. Domande e conversazioni non sono conservate sul server né inviate al provider. Vedi [ASSISTENTE-WIDGET](docs/ASSISTENTE-WIDGET.md) e [CHAT](docs/CHAT.md).
- `/briefing` e archivio con versioni, selezione di articoli originali verificati, generazione condivisa alle 07:00 di Roma, revisione dei nuovi testi AI, correzioni e ritiro. Senza articoli idonei non viene creato un riepilogo fittizio. Audio predisposto nello schema ma non attivo. Vedi [BRIEFING](docs/BRIEFING.md).
- `/guerra-silenziosa`, `/carburanti`, `/italia-in-numeri` e `/quanto-mi-costa-vivere`: dati MIMIT ed Eurostat italiani, date e unità esplicite, mappe su richiesta e simulatore che mantiene gli importi nella memoria della pagina. Medie carburanti calcolate dal giornale, distinte dalle medie ministeriali. Vedi [SERVIZI-PUBBLICI](docs/SERVIZI-PUBBLICI.md).
- `/il-mio-comune` e `/cosa-cambia-davvero`, con avvisi e provvedimenti controllati dalla redazione; copertura comunale iniziale limitata, senza efficacia giuridica desunta da annunci. Gestione in `/admin/servizi-civici`. Vedi [CIVICO](docs/CIVICO.md).
- `/sport`: risultati, calendario, classifiche, squadre, competizioni e preferiti locali. I formati calcio e pallavolo hanno adapter predisposti; nessuna copertura o partita è dichiarata disponibile senza dati importati e diritti verificati. Gestione in `/admin/sport`. Vedi [SPORT](docs/SPORT.md).
- PWA con manifest, icone e salvataggio volontario di massimo 20 articoli per sette giorni. Copie datate, cancellabili da `/offline`; prezzi, sport, chat e aree private non vengono salvati. Installazione dipendente dal browser; notifiche solo predisposte, nessun invio. Vedi [PWA](docs/PWA.md).
- `/admin/autocontrollo`: watchdog con controlli reali, incidenti e recuperi registrati; webhook amministrativo facoltativo solo se configurato. Vedi [AUTOCONTROLLO](docs/AUTOCONTROLLO.md).
- Scheduler separato, heartbeat, coda persistente con checkpoint, lease nel database, timeout, retry limitati, circuit breaker per fonte, deduplicazione e gate editoriale dei contenuti sensibili.
- Sitemap/robots/canonical/Open Graph; indicizzazione disattiva di default (`SITE_INDEXABLE=false`), pagine vuote e schede senza contenuti originali escluse dalla sitemap delle notizie.
- Segnalazioni moderate, pannello privato, schema pronto per PostgreSQL e servizi Docker/systemd.

## Cosa resta da attivare prima del lancio

Non sono stati attivati: chiave e fatturazione OpenAI reali, database cloud, hosting 24/7, dominio, monitor esterno dell'host, AdSense, CMP certificata, campagne locali, provider sport con diritti di pubblicazione, audio briefing e invio di notifiche push. La mappa carburanti carica cartografia OpenStreetMap solo su richiesta; una mappa completa delle notizie geolocalizzate non è implementata. Nessun annuncio o tracker pubblicitario viene caricato. Il contatore aggregato opzionale non misura visitatori unici e non è un’integrazione AdSense.

Le pagine legali sono **bozze da completare**, non documenti di conformità. Servono dati del gestore, contatti, titolarità/trattamenti, accordi con fornitori e validazione professionale degli obblighi italiani, inclusa l’eventuale registrazione della testata. Pubblicazione pubblica e monetizzazione richiedono questa verifica. `SITE_INDEXABLE=true` abilita soltanto la predisposizione SEO, non certifica conformità né garantisce Google News.

La copertura iniziale è limitata alle fonti attive: non sono garantite notizie locali o di ogni categoria. Non vengono inferite regioni o coordinate da una semplice menzione di città. Dati territoriali più precisi richiedono connettori e prove adeguati. Il raggruppamento fra fonti è volutamente prudente e non è un riconoscimento semantico completo di tutti gli avvenimenti.

## Verifica e produzione

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm start
node scripts/check-sources.mjs
```

I test usano database isolati e fixture chiaramente di prova, non inserite nel portale. La build e le letture delle pagine non avviano chiamate OpenAI; una domanda esplicita all'assistente può farlo solo se tutte le abilitazioni sono configurate. Le prove con provider simulati non dimostrano una chiamata OpenAI o sport reale. Il controllo visivo automatico è stato bloccato dalla policy del browser: installazione PWA e resa mobile richiedono una verifica manuale. Registro delle verifiche effettive: [VALIDATION](docs/VALIDATION.md). Guida con cinque processi, TLS, backup, Supabase e scheduler HTTP alternativo: [DEPLOYMENT](docs/DEPLOYMENT.md).

Per Docker: `docker compose up --build -d` avvia i cinque processi con volume condiviso. Pubblica il sito dietro un reverse proxy HTTPS; la porta del compose è limitata a `127.0.0.1`.
