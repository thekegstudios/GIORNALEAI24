# AI24 AUTOCONTROLLO

Il supervisore è un processo Node separato dal sito Next.js e dal worker di raccolta. Non aspetta visite e non usa un’AI per inventare riparazioni. Il pannello è `/admin/autocontrollo`; la lettura autenticata è `/api/admin/health`.

## Esecuzione

```powershell
node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/watchdog.ts
```

Un controllo singolo senza notifiche:

```powershell
node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/watchdog.ts --once --no-notify
```

Il processo registra il proprio heartbeat, legge gli stati reali e ripete il controllo ogni 60 secondi (`WATCHDOG_INTERVAL_SECONDS`, 30–300). Gli errori di accesso al database applicano backoff fino a cinque minuti. Una lease separata evita cicli duplicati fra istanze connesse allo stesso database. Il supervisore deve essere eseguito come servizio con riavvio gestito dall’infrastruttura; lo sviluppo locale non equivale a disponibilità cloud 24/7. Il controllo singolo registra anche l’arresto e non viene spacciato per un servizio ancora attivo.

## Che cosa controlla

- Accesso al database e schema necessario.
- Heartbeat del worker notizie o controlli effettivi dello scheduler HTTP, esecuzioni bloccate/parziali, fonti in errore/ritardo. Un esito parziale con errori non viene classificato come regolare.
- Heartbeat del worker dati pubblici, separato dalla data dell’ultima importazione: un dataset recente non prova che il processo sia ancora attivo. Sono riconosciuti `lastHeartbeatAt` e il campo precedente `heartbeatAt`, con presenza entro tre minuti e stato `online`.
- Coda persistente, backlog, job falliti e lease scadute. Il recupero resta nei worker autorizzati.
- Richieste OpenAI completate, fallimenti, prenotazioni dall’esito incerto, token e limiti AI globali giornalieri/mensili. Una prenotazione ancora pendente non dimostra una risposta live riuscita. Nessuna richiesta API di prova a pagamento.
- Import MIMIT, data effettiva del dataset, ultimo successo e righe scartate registrate nell’audit.
- Import economici, errore del connettore e periodo statistico separato dalla data di controllo. Il connettore esistente usa Eurostat per l’Italia; i collegamenti diretti ISTAT/ARERA non vengono dichiarati attivi se non implementati/configurati.
- Configurazione effettiva delle API sportive, errori/ritardi dei task, richieste e quota residua comunicata dal provider.
- Stato dell’ultima generazione del briefing e fallimenti server conservati nel registro. Il servizio non misura errori JavaScript nei browser.

La lettura HTTP e il pannello non avviano importazioni, generazioni AI o notifiche. Le informazioni non disponibili sono dichiarate tali. “Configurato” non significa che una richiesta live sia riuscita. Le serie statistiche mensili non vengono rese “di oggi” perché il controllo è odierno.

## Probe web indipendente

Il controllo del database da solo non prova che il frontend funzioni. Per il probe web server autenticato:

```dotenv
HEALTHCHECK_PROBE_WEB=true
HEALTHCHECK_SECRET=un-segreto-server-lungo-almeno-32-caratteri
SITE_URL=https://il-dominio-configurato-del-giornale
```

Il watchdog chiama soltanto `/api/admin/health?probe=1` sul `SITE_URL` configurato con un Bearer server, timeout di cinque secondi e redirect vietati. Se `HEALTHCHECK_SECRET` non è impostato può usare `CRON_SECRET` (almeno 32 caratteri). Il probe verifica la disponibilità dell’endpoint e del database; non afferma di aver verificato visivamente le pagine. URL e segreti non sono accettati dal browser.

## Notifiche amministrative

Il canale è **disattivato finché non viene configurato un URL HTTPS pubblico dal gestore**:

```dotenv
HEALTH_ALERT_WEBHOOK_URL=https://il-canale-scelto-dal-gestore
HEALTH_ALERT_WEBHOOK_SECRET=
HEALTH_ALERT_COOLDOWN_MINUTES=60
WATCHDOG_STATE_DIR=./data
```

Nessun recapito viene inventato. Il payload JSON contiene `text`, `event`, `severity`, `component`, `code`, `detectedAt`. Il messaggio invita a consultare il pannello; non include domande dei lettori, articoli, messaggi privati, credenziali, URL del webhook o corpi della risposta. L’eventuale segreto viene inviato soltanto come `Authorization: Bearer …` al canale configurato. Non viene stampato o restituito dalle API.

Le notifiche hanno timeout otto secondi, redirect vietati, massimo tre invii per ciclo, deduplica persistente in `admin_alerts`, fino a tre tentativi con backoff e cooldown minimo di 15 minuti (predefinito 60). Una richiesta senza esito certo mantiene la prenotazione per due minuti prima di un nuovo tentativo; non viene dichiarata consegnata. Configurazione e consegna sono stati distinti.

I consumi esposti riguardano i provider del giornale e i budget configurati nel progetto. Non rappresentano la quota dell’abbonamento Codex usato per sviluppare il sito.

Se il database non è scrivibile, il file `WATCHDOG_STATE_DIR/watchdog-alerts.json` conserva soltanto impronte e stati d’invio. Un lock e sostituzione atomica con flush evitano duplicati fra processi che condividono il volume. Il cooldown del file viene rispettato anche al recupero del database. La cartella deve essere persistente e scrivibile; se manca anche questa possibilità, nessun invio viene eseguito senza una prenotazione di deduplica. Nessun file contiene il segreto o il contenuto dell’allarme.

## Audit e limiti di recupero

Gli incidenti correnti e il riepilogo sono conservati in `public_data_runtime` (`watchdog`, `watchdog:incidents`, `watchdog:health`). Aperture, recuperi e invii vengono aggiunti al registro `newsroom_actions`; gli eventi invariati non riaprono continuamente lo stesso incidente. Il pannello mostra lo storico. Durante un’interruzione del database l’audit DB può essere indisponibile, mentre il controllo e il canale opzionale con deduplica su file restano indipendenti.

Il supervisore segnala e conserva lo stato. Non modifica codice, credenziali o configurazione, non cancella dati, non altera budget e non riavvia autonomamente processi estranei. Queue, retry, circuit breaker e recuperi tecnici già previsti nei worker rimangono gli unici meccanismi automatici di ripristino.

Un watchdog nello stesso host può rilevare il crash del processo web o del worker. Per un guasto completo dell’host serve un monitor esterno o una seconda macchina con accesso autorizzato al database/canale; il programma non sostiene di potersi eseguire su un server spento.

## Verifica

`node node_modules/tsx/dist/cli.mjs --test tests/service-health.test.ts`

Quattordici test coprono letture senza chiamate API, heartbeat distinti dei worker e pausa/scheduler HTTP, esecuzioni parziali, prenotazioni AI ancora pendenti, dataset vecchi con import recente, scarti MIMIT, budget raggiunto, canali non configurati, invio concorrente unico, header Bearer opzionale e segreti esclusi da payload/audit, retry limitati, fallback persistente durante perdita della tabella alert e recupero DB, audit deduplicato, probe web autenticato con errore HTTP e schema non disponibile senza esposizione dei dettagli del driver. SQLite è in memoria; rete esterna simulata. Verificati 14/14 il 23 ottobre 2026 con i permessi del servizio; la sandbox Windows impediva il rename atomico del solo percorso fallback.
