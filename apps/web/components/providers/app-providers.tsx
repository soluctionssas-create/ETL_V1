"use client";

import { useMemo } from "react";
import { ThemeProvider as NextThemeProvider, useTheme as useNextTheme } from "next-themes";
import { CssBaseline, ThemeProvider } from "@mui/material";
import type { PaletteMode } from "@mui/material";
import { getAppTheme } from "@/theme/get-app-theme";

function MuiThemeBridge({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useNextTheme();
  const mode: PaletteMode = resolvedTheme === "dark" ? "dark" : "light";
  const theme = useMemo(() => getAppTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="etl-theme-mode"
    >
      <MuiThemeBridge>{children}</MuiThemeBridge>
    </NextThemeProvider>
  );
}
