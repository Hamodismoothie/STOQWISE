/**
 * Transactional e-mail.
 *
 * Delivery uses Resend's REST API through fetch, so there is no SDK to install
 * and no background worker. Without RESEND_API_KEY and MAIL_FROM the message is
 * written to the local outbox instead: development and tests keep working, and
 * every link stays inspectable without sending anything.
 *
 * Sending never throws. A password reset or an invitation must not fail because
 * the mail provider is down; the caller decides what to tell the user, and the
 * attempt is recorded in mail_log either way. The full body is stored only in
 * outbox mode, so a production database never holds live reset tokens.
 */
import { EMAILS } from "./brand.ts";
import { config } from "./config.ts";
import { logMail } from "./db.ts";
import { intlFor } from "./i18n.ts";
import { TRIAL_DAYS } from "./trial-state.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type MailKind =
  | "password_reset"
  | "password_change"
  | "invitation"
  | "contact"
  | "quote_requested"
  | "quote_confirmation"
  | "activation_requested"
  | "activation_confirmation"
  | "plan_activated"
  | "trial_welcome"
  | "trial_midpoint"
  | "trial_ending"
  | "trial_ended";

export type MailLocale = "sv" | "en";

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  kind: MailKind;
  locale?: MailLocale;
  replyTo?: string;
}

export interface MailResult {
  status: "sent" | "outbox" | "failed";
  id?: string;
  error?: string;
}

/** The sender identity, or an empty string when mail cannot be sent. */
export function mailSender(): string {
  if (config.mail.from) return config.mail.from;
  return EMAILS.hello ? `STOQWISE <${EMAILS.hello}>` : "";
}

export function mailConfigured(): boolean {
  return Boolean(config.mail.apiKey && mailSender());
}

/** Where contact form notifications go, or an empty string when unset. */
export function contactInbox(): string {
  return config.mail.notify || EMAILS.hello || "";
}

