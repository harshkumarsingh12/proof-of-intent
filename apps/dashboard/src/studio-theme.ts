/**
 * The AG Studio theme, built from the dashboard's palette so Studio and the rest of the dashboard read the same
 * colors (spec 0007). Studio wants literal values, not CSS variables, so this reads `palette` directly.
 */
import { studioTheme } from "ag-studio";
import { fontStack, palette } from "./theme";

export const studioThemeParams = {
  fontFamily: fontStack,
  textColor: palette.text,
  foregroundColor: palette.text,
  backgroundColor: palette.surface,
  borderColor: palette.border,
  accentColor: palette.blue,
  studioCanvasBackgroundColor: palette.bg,
  studioWidgetBackgroundColor: palette.surface,
  studioWidgetBorder: { style: "solid" as const, width: 1, color: palette.border },
  studioWidgetBorderRadius: 10,
  studioWidgetTitleFontFamily: fontStack,
  studioWidgetTitleFontSize: 16,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: palette.heading,
  studioToggleButtonActiveBackgroundColor: palette.blue,
  studioToggleButtonActiveBorderColor: palette.blue,
  studioToggleButtonActiveColor: palette.surface,
  studioPanelGroupTitleBarTextColor: palette.heading,
};

export const dashboardStudioTheme = () => studioTheme.withParams(studioThemeParams);
