# Avvio locale e messa in produzione

Per la distribuzione richiesta su Netlify, seguire [NETLIFY.md](NETLIFY.md): include PostgreSQL persistente, variabili runtime, job background e limiti del provider. I servizi Docker/systemd descritti qui restano un'alternativa per server persistenti.

Questo repository contiene l'applicazione e i suoi punti d'integrazione. **Non è stato attivato alcun hosting pubblico, dominio, account Supabase, scheduler remoto, progetto OpenAI, AdSense o CMP.** Una build riuscita e una raccolta locale non significano che il servizio sia già in esecuzione 24 ore su 24.

## Prerequisiti e avvio locale

Occorrono Node.js **24 o successivo**, pnpm e accesso HTTPS alle fonti. SQLite incluso in Node consente di avviare il progetto senza un account esterno; PostgreSQL è l'opzione da utilizzare quando si distribuiscono più processi o repliche su host differenti.

Nella cartella del progetto:

```powershell
pnpm install --frozen-lockfile
node scripts/setup-local.mjs
pnpm db:init
pnpm ingest
pnpm dev
```

Aprire `http://localhost:3000`. `setup-local.mjs` crea `.env.local` senza sovrascriverlo se esiste già e genera password amministrativa, segreto della sessione e segreto cron. Le credenziali sono in quel file privato. L'utente amministrativo predefinito è `redazione`; il pannello è disponibile su `/admin`.

Nella stessa cartella avviare i servizi separati, ciascuno in un terminale:

```powershell
pnpm worker
pnpm data:worker
pnpm sports:worker
pnpm watchdog
```

Il worker esegue l'orchestratore separatamente dalle visite al sito e controlla l'intervallo configurato nel database. L'impostazione iniziale è 5 minuti; pausa e impostazioni vengono rilette ogni 15 secondi. Un heartbeat nel database ogni 15 secondi permette al Control Center di distinguere il processo recente da una semplice configurazione: dopo 90 secondi senza heartbeat non è considerato online. La chiusura del terminale ferma il processo locale: per servizio continuo serve un supervisore sul server.

Il sistema completo comprende **cinque processi**:

| Processo | Comando | Responsabilità |
| --- | --- | --- |
| Web | `pnpm dev` in sviluppo, `pnpm start` dopo la build | Pagine, letture dal database, API e operazioni esplicite protette |
| Notizie | `pnpm worker` | Feed, coda editoriale, homepage, avvisi civici da articoli pubblicati e briefing condiviso |
| Dati pubblici | `pnpm data:worker` | Import MIMIT ogni 12 ore dopo successo ed Eurostat ogni 24 ore; controlla le scadenze ogni minuto |
| Sport | `pnpm sports:worker` | Aggiornamenti condivisi con lease, quota e competizioni autorizzate; disattivo senza configurazione |
| Autocontrollo | `pnpm watchdog` | Controlli ogni 60 secondi, incidenti, probe web e webhook amministrativo facoltativi |

I cicli con esito invariato o non ancora scaduti non comportano automaticamente nuove chiamate esterne. Un controllo ogni minuto non rende giornalieri i dati mensili Eurostat né live i CSV MIMIT. Il watchdog rileva i problemi e registra recuperi; il riavvio dei processi resta al process manager. Le visite pubbliche non avviano importazioni o generazioni del briefing. Una richiesta esplicita della chat può attivare AI soltanto se autorizzata da configurazione e budget.

La coda conserva snapshot della fonte, stato, bozza e verifiche. Un'interruzione non approva un articolo; lease scadute e checkpoint consentono il recupero con tentativi limitati e attesa. Pause e modalità sicurezza vengono ricontrollate prima delle chiamate AI e della pubblicazione. Un circuit breaker sospende temporaneamente una fonte con errori ripetuti. Il pannello permette di ispezionare la coda e richiedere un nuovo tentativo, mantenendo il gate editoriale. Vedi [REDAZIONE-AI](REDAZIONE-AI.md).

