# Assistente AI24

Il componente `FloatingAssistant` si monta una sola volta nel layout pubblico. Mostra il pulsante in basso a destra e nasconde l’intero widget nelle aree `/admin` e `/api`. L’header usa il logo ufficiale, il titolo “Assistente AI24” e il sottotitolo richiesto. `/chiedi` usa lo stesso `ChatPanel` a pagina intera.

Il messaggio iniziale è quello del brief. I tre suggerimenti inviano una richiesta al backend. “Notizie della mia zona” non usa geolocalizzazione: quando il territorio non è specificato, il sistema invita a indicare città o regione. I cinque suggerimenti contestuali consultano la notizia selezionata.

## Collegamento del contesto

Nel client si può importare `openArticleAssistant` da `@/components/article-ai-context`:

```tsx
openArticleAssistant({ articleId, slug, title, question: 'Spiegamelo in parole semplici.' });
openArticleAssistant({ articleIds, title: 'Il tuo briefing', question: 'Riassumi e spiegami queste notizie in parole semplici.' });
openArticleAssistant({ sportEventId, question: 'Spiegami questo incontro.' });
```

Il comando emette `ai24:assistant:open`. Senza `question` apre soltanto la finestra. `ArticleAIContext` notifica il contesto dell’articolo tramite `ai24:assistant:context`, aggiunge il pulsante sotto il testo e non espone contenuti riservati. Il backend usa esclusivamente le copie pubblicate. Il titolo passato dal client è soltanto un’etichetta visuale e non viene usato come prova. In assenza dell’evento contestuale, il percorso `/notizie/SLUG` permette comunque di riconoscere la scheda.

Le richieste sportive interrogano soltanto il database del centro sportivo attraverso il suo adapter pubblico e restano esplicitamente in modalità archivio. Nessuna domanda del lettore avvia una ricerca web o un aggiornamento del provider sportivo.

## Streaming, costi e dati

La finestra usa `POST /api/chat` con `stream: true`. Il backend richiede davvero lo streaming SSE a OpenAI Responses API e invia NDJSON al browser. I frammenti mostrati sono affermazioni complete con riferimenti ammessi, ricavate dagli eventi reali `response.output_text.delta`. Non è un’animazione di caratteri su una risposta già completata. Il risultato finale riporta le fonti del database e le incertezze.

Senza chiave, modello/prezzi coerenti, attivazione chat e budget disponibili, la risposta è `mode: archive` e l’interfaccia lo scrive chiaramente. Le schede con soli metadati, sensibili o incerte non attivano il modello. L’archivio continua a funzionare senza una chat simulata. L’attivazione e i limiti sono descritti in `CHAT.md` e `.env.example`.

Sono conservati i budget atomici giornalieri/mensili e il sottobudget chat, cache versionata di contenuti pubblici, lock contro richieste duplicate, controllo Origin, validazione stretta e rate limit. Le chiavi restano sul server. Domande e conversazione non sono persistite né inviate integralmente al provider: viene inviata soltanto una modalità canonica con le schede pubbliche selezionate. Nessun localStorage di chat. Evitare il logging dei corpi HTTP sul sistema di hosting.

Interrompi, Escape, chiusura e smontaggio annullano la richiesta. L’eventuale testo parziale è marcato incompleto; non viene salvato nella cache. Un consumo non conoscibile mantiene la prenotazione prudenziale. La finestra può essere riaperta e conserva i messaggi solo nella memoria del contesto corrente.

## Verifica

I test di `tests/chat.test.ts` e `tests/budget.test.ts` usano SQLite in memoria e un provider simulato chiaramente separato dall’applicazione reale. Coprono contesti pubblici/privati, briefing, SSE, UTF-8 spezzato tra chunk, fonti inventate, stop, lock, cache, Origin e budget. Non effettuano richieste a pagamento.

Sono stati verificati 25 test mirati senza errori. Nessuna risposta OpenAI reale è stata dichiarata verificata in assenza di credenziali. Il controllo browser automatico non è disponibile a causa della policy del browser della sessione; focus, Escape e layout mobile richiedono anche una prova interattiva manuale nell’anteprima.

Implementazione streaming confrontata con la documentazione ufficiale: https://developers.openai.com/api/docs/guides/streaming-responses
