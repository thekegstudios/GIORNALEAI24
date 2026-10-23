# Chiedi a GIORNALE AI24

La pagina `/chiedi` permette di consultare gratuitamente le notizie già pubblicate, senza account. Non effettua ricerche sul web, non consulta bozze o articoli ritirati e non rappresenta una verifica giornalistica indipendente.

## Funzionamento iniziale

La modalità `archive` funziona senza chiave API: seleziona fino a quattro articoli e riporta titoli, sintesi o spiegazioni già presenti nell’archivio, insieme a un massimo di sei collegamenti alle fonti. Non simula una conversazione con un modello. Le schede che contengono soltanto metadati rimandano al documento originale senza presentare una sintesi come contenuto verificato.

Sono riconosciute richieste generali, categorie, fonti, cronologie e territori documentati. Un filtro testuale conservativo cerca altri argomenti nei contenuti pubblicati; non è una ricerca semantica generale. Se mancano articoli pertinenti, la risposta lo dichiara. I territori richiedono un’evidenza geografica presente nella scheda: una menzione nel testo non assegna automaticamente una provincia o un comune. “Oggi” usa la data dichiarata dalla fonte nel fuso `Europe/Rome`, non la data di importazione.

Dal dettaglio di una notizia si può aprire l’assistente flottante oppure `/chiedi?articolo=ID` per consultare quella scheda. L’apertura semplice non avvia richieste. I suggerimenti cliccabili e il pulsante “Chiedi all’AI di spiegarti questa notizia” inviano invece la domanda indicata. Il contesto è un identificativo pubblico o uno slug: il backend ricarica sempre le schede pubblicate, senza fidarsi del testo presente nel browser. Un briefing può passare fino a sei identificativi.

## Supporto AI opzionale

I valori iniziali sono `chatEnabled: false` e `chatDailyBudgetUsd: 0`. Per consentire chiamate AI occorrono insieme una chiave OpenAI server, tariffe positive configurate per il modello corretto, budget generale giornaliero e mensile disponibile, attivazione esplicita della chat e sottobudget chat positivo. La sola chiave non attiva la chat AI. Pausa e modalità sicurezza impediscono nuove prenotazioni AI; la consultazione dell’archivio resta disponibile.

Il modello riceve esclusivamente una modalità di consultazione e una selezione di contenuti pubblicati. La domanda originale e la conversazione non sono inviate al provider. La richiesta usa `store: false`, uno schema JSON e nessuno strumento di ricerca. Ogni affermazione generata deve indicare identificativi appartenenti alle fonti fornite; riferimenti sconosciuti, risposte incomplete o contenuti non idonei fanno tornare all’archivio. Questi controlli non garantiscono da soli la correttezza semantica di ogni frase: le risposte indicano le fonti e restano da controllare sui documenti originali.

Le richieste personali mediche, legali, fiscali e finanziarie, i dati privati e le richieste di aggiornamenti esterni non attivano il modello. Le schede sensibili, incerte o prive di testo originale restano nella modalità archivio.

## Costi e cache

Scrittura editoriale e chat condividono prenotazioni atomiche nel database: prima di contattare il provider devono essere disponibili il tetto giornaliero, quello mensile e, per la chat, il sottobudget giornaliero. Il calendario è quello di Roma. Una modifica al modello, alla pausa o alla sicurezza viene ricontrollata durante la prenotazione. Il conteggio delle ricerche web resta zero perché nessuna ricerca viene eseguita.

Le prenotazioni considerano un limite conservativo dell’input e il massimo dell’output. I token e il costo effettivo derivano dall’utilizzo restituito dal provider. Se un timeout o una risposta non valida impediscono di conoscere l’utilizzo, il costo conserva l’intera prenotazione e i token restano sconosciuti, rappresentati come zero. Sono stime applicative: il controllo non sostituisce la fatturazione e i limiti impostati sul conto del provider.

Una cache condivisa di un’ora riusa risposte basate sulla stessa selezione e versione degli articoli. Un lock nel database evita chiamate duplicate simultanee per la stessa selezione; il richiedente che attende troppo riceve l’archivio. Prima di servire cache o generazione si ricontrollano stato pubblico e contenuto delle schede. Correzioni, cambiamenti e ritiri invalidano le risposte precedenti.

La cache memorizza risposte e fonti pubbliche, mai la domanda originale; la chiave è un hash della modalità e dei contenuti selezionati. La conversazione vive soltanto nella memoria della pagina, senza localStorage o cronologia server delle domande. Il sistema di hosting può avere propri log HTTP: non configurare il logging dei corpi delle richieste a `/api/chat`.

## API e verifiche

`POST /api/chat` accetta JSON con `question` da 5 a 500 caratteri ed eventualmente `articleId`, `articleSlug`, `articleIds` (massimo sei), `sportEventId` e `stream`. Richiede un’origine corrispondente al sito, limita il corpo a 4 KB e risponde con `Cache-Control: no-store`. Il limite predefinito è 15 richieste ogni 10 minuti, configurabile con `CHAT_REQUESTS_PER_WINDOW` (massimo 100) e `CHAT_RATE_WINDOW_SECONDS` (massimo 3600). Senza un’intestazione IP esplicitamente configurata e gestita da un proxy fidato, il limite è condiviso globalmente.

Con `stream: true` l’endpoint restituisce NDJSON: eventi `status`, `delta`, `done` o `error`. Le chiamate reali a Responses API usano SSE con `stream: true`. L’interfaccia riceve soltanto affermazioni JSON complete, dopo averne controllato testo e identificativi delle fonti; al termine riceve la risposta completa con i link costruiti dal database. In caso di risposta non valida, il risultato finale sostituisce il testo parziale con l’archivio. La presenza di una fonte valida non dimostra da sola la correttezza semantica di un’affermazione. Cache e archivio vengono restituiti immediatamente, senza simulare una digitazione AI. Il pulsante Interrompi annulla il fetch; una prenotazione con consumo incerto conserva il costo prudenziale e non viene memorizzata come risposta completa.

Il widget usa un dialogo nativo con focus contenuto, Escape, ripristino del focus al comando di apertura e layout per aree sicure mobili. La conversazione resta in memoria durante chiusura e riapertura nello stesso contesto; cambiare articolo o ricaricare la pagina la elimina. Chiudere la finestra interrompe una generazione in corso. I richiami brevi possono riutilizzare gli identificativi delle fonti della risposta precedente, senza trasmettere o salvare una cronologia di domande.

Le verifiche isolate si eseguono senza leggere `.env.local` e senza richieste OpenAI reali:

```powershell
node node_modules/tsx/dist/cli.mjs --test tests/chat.test.ts tests/budget.test.ts
```

I test usano un database in memoria, contenuti chiaramente contrassegnati come fixture e risposte provider simulate. Coprono la selezione dell’archivio, l’assenza di argomenti e territori documentati, la cache concorrente, i ritiri durante la generazione, i riferimenti inventati, la riservatezza delle domande, la modalità archivio durante pausa/sicurezza e i limiti di budget.
