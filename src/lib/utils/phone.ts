export function normalizeMalaysiaPhoneNumber(phone?: string | null): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return `60${digits.slice(1)}`;
  return `60${digits}`;
}

export function malaysiaPhoneVariants(phone?: string | null): string[] {
  const raw = String(phone || '').trim();
  const normalized = normalizeMalaysiaPhoneNumber(raw);
  const local = normalized.startsWith('60') ? `0${normalized.slice(2)}` : '';
  return Array.from(new Set([raw, normalized, local, normalized ? `+${normalized}` : ''].filter(Boolean)));
}

export function maskPhoneForLog(phone?: string | null): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 6) return digits ? '***' : '';
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}
