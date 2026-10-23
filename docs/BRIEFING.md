# AI24 BRIEFING — L’Italia in 60 secondi

Il briefing usa il database del giornale. Non scarica né genera contenuti quando qualcuno apre la homepage. `getBriefingHomeData()` legge la versione preparata; `BriefingHome` la presenta nella homepage. La pagina completa è `/briefing`, l’archivio `/briefing/archivio`, le versioni `/briefing/YYYY-MM-DD?version=N`.

## Contenuti ammessi

Un articolo deve essere pubblicato, originale, con fatti confermati e senza incertezze o revisione pendente. Il rapporto deve essere `CONFIRMED`, comprese le singole affermazioni e i riferimenti alle citazioni effettive. Il solo stato di pubblicazione, il numero delle fonti o un titolo RSS non costituiscono verifica. Le fonti devono avere autorizzazione e permesso di sintesi registrati, URL HTTPS sul dominio autorizzato e controllo di consultabilità HTTP riuscito nelle ultime 24 ore prima della selezione/pubblicazione. Il controllo HTTP non dimostra la correttezza semantica dei fatti.

La finestra iniziale è 72 ore rispetto alla data della fonte. Data dell’avvenimento e data della pubblicazione restano distinte. Non vengono inseriti elementi futuri, notizie inventate per arrivare a cinque o schede composte soltanto da metadati. L’assenza di articoli idonei produce uno stato informativo reale.

La selezione usa rilevanza editoriale, attualità, fonti istituzionali e diversità degli argomenti. I motivi sono conservati in ogni elemento. Titoli equivalenti e citazioni riutilizzate non riempiono più posizioni. Clic e dati pubblicitari non intervengono.

## Generazione e costi

`runBriefingCycle()` viene eseguito dal worker/orchestratore indipendentemente dalle visite. L’orario predefinito è **07:00 Europe/Rome**, con gestione dell’ora legale tramite Intl. Una nuova edizione giornaliera è possibile dopo l’orario previsto; un aggiornamento nello stesso giorno richiede una selezione cambiata, una novità oltre la soglia editoriale configurabile (75/100) e il termine del periodo minimo (120 minuti, configurabile).

Lease persistente, impronta degli articoli e chiave univoca del tentativo evitano versioni e richieste AI duplicate tra processi. Anche un errore/timeout del provider conserva il tentativo: nessun retry AI automatico potenzialmente a pagamento per la stessa selezione. Un nuovo contenuto o versione degli articoli produce una nuova impronta.

La sintesi usa Responses API con `store:false`, schema JSON rigoroso, nessuno strumento e riferimenti limitati agli articoli selezionati. L’obiettivo è 120–150 parole, riducibile quando le prove sono poche. La validazione dei riferimenti **non** prova che tutte le frasi siano corrette: le sintesi nuove dell’AI rimangono in revisione fino all’approvazione editoriale umana. [Documentazione ufficiale OpenAI sugli output strutturati](https://developers.openai.com/api/docs/guides/structured-outputs).

La prenotazione `purpose:briefing` usa lo stesso budget globale giornaliero e mensile di redazione e chat. Un modello senza tariffe server coerenti non viene chiamato. Token e costi provengono dalla risposta; quando l’esito è incerto resta la stima massima prenotata. Una pausa o modifica delle fonti prima del commit blocca la pubblicazione; le spese già sostenute rimangono registrate.

Senza chiave, tariffe o budget, il servizio può pubblicare una **composizione estrattiva dei testi di articoli già approvati**, dichiarata come tale e distinta da una nuova sintesi AI. Non inventa un’attivazione del provider. Senza articoli idonei non pubblica nulla.

## Versioni, rettifiche e ritiro

La migrazione `006_briefing.sql` crea `ai24_briefings`, `ai24_briefing_items`, `ai24_briefing_settings`, `ai24_briefing_runs`, `ai24_briefing_audio`. Le versioni pubblicate contengono snapshot completi con impronta del contenuto, citazioni, data fonte e motivazione.

`reconcileBriefingsForArticle(articleId,reason)` aggiunge una versione esplicitamente corretta quando un articolo cambia, viene ritirato, entra in revisione o perde i requisiti. Le vecchie righe non sono sovrascritte. Anche prima della riconciliazione il lettore confronta impronte e stato attuale: esclude contenuti cambiati/ritirati e non ripropone il vecchio riepilogo come valido. Una correzione conserva lo storico con avviso; il ritiro impedisce di ripubblicare il contenuto selezionando una vecchia versione nell’archivio.

## Gestione

`/admin/briefing` usa la sessione editoriale esistente. `/api/admin/briefing` richiede autenticazione, origine coerente, JSON limitato, schema rigoroso e limiti di frequenza. Ogni generazione richiesta e operazione editoriale ha motivazione e audit. Si possono modificare orario, soglia, finestra, frequenza e abilitazione; visualizzare bozze; approvare, correggere o ritirare l’ultima versione. Le correzioni generano nuove versioni. Non si può ripristinare una versione superata con una vecchia operazione.

La lettura pubblica `/api/briefing` non genera nulla e non espone bozze. Le API usano `Cache-Control:no-store` per applicare ritiri/correzioni immediatamente.

## Personalizzazione e assistente

Il browser compone fino a tre moduli aggiuntivi tra gli stessi articoli verificati condivisi, secondo regione, provincia, comune e categorie. Le preferenze usano `italia-ora-preferences`, già condiviso con “La mia Italia”, e rimangono nel browser. Province/comuni sono proposti soltanto se esistono elementi localizzati idonei. Nessuna chiamata AI individuale è necessaria. Se mancano aggiornamenti locali rimane il nazionale, con un messaggio esplicito.

“Spiegamelo meglio” passa l’ID dell’articolo all’assistente già presente; “Spiegami tutto il briefing” passa gli ID selezionati. Il server ricarica gli articoli effettivamente pubblicati e le fonti. Gli articoli territoriali vengono composti senza inventare una nuova redazione locale.

Sport e costo della vita possono entrare solo attraverso articoli che superano gli stessi controlli. Le pagine dei dati sportivi, carburanti e indicatori restano collegate; un risultato da API o una serie statistica grezza non diventano automaticamente una notizia verificata. Non si inventano risultati, dirette o variazioni di prezzo.

## Audio e distribuzione

Lo schema audio prevede una risorsa per versione, impronta del testo, stato, storage key, voce e costo. Il provider di voce e lo storage non sono configurati: nessuna richiesta a pagamento e nessun pulsante pubblico non funzionante. L’API rifiuta `audioEnabled:true` finché questa integrazione non è implementata e verificata. Un futuro player dovrà dichiarare la voce sintetica, conservare la versione e riutilizzare il file condiviso.

L’automazione resta operativa solo mentre un worker/scheduler server è effettivamente in esecuzione e collegato al database. Lo sviluppo locale non garantisce disponibilità 24/7. PostgreSQL deve applicare RLS/revoche alle cinque tabelle; il browser accede tramite le API server, mai con privilegi editoriali.

## Verifica

`node node_modules/tsx/dist/cli.mjs --test tests/briefing.test.ts`

Copre idoneità, metadati esclusi, diversità/deduplica, due transizioni dell’ora legale, soglia/cooldown, processi simultanei, chiavi idempotenti, correzioni con timestamp invariato, ritiro di vecchie versioni, budget nullo senza chiamate, bozza AI privata, costo unico, pausa durante il provider, riferimenti fuori contesto, audio non configurato e personalizzazione condivisa. I dati di prova sono confinati a SQLite in memoria; nessuna chiamata OpenAI reale.
