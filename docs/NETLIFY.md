# Pubblicare GIORNALE AI24 su Netlify

Il progetto usa Next.js con rendering server, API e database. Va distribuito tramite una build Netlify con l'adapter OpenNext automatico. Il caricamento della sola cartella `public/` o di un archivio del sorgente nel riquadro di deploy statico non avvia il giornale completo.

## Stato della preparazione

- `netlify.toml`: comando di build, output `.next`, funzioni e migrazioni incluse.
- Node.js 24 per build e funzioni; nessun adapter Next.js bloccato a una versione manuale.
- Database PostgreSQL tramite `DATABASE_URL` oppure `NETLIFY_DB_URL` di Netlify Database. SQLite resta disponibile in locale e viene rifiutato nel runtime cloud Netlify.
- Job in background per le elaborazioni lunghe e dispatcher pianificato; restano spenti fino all'abilitazione esplicita.
- Password, segreti, database locale, backup e dipendenze non vanno nel repository.

La preparazione locale non costituisce una pubblicazione: l'URL online e l'esito del deploy vanno verificati nel progetto Netlify.

## 1. Repository e progetto

Usare un repository GitHub dedicato, preferibilmente privato, contenente i sorgenti e il lockfile. Non riutilizzare repository di altri progetti. Concedere all'app Netlify accesso soltanto al repository del giornale.

Nel team Netlify selezionare **Import a Git repository → GitHub**, scegliere il repository, il nome del progetto e la branch di produzione. Le impostazioni sono lette da `netlify.toml`:

| Impostazione | Valore |
| --- | --- |
| Base directory | Radice del repository |
| Build command | `node scripts/netlify-build.mjs` |
| Publish directory | `.next` |
| Functions directory | `netlify/functions` |
| Node.js | 24 |

Prima del primo deploy configurare il database e le variabili. Lo script di build rifiuta una configurazione cloud priva di database, origine HTTPS o credenziali amministrative, indicando soltanto i nomi mancanti.

## 2. Database persistente

Si può creare **Netlify Database** da **Data & Storage → Database**: Netlify fornisce `NETLIFY_DB_URL`, già supportata dal driver PostgreSQL del progetto. Non viene creato automaticamente dal sorgente. In alternativa impostare `DATABASE_URL` con la connection string privata di un PostgreSQL esterno, con TLS verificato e connessioni compatibili con funzioni serverless.

Il database deve appartenere al gestore. Il ruolo server deve poter applicare le migrazioni e accedere alle tabelle private; non usare una chiave pubblica Supabase come connection string. Le migrazioni inizializzano lo schema senza inserire notizie dimostrative. Non esporre le tabelle editoriali tramite ruoli REST pubblici.

Il database locale non viene trasferito automaticamente. I job possono ricostruire i dati pubblici dalle fonti attive; articoli, revisioni e impostazioni già presenti richiedono una migrazione separata e controllata se devono essere conservati online. Non caricare il file SQLite o i backup nella cartella pubblicata.

## 3. Variabili e segreti

Modello senza credenziali: [`deploy/netlify.env.example`](../deploy/netlify.env.example). Inserire i valori nel gestore **Environment variables** di Netlify, con ambiti **Builds e Functions**. Le variabili nella sola sezione `build.environment` del TOML non configurano i segreti runtime.

- `SITE_URL`: origine pubblica HTTPS esatta, ad esempio `https://giornale-ai24.netlify.app`, dopo aver verificato il nome assegnato. Usare la propria origine per il dominio definitivo.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`: valori riservati; password e segreti di almeno 32 caratteri. Generarli localmente e copiarli nel gestore dei segreti, senza pubblicarli o inviarli in chat.
- `DATABASE_URL` oppure `NETLIFY_DB_URL`: connessione server PostgreSQL. Non impostare `DATABASE_PATH` in cloud.
- `AWS_LAMBDA_JS_RUNTIME=nodejs24.x`, `SCHEDULER_MODE=http`.
- `SITE_INDEXABLE=false`, AI e sport inizialmente disattivati; le credenziali dei fornitori si configurano dopo il collaudo con budget e diritti verificati.
- `NETLIFY_JOBS_ENABLED=false` durante l'installazione, poi `true` **soltanto nel contesto Production** dopo il primo controllo. `NETLIFY_JOBS_ALLOW_PREVIEW=false`.

Usare database e segreti separati per le anteprime. Non consentire a branch non fidate di accedere al database di produzione. Quando il nome del sito o il dominio cambia, aggiornare `SITE_URL` e ridistribuire: l'origine governa anche le operazioni amministrative.

## 4. Aggiornamenti e monitoraggio

Netlify non esegue i worker CLI infiniti del computer locale. Il dispatcher pianificato avvia elaborazioni background, autenticate con `CRON_SECRET`, mentre le pagine pubbliche leggono il database. Gli importatori mantengono i propri controlli di scadenza, le quote e le lease; una nuova invocazione non forza nuovi download o nuove spese AI.

Le Scheduled Functions hanno un limite di 30 secondi, le richieste sincrone di 60 secondi e le Background Functions di 15 minuti. Per questo gli import lunghi non vengono eseguiti nella richiesta della pagina o nel piccolo dispatcher. I job restano soggetti ai limiti del piano e alle risorse del database. Dopo il deploy verificare gli esiti nel Control Center e nei log Netlify; l'accettazione HTTP 202 di un job conferma soltanto l'accodamento.

Frequenze del dispatcher: watchdog ogni minuto, notizie ogni cinque minuti, controllo dei job dati ogni ora e sport ogni due minuti soltanto se abilitato con chiave. Il job dati controlla internamente le scadenze MIMIT di 12 ore ed Eurostat di 24 ore. Il briefing ordinario segue il ciclo notizie; la generazione manuale del briefing e le elaborazioni lunghe del pannello usano anch'esse il job background. Il monitor valuta separatamente heartbeat del dispatcher e stato di ciascun job, senza simulare worker persistenti.

Il watchdog sullo stesso provider può controllare i moduli, ma un guasto completo di Netlify richiede un monitor esterno indipendente. Il fallback su file temporaneo è effimero tra istanze: durante un guasto del database non garantisce deduplica globale degli avvisi. Nessun webhook amministrativo viene attivato senza configurazione.

## 5. Collaudo e crediti

Controllare homepage, articolo, `/admin`, `/carburanti`, `/api/status`, API private e almeno un ciclo del dispatcher. Verificare che le notizie restino presenti tra due invocazioni, che le correzioni raggiungano briefing e chat e che il monitor distingua dati non configurati da errori. Il sito parte senza chiamate OpenAI o sportive a pagamento.

Su un piano a crediti, ogni deploy riuscito in produzione consuma **15 crediti**; compute, richieste, traffico e database possono consumarne altri. Le anteprime non consumano crediti di deploy, ma i loro servizi restano soggetti alle altre misurazioni. Non attivare acquisti o ricariche automatiche senza una scelta del titolare. Il 23 ottobre 2026 la schermata del team KEG Studios mostrava **12 crediti disponibili**: il saldo va ricontrollato prima della pubblicazione.

Fonti ufficiali verificate il 23 ottobre 2026: [Next.js su Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [Netlify Database e driver](https://docs.netlify.com/build/data-and-storage/netlify-database/tooling/), [limiti delle funzioni](https://docs.netlify.com/build/functions/configuration/), [job pianificati](https://docs.netlify.com/build/functions/scheduled-functions/), [job background](https://docs.netlify.com/build/functions/background-functions/), [variabili runtime](https://docs.netlify.com/build/functions/environment-variables/) e [crediti](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).