function record(input: {
  to: string;
  subject: string;
  kind: MailKind;
  status: MailResult["status"];
  providerId?: string | null;
  error?: string | null;
  body?: string | null;
}): void {
  try {
    logMail({
      toEmail: input.to,
      subject: input.subject,
      kind: input.kind,
      status: input.status,
      providerId: input.providerId ?? null,
      error: input.error ?? null,
      body: input.body ?? null,
    });
  } catch {
    // A logging failure must never stop a password reset or an invitation.
  }
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { status: "failed", error: "invalid recipient" };

  if (!mailConfigured()) {
    record({ to, subject: input.subject, kind: input.kind, status: "outbox", body: input.text });
    return { status: "outbox" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.mail.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: mailSender(),
        to: [to],
        subject: input.subject,
        text: input.text,
        html: htmlDocument(input),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      const error = `${res.status} ${payload?.message ?? ""}`.trim();
      record({ to, subject: input.subject, kind: input.kind, status: "failed", error });
      return { status: "failed", error };
    }
    record({ to, subject: input.subject, kind: input.kind, status: "sent", providerId: payload?.id ?? null });
    return { status: "sent", id: payload?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record({ to, subject: input.subject, kind: input.kind, status: "failed", error: message });
    return { status: "failed", error: message };
  }
}

/* ---------------------------------------------------------------- templates */

export function passwordResetMail(input: {
  name: string;
  link: string;
  expiresInMinutes: number;
}): Omit<MailInput, "to"> {
  return {
    kind: "password_reset",
    subject: "Återställ ditt lösenord",
    text: [
      `Hej ${input.name},`,
      "Vi fick en begäran om att återställa lösenordet för ditt konto hos STOQWISE.",
      `Öppna länken för att välja ett nytt lösenord:\n${input.link}`,
      `Länken gäller i ${input.expiresInMinutes} minuter och kan användas en gång. Om du inte begärde den kan du bortse från det här mejlet, lösenordet är oförändrat.`,
      "STOQWISE",
    ].join("\n\n"),
  };
}

/**
 * Confirmation after a completed reset. It is deliberately sent after the new
 * password is stored, so it describes something that has already happened.
 */
export function passwordChangedMail(input: {
  name: string;
  changedAt: Date;
  contactUrl: string;
}): Omit<MailInput, "to"> {
  const when = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(input.changedAt);
  return {
    kind: "password_change",
    subject: "Ditt lösenord har ändrats",
    text: [
      `Hej ${input.name},`,
      `Lösenordet för ditt konto hos STOQWISE ändrades ${when} (svensk tid). Alla sessioner som var inloggade med det gamla lösenordet har loggats ut.`,
      "Om det var du kan du bortse från det här mejlet.",
      `Om du inte ändrade lösenordet själv, kontakta oss direkt:\n${input.contactUrl}`,
      "STOQWISE",
    ].join("\n\n"),
  };
}

export function invitationMail(input: {
  locale: "sv" | "en";
  orgName: string;
  inviterName: string;
  role: string;
  link: string;
  expiresInDays: number;
}): Omit<MailInput, "to"> {
  if (input.locale === "en") {
    return {
      kind: "invitation",
      subject: `You are invited to ${input.orgName}`,
      text: [
        "Hello,",
        `${input.inviterName} has invited you to ${input.orgName} as ${input.role}.`,
        `Open the link to create your account:\n${input.link}`,
        `The link is valid for ${input.expiresInDays} days and can be used once. If you already have a STOQWISE account, sign in with your existing password.`,
        "STOQWISE",
      ].join("\n\n"),
    };
  }
  return {
    kind: "invitation",
    subject: `Du är inbjuden till ${input.orgName}`,
    text: [
      "Hej,",
      `${input.inviterName} har bjudit in dig till ${input.orgName} som ${input.role}.`,
      `Öppna länken för att skapa ditt konto:\n${input.link}`,
      `Länken gäller i ${input.expiresInDays} dagar och kan användas en gång. Har du redan ett konto hos STOQWISE loggar du in med ditt befintliga lösenord.`,
      "STOQWISE",
    ].join("\n\n"),
  };
}

export function contactNotificationMail(input: {
  name: string;
  email: string;
  company: string;
  subject: string;
  message: string;
}): Omit<MailInput, "to"> {
  return {
    kind: "contact",
    subject: `Kontaktformuläret: ${input.subject}`,
    replyTo: input.email,
    text: [
      "Ett nytt meddelande kom in via kontaktformuläret.",
      [
        `Namn: ${input.name}`,
        `E-post: ${input.email}`,
        `Företag: ${input.company || "ej angivet"}`,
        `Ämne: ${input.subject}`,
      ].join("\n"),
      input.message,
      "STOQWISE",
    ].join("\n\n"),
  };
}

const sek = (value: number): string => `${Math.round(value).toLocaleString("sv-SE")} kr`;
const trialDate = (iso: string, locale: MailLocale = "sv"): string =>
  new Date(iso).toLocaleDateString(intlFor(locale), { day: "numeric", month: "long", year: "numeric" });

const daysLeftLabel = (days: number, locale: MailLocale): string =>
  locale === "en" ? `${days} ${days === 1 ? "day" : "days"}` : `${days} ${days === 1 ? "dag" : "dagar"}`;

/** Internal notification when a quote is requested from the price estimate. */
export function quoteRequestedMail(input: {
  orgName: string;
  requesterName: string;
  requesterEmail: string;
  monthly: number;
  annualMonthly: number;
  implementation: number;
  note: string;
  queueUrl: string;
}): Omit<MailInput, "to"> {
  return {
    kind: "quote_requested",
    subject: `Offertförfrågan: ${input.orgName}`,
    replyTo: input.requesterEmail,
    text: [
      "En ny offertförfrågan kom in via prisestimatet.",
      [
        `Organisation: ${input.orgName}`,
        `Kontakt: ${input.requesterName} <${input.requesterEmail}>`,
        `Beräknat pris: ${sek(input.monthly)} per månad exkl. moms`,
        `Årsvis fakturering: ${sek(input.annualMonthly)} per månad`,
        `Implementation: ${sek(input.implementation)}`,
      ].join("\n"),
      input.note ? `Meddelande från kunden:\n${input.note}` : "Kunden lämnade inget meddelande.",
      `Öppna offertkön:\n${input.queueUrl}`,
      "Svara direkt på det här mejlet för att nå kunden.",
    ].join("\n\n"),
  };
}

/** Customer acknowledgement after a quote request. */
export function quoteConfirmationMail(input: {
  name: string;
  orgName: string;
  monthly: number;
  contactUrl: string;
}): Omit<MailInput, "to"> {
  return {
    kind: "quote_confirmation",
    subject: "Vi har tagit emot din offertförfrågan",
    text: [
      `Hej ${input.name},`,
      `Vi har tagit emot din offertförfrågan för ${input.orgName}. Det beräknade priset är ${sek(input.monthly)} per månad exkl. moms.`,
      "Estimatet är inte ett bindande erbjudande. Vi återkommer med en formell offert och går igenom avtal och betalning innan något aktiveras.",
      "Ingen betalning har dragits.",
      `Har du frågor kan du svara på det här mejlet eller kontakta oss:\n${input.contactUrl}`,
      "STOQWISE",
    ].join("\n\n"),
  };
}

/** Internal notification when activation is requested from the price estimate. */
export function activationRequestedMail(input: {
  orgName: string;
  requesterName: string;
  requesterEmail: string;
  monthly: number;
  annualMonthly: number;
  implementation: number;
  note: string;
  organizationUrl: string;
}): Omit<MailInput, "to"> {
  return {
    kind: "activation_requested",
    subject: `Aktivering begärd: ${input.orgName}`,
    replyTo: input.requesterEmail,
    text: [
      "Kunden har begärt aktivering från prisestimatet. Avtal och betalning krävs innan planen slås på.",
      [
        `Organisation: ${input.orgName}`,
        `Kontakt: ${input.requesterName} <${input.requesterEmail}>`,
        `Beräknat pris: ${sek(input.monthly)} per månad exkl. moms`,
        `Årsvis fakturering: ${sek(input.annualMonthly)} per månad`,
        `Implementation: ${sek(input.implementation)}`,
      ].join("\n"),
      input.note ? `Anteckning:\n${input.note}` : "",
      `Öppna organisationen för att aktivera planen:\n${input.organizationUrl}`,
      "När planen sparas skickas välkomstmejlet automatiskt till kundens ägare.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** Customer acknowledgement after an activation request. */
export function activationConfirmationMail(input: {
  name: string;
  orgName: string;
  monthly: number;
  contactUrl: string;
}): Omit<MailInput, "to"> {
  return {
    kind: "activation_confirmation",
    subject: "Vi har tagit emot din begäran om aktivering",
    text: [
      `Hej ${input.name},`,
      `Vi har tagit emot din begäran om att aktivera ${input.orgName}. Det beräknade priset är ${sek(input.monthly)} per månad exkl. moms.`,
      "En aktivering kräver ett avtal och betalning. Vi kontaktar dig för att gå igenom upplägget. Ingen betalning har dragits och inget har aktiverats ännu.",
      `Har du frågor kan du svara på det här mejlet eller kontakta oss:\n${input.contactUrl}`,
      "STOQWISE",
    ].join("\n\n"),
  };
}

/** Sent once when a paid plan is switched on, never for ordinary org edits. */
export function planActivatedMail(input: {
  name: string;
  orgName: string;
  planName: string;
  monthlyPrice: number;
  maxSkus: number;
  maxUsers: number;
  maxAnalysesPerMonth: number;
  appUrl: string;
  contactUrl: string;
}): Omit<MailInput, "to"> {
  return {
    kind: "plan_activated",
    subject: `Välkommen till ${input.planName}`,
    text: [
      `Hej ${input.name},`,
      `Planen ${input.planName} är nu aktiverad för ${input.orgName}.`,
      [
        `Pris: ${sek(input.monthlyPrice)} per månad exkl. moms`,
        `Artiklar: upp till ${input.maxSkus.toLocaleString("sv-SE")}`,
        `Användare: upp till ${input.maxUsers.toLocaleString("sv-SE")}`,
        `Analyser per månad: upp till ${input.maxAnalysesPerMonth.toLocaleString("sv-SE")}`,
      ].join("\n"),
      `Öppna STOQWISE:\n${input.appUrl}`,
      `Fakturering sker enligt avtalet. Har du frågor kan du svara på det här mejlet eller kontakta oss:\n${input.contactUrl}`,
      "STOQWISE",
    ].join("\n\n"),
  };
}

/** First message in the trial lifecycle, sent when the workspace is created. */
export function trialWelcomeMail(input: {
  name: string;
  orgName: string;
  trialEndsAt: string;
  appUrl: string;
  quoteUrl: string;
  locale?: MailLocale;
}): Omit<MailInput, "to"> {
  const english = input.locale === "en";
  return {
    kind: "trial_welcome",
    locale: english ? "en" : "sv",
    subject: english ? "Your STOQWISE trial is active" : "Din provperiod på STOQWISE är igång",
    text: english
      ? [
          `Hi ${input.name},`,
          `The trial for ${input.orgName} is active and ends ${trialDate(input.trialEndsAt, "en")}. You have ${TRIAL_DAYS} days to import, analyse and export.`,
          "During the trial you can upload a CSV or Excel export, see where capital is tied up, simulate scenarios and download a report and purchase order.",
          "When the trial ends, the organization switches to read-only mode. Your analyses and item rows are not deleted. You can keep reading and exporting until you choose a paid plan.",
          `Open STOQWISE:\n${input.appUrl}`,
          `See the price estimate and request a quote:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n")
      : [
          `Hej ${input.name},`,
          `Provperioden för ${input.orgName} är igång och slutar ${trialDate(input.trialEndsAt)}. Du har ${TRIAL_DAYS} dagar på dig att importera, analysera och exportera.`,
          "Under provperioden kan du ladda upp en CSV- eller Excel-export, se var kapitalet sitter, simulera scenarier och ladda ner rapport och beställningsunderlag.",
          "När provperioden tar slut går organisationen över till läsbart läge. Dina analyser och artikelrader raderas inte. Du kan fortsätta läsa och exportera tills du väljer en betald plan.",
          `Öppna STOQWISE:\n${input.appUrl}`,
          `Se prisestimat och begär offert:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n"),
  };
}

/** Sent halfway through the trial, when there is still time to act. */
export function trialMidpointMail(input: {
  name: string;
  orgName: string;
  trialEndsAt: string;
  daysLeft: number;
  appUrl: string;
  quoteUrl: string;
  locale?: MailLocale;
}): Omit<MailInput, "to"> {
  const english = input.locale === "en";
  return {
    kind: "trial_midpoint",
    locale: english ? "en" : "sv",
    subject: english ? `Half of the trial remains for ${input.orgName}` : `Halva provperioden är kvar för ${input.orgName}`,
    text: english
      ? [
          `Hi ${input.name},`,
          `Half of the trial for ${input.orgName} has passed. You have ${daysLeftLabel(input.daysLeft, "en")} left until ${trialDate(input.trialEndsAt, "en")}.`,
          "A good next step is to import a fresh export and compare it with the first analysis. That shows whether overstock and stockout risk are moving in the right direction.",
          "The trial ends in read-only mode, not with deletion. All data remains even if you do not choose a paid plan right away.",
          `Open STOQWISE:\n${input.appUrl}`,
          `See the price estimate and request a quote:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n")
      : [
          `Hej ${input.name},`,
          `Halva provperioden för ${input.orgName} har gått. Det är ${daysLeftLabel(input.daysLeft, "sv")} kvar till ${trialDate(input.trialEndsAt)}.`,
          "Ett bra nästa steg är att importera en färsk export och jämföra den med den första analysen. Då syns om overstock och bristrisk rör sig åt rätt håll.",
          "Provperioden avslutas med läsbart läge, inte med radering. All data finns kvar även om du inte väljer en betald plan direkt.",
          `Öppna STOQWISE:\n${input.appUrl}`,
          `Se prisestimat och begär offert:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n"),
  };
}

/** Last reminder before the trial becomes read-only. */
export function trialEndingMail(input: {
  name: string;
  orgName: string;
  trialEndsAt: string;
  daysLeft: number;
  appUrl: string;
  quoteUrl: string;
  locale?: MailLocale;
}): Omit<MailInput, "to"> {
  const english = input.locale === "en";
  return {
    kind: "trial_ending",
    locale: english ? "en" : "sv",
    subject: english ? `${daysLeftLabel(input.daysLeft, "en")} left of the trial` : `${daysLeftLabel(input.daysLeft, "sv")} kvar av provperioden`,
    text: english
      ? [
          `Hi ${input.name},`,
          `The trial for ${input.orgName} ends ${trialDate(input.trialEndsAt, "en")}. You have ${daysLeftLabel(input.daysLeft, "en")} left.`,
          "After that the organisation switches to read-only mode. You can still read analyses, download reports and export data, but you cannot import new files or create new analyses.",
          "Nothing is deleted automatically. If you want to keep working with new data, request a quote now.",
          `Open STOQWISE:\n${input.appUrl}`,
          `See the price estimate and request a quote:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n")
      : [
          `Hej ${input.name},`,
          `Provperioden för ${input.orgName} slutar ${trialDate(input.trialEndsAt)}. Det är ${daysLeftLabel(input.daysLeft, "sv")} kvar.`,
          "Efter det går organisationen över till läsbart läge. Det betyder att du fortfarande kan läsa analyser, ladda ner rapporter och exportera data, men inte importera nya filer eller skapa nya analyser.",
          "Ingenting raderas automatiskt. Vill du fortsätta arbeta med nya data kan du begära en offert redan nu.",
          `Öppna STOQWISE:\n${input.appUrl}`,
          `Se prisestimat och begär offert:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n"),
  };
}

/** Sent when the trial has ended and the workspace is read-only. */
export function trialEndedMail(input: {
  name: string;
  orgName: string;
  trialEndsAt: string;
  appUrl: string;
  exportUrl: string;
  quoteUrl: string;
  locale?: MailLocale;
}): Omit<MailInput, "to"> {
  const english = input.locale === "en";
  return {
    kind: "trial_ended",
    locale: english ? "en" : "sv",
    subject: english ? "Your trial has ended and your data remains" : "Provperioden har tagit slut, dina data finns kvar",
    text: english
      ? [
          `Hi ${input.name},`,
          `The trial for ${input.orgName} ended ${trialDate(input.trialEndsAt, "en")}. The organisation is now in read-only mode.`,
          "All analyses, item rows, scenarios and reports remain. You can keep reading them and export the organisation's data. What is closed is new imports, new analyses and other changes to customer data.",
          `Export all data:\n${input.exportUrl}`,
          `Open STOQWISE:\n${input.appUrl}`,
          `Request a quote to continue:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n")
      : [
          `Hej ${input.name},`,
          `Provperioden för ${input.orgName} tog slut ${trialDate(input.trialEndsAt)}. Organisationen är nu i läsbart läge.`,
          "Alla analyser, artikelrader, scenarier och rapporter finns kvar. Du kan fortsätta läsa dem och exportera hela organisationens data. Det som stängs av är nya importer, nya analyser och andra ändringar av kunddata.",
          `Exportera all data:\n${input.exportUrl}`,
          `Öppna STOQWISE:\n${input.appUrl}`,
          `Begär offert för att fortsätta:\n${input.quoteUrl}`,
          "STOQWISE",
        ].join("\n\n"),
  };
}

/* --------------------------------------------------------------- rendering */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(block)
          .replace(/\n/g, "<br>")
          .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1f5f4a;overflow-wrap:anywhere;word-break:break-word">$1</a>')}</p>`,
    )
    .join("");
}

function htmlDocument(input: MailInput): string {
  const english = input.locale === "en";
  return `<!doctype html><html lang="${english ? "en" : "sv"}"><body style="margin:0;padding:24px;background:#f6f4ef;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e0d6;border-radius:12px">
<tr><td style="padding:28px 32px">
<p style="margin:0 0 20px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b62">STOQWISE</p>
${paragraphs(input.text)}
<p style="margin:24px 0 0;font-size:12px;color:#6b6b62">${english ? "This email was sent automatically from STOQWISE." : "Det här mejlet skickades automatiskt från STOQWISE."}</p>
</td></tr></table></td></tr></table></body></html>`;
}
