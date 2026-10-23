import { getArticle,getSources } from '@/lib/store';
import { offlineArticleAllowed,renderOfflineArticle } from '@/lib/offline-article';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const base={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
async function snapshot(params:Promise<{slug:string}>,head:boolean){
  const {slug}=await params;if(!/^[a-zA-Z0-9-]{1,250}$/.test(slug))return new Response(null,{status:404,headers:base});
  const [article,sources]=await Promise.all([getArticle(slug),getSources()]);
  if(!article)return new Response(null,{status:404,headers:base});
  if(!offlineArticleAllowed(article,sources))return new Response(null,{status:403,headers:base});
  const savedAt=new Date().toISOString();
  const headers={...base,'Content-Type':'text/html; charset=utf-8','X-AI24-Offline':'article','X-AI24-Article-Slug':slug,'X-AI24-Article-Title':encodeURIComponent(article.title),'X-AI24-Article-Updated-At':article.updatedAt,'X-AI24-Offline-Saved-At':savedAt};
  return new Response(head?null:renderOfflineArticle(article,sources,savedAt),{headers});
}
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){return snapshot(params,false);}
export async function HEAD(_request:Request,{params}:{params:Promise<{slug:string}>}){return snapshot(params,true);}
