import { handleNetlifySchedule } from '../../src/lib/netlify-jobs';

export default async (request: Request) => handleNetlifySchedule(request);
export const config = { schedule: '* * * * *' };
