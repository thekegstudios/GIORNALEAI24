# Redazione GIORNALE AI24

La redazione è un orchestratore applicativo con nove responsabilità distinte, una coda persistente e un pannello privato. Non sono nove processi autonomi né nove modelli sempre attivi: gran parte del lavoro è deterministico; la generazione AI è facoltativa e soggetta ai limiti del server.

## Componenti effettivi

| Responsabilità | Implementazione | Perimetro |
| --- | --- | --- |
| Ricercatore | `src/lib/feeds.ts`, `src/lib/pipeline.ts` | Legge solo feed configurati, abilitati e autorizzati; conserva provenienza, URL, hash e date. |
| Verificatore | `src/lib/verification.ts` | Controlla provenienza, diritti configurati, URL, data della fonte e indicatori di rischio. Non certifica la verità delle affermazioni. |
| Redattore | `src/lib/ai.ts`, `src/lib/budget.ts` | Produce una sintesi quando chiave, prezzi, budget e condizioni editoriali lo permettono. In caso contrario conserva una scheda attribuita. |
| Classificatore | `src/lib/editorial.ts`, `src/lib/geography.ts` | Assegna categorie e solo la copertura territoriale documentata della fonte; non deduce un comune dalle parole nel testo. |
| Caporedattore | `src/lib/homepage.ts` | Ordina i contenuti pubblicati usando rilevanza, data della fonte e varietà. Rispetta posizioni ed esclusioni motivate dal gestore. |
| Aggiornatore | `src/lib/pipeline.ts`, `src/lib/store.ts` | Collega nuove versioni della stessa fonte, conserva revisioni e gestisce correzioni e ritiri. Non fonde eventi soltanto perché i titoli somigliano. |
| SEO | `src/lib/seo.ts`, `src/lib/monitor.ts` | Prepara metadati e idoneità all'indice; registra controlli limitati di disponibilità dei link. Non garantisce posizionamento nei motori. |
| Analista | `src/lib/monitor.ts`, `src/app/api/metrics/route.ts` | Usa contatori reali di coda, errori, costi e pagine misurate quando la raccolta è abilitata. |
| Supervisore | `src/lib/queue.ts`, `src/lib/monitor.ts`, `src/lib/audit.ts` | Recupera lease scadute, limita i tentativi, registra anomalie e azioni. Non cambia credenziali, budget o autorizzazioni alle fonti. |

`src/lib/newsroom-types.ts` contiene il contratto condiviso tra server e Control Center. La persistenza è in `migrations/003_newsroom.sql`, inizializzata da `src/lib/db.ts` insieme allo schema principale. Sono supportati SQLite locale e PostgreSQL tramite `DATABASE_URL`; il browser non riceve credenziali del database o chiavi OpenAI.

## Flusso e tracciabilità

I job attraversano `DISCOVERED → NORMALIZED → VERIFYING → DRAFT`, quindi revisione umana oppure approvazione e pubblicazione. Sono previsti anche aggiornamento, rifiuto, ritiro ed errore. `src/lib/queue.ts` applica le transizioni ammesse, una chiave di idempotenza per fonte/URL/hash e lease di tre minuti. I tentativi automatici sono limitati a tre con attesa crescente; il retry manuale riparte dalla coda e non approva il contenuto.

Azioni, anomalie, verifiche, edizione homepage e override hanno registri persistenti. Le schede precedenti all'introduzione della coda possono ricevere una traccia di importazione storica esplicita: i passaggi che non erano registrati non vengono ricostruiti come attività realmente eseguita.

## Cosa significa «verifica»

Un feed istituzionale e un collegamento valido dimostrano una provenienza attribuita, non una corroborazione indipendente. La verifica corrente lascia le affermazioni in `NEEDS_VERIFICATION`; rischi o metadati insufficienti richiedono `HUMAN_REVIEW`. Le schede di soli metadati non diventano fatti confermati per effetto della pubblicazione. Il numero di link non prova il numero di origini indipendenti.

