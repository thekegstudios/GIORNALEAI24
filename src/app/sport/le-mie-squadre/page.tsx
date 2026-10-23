import { getCompetitions,getSportsEntities,getSportsEvents,getSportsStandings,competitionAuthorized } from '@/lib/sports/store';
import { SportFavorites } from '@/components/sports-favorites';
export const dynamic='force-dynamic';
export default async function Favorites(){const [entities,competitions,events,standings]=await Promise.all([getSportsEntities(),getCompetitions(),getSportsEvents(),getSportsStandings()]);return <><h1>Le mie squadre</h1><SportFavorites entities={entities} competitions={competitions.filter(competitionAuthorized)} events={events} standings={standings}/></>;}