Comandi di verifica:

```powershell
pnpm typecheck
pnpm test
pnpm build
node scripts/check-sources.mjs
```

Lo smoke test delle fonti richiede rete; gli altri test possono usare fixture chiaramente di prova. Una mancata raggiungibilità di una fonte deve comparire nei registri, senza eliminare le notizie già salvate.

Con il server già avviato e almeno una notizia reale raccolta, verificare anche le pagine HTTP:

```powershell
node scripts/http-smoke.mjs
```

Il controllo usa `http://localhost:3000` per default; `TEST_BASE_URL` consente di scegliere un altro server. Non esegue raccolte o modifiche editoriali: legge le pagine, le API pubbliche e prova un accesso cron senza segreto, che deve essere rifiutato. Controlla le 20 regioni, le categorie, gli articoli disponibili, le protezioni del pannello, il mancato invio di segreti e l'esclusione dall'indice delle schede di soli metadati. In un ambiente intenzionalmente indicizzabile impostare `TEST_EXPECT_NOINDEX=false`; usare `TEST_ALLOW_EMPTY_NEWS=true` soltanto per un database deliberatamente vuoto.

## Configurazione del server

Copiare le variabili di `.env.example` nel gestore dei segreti del provider o in un file di configurazione leggibile soltanto dall'utente del servizio. Non copiare segreti in variabili `NEXT_PUBLIC_*`, nel repository, nell'immagine Docker, in screenshot o nei log.

| Variabile | Cosa fornire |
| --- | --- |
| `SITE_URL` | Origine HTTPS pubblica esatta, senza percorsi; usata anche per il controllo dell'origine e per i cookie di amministrazione |
| `SITE_INDEXABLE` | Lasciare `false` durante installazione, verifica editoriale e completamento delle pagine legali |
| `DATABASE_URL` | Connection string PostgreSQL/Supabase privata, condivisa fra web e worker; vuota solo per SQLite |
| `DATABASE_PATH` | Percorso SQLite persistente se non si usa PostgreSQL; deve essere lo stesso per web e worker |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Credenziali private; password casuale di almeno 24 caratteri |
| `SESSION_SECRET` | Segreto casuale di almeno 32 caratteri; ruotarlo invalida le sessioni esistenti |
| `CRON_SECRET` | Segreto casuale distinto, di almeno 32 caratteri, per lo scheduler HTTP alternativo |
| `TRUSTED_CLIENT_IP_HEADER` | Vuoto salvo proxy controllato che sovrascrive sempre l'header indicato e impedisce accesso diretto al backend |
| `OPENAI_API_KEY` | Chiave API del progetto, solo server-side; facoltativa per l'avvio senza AI |
| `OPENAI_MODEL` | Identificativo del modello effettivamente disponibile al proprio progetto |
| `AI_INPUT_USD_PER_MILLION` / `AI_OUTPUT_USD_PER_MILLION` | Prezzi conservativi aggiornati del modello scelto, in dollari per milione di token |
| `AI_DAILY_BUDGET_USD` | Budget iniziale desiderato; controllare anche il limite corrente nelle impostazioni amministrative persistenti |
| `AI_MONTHLY_BUDGET_USD` | Budget mensile iniziale; redazione e chat condividono entrambi i tetti, secondo il calendario di Roma |
| `AI_AUTO_PUBLISH` | Lasciare `false`: i testi generati dall'AI richiedono revisione umana. Abilitare solo dopo validazione della propria politica editoriale |
| `ADS_ENABLED` / `ANALYTICS_ENABLED` | Mantenere `false` finché le relative integrazioni e condizioni non sono state completate |
| `SCHEDULER_MODE` | `worker` per il processo persistente, oppure `http` quando è stato effettivamente configurato lo scheduler esterno |
| `FUEL_DATA_ENABLED` / `ECONOMIC_DATA_ENABLED` | Import pubblici MIMIT/Eurostat; `true` nell'esempio, disabilitabili separatamente. Nessuna chiave necessaria |
| `SPORTS_ENABLED` / `APISPORTS_KEY` | Sport disabilitato inizialmente; occorrono chiave server, provider e competizioni autorizzate nel pannello |
| `APISPORTS_DAILY_CAP` / `SPORTS_PAID_PLAN_AUTHORIZED` | Tetto server delle richieste sportive; senza autorizzazione di un piano a pagamento non supera 100/giorno. Non acquista un abbonamento |
| `CHAT_REQUESTS_PER_WINDOW` / `CHAT_RATE_WINDOW_SECONDS` | Limiti antiabuso della chat, inizialmente 15 richieste ogni 600 secondi, oltre ai budget AI |
| `WATCHDOG_INTERVAL_SECONDS` | Intervallo supervisore, inizialmente 60 secondi, ammesso 30–300 |
| `HEALTHCHECK_PROBE_WEB` / `HEALTHCHECK_SECRET` | Probe web facoltativo; segreto server di almeno 32 caratteri, con fallback al segreto cron. Il probe non controlla la resa visiva |
| `HEALTH_ALERT_WEBHOOK_URL` / `HEALTH_ALERT_WEBHOOK_SECRET` | Canale amministrativo HTTPS scelto dal gestore; vuoto significa nessun avviso esterno |
| `HEALTH_ALERT_COOLDOWN_MINUTES` / `WATCHDOG_STATE_DIR` | Cooldown degli avvisi, inizialmente 60 minuti, e directory persistente scrivibile per deduplica durante guasti DB, inizialmente `./data` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Nomi predisposti per un futuro servizio push: lasciarli vuoti. Compilarli non implementa né attiva sottoscrizioni o invii |

