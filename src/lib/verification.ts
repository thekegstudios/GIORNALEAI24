import type { Article, Source } from './types';
import type { FeedItem } from './feeds';
import type { VerificationReport } from './newsroom-types';
import { safePublicUrl, sensitiveReasons, sourceDateReasons } from './editorial';
import { resolveSourceGeography } from './geography';

export async function verifyEvidence(source:Source,item:FeedItem,article?:Article):Promise<VerificationReport>{
  const dateReasons=sourceDateReasons(item.publishedAt);
  const risks=sensitiveReasons(item.title,item.text);
  const urlOK=safePublicUrl(item.url)&&(!source.homepage||new URL(item.url).hostname===new URL(source.homepage).hostname);
  const sourceOK=source.authorized&&source.enabled&&Boolean(source.license&&source.termsUrl);
  const contradictions=Boolean(article?.unconfirmed.length);
  const geography=await resolveSourceGeography(source);
  const checks=[
    {name:'rights-and-provenance',passed:sourceOK,detail:sourceOK?`Fonte abilitata con condizioni registrate: ${source.termsUrl}`:'Autorizzazione, abilitazione o condizioni della fonte insufficienti'},
    {name:'original-link',passed:urlOK,detail:urlOK?'Collegamento pubblico sul dominio della fonte originale':'URL non valido o dominio non corrispondente alla fonte'},
    {name:'source-publication-date',passed:dateReasons.length===0,detail:dateReasons.join('; ')||`Data dichiarata dal feed: ${item.publishedAt}; non equivale alla data dell’evento`},
    {name:'sensitive-content',passed:risks.length===0,detail:risks.join('; ')||'Nessun indicatore deterministico di contenuto sensibile individuato'},
    {name:'independent-corroboration',passed:false,detail:'L’indipendenza delle origini non è stata accertata. Il numero di link non prova corroborazione indipendente.'},
    {name:'event-date',passed:false,detail:'La data effettiva dell’evento non è verificata; resta distinta dalla data RSS e dalla scoperta.'},
  ];
  const claimTexts=article?.aiGenerated?[...article.confirmed,article.summary].filter(Boolean):[item.title];
  return {status:risks.length||!sourceOK||!urlOK||dateReasons.length?'HUMAN_REVIEW':contradictions?'DEVELOPING':'NEEDS_VERIFICATION',checkedAt:new Date().toISOString(),explanation:article?.aiGenerated?'Contenuto elaborato sulla fonte attribuita. Riferimenti e controlli tecnici non costituiscono verifica semantica delle affermazioni.':'Sono stati controllati provenienza e metadati attribuiti. Il titolo della fonte non equivale a conferma indipendente dei fatti.',checks,claims:claimTexts.map(text=>({text,status:'NEEDS_VERIFICATION',evidence:[{sourceId:source.id,url:item.url,itemHash:item.hash}]})),independentOrigins:null,eventDate:null,eventDateEvidence:null,geography};
}
