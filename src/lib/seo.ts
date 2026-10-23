import type { Article } from './types';
export function prepareSeo(article:Article):NonNullable<Article['seo']> {
  const issues:string[]=[];
  if(article.title.length<12)issues.push('Titolo troppo breve per identificare il contenuto');
  if(article.title.length>180)issues.push('Titolo esteso: revisione SEO suggerita senza alterarne il significato');
  if(!article.originalContent)issues.push('Scheda di metadati: esclusa dall’indice');
  if(article.summary.length+article.context.length<300)issues.push('Contenuto originale insufficiente');
  if(!article.citations.length)issues.push('Mancano riferimenti alle fonti');
  if(article.verification?.status==='CONTRADICTED')issues.push('Informazioni contraddette: pubblicazione non idonea');
  const description=article.summary.replace(/\s+/g,' ').trim();
  return {title:article.title,description:description.length>160?`${description.slice(0,157).replace(/\s+\S*$/,'')}…`:description,indexable:article.status==='published'&&article.originalContent&&article.summary.length+article.context.length>=300&&article.citations.length>0&&article.verification?.status!=='CONTRADICTED',issues};
}
