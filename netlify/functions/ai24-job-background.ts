import { handleNetlifyJob } from '../../src/lib/netlify-jobs';

export default async (request: Request) => handleNetlifyJob(request);
export const config = { background: true };
