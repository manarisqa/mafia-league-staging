export function eveningReadiness(capacity: number, hostId: string | null, confirmedIds: Iterable<string>) {
  const players = new Set(confirmedIds);
  if (hostId) players.delete(hostId);
  const confirmed = players.size;
  const missing = Math.max(capacity - confirmed, 0);
  return { confirmed, missing, hasHost: hostId !== null, ready: !!hostId && missing === 0 };
}
