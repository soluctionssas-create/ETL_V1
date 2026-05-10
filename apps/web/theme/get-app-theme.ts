import { createTheme, alpha } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material";
import type {} from "@mui/x-data-grid/themeAugmentation";
import { brand, radius, shadows } from "./tokens";

export function getAppTheme(mode: PaletteMode) {
  const isDark = mode === "dark";

  return createTheme({
    shape: { borderRadius: radius.md },
    spacing: 8,
    palette: {
      mode,
      primary: { main: brand.indigo },
      secondary: { main: brand.cyan },
      success: { main: brand.emerald },
      background: {
        default: isDark ? "#090e1a" : "#f4f7fb",
        paper: isDark ? "#111a2b" : "#ffffff",
      },
      text: {
        primary: isDark ? "#e8eef9" : "#0f172a",
        secondary: isDark ? "#a7b4cb" : "#475569",
      },
      divider: isDark ? alpha("#a7b4cb", 0.22) : "#dbe3ef",
    },
    typography: {
      fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      h1: { fontSize: "2.2rem", fontWeight: 700, letterSpacing: "-0.02em" },
      h2: { fontSize: "1.8rem", fontWeight: 700, letterSpacing: "-0.015em" },
      h3: { fontSize: "1.35rem", fontWeight: 700, letterSpacing: "-0.01em" },
      h4: { fontSize: "1.1rem", fontWeight: 650 },
      body1: { fontSize: "0.95rem", lineHeight: 1.6 },
      body2: { fontSize: "0.84rem", lineHeight: 1.55 },
      caption: { fontSize: "0.75rem", letterSpacing: "0.03em" },
      overline: { fontSize: "0.68rem", letterSpacing: "0.1em", fontWeight: 700 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: radius.lg,
            border: `1px solid ${isDark ? alpha("#a7b4cb", 0.18) : "#dbe3ef"}`,
            backgroundImage: "none",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: radius.lg,
            boxShadow: shadows.soft,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: radius.sm,
            textTransform: "none",
            fontWeight: 650,
          },
          containedPrimary: {
            boxShadow: shadows.soft,
          },
        },
      },
      MuiTextField: {
        defaultProps: { size: "small" },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: {
            border: 0,
            fontSize: 13,
            backgroundColor: isDark ? "#10182a" : "#ffffff",
          },
          columnHeaders: {
            backgroundColor: isDark ? alpha("#a7b4cb", 0.08) : "#f8fbff",
            borderBottom: `1px solid ${isDark ? alpha("#a7b4cb", 0.16) : "#dbe3ef"}`,
          },
        },
      },
    },
  });
}
