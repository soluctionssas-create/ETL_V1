"use client";

import { useTheme } from "next-themes";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import LightModeRounded from "@mui/icons-material/LightModeRounded";
import DarkModeRounded from "@mui/icons-material/DarkModeRounded";
import DesktopWindowsRounded from "@mui/icons-material/DesktopWindowsRounded";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={theme ?? "system"}
      onChange={(_, value) => value && setTheme(value)}
      aria-label="Selector de tema"
    >
      <ToggleButton value="light" aria-label="Tema claro">
        <LightModeRounded fontSize="small" />
      </ToggleButton>
      <ToggleButton value="dark" aria-label="Tema oscuro">
        <DarkModeRounded fontSize="small" />
      </ToggleButton>
      <ToggleButton value="system" aria-label="Tema del sistema">
        <DesktopWindowsRounded fontSize="small" />
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