La data RSS, la data di acquisizione e la data dell'evento sono campi diversi. La data dell'evento resta nulla quando manca una prova specifica. Anche il territorio resta `undetermined` se non è disponibile un'attribuzione documentata. La copertura di una fonte regionale non localizza precisamente l'evento: provincia e comune non vengono inventati. Il registro iniziale di `src/lib/geography.ts` contiene le regioni; eventuali ulteriori unità e relazioni richiedono dati territoriali documentati nel database.

## Controllo costi e AI

`src/lib/budget.ts` prenota il costo massimo stimato prima della chiamata, serializzando le prenotazioni nel database. Il limite giornaliero e quello mensile valgono per la spesa complessiva; la chat ha inoltre una quota giornaliera propria. I giorni di contabilizzazione usano `Europe/Rome`. I costi registrati sono stime basate sui prezzi configurati, non una fattura del fornitore. Quando un timeout non permette di conoscere il consumo, resta addebitata la prenotazione conservativa; gli eventuali token non misurati non vengono inventati.

Le chiamate a pagamento richiedono `OPENAI_API_KEY`, modello server compatibile e prezzi input/output positivi. La chat AI richiede anche `chatEnabled` e budget disponibile. La pausa blocca l'operatività prevista dalle impostazioni; la modalità sicurezza blocca le chiamate AI e invia le nuove pubblicazioni alla revisione umana. Nessun modello può aumentare i limiti. L'abilitazione della pubblicazione automatica è una decisione del gestore e non sostituisce i controlli editoriali.

`src/lib/chat.ts` risponde usando l'archivio pubblico con fonti; la modalità archivio funziona anche senza generazione AI. Non è una ricerca web in tempo reale. La risposta cita contenuti selezionati e rende visibili i limiti; non fornisce consulenze personali mediche, legali, fiscali o finanziarie. Cache e controlli di versione impediscono di servire risposte basate su contenuti ritirati o cambiati.

## Pannello e API

L'accesso privato e le operazioni precedenti su fonti, moderazione, segnalazioni e impostazioni restano in `src/app/api/auth/route.ts` e `src/app/api/admin/route.ts`. `src/app/admin/ui.tsx` aggiunge il Control Center con stato operativo, nove moduli, coda, registro, anomalie, budget, homepage e misure disponibili. I dati provengono da `GET /api/newsroom`; il polling avviene ogni 30 secondi mentre la scheda è visibile. Richieste superate vengono annullate e un errore di lettura lascia visibile l'ultimo stato con operazioni disabilitate fino a una rilettura riuscita.

`POST /api/newsroom` accetta queste azioni protette dall'accesso amministrativo:

- `settings`: limiti giornalieri/mensili, quota e abilitazione chat, sicurezza, pausa, intervallo, dimensione ciclo e pubblicazione automatica.
- `retry` con `id`: nuovo tentativo per un job fallito, senza approvazione implicita.
- `resolve-incident` con `id`: annotazione di risoluzione; il monitor può riaprire una condizione ancora presente.
- `homepage` con `articleId`, `position` tra 1 e 12 oppure `null`, `excluded` e motivo di almeno dieci caratteri: scelta editoriale su un contenuto pubblicato. Un'esclusione non può avere anche una posizione fissata.
- `rebuild-homepage`: ricalcolo deterministico dell'edizione corrente.

La disponibilità di un link non dimostra l'esattezza del contenuto. Traffico organico, visitatori unici e ricavi pubblicitari restano non disponibili finché non esistono integrazioni e misure effettive. Non sono sostituiti da cifre simulate. Le pagine viste sono aggregate e la raccolta è disattivata per impostazione iniziale.

## Esecuzione continuativa

Il sito web e `scripts/worker.ts` sono processi distinti. Avviare `npm run worker` esegue il worker locale; un portatile spento, sospeso o disconnesso interrompe i controlli. Un intervallo salvato nel database non prova che il processo sia attivo. Il Control Center usa heartbeat e registri reali per mostrare lo stato disponibile.

Per un servizio continuativo servono un host acceso, database persistente, processo supervisionato con riavvio, backup e credenziali server correttamente configurati. Le istruzioni operative sono in `docs/DEPLOYMENT.md`; le condizioni di riuso delle fonti sono in `docs/SOURCES.md`. Il pannello non attiva autonomamente infrastruttura, account, fonti non autorizzate, pubblicità o pagamenti.
