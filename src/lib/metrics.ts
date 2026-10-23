import { execute, transaction } from './db';
import { getArticle } from './store';
import { categories, regions } from './regions';
import { romeDate } from './budget';
export async function recordPublicPageView(rawPath:string,loadMs?:number):Promise<boolean> {
  if(process.env.ANALYTICS_ENABLED!=='true')return false;
  const path=rawPath.split(/[?#]/,1)[0];
  if(path.length>220||!path.startsWith('/')||path.startsWith('//'))return false;
  let category:string|null=null,region:string|null=null,articleId:string|null=null;
  const staticPaths=['/','/italia','/ultim-ora','/regioni','/riepilogo','/chiedi','/metodo','/fonti','/correzioni','/cerca','/la-mia-italia','/segnala'];
  if(path.startsWith('/notizie/')){
    const article=await getArticle(path.slice('/notizie/'.length));if(!article)return false;
    articleId=article.id;category=article.categories[0]||null;region=article.region;
  }else if(path.startsWith('/categoria/')){category=categories.find(unit=>unit.slug===path.slice('/categoria/'.length))?.slug||null;if(!category)return false;}
  else if(path.startsWith('/regioni/')){region=regions.find(unit=>unit.slug===path.slice('/regioni/'.length))?.slug||null;if(!region)return false;}
  else if(!staticPaths.includes(path))return false;
  const measured=typeof loadMs==='number'&&Number.isFinite(loadMs)&&loadMs>0&&loadMs<=60_000?Math.round(loadMs):null;
  const day=romeDate();
  await transaction(async()=>{
    await execute('INSERT INTO daily_metrics (day,page_views) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET page_views=daily_metrics.page_views+1',[day]);
    await execute('INSERT INTO page_metrics (day,path,category,region,article_id,views,load_ms_sum,load_samples) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(day,path) DO UPDATE SET views=page_metrics.views+1,load_ms_sum=page_metrics.load_ms_sum+excluded.load_ms_sum,load_samples=page_metrics.load_samples+excluded.load_samples',[day,path,category,region,articleId,measured||0,measured===null?0:1]);
  });
  return true;
}
