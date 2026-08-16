/**
 * Israeli mobile numbers, normalised to E.164.
 *
 * People type 050-123-4567, 0501234567, 972501234567 and +972 50 123 4567 and
 * mean the same phone. WhatsApp providers accept exactly one of those forms,
 * so normalisation happens once, on the way into the database — never at send
 * time, where a bad number would already have cost a delivery attempt.
 *
 * Shared by the account form (client) and the notification worker (server), so
 * this file must stay free of server-only imports.
 */

/** +972 followed by a 9-digit subscriber number starting with 5 (mobile). */
export function toE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits === "") return null;

  let local: string;
  if (digits.startsWith("+972")) local = digits.slice(4);
  else if (digits.startsWith("972")) local = digits.slice(3);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;

  // Israeli mobile: 5X plus 7 more digits.
  if (!/^5\d{8}$/.test(local)) return null;
  return `+972${local}`;
}

export function isValidIsraeliMobile(input: string): boolean {
  return toE164(input) != null;
}

/** 0501234567 — how the number is shown back to the user. */
export function toLocalPhone(e164: string): string {
  return e164.startsWith("+972") ? `0${e164.slice(4)}` : e164;
}
