export interface PacketPtsExtent {
  durationSeconds: number;
  packetCount: number;
}

export function parsePacketPtsCsvExtent(csv: string): PacketPtsExtent | null {
  let maximum = Number.NEGATIVE_INFINITY;
  let packetCount = 0;
  for (const line of csv.split(/\r?\n/)) {
    const value = Number.parseFloat(line.trim());
    if (!Number.isFinite(value)) continue;
    packetCount += 1;
    if (value > maximum) maximum = value;
  }
  if (packetCount === 0) return null;
  return { durationSeconds: maximum, packetCount };
}
