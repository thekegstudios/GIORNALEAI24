/** A foreign context needs an explicit Italian connection before automatic publication. */
export function italyScopeReasons(title:string,text=''):string[]{
  const content=`${title} ${text}`.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const italian=/\b(italia|italian[oaie]|governo italiano|parlamento italiano|regioni italiane|territorio nazionale|cittadini italiani|imprese italiane)\b/.test(content);
  const foreign=/\b(estero|internazional[ei]|mondial[ei]|global[ei]|onu|nazioni unite|ucraina|russia|israele|gaza|stati uniti|cina|bruxelles|europa|europe[oaie])\b/.test(content);
  return foreign&&!italian?['Pertinenza concreta per l’Italia da verificare: il contenuto cita un contesto estero senza un collegamento italiano esplicito.']:[];
}
