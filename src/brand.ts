/**
 * Brand contact addresses, fail-closed.
 *
 * There is deliberately no fallback domain: an address is published only when
 * BRAND_EMAIL_DOMAIN is set to a domain the company owns. Until then every page,
 * PDF and invoice omits the address instead of pointing at a mailbox nobody
 * controls.
 *
 * When the domain is configured, addresses use role mailboxes:
 * hello@ (public contact, reports), privacy@ (data protection) and
 * billing@ (invoices).
 */
export function resolveBrandDomain(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) return null;
  return value;
}

export const BRAND_EMAIL_DOMAIN = resolveBrandDomain(process.env.BRAND_EMAIL_DOMAIN);

export function brandEmail(local: string, domain: string | null = BRAND_EMAIL_DOMAIN): string | null {
  return domain ? `${local}@${domain}` : null;
}

export const EMAILS = {
  hello: brandEmail("hello"),
  privacy: brandEmail("privacy"),
  billing: brandEmail("billing"),
} as const;
