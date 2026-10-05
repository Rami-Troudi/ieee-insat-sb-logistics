import { DateTime } from "luxon";
const TZ = "Africa/Tunis";
export const fmtDay = (iso: string) => DateTime.fromISO(iso).setZone(TZ).toFormat("ccc, d LLL");
export const fmtTime = (iso: string) => DateTime.fromISO(iso).setZone(TZ).toFormat("HH:mm");
export function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}
