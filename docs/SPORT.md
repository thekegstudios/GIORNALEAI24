# AI24 SPORT

Implementazione nel progetto esistente, 22 ottobre 2026. Le letture pubbliche usano soltanto il database condiviso: aprire una pagina o l’assistente non genera chiamate al provider.

## Cosa funziona

- Motore normalizzato, idempotenza per identificativo del provider, provenienza e orari UTC; visualizzazione Europe/Rome e filtri per data, disciplina, competizione, genere e stato.
- Adapter API-SPORTS per `/fixtures` del calcio e `/games` della pallavolo, più `/standings`. Identificativi, stagioni e diritti vanno configurati per ogni competizione. Le risposte vuote non diventano incontri o copertura dichiarata.
- Punteggi distinti: calcio con intervallo e rigori, pallavolo con set, basket con quarti e supplementari, tennis con set e tie-break, gare con posizioni/tempi/distacchi. Gli ultimi tre formati sono predisposti nel contratto; i relativi adapter non sono ancora attivi.
- Risultati ieri/oggi/domani e calendario; pagine incontro, competizione e partecipante; classifiche esclusivamente importate. Le statistiche, le azioni e le formazioni mancanti sono indicate come non disponibili.
- Preferiti di squadre e campionati nel browser, senza registrazione o notifiche. L’assistente legge i dati pubblici importati e cita il momento del controllo.
- Worker sportivo separato dal giornale: quote persistenti, lease di 90 secondi, timeout, risposta limitata a 4 MB, retry esponenziale, stop fino alla mezzanotte UTC se la quota è esaurita. Nessuna chiave nel client.

Non sono presenti incontri, squadre, loghi o classifiche dimostrativi nel database pubblico. Gli esempi esistono soltanto nei test in memoria. Non viene dichiarata una copertura universale.

## Attivazione

1. Applicare `004_sports.sql` attraverso `initDatabase()`, già integrato nel bootstrap. PostgreSQL deve proteggere le nove tabelle `sports_*` con RLS e revocare accessi REST anonimi e autenticati; letture soltanto tramite il server.
2. Ottenere una chiave nel proprio account API-SPORTS e verificare stagione, campionati ed effettivi dati disponibili. Non è stato creato alcun account o abbonamento.
3. Nel file `.env.local` impostare:

   ```dotenv
   SPORTS_ENABLED=false
   APISPORTS_KEY=
   APISPORTS_DAILY_CAP=100
   SPORTS_PAID_PLAN_AUTHORIZED=false
   ```

   Mettere `SPORTS_ENABLED=true` solo dopo la configurazione. Il limite effettivo è il minore tra il pannello e il tetto del server; senza `SPORTS_PAID_PLAN_AUTHORIZED=true` non può superare 100 richieste/giorno né registrare un piano a pagamento. Questa variabile non acquista servizi: documenta una configurazione esplicitamente autorizzata.
4. Accedere a `/admin`, poi `/admin/sport`. Abilitare il provider; impostare limite giornaliero, limite al minuto ed eventuale costo mensile del contratto. Il pannello non inventa costi unitari per richieste incluse in un abbonamento.
5. Registrare la competizione: ID interno, ID del provider, disciplina, paese, stagione, categoria, URL della prova di autorizzazione alla pubblicazione e annotazione dei diritti ottenuti. Abilitare la competizione solo dopo la verifica. Per competizioni estere occorre una lista di ID verificati dei partecipanti italiani; vengono importati solo gli incontri che li coinvolgono. La competizione domestica deve essere confermata come italiana dalla risposta del provider.
6. Avviare un processo separato:

   ```powershell
   node node_modules/tsx/dist/cli.mjs --env-file-if-exists=.env.local scripts/sports-worker.ts
   ```

   In produzione usare un process manager o uno scheduler dedicato che richiami `runSportsCycle()`. Lo stato è nel database, quindi richiami concorrenti condividono lease e quote. Il processo locale non garantisce operatività quando il computer è spento.

L’aggiornamento prende le tre date correnti e le classifiche. Gli archivi conservano i giorni già importati; selezionare una data non presente non avvia uno scarico a pagamento. Non è ancora implementata un’importazione massiva di tutte le stagioni passate. Gli incontri vengono ricontrollati il giorno successivo per le correzioni; aggiornamenti ancora successivi richiedono un job aggiuntivo pianificato.

