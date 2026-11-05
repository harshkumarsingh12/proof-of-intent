/**
 * Dashboard theme: a light, PayPal-style palette (navy and blue on white). Owner: @hoursgotviral-dev.
 * Spec: docs/specs/0007-dashboard.md. Not PayPal's own branding: no logo, no PayPal Sans.
 *
 * Components use the CSS variables (`var(--poi-border)` and so on), which the root layout writes to :root
 * from `palette`, so a color changes in one place. AG Grid's theme can read the same values later.
 */
export const palette = {
  navy: "#003087",
  navyDark: "#001c64",
  blue: "#0065d6",
  blueDark: "#0052b0",
  blueLight: "#009cde",

  bg: "#f5f7fa",
  surface: "#ffffff",
  surfaceMuted: "#eef1f5",
  border: "#dde1e6",

  text: "#001435",
  heading: "#003087",
  textMuted: "#545d68",
  textSubtle: "#636a74",

  success: "#0a7d3e",
  successBg: "#e6f4ec",
  successBorder: "#a7d8bc",
  warning: "#a85600",
  warningBg: "#fff4e5",
  warningBorder: "#f5c98b",
  danger: "#c9162b",
  dangerBg: "#fdecee",
  dangerBorder: "#f2b8bf",
  infoBg: "#e8f1fc",

  // App shell
  sidebarBg: "#ffffff",
  navActiveBg: "#d6e6fb",
  navHoverBg: "#eef3fb",
  modeBg: "#e7e1ff",
  modeText: "#2a1a7a",
  noticeBg: "#ece9e4",

  // Flat color bands on the home tiles (our own, not PayPal's illustrations)
  bandConcede: "#f6c453",
  bandDefend: "#2f6fd6",
  bandResolved: "#7cc242",
  bandStandard: "#cfd5dd",
  skeleton: "#e6e9ee",

  overlay: "rgba(0, 20, 53, 0.45)",
  shadow: "0 1px 4px rgba(0, 20, 53, 0.08)",
  shadowLg: "0 8px 28px rgba(0, 20, 53, 0.18)",
} as const;

export type PaletteToken = keyof typeof palette;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** `var(--poi-<token>)` for inline styles. */
export const v = (token: PaletteToken) => `var(--poi-${kebab(token)})`;

export const fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

/** The :root block the root layout renders once. */
export function themeCss(): string {
  const vars = Object.entries(palette)
    .map(([k, val]) => `  --poi-${kebab(k)}: ${val};`)
    .join("\n");
  return `:root {\n${vars}\n}\n${BASE_CSS}`;
}

/** Global rules that inline styles can't express: hover, focus, animation, small screens. */
const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
a { color: var(--poi-blue); }
a:hover { color: var(--poi-blue-dark); }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
  outline: 2px solid var(--poi-blue-light);
  outline-offset: 2px;
}
.poi-nav-item:hover { background: var(--poi-nav-hover-bg); }
.poi-nav-item[aria-current="page"], .poi-nav-item[aria-current="page"]:hover { background: var(--poi-nav-active-bg); }
.poi-tile { transition: box-shadow 0.15s ease, transform 0.15s ease; }
.poi-tile:hover { box-shadow: var(--poi-shadow-lg); transform: translateY(-2px); }
.poi-quick:hover .poi-quick-circle { background: var(--poi-nav-active-bg); color: var(--poi-navy); }
.poi-tab:hover { color: var(--poi-navy); }
.poi-suggestion[aria-selected="true"] { background: var(--poi-nav-hover-bg); }
@keyframes poi-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.poi-skeleton {
  border-radius: 6px;
  background: linear-gradient(90deg, var(--poi-skeleton) 0px, var(--poi-surface-muted) 80px, var(--poi-skeleton) 160px);
  background-size: 800px 100%;
  animation: poi-shimmer 1.4s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .poi-skeleton { animation: none; }
  .poi-tile, .poi-tile:hover { transition: none; transform: none; }
}
@media (max-width: 900px) {
  .poi-search { display: none !important; }
}
`;

/** Shared shapes. Screens spread these and adjust padding or size locally. */
export const card = {
  background: v("surface"),
  border: `1px solid ${v("border")}`,
  borderRadius: 16,
  boxShadow: v("shadow"),
  padding: 20,
} as const;

/** Large page title and subtitle, as on the Home page. */
export const pageTitle = {
  fontSize: 36,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: v("text"),
  margin: "0 0 8px 0",
} as const;

export const pageSubtitle = {
  fontSize: 16,
  color: v("textMuted"),
  margin: 0,
} as const;

export const kpiLabel = {
  fontSize: 13,
  fontWeight: 600,
  color: v("textMuted"),
} as const;

/** Secondary pill button: navy outline on white. Primary buttons override background and color. */
export const pillButton = {
  padding: "8px 18px",
  borderRadius: 9999,
  fontSize: 13,
  fontWeight: 600,
  border: `1px solid ${v("navy")}`,
  background: v("surface"),
  color: v("navy"),
  cursor: "pointer",
} as const;