Il pannello resta disattivato se le credenziali richieste non sono configurate. Impostare `SITE_URL` con HTTPS in produzione, così i cookie amministrativi vengono marcati `Secure`. Usare TLS sul reverse proxy, impedire accesso pubblico diretto alla porta interna e non mettere in cache `/admin` o le API riservate.

In assenza di un header IP fidato i limiti di login e segnalazioni sono globali: è una configurazione prudente per l'installazione locale. Dietro un proxy pubblico, impostare l'header soltanto dopo avere verificato che il client non possa falsificarlo.

## PostgreSQL e Supabase

1. Creare un database e un utente applicativo sul servizio scelto. Fornire `DATABASE_URL` tramite segreti server-side. Il frontend utilizza le API dell'applicazione: non richiede chiavi Supabase pubbliche o accesso alle tabelle editoriali dal browser.
2. Usare le opzioni TLS e i certificati forniti dal provider. La stringa di connessione viene passata a `pg`; `sslmode=verify-full` richiede una catena di certificati attendibile. Non disabilitare la verifica dei certificati per risolvere un errore TLS. Se il provider offre connessione diretta o pooler, scegliere un endpoint compatibile con connessioni Node persistenti.
3. Eseguire un backup e quindi `pnpm db:init` nell'ambiente server configurato, prima di avviare i cinque processi. Questo applica gli schemi idempotenti 001, 003, 004 (sport), 005 (servizi pubblici) e 006 (briefing), inizializza fonti e impostazioni e protegge con RLS tutte le relative tabelle private su PostgreSQL. L'utente usato per inizializzare deve possedere i privilegi richiesti per creare e proteggere le tabelle. Se sono presenti i ruoli `anon` e `authenticated`, l'inizializzazione revoca loro i privilegi sulle tabelle applicative.
4. **Solo su Supabase**, `migrations/002_supabase_rls.sql` resta disponibile come hardening esplicito dello schema iniziale tramite l'SQL editor con il proprietario del database; la protezione delle nuove tabelle è applicata da `db:init`. Il file 002 usa ruoli specifici Supabase e non va applicato senza adattamento a un PostgreSQL generico.
5. Verificare che la connessione applicativa autorizzata possa leggere e scrivere e che richieste anonime all'API dati Supabase non leggano le tabelle. L'app usa una connessione server-side; proteggere e ruotare quella credenziale.
6. Attivare backup cifrati e verificarne il ripristino. Prima di migrazioni successive eseguire un backup. Non usare un database temporaneo del container per la produzione.

