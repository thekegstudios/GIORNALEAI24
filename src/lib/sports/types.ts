import { z } from 'zod';
const identifier=z.string().regex(/^[a-zA-Z0-9:_-]{1,120}$/);
const number=z.number().finite().int().nonnegative();
export const partialScore=z.object({label:z.string().max(60),home:number.nullable(),away:number.nullable(),tieBreakHome:number.optional(),tieBreakAway:number.optional()}).strict();
export const scoreSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('football'),home:number.nullable(),away:number.nullable(),halfTime:partialScore.optional(),penalties:partialScore.optional()}).strict(),
  z.object({kind:z.literal('volleyball'),home:number.nullable(),away:number.nullable(),sets:z.array(partialScore).max(7)}).strict(),
  z.object({kind:z.literal('basketball'),home:number.nullable(),away:number.nullable(),quarters:z.array(partialScore).max(4),overtime:z.array(partialScore).max(10)}).strict(),
  z.object({kind:z.literal('tennis'),home:number.nullable(),away:number.nullable(),sets:z.array(partialScore).max(7),games:partialScore.optional()}).strict(),
  z.object({kind:z.literal('race'),positions:z.array(z.object({entityId:identifier,position:z.number().int().positive().nullable(),time:z.string().max(100).nullable(),gap:z.string().max(100).nullable()})).max(500)}).strict(),
  z.object({kind:z.literal('other'),label:z.string().max(100),home:number.nullable(),away:number.nullable(),partials:z.array(partialScore).max(50)}).strict()
]);
export type SportScore=z.infer<typeof scoreSchema>;
export type Discipline={id:string;name:string;scoreKind:SportScore['kind'];enabled:boolean};
export type SportsProvider={id:'api-sports';name:string;enabled:boolean;dailyLimit:number;minuteLimit:number;monthlyCostUsd:number|null};
export type Competition={id:string;sportId:string;name:string;country:string;gender:'men'|'women'|'mixed'|'unknown';season:string;providerId:'api-sports';externalId:string;enabled:boolean;rightsConfirmed:boolean;rightsEvidenceUrl:string;rightsNote:string;italianEntityExternalIds:string[];coverageVerifiedAt:string|null;lastImportedAt:string|null};
export const entitySchema=z.object({id:identifier,externalId:z.string().max(100),name:z.string().min(1).max(180),sportId:identifier,kind:z.enum(['team','athlete']),country:z.string().max(80).nullable(),italian:z.boolean(),providerId:z.literal('api-sports')}).strict();
export type SportsEntity=z.infer<typeof entitySchema>;
export const sportsEventSchema=z.object({id:identifier,externalId:z.string().max(100),sportId:identifier,competitionId:identifier,competitionName:z.string().max(200),season:z.string().max(30),startsAt:z.iso.datetime({offset:true}),status:z.enum(['scheduled','live','finished','postponed','cancelled','interrupted','unknown']),providerStatus:z.string().max(120),participants:z.array(entitySchema).min(1).max(500),score:scoreSchema,round:z.string().max(180).nullable(),venue:z.string().max(200).nullable(),providerId:z.literal('api-sports'),sourceUrl:z.url(),fetchedAt:z.iso.datetime({offset:true}),italyEvidence:z.string().min(1).max(500),statistics:z.array(z.object({name:z.string().max(100),home:z.string().max(100).nullable(),away:z.string().max(100).nullable()})).max(200),timeline:z.array(z.object({minute:z.string().max(30),text:z.string().max(300)})).max(300),lineups:z.array(z.object({teamId:identifier,names:z.array(z.string().max(150)).max(50)})).max(2)}).strict();
export type SportsEvent=z.infer<typeof sportsEventSchema>;
export type StandingRow={position:number|null;entityId:string;name:string;played:number|null;won:number|null;drawn:number|null;lost:number|null;points:number|null;description:string|null};
export type SportsStanding={id:string;competitionId:string;season:string;group:string;stage:string|null;rows:StandingRow[];providerId:'api-sports';sourceUrl:string;fetchedAt:string};
export type SportsFilters={date?:string;sport?:string;competition?:string;country?:string;gender?:string;status?:string;entity?:string};
export type SportsOverview={enabled:boolean;configured:boolean;disciplines:Discipline[];competitions:Competition[];providers:SportsProvider[];usage:Record<string,unknown>[];sync:Record<string,unknown>[];events:number;lastUpdated:string|null};
