/** What the server's /api/v1/health answers (server/board.ts Health): versions and the backlog served. */
export interface Health {
  board: string;
  core: string;
  spec: string;
  backlog: { name: string; items: number };
}

/** Reads /api/v1/health from the board's own server. */
export async function loadHealth(fetchFn: typeof fetch = fetch): Promise<Health> {
  const res = await fetchFn('api/v1/health');
  if (!res.ok) throw new Error(`the board's server answered ${res.status}`);
  return (await res.json()) as Health;
}