Il minimo live desiderato è 60 secondi; viene aumentato in funzione della quota e delle competizioni abilitate. Un piano di 100 richieste/giorno non consente un servizio live continuo a un minuto. Le pagine vengono rilette ogni minuto solo quando visibili; ciò aggiorna la cache pubblica senza interrogare il provider. Un incontro live non controllato da oltre tre minuti mostra «In corso all’ultimo controllo» e «Dati da aggiornare».

## Provider verificati e diritti

Fonti primarie consultate il 22 ottobre 2026:

- [API-SPORTS: termini](https://api-sports.io/terms). Il servizio non concede i diritti commerciali delle competizioni o una licenza di pubblicazione; autorizzazioni e immagini richiedono verifica presso i titolari. Per questo ogni competizione rimane disabilitata finché i diritti non sono documentati e nessun logo viene importato o mostrato. I tempi indicati sono orientativi, senza SLA garantito.
- [API-Football: prezzi](https://www.api-football.com/pricing). Piano gratuito indicato a 100 richieste/giorno, con limitazioni sulle stagioni; Pro indicato a 19 USD/mese e 7.500 richieste/giorno. Nessun piano acquistato.
- [API-SPORTS: pallavolo e copertura](https://api-sports.io/sports/volleyball). Il catalogo elenca competizioni italiane e un piano gratuito da 100 richieste/giorno con reset UTC. Prezzo Pro indicato a 15 per mese, 7.500 richieste/giorno; verificare valuta, condizioni e copertura nel proprio account prima dell’acquisto. Il catalogo non prova l’accessibilità della stagione con la chiave dell’utente.
- [Documentazione calcio](https://api-sports.io/documentation/football/v3) e [documentazione pallavolo](https://api-sports.io/documentation/volleyball/v1). La documentazione pallavolo non è risultata leggibile integralmente senza challenge durante la verifica: il formato supportato è validato nei test e l’integrazione reale rimane da confermare con una chiave autorizzata. Una risposta differente produce un errore, non un punteggio inventato.
- [TheSportsDB](https://www.thesportsdb.com/api.php): alternativa con chiave di produzione e live a due minuti indicati tra le funzioni premium, da 9 USD/mese. Non selezionata in questa fase e nessun riuso commerciale presunto.
- [Sportmonks: piani calcio](https://www.sportmonks.com/football-api/plans-pricing/): alternativa calcistica con piano iniziale indicato da 29 EUR/mese, selezione di cinque leghe. Non selezionata e nessun trial attivato.

## Contratti e API

- `src/lib/sports/types.ts`: `SportsEvent`, `SportScore`, `Competition`, `SportsStanding`, `SportsEntity`. I dati derivati da nuove fonti devono essere normalizzati prima del salvataggio e mantenere provenienza, evidenza italiana e momento di acquisizione.
- `normalizeApiSportsEvent(raw, competition)` e `normalizeStandings(response, competition)` isolano il formato del provider.
- `saveSportsBatch(competition, events, standings)` scrive una transazione e ricontrolla l’autorizzazione prima del commit. Non è esposto un import anonimo.
- `getSportsEvent(id)`, `getSportsEvents(filters)`, `getSportsStandings(competitionId?)`, `getSportsEntities()` restituiscono solo dati pubblicabili. Revocare una competizione ne esclude subito gli incontri dalle risposte.
- `answerSportsQuestion(question, eventId?)`: risposta documentale, nessuna chiamata AI/provider. L’apertura dell’assistente usa `openArticleAssistant({question,sportEventId})`.
- `GET /api/sports`: risultati filtrati, cache 30 secondi, solo database. `GET /api/sports/events/[id]`: dettaglio pubblico. Non usare il campo `fetchedAt` dell’involucro API come aggiornamento del provider: ogni incontro conserva il proprio `fetchedAt`.
- `GET/POST /api/admin/sports`: sessione admin, POST con Origin e rate limit; comandi `provider`, `competition`, `discipline`, `sync`. `sync` rispetta scadenze e quote; non forza consumi oltre il budget.

## Validazione

`node node_modules/tsx/dist/cli.mjs --test tests/sports.test.ts`: undici test isolati su modelli, normalizzazione calcio/volley, Italia, stati live, classifiche, date/DST, assenza di chiave, diritti, idempotenza, revoca, concorrenza delle quote, blocco piani non autorizzati e assistente documentale. La conferma con il provider reale richiede una chiave e diritti documentati; non è stata simulata come verifica di produzione.
