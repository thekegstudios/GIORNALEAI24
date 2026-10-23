import type { Article, Category } from './types';

export function slugify(value:string):string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,95) || 'notizia';
}
export function classifyCategories(title:string,text=''):Category[] {
  const input=`${title} ${text}`.toLowerCase();
  const rules:[Category,RegExp][]=[['economia',/\b(pil|istat|inflazione|economia|prezzi|imprese|consumi|export)\b/],['lavoro',/\b(lavoro|occupazione|pensioni|inps|disoccupazione)\b/],['ambiente',/\b(ambiente|biodiversità|clima|ispra|inquinamento|natura|ecosistem|sostenibil|rifiuti|mare|acqua|foreste)/],['politica',/\b(governo|parlamento|ministero|ministro|elezioni|senato|decreto)\b/],['tecnologia',/\b(tecnologia|digitale|intelligenza artificiale|ricerca|spazio|satellite)\b/],['scuola',/\b(scuola|studenti|istruzione|università|didattica)\b/],['salute',/\b(salute|sanità|sanitario|ospedale|vaccino|malattia|tumore|terapia)\b/],['sport',/\b(sport|calcio|campionato|olimpiadi|tennis|ciclismo)\b/],['meteo',/\b(meteo|allerta|maltempo|temporale|alluvion|terremot|sism|protezione civile)/],['trasporti',/\b(trasporti|treni|ferrovie|autostrada|aeroporto|mobilità)\b/],['giustizia',/\b(indagine|arresto|tribunale|processo|accusa|condanna)\b/],['spettacolo',/\b(cinema|teatro|musica|festival|spettacolo)\b/],['eventi',/\b(convegno|incontro|webinar|mostra|giornata|conferenza|presentazione)\b/]];
  const found=rules.filter(([,pattern])=>pattern.test(input)).map(([category])=>category);
  return found.length?found.slice(0,3):['cronaca'];
}
export function sensitiveReasons(title:string,text=''):string[] {
  const input=`${title} ${text}`.normalize('NFKC');
  const rules:[string,RegExp][]=[
    ['Persone vulnerabili, vittime o dati personali',/\b(minor[ei]|bambin[oi]|vittim[ae]|stupr\w*|suicid\w*|violenza sessuale|abusi? sessual\w*)\b/i],
    ['Decessi, incidenti o emergenze',/\b(mort[oiae]|decedut\w*|uccis\w*|omicid\w*|cadaver\w*|incident\w*|ferit[oi]|dispers[oi]|allert\w*|alluvion\w*|terremot\w*|evacuazion\w*|emergenz\w*|cordoglio|scomparsa|lutto|si è spento|decesso)\b/i],
    ['Indagini, accuse o procedimenti',/\b(indagat\w*|indagin\w*|accusat\w*|arrest\w*|condann\w*|corruzion\w*|truff\w*|reat[oi]|procura|processo penale|presunt\w*)\b/i],
    ['Informazioni sanitarie o indicazioni personali',/\b(diagnosi|pazient\w*|terapi\w*|farmac\w*|vaccin\w*|cura per|consiglio medico|investi i tuoi|consulenza fiscale)\b/i],
  ];
  return rules.filter(([,pattern])=>pattern.test(input)).map(([reason])=>reason);
}
export function evaluateEditorial(article:Article,options:{autoPublish:boolean;authorized:boolean;evidenceValid:boolean}):string[] {
  const reasons=sensitiveReasons(article.title,`${article.summary} ${article.context} ${article.confirmed.join(' ')}`);
  if(!options.autoPublish) reasons.push('Pubblicazione automatica disabilitata');
  if(!options.authorized) reasons.push('Fonte priva di autorizzazione documentata');
  if(!options.evidenceValid || !article.citations.length) reasons.push('Prove o riferimenti insufficienti');
  if(article.citations.some(citation=>!safePublicUrl(citation.url))) reasons.push('URL della fonte non valido');
  if(article.region && !article.locationEvidence) reasons.push('Attribuzione geografica priva di evidenza verificabile');
  if(article.unconfirmed.length) reasons.push('Informazioni divergenti o ancora da chiarire');
  if(article.aiGenerated&&process.env.AI_AUTO_PUBLISH!=='true')reasons.push('Testo AI: revisione umana richiesta prima della pubblicazione');
  return [...new Set(reasons)];
}
export function sourceDateReasons(publishedAt:string|null,now=Date.now()):string[]{
  if(!publishedAt||!Number.isFinite(new Date(publishedAt).getTime()))return ['Data dichiarata dalla fonte assente o non valida'];
  const timestamp=new Date(publishedAt).getTime();
  if(timestamp>now+5*60_000)return ['Data della fonte futura: richiede verifica'];
  if(timestamp<now-72*3600_000)return ['Contenuto della fonte precedente alle ultime 72 ore: possibile archivio storico'];
  return [];
}
export function safePublicUrl(value:string):boolean {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443'))return false;
    const host=url.hostname.toLowerCase();
    return !/^(localhost|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$|.*\.internal$)/.test(host) && host.includes('.');
  }catch{return false;}
}
export function sameEvent(left:string,right:string):boolean {
  const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const a=normalize(left),b=normalize(right);
  // Cross-source consolidation requires exactly the same substantive headline.
  // Related but different claims remain separate until an editor links them.
  return a.length>=35 && a===b;
}
