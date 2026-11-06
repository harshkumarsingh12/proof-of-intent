import type { ReactNode } from "react";

export const metadata = {
  title: "Proof of Intent · Shop with a signed intent",
  description:
    "Tell your shopping agent what you want, sign it, and the merchant checks every cart against it before PayPal takes any money.",
};

// Same palette as the operations dashboard (apps/dashboard/src/theme.ts), so both sites read as one product.
const CSS = `
:root {
  --navy: #003087; --blue: #0065d6; --blue-dark: #0052b0; --blue-light: #009cde;
  --bg: #f5f7fa; --surface: #ffffff; --surface-muted: #eef1f5; --border: #dde1e6;
  --text: #001435; --muted: #545d68; --success: #0a7d3e; --success-bg: #e6f4ec;
  --danger: #c9162b; --danger-bg: #fdecee; --shadow: 0 1px 4px rgba(0, 20, 53, 0.08);
  --shadow-lg: 0 8px 28px rgba(0, 20, 53, 0.14);
}
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text); line-height: 1.55;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
a { color: var(--blue); }
a:hover { color: var(--blue-dark); }
a:focus-visible { outline: 2px solid var(--blue-light); outline-offset: 2px; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
.nav { display: flex; align-items: center; justify-content: space-between; height: 72px; }
.brand { font-size: 22px; font-weight: 800; color: var(--navy); letter-spacing: -0.02em; text-decoration: none; }
.nav-links { display: flex; gap: 24px; font-size: 15px; }
.nav-links a { color: var(--text); text-decoration: none; }
.nav-links a:hover { color: var(--navy); }
.hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 48px; align-items: center; padding-top: 56px; padding-bottom: 72px; }
.eyebrow { display: inline-block; font-size: 13px; font-weight: 700; color: var(--navy); background: #d6e6fb;
  padding: 4px 12px; border-radius: 9999px; margin-bottom: 18px; }
h1 { font-size: 52px; line-height: 1.08; letter-spacing: -0.03em; margin: 0 0 18px; }
.lead { font-size: 19px; color: var(--muted); margin: 0 0 28px; max-width: 540px; }
.ctas { display: flex; flex-wrap: wrap; gap: 12px; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 13px 24px; border-radius: 9999px;
  font-size: 15px; font-weight: 700; text-decoration: none; border: 1px solid var(--navy); }
.btn-primary { background: var(--navy); color: #fff; }
.btn-primary:hover { background: #001c64; color: #fff; }
.btn-ghost { background: var(--surface); color: var(--navy); }
.btn-ghost:hover { background: var(--surface-muted); color: var(--navy); }
.mandate { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow-lg); padding: 24px; }
.mandate-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; font-size: 13px; color: var(--muted); }
.tag { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; }
.tag-ok { background: var(--success-bg); color: var(--success); }
.tag-no { background: var(--danger-bg); color: var(--danger); }
.quote { font-size: 17px; font-style: italic; margin: 0 0 16px; padding: 14px 16px; border-left: 3px solid var(--blue); background: var(--bg); border-radius: 0 10px 10px 0; }
.rules { list-style: none; margin: 0 0 18px; padding: 0; display: grid; gap: 8px; font-size: 14px; }
.rules li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; background: var(--surface-muted); border-radius: 8px; }
.rules code { font-size: 13px; }
.cart { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; font-size: 14px; }
.cart + .cart { margin-top: 8px; }
.cart strong { display: block; }
.cart small { color: var(--muted); }
section.band { padding: 64px 0; }
section.band.alt { background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
h2 { font-size: 32px; letter-spacing: -0.02em; margin: 0 0 8px; }
.sub { color: var(--muted); font-size: 17px; margin: 0 0 36px; max-width: 640px; }
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.step { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; box-shadow: var(--shadow); }
section.band.alt .step { background: var(--bg); box-shadow: none; }
.num { display: inline-flex; width: 36px; height: 36px; border-radius: 9999px; align-items: center; justify-content: center;
  background: var(--navy); color: #fff; font-weight: 800; margin-bottom: 14px; }
.step h3 { margin: 0 0 6px; font-size: 18px; }
.step p { margin: 0; color: var(--muted); font-size: 15px; }
footer { padding: 32px 0 48px; color: var(--muted); font-size: 14px; }
footer .wrap { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; }
/* Shop (/shop) */
.shop { padding-top: 24px; padding-bottom: 64px; display: grid; gap: 20px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); padding: 24px; }
.panel h2 { font-size: 22px; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
.panel .sub { font-size: 15px; margin: 0 0 18px; }
.panel.muted { opacity: 0.55; }
.field { display: grid; gap: 6px; margin-bottom: 14px; font-size: 14px; font-weight: 600; }
.field input, .field select, .field textarea { font: inherit; font-weight: 400; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); }
.field textarea { min-height: 72px; resize: vertical; }
.row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.check { display: flex; gap: 8px; align-items: center; font-size: 14px; margin-bottom: 16px; }
button.btn { cursor: pointer; font-family: inherit; }
button.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-small { padding: 8px 16px; font-size: 14px; }
.group { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 10px; }
.others { margin-top: 16px; }
.others summary { cursor: pointer; font-weight: 700; font-size: 14px; color: var(--navy); margin-bottom: 12px; }
.products { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.product { border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: grid; gap: 6px; align-content: start; }
.product strong { font-size: 15px; }
.product small { color: var(--muted); }
.price { font-weight: 800; font-size: 18px; }
.verdict { border-radius: 12px; padding: 16px; margin-top: 16px; }
.verdict.ok { background: var(--success-bg); }
.verdict.warn { background: #fff4e0; }
.verdict.no { background: var(--danger-bg); }
.verdict h3 { margin: 0 0 6px; font-size: 17px; }
.verdict p { margin: 0 0 8px; font-size: 14px; }
.reasons { margin: 8px 0 0; padding-left: 18px; font-size: 14px; }
.reasons code { font-size: 12px; color: var(--muted); }
.trace { margin: 8px 0 0; padding-left: 20px; font-size: 14px; display: grid; gap: 6px; }
.trace code { font-size: 12px; color: var(--muted); }
.meta { font-size: 13px; color: var(--muted); word-break: break-all; }
.error { color: var(--danger); font-size: 14px; margin: 8px 0 0; }
.paypal-slot { max-width: 360px; margin-top: 12px; }
@media (max-width: 900px) {
  .row, .products { grid-template-columns: minmax(0, 1fr); }
  .hero { grid-template-columns: minmax(0, 1fr); padding-top: 32px; padding-bottom: 48px; gap: 32px; }
  h1 { font-size: 38px; }
  .steps { grid-template-columns: minmax(0, 1fr); }
  .nav-links { display: none; }
}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