Con SQLite, montare una directory persistente condivisa fra web e worker sullo stesso host. Non collocare il file su un filesystem effimero o su repliche indipendenti. Per molte repliche usare PostgreSQL condiviso e una configurazione del pool coerente con i limiti del database.

Per un backup coerente del database SQLite locale, prima di migrazioni o interventi usare:

```powershell
node --env-file=.env.local scripts/backup-db.mjs
```

Il comando usa l'API di backup SQLite e salva una copia con data in `data/backups/`, senza stampare segreti. Proteggere le copie e verificarne il ripristino su un database separato. Con `DATABASE_URL` lo script si ferma: usare backup del provider o `pg_dump`. Non copiare soltanto il file principale mentre SQLite usa WAL.

## Esecuzione dei cinque processi

Per un server Linux persistente, le unità fornite in `deploy/italia-ora-web.service` e `deploy/italia-ora-worker.service` assumono installazione in `/opt/italia-ora`, utente `italiaora`, Node 24 in `/usr/bin/node` e configurazione in `/opt/italia-ora/.env.local`. Adattare questi percorsi e creare l'utente prima dell'installazione. Il file ambiente per systemd contiene righe `NOME=valore`, senza `export`, e non va esposto dal server web.

```bash
pnpm install --frozen-lockfile
pnpm db:init
pnpm build
```

Le due unità fornite avviano il sito e il worker notizie; **non coprono da sole i cinque processi**. Per dati pubblici, sport e watchdog creare tre unità equivalenti con `ExecStart=/usr/bin/node node_modules/tsx/dist/cli.mjs scripts/data-worker.ts`, `scripts/sports-worker.ts` e `scripts/watchdog.ts`, mantenendo `WorkingDirectory`, `EnvironmentFile`, utente, volume persistente e riavvio in caso di errore. Il nome dello script è l'ultimo argomento, non un secondo comando. In alternativa usare il compose già completo descritto sotto. Prima di installare unità systemd assicurarsi che `/opt/italia-ora/data` e `/opt/italia-ora/.next` esistano e siano scrivibili dall'utente `italiaora`. Il sito ascolta soltanto su `127.0.0.1`: collocare un reverse proxy HTTPS davanti alla porta interna.

```bash
sudo cp deploy/italia-ora-web.service /etc/systemd/system/
sudo cp deploy/italia-ora-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now italia-ora-web italia-ora-worker
sudo systemctl status italia-ora-web italia-ora-worker
journalctl -u italia-ora-worker --since today
```

In alternativa, `Dockerfile` e `compose.yaml` avviano `web`, `worker`, `data-worker`, `sports-worker` e `watchdog`, con la medesima configurazione e il volume persistente `news-data`. Impostare prima `.env.local` con il dominio HTTPS e i propri segreti, poi:

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=50 worker
docker compose logs --tail=50 data-worker sports-worker watchdog
```

La porta web è pubblicata solo su `127.0.0.1:3000`, da servire tramite reverse proxy HTTPS. Il volume è necessario per SQLite; con `DATABASE_URL` i processi useranno invece PostgreSQL. Il watchdog nel compose usa `SITE_URL=http://web:3000` per raggiungere soltanto il servizio interno quando il probe è abilitato; la configurazione del processo web conserva l'origine HTTPS pubblica per cookie e controllo Origin. Evitare `docker compose down -v` perché rimuove il database nel volume. Non avviare il servizio systemd e quello Docker insieme sullo stesso database. I segreti sono forniti all'avvio e non devono essere inclusi nell'immagine. Le fonti restano consultabili soltanto se l'host può effettuare richieste HTTPS in uscita.

Queste istruzioni non installano autonomamente servizi sul computer locale e non configurano un server remoto.

## Scheduler HTTP alternativo

