/** AG Grid on the dashboard palette (src/theme.ts); the Orders page and the Studio disputes grid share it. */
import { themeQuartz } from "ag-grid-community";
import { fontStack, palette } from "./theme";

export const gridTheme = themeQuartz.withParams({
  accentColor: palette.blue,
  foregroundColor: palette.text,
  backgroundColor: palette.surface,
  borderColor: palette.border,
  headerBackgroundColor: palette.surfaceMuted,
  headerTextColor: palette.heading,
  oddRowBackgroundColor: palette.bg,
  rowHoverColor: palette.navHoverBg,
  fontFamily: fontStack,
  fontSize: 13,
  wrapperBorderRadius: 12,
});
