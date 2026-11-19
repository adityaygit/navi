// Waitlist email templates, in the website's light "Sky" design: a pale sky page, the Navi lockup,
// one white rounded card with a sky photo on top, a heavy ink headline, and an ink pill button.
// Table-based HTML with inline styles (email-safe). Images are PNG/JPG served from the app's
// public/email/ (absolute URLs, since mail clients load them from the open web); every image has
// a background colour and alt text, so the email still reads well with images blocked.
// Every template also has a plain-text version.

export type Email = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The website's tokens (website/parts/1-head.html).
const C = { page: "#EEF3FA", card: "#FFFFFF", sky: "#CFE2F7", ink: "#0B0F17", ink2: "#2B3140", muted: "#596173", line: "#E3E7EE" };
const FONT = "'Figtree',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const TAGLINE = "Navi · A personal planner you talk to.";
const FOOTER = "You’re receiving this because this address asked for early access to Navi. If that wasn’t you, ignore this email and nothing else will be sent.";

/** The site's origin, taken from a link that points at it. */
const originOf = (url: string) => {
  try { return new URL(url).origin; } catch { return ""; }
};

function layout(o: { site: string; preheader: string; eyebrow: string; title: string; body: string; button?: { label: string; href: string }; after?: string }): string {
  const site = o.site.replace(/\/$/, "");
  const img = (p: string) => esc(`${site}/email/${p}`);
  const btn = o.button
    ? `<tr><td style="padding:30px 0 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${C.ink}" style="border-radius:999px;background:${C.ink}"><a href="${esc(o.button.href)}" style="display:inline-block;padding:16px 28px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${esc(o.button.label)}&nbsp;&nbsp;&rarr;</a></td></tr></table></td></tr>`
    : "";
  const after = o.after ? `<tr><td style="padding-top:24px;font-size:14px;line-height:1.6;color:${C.muted}">${esc(o.after)}</td></tr>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@500;700;800&display=swap" rel="stylesheet">
<style>body{margin:0;padding:0;background:${C.page}}img{border:0;display:block}a{color:${C.ink}}@media (max-width:520px){.out{padding-left:12px!important;padding-right:12px!important}.pad{padding-left:24px!important;padding-right:24px!important}.h{font-size:30px!important;line-height:1.05!important}}</style></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" class="out" style="padding:36px 20px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${FONT};color:${C.ink}">
<tr><td style="padding:0 4px 22px"><img src="${img("navi-lockup.png")}" width="90" height="25" alt="Navi" style="display:block;width:90px;height:auto;font-family:${FONT};font-size:22px;font-weight:800;color:${C.ink}"></td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:28px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td bgcolor="${C.sky}" style="background:${C.sky};border-radius:27px 27px 0 0;overflow:hidden;font-size:0;line-height:0"><img src="${img("sky-header.jpg")}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border-radius:27px 27px 0 0"></td></tr>
<tr><td class="pad" style="padding:36px 40px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:14px;font-size:14px;line-height:20px;font-weight:700;color:${C.muted}">${esc(o.eyebrow)}</td></tr>
<tr><td class="h" style="font-size:36px;line-height:1.02;font-weight:800;letter-spacing:-1.4px;color:${C.ink}">${esc(o.title)}</td></tr>
<tr><td style="padding-top:18px;font-size:17px;line-height:1.55;font-weight:500;color:${C.ink2}">${esc(o.body)}</td></tr>
${btn}${after}
</table></td></tr>
</table></td></tr>
<tr><td style="padding:26px 8px 0;font-size:13px;line-height:1.6;color:${C.muted}">${esc(FOOTER)}<br><br><span style="font-weight:700;color:${C.ink2}">${esc(TAGLINE)}</span></td></tr>
</table></td></tr></table></body></html>`;
}

function text(lines: (string | undefined)[]): string {
  return lines.filter(Boolean).join("\n\n") + `\n\n—\n${FOOTER}\n${TAGLINE}\n`;
}

export function applyEmail(applyUrl: string, siteUrl = originOf(applyUrl)): Email {
  const title = "Tell us a little about you.";
  const body = "Thanks for asking for early access. Navi opens to a small group at a time, and five quick questions help us understand what you’d use it for. It takes about two minutes.";
  const after = "This link is just for you and expires in 14 days. You can only send it once.";
  return {
    subject: "Tell us a little about you",
    html: layout({ site: siteUrl, preheader: "Two minutes, five questions. Then we’ll be in touch.", eyebrow: "Early access · Step 2 of 3", title, body, button: { label: "Answer five questions", href: applyUrl }, after }),
    text: text([title, body, `Answer five questions: ${applyUrl}`, after]),
  };
}

export function approvedEmail(signInUrl: string, siteUrl: string): Email {
  const title = "You’re in.";
  const body = "Your early access to Navi is approved. Sign in with the button below, then tell Navi about your week, out loud or in writing. It will set up your workspaces, routines and first plan, and show you everything before anything is created.";
  const after = `The sign-in link works once and expires in 24 hours. After that, sign in at ${siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} with this email address.`;
  return {
    subject: "You’re in. Navi is ready for you",
    html: layout({ site: siteUrl, preheader: "Your early access is approved. Sign in and tell Navi about your week.", eyebrow: "Early access · Approved", title, body, button: { label: "Sign in to Navi", href: signInUrl }, after }),
    text: text([title, body, `Sign in to Navi: ${signInUrl}`, after]),
  };
}

export function declinedEmail(siteUrl = ""): Email {
  const title = "Not yet, but you’re on the list.";
  const body = "We’re keeping early access small while Navi settles, so we can’t open it to everyone right now. Your answers are saved, and we’ll write again when there’s room.";
  const after = "Want us to forget your details instead? Reply to this email and we’ll delete them.";
  return {
    subject: "About your Navi early access",
    html: layout({ site: siteUrl, preheader: "Not yet, but we’ve kept your place.", eyebrow: "Early access", title, body, after }),
    text: text([title, body, after]),
  };
}
