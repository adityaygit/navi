// Waitlist email templates. Table-based HTML with inline styles (email-safe), matching the landing page:
// black canvas, Navi mark, tight semibold headline, grey body, white pill button, hairline divider.
// Every template also has a plain-text version.

export type Email = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const MARK = `<svg width="15" height="18" viewBox="0 0 22 26" xmlns="http://www.w3.org/2000/svg"><path d="M11 1.5 20 24.5 11 19.2 2 24.5Z" fill="#f2f2f2"/><path d="M11 1.5V19.2L2 24.5Z" fill="#000" opacity=".3"/></svg>`;
const FOOTER = "You’re receiving this because this address asked for early access to Navi. If that wasn’t you, ignore this email and nothing else will be sent.";

function layout(o: { preheader: string; title: string; body: string; button?: { label: string; href: string }; after?: string }): string {
  const btn = o.button
    ? `<tr><td style="padding:30px 0 0"><a href="${esc(o.button.href)}" style="display:inline-block;background:#f2f2f2;color:#000;text-decoration:none;font-weight:600;font-size:15px;line-height:44px;height:44px;padding:0 26px;border-radius:99px">${esc(o.button.label)}</a></td></tr>`
    : "";
  const after = o.after ? `<tr><td style="padding-top:22px;font-size:13px;line-height:1.6;color:#6c6f76">${esc(o.after)}</td></tr>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>body{margin:0;background:#000}a{color:#f2f2f2}@media (max-width:480px){.pad{padding-left:22px!important;padding-right:22px!important}.h{font-size:30px!important}}</style></head>
<body style="margin:0;background:#000">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000"><tr><td align="center" style="padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:'Instrument Sans',Helvetica,Arial,sans-serif;color:#f2f2f2">
<tr><td class="pad" style="padding:44px 40px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;padding-right:9px">${MARK}</td><td style="vertical-align:middle;font-size:17px;font-weight:600;letter-spacing:-0.3px;color:#f2f2f2">Navi</td></tr></table></td></tr>
<tr><td class="pad" style="padding:56px 40px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td class="h" style="font-size:36px;line-height:1.08;font-weight:600;letter-spacing:-1.3px;color:#f2f2f2">${esc(o.title)}</td></tr>
<tr><td style="padding-top:18px;font-size:16px;line-height:1.6;color:#8f949b">${esc(o.body)}</td></tr>
${btn}${after}
</table></td></tr>
<tr><td class="pad" style="padding:56px 40px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #1d1e22;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>
<tr><td class="pad" style="padding:20px 40px 44px;font-size:12.5px;line-height:1.6;color:#6c6f76">${esc(FOOTER)}<br><br>Navi · A calmer way to run your life.</td></tr>
</table></td></tr></table></body></html>`;
}

function text(lines: (string | undefined)[]): string {
  return lines.filter(Boolean).join("\n\n") + `\n\n—\n${FOOTER}\nNavi · A calmer way to run your life.\n`;
}

export function applyEmail(applyUrl: string): Email {
  const title = "Thanks for asking. Tell us a little about you.";
  const body = "Navi is opening to a small group at a time. A few quick questions help us understand what you’d use it for. It takes about two minutes.";
  const after = "This link is just for you and expires in 14 days. You can only submit it once.";
  return {
    subject: "Tell us a little about you",
    html: layout({ preheader: "Two minutes, five questions. Then we’ll be in touch.", title, body, button: { label: "Answer five questions", href: applyUrl }, after }),
    text: text([title, body, `Answer five questions: ${applyUrl}`, after]),
  };
}

export function approvedEmail(signInUrl: string, siteUrl: string): Email {
  const title = "You’re in.";
  const body = "Your early access to Navi is approved. Sign in with the button below, then tell Navi about your week, out loud or in writing. It will set up your workspaces, routines and first plan, and show you everything before anything is created.";
  const after = `The sign-in link works once and expires in 24 hours. After that, sign in at ${siteUrl.replace(/^https?:\/\//, "")} with this email address.`;
  return {
    subject: "You’re in. Navi is ready for you",
    html: layout({ preheader: "Your early access is approved. Sign in and tell Navi about your week.", title, body, button: { label: "Sign in to Navi", href: signInUrl }, after }),
    text: text([title, body, `Sign in to Navi: ${signInUrl}`, after]),
  };
}

export function declinedEmail(): Email {
  const title = "Not yet, but you’re on the list.";
  const body = "We’re keeping early access small while Navi settles, so we can’t open it to everyone right now. Your answers are saved, and we’ll write again when there’s room.";
  const after = "Want us to forget your details instead? Reply to this email and we’ll delete them.";
  return {
    subject: "About your Navi early access",
    html: layout({ preheader: "Not yet, but we’ve kept your place.", title, body, after }),
    text: text([title, body, after]),
  };
}