Se la piattaforma non supporta un processo worker persistente, configurare **uno scheduler server-side esterno** ogni 5 minuti con:

```text
Metodo: POST
URL: https://<dominio-del-portale>/api/cron
Header: Authorization: Bearer <CRON_SECRET>
```

Fornire il segreto tramite il secret store dello scheduler. Non inserirlo nella query string, in un job pubblico o nel browser. Il route handler dichiara runtime Node e durata massima di 300 secondi; il provider deve realmente consentire una durata sufficiente. Un semplice cron GET non richiama questo endpoint.

Scegliere worker persistente oppure scheduler HTTP come esecutore principale e impostare `SCHEDULER_MODE` coerentemente. Il lock persistente protegge dalle sovrapposizioni, ma avviare entrambi senza necessità genera controlli saltati e rende più difficile il monitoraggio. Le richieste dei lettori non avviano la raccolta. La modalità HTTP non crea da sola un job remoto: verificarne almeno due esecuzioni reali nei registri.

Questo endpoint sostituisce soltanto l'orchestratore delle notizie. Non sostituisce `data-worker`, `sports-worker` o `watchdog`: per questi occorrono processi persistenti o job server separati che ne eseguano i cicli. `pnpm data:import` esegue una sola importazione dati, rispettando le scadenze; il watchdog ammette `--once --no-notify` per un controllo unico senza avvisi.

La cadenza di esecuzione non promette nuove notizie ogni cinque minuti: dipende da contenuti consentiti effettivamente pubblicati dalle fonti. Un servizio di hosting che va in sospensione richiede uno scheduler esterno compatibile o un piano che mantenga il worker attivo.

## Integrazione OpenAI

Il portale può raccogliere e conservare dati consentiti anche con AI disattivata. Per utilizzare la generazione occorrono chiave valida, accesso al modello scelto, prezzi configurati e budget disponibile. Nelle verifiche senza chiave non viene dimostrata una richiesta reale al modello.

Il modello nelle impostazioni persistenti deve coincidere con `OPENAI_MODEL`, al quale si riferiscono le tariffe server: una selezione diversa disattiva la generazione finché la configurazione non viene allineata. Quando si cambia modello aggiornare insieme modello e tariffe, riavviare i processi e controllare il pannello. `AI_AUTO_PUBLISH=false` mantiene la revisione umana per i testi AI; i soli metadati autorizzati a basso rischio possono seguire il gate automatico, restando esclusi dall'indicizzazione quando non hanno sufficiente contenuto originale.

