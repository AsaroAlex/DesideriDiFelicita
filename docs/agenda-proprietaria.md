# Agenda proprietaria Desideri di Felicità

Il sito, il calendario e l’agenda usano lo stesso servizio Railway. Non richiedono
un abbonamento a un gestionale o un database esterno. Restano il consumo Railway
e l’eventuale costo dei messaggi stabilito da Meta.

## Prima apertura

1. Aprire il collegamento privato `/agenda?attiva=…` fornito alla titolare.
   Il token è forte, ha una scadenza e può creare un solo account; viene rimosso
   subito dalla barra dell’indirizzo. Non condividerlo né inserirlo nel repository.
2. Scegliere email e password di almeno 12 caratteri. I dati clienti sono visibili
   solo dopo l’accesso. La sessione scade dopo 12 ore; logout revoca il cookie.
3. In **Servizi**, impostare la durata reale di ogni servizio prenotabile e abilitarlo.
   Le durate non sono precompilate perché non sono state confermate dalla titolare.
4. Verificare orari, pause e giorni di chiusura in **Impostazioni**; attivare le
   prenotazioni online. Il calendario propone solo intervalli liberi abbastanza
   lunghi per il servizio scelto. Prima dell’attivazione offre il contatto WhatsApp.
5. Inserire nell’agenda gli appuntamenti già presenti sulla carta: devono occupare
   gli orari prima di aprire il calendario alle clienti.

L’agenda permette inserimento, modifica, spostamento, cancellazione, vista giornaliera
e settimanale ed esportazione CSV. Le clienti non creano un account; la conferma
sul sito include il riferimento della prenotazione. In caso di modifica o
cancellazione, contattano il salone. Non sono previsti pagamenti sul sito.

## Promemoria e costi

- Il consenso WhatsApp è facoltativo e inizialmente non selezionato. Nessun marketing.
- Orario iniziale: 18:00 Europe/Rome, la sera precedente; modificabile in agenda.
- Un solo promemoria per appuntamento; nessun messaggio automatico di conferma.
- Quote iniziali: 20 invii/giorno e 200/mese, modificabili, anche a 0 per sospendere.
  Le quote contano prudentemente anche invii dall’esito incerto e non sono un tetto
  di spesa in euro: la tariffa applicabile la determina Meta.
- Cancellazioni e spostamenti invalidano i lavori ancora da inviare. Il sistema
  controlla ancora l’appuntamento prima di contattare Meta e registra il suo ID.
- Solo un rifiuto esplicito 429 può essere riprovato, con attesa e massimo 3 tentativi.
  Timeout, errore di rete, 5xx o risposta ambigua diventano **Da verificare**:
  nessun reinvio automatico che rischi un secondo messaggio a pagamento.
- I riavvii conservano la coda. Non vengono recuperati messaggi dopo la fine del
  giorno precedente all’appuntamento. Limiti raggiunti possono lasciare un promemoria
  sospeso fino a quella scadenza; l’agenda mostra lo stato senza inventare consegne.
- Il pulsante manuale apre WhatsApp con testo preparato: la titolare deve premere
  **Invia**. Non cambia lo stato in “inviato” e non avvia chiamate API a pagamento.

Le limitazioni sono deliberate per ridurre traffico, reinvii e servizi separati.
Non garantiscono consegna se numero, connessione o fornitore non sono disponibili.

## Attivare WhatsApp automatico

Serve un account WhatsApp Business Platform con numero registrato, token server
e un template **utility approvato**. La logica proprietaria usa esclusivamente la
[Cloud API ufficiale](https://developers.facebook.com/documentation/business-messaging/whatsapp/).
Le credenziali non sono disponibili in questa sessione: il software è predisposto,
ma non dichiara attivo l’invio finché mancano.

Variabili server Railway (mai nel frontend o nel repository):

| Variabile | Contenuto |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Token permanente del system user con accesso al numero |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificativo Meta del numero, non il numero telefonico |
| `WHATSAPP_TEMPLATE_NAME` | Nome esatto del template utility approvato |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Lingua del template, inizialmente `it` |
| `WHATSAPP_GRAPH_VERSION` | Versione supportata, inizialmente `v26.0` |
| `WHATSAPP_APP_SECRET` | Segreto dell’app per verificare la firma webhook |
| `WHATSAPP_VERIFY_TOKEN` | Token casuale forte per la verifica iniziale webhook |

Esempio testo da sottoporre ad approvazione, con **tre parametri body posizionali**:

> Ciao {{1}}, ti ricordiamo l’appuntamento da Desideri di Felicità il {{2}} alle {{3}}.
> Per modifiche o cancellazioni contatta il salone.

I parametri contengono nome, data italiana e ora. Non aggiungere header, bottoni o
parametri che l’adapter non invia. Configurare il webhook pubblico
`https://desideri-di-felicita-production.up.railway.app/api/whatsapp/webhook` e
sottoscrivere gli eventi `messages`. Il server verifica HMAC sul corpo originale,
deduplica gli eventi e registra stati consegnato/letto/errore senza rispondere
automaticamente ai messaggi ricevuti.

L’uso dello stesso numero già presente nell’app WhatsApp Business va verificato:
la coexistence dipende dal percorso di onboarding ufficiale e non si abilita
semplicemente copiando un token. Potrebbero servire onboarding compatibile,
migrazione o un numero dedicato. Nessuna automazione WhatsApp Web o sessione QR.
Le [tariffe Meta](https://business.whatsapp.com/products/platform-pricing) dipendono
da paese, categoria e regole applicabili; non è stato fissato un prezzo italiano.

## Runtime, backup e manutenzione

- Node 24 con SQLite integrato, database in `DATA_DIR`; in produzione `/data` deve
  essere un **volume persistente**. Il server rifiuta una produzione senza DATA_DIR.
- Una replica Railway; non collegare più writer allo stesso file su storage di rete.
- `APP_ORIGIN` è l’origine HTTPS completa, senza path; deve corrispondere al dominio
  usato nel browser. Dopo un cambio dominio aggiornare anche SITE_URL e ricostruire.
- Non abilitare Railway Serverless/sleep: i timer non girano mentre il servizio dorme.
- Backup SQLite privati quotidiani in `/data/backups/`, ultime 7 copie, snapshot
  autonomi e pubblicazione atomica. Copie nello stesso volume proteggono da errori
  applicativi, non dalla perdita del volume: configurare anche backup Railway o
  scaricare periodicamente una copia privata. Il CSV è un’esportazione leggibile,
  non un backup di account, impostazioni e coda.
- Per ripristinare, fermare il servizio, conservare il file attuale e sostituire
  `/data/agenda.sqlite` con lo snapshot scelto; rimuovere solo i sidecar WAL/SHM
  riferiti al database fermo. Riavviare e verificare prima l’agenda e i promemoria.
  Non forzare a pending lavori già inviati o dall’esito incerto.
- In caso di perdita della password non cancellare il database: il token iniziale
  non ricrea un secondo proprietario. Recuperare l’accesso con manutenzione privata,
  derivando una nuova password con lo stesso modulo auth e revocando tutte le sessioni.
  Non implementare un endpoint pubblico di reset privo di verifica.

## Verifiche

`npm test` usa database temporanei e provider Meta simulato: concorrenza su slot,
timezone/DST, accesso e CSRF, revoca sessioni, webhook, quote, cancellazioni,
timeout e duplicati. Nessun test invia messaggi a clienti. `npm audit --omit=dev`
controlla le dipendenze presenti nel runtime dopo il prune; il tooling Astro è
usato solo per compilare. La build Pages resta supportata con fallback WhatsApp.
