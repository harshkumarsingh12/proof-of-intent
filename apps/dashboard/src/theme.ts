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
  return `:root {\n${vars}\n}\n*, *::before, *::after { box-sizing: border-box; }\na { color: var(--poi-blue); }\na:hover { color: var(--poi-blue-dark); }\nbutton:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {\n  outline: 2px solid var(--poi-blue-light);\n  outline-offset: 2px;\n}\n`;
}

/** Shared shapes. Screens spread these and adjust padding or size locally. */
export const card = {
  background: v("surface"),
  border: "none",
  borderRadius: 12,
  boxShadow: v("shadow"),
  padding: 20,
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