La [documentazione ufficiale OpenAI sull'autenticazione](https://developers.openai.com/api/reference/overview) prescrive di mantenere la chiave sul server e caricarla da variabili ambiente o dal gestore dei segreti. Configurare prezzi coerenti con il proprio modello e la modalità di elaborazione usando il [listino ufficiale](https://developers.openai.com/api/docs/pricing). Non sono inserite tariffe fisse presunte nel progetto.

Le stime locali servono a limitare e rendere visibili i consumi; confrontarle con il rendiconto del progetto API. Impostare anche controlli di spesa e accesso sul proprio account/provider. Variazioni di prezzo, modello o impostazioni richiedono una revisione dei coefficienti prima di riattivare le generazioni.

I limiti persistenti giornaliero e mensile comprendono redazione, chat e briefing. I valori ambiente inizializzano un database nuovo: per un database esistente controllare e aggiornare le impostazioni nel Control Center. La chat `/chiedi` parte in modalità archivio, con `chatEnabled=false` e quota giornaliera zero; per abilitare l'AI servono inoltre attivazione e quota positiva nel pannello. Il modello riceve soltanto una modalità e contenuti già pubblicati, non la domanda originale del lettore. La cache condivisa controlla contenuto e stato pubblico degli articoli; correzioni e ritiri invalidano le risposte precedenti. Non abilitare log dei corpi delle richieste a `/api/chat`. Lo streaming del provider usa SSE reale; il client riceve NDJSON con affermazioni strutturate e riferimenti ammessi. Configurare il reverse proxy perché non accumuli tutto il flusso prima dell'invio. Cache e archivio sono immediati, senza digitazione simulata. Dettagli in [CHAT](CHAT.md).

## Servizi pubblici, briefing e PWA

`FUEL_DATA_ENABLED` ed `ECONOMIC_DATA_ENABLED` consentono importazioni condivise senza chiavi. Un errore conserva l'ultimo dataset valido e la sua data. La frequenza di controllo è separata dalla frequenza di pubblicazione delle fonti. Metodo, URL ufficiali, snapshot iniziali e limiti: [SERVIZI-PUBBLICI](SERVIZI-PUBBLICI.md). Gli avvisi locali e i provvedimenti necessitano della revisione esplicita in `/admin/servizi-civici`; non vengono creati atti o date di efficacia per riempire le pagine. [CIVICO](CIVICO.md).

Il briefing usa articoli originali e verificati; la generazione condivisa parte dopo le 07:00 Europe/Rome se abilitata. I nuovi testi AI rimangono in revisione. Senza chiave può comporre estratti già approvati, ma in assenza di materiale idoneo non pubblica nulla. Audio e storage non sono attivati. Impostazioni e versioni in `/admin/briefing`; [BRIEFING](BRIEFING.md).

Per la PWA servono HTTPS, manifest, icone e `/sw.js` accessibili senza autenticazione, con gli header definiti dal progetto. Non mettere in cache generalizzata HTML, API o pannelli privati nel proxy. Il service worker mantiene solo risorse statiche ammesse e copie volontarie datate di massimo 20 articoli per sette giorni. Non salva carburanti, sport, chat o dati amministrativi. `/offline` permette gestione e cancellazione; la cartografia esterna non è inclusa nelle copie. Le variabili VAPID non attivano alcun push. Prima del lancio verificare installazione e funzionamento offline su dispositivi effettivi: i test tecnici non dimostrano la resa mobile. [PWA](PWA.md).

Il watchdog può segnalare guasti mentre l'host è acceso; non sostituisce un monitor esterno per il guasto completo della macchina. I webhook amministrativi restano vuoti e nessuna consegna è dimostrata senza una prova sul canale autorizzato. [AUTOCONTROLLO](AUTOCONTROLLO.md).

## Controlli di esercizio

- Nel pannello verificare ultima esecuzione, fonti raggiungibili, errori, coda editoriale e consumo AI. Controllare la presenza di almeno due cicli successivi senza visite al sito.
- Simulare fonte irraggiungibile e assenza di chiave: homepage e articoli precedenti devono restare disponibili, con stato trasparente. Un errore non deve produrre notizie inventate.
- Verificare che due esecuzioni contemporanee non elaborino lo stesso ciclo, che una ripetizione non pubblichi duplicati e che allerte/cronaca sensibile rimangano in revisione.
- Controllare backup, spazio su disco, disponibilità database, scadenza TLS e riavvio dopo crash/riavvio host. La presenza del codice di logging non attiva un servizio di allerta remoto.
- Usare lo smoke test dei feed e [il registro dei diritti](SOURCES.md) prima di aggiungere o riattivare una fonte.

## Prima del lancio pubblico

Completare contatti del gestore, privacy, cookie, termini, procedura di segnalazione e correzione, informativa AI e revisione dei diritti. I dati societari non sono stati inventati. Un professionista competente deve valutare conformità e eventuali adempimenti per la testata prima della pubblicazione e monetizzazione.

Gli spazi pubblicitari sono predisposti come elementi dell'interfaccia; non esiste un account AdSense approvato né una CMP già certificata e collegata. Mantenere pubblicità e tracker disabilitati fino al completamento delle integrazioni autorizzate e dei consensi necessari. Abilitare `SITE_INDEXABLE` solo dopo la verifica editoriale e tecnica del dominio effettivo. Le pagine senza valore originale sufficiente devono restare escluse dall'indicizzazione.
