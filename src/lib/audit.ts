import { randomUUID } from 'node:crypto';
import { execute, query } from './db';
import type { ModuleId, NewsroomAction } from './newsroom-types';

export async function logAction(module:ModuleId,action:string,entityId:string|null,details:Record<string,unknown>,runId?:string|null):Promise<void>{
  await execute('INSERT INTO newsroom_actions (id,module,action,entity_id,run_id,details,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),module,action.slice(0,120),entityId,runId||null,JSON.stringify(details),new Date().toISOString()]);
}
export async function listActions(limit=100):Promise<NewsroomAction[]>{
  return (await query('SELECT * FROM newsroom_actions ORDER BY created_at DESC LIMIT ?',[Math.max(1,Math.min(500,Math.trunc(limit)||100))])).map(row=>({id:String(row.id),module:row.module as ModuleId,action:String(row.action),entityId:row.entity_id==null?null:String(row.entity_id),runId:row.run_id==null?null:String(row.run_id),details:JSON.parse(String(row.details)),at:String(row.created_at)}));
}
