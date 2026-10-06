/** Per-account limits the API enforces. Mirrors MAX_ACTIVE_KEYS in
 *  apikeys/service.py and MAX_WEBHOOKS in webhooks/service.py; the server is
 *  the authority and says so in its error if these ever drift. */
export const MAX_ACTIVE_API_KEYS = 10;
export const MAX_WEBHOOKS = 5;
