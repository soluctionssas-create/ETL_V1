"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Divider,
  Drawer,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Toolbar,
  Typography,
  alpha,
} from "@mui/material";
import DashboardRounded from "@mui/icons-material/DashboardRounded";
import ReceiptLongRounded from "@mui/icons-material/ReceiptLongRounded";
import CategoryRounded from "@mui/icons-material/CategoryRounded";
import SettingsSuggestRounded from "@mui/icons-material/SettingsSuggestRounded";
import PublishRounded from "@mui/icons-material/PublishRounded";
import FactCheckRounded from "@mui/icons-material/FactCheckRounded";
import MenuRounded from "@mui/icons-material/MenuRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import NotificationsNoneRounded from "@mui/icons-material/NotificationsNoneRounded";
import KeyboardCommandKeyRounded from "@mui/icons-material/KeyboardCommandKeyRounded";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";

const drawerWidth = 276;

const NAV = [
  { href: "/dashboard", label: "Dashboard ROI", icon: <DashboardRounded fontSize="small" /> },
  { href: "/invoices", label: "Lotes y Facturas", icon: <ReceiptLongRounded fontSize="small" /> },
  { href: "/classification", label: "Clasificacion", icon: <CategoryRounded fontSize="small" /> },
  { href: "/parametrizacion", label: "Parametrizacion", icon: <SettingsSuggestRounded fontSize="small" /> },
  { href: "/exports", label: "Exportaciones", icon: <PublishRounded fontSize="small" /> },
  { href: "/audit", label: "Auditoria", icon: <FactCheckRounded fontSize="small" /> },
];

function crumbLabel(segment: string) {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    let href = "";
    return segments.map((segment) => {
      href += `/${segment}`;
      return { href, label: crumbLabel(segment) };
    });
  }, [pathname]);

  function logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    router.push("/login");
  }

  const drawerContent = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Typography variant="overline" color="text.secondary">ETL SaaS</Typography>
        <Typography variant="h4" sx={{ fontSize: 20 }}>Clasificacion Contable</Typography>
      </Box>
      <Divider />
      <List sx={{ p: 1.2, flex: 1 }}>
        {NAV.map((item) => {
          const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              selected={selected}
              onClick={() => setMobileOpen(false)}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                "&.Mui-selected": {
                  bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14),
                  color: "primary.main",
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 34, color: "inherit" }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />
            </ListItemButton>
          );
        })}
      </List>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Button variant="outlined" color="inherit" fullWidth onClick={logout}>
          Cerrar sesion
        </Button>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        color="transparent"
        elevation={0}
        sx={{
          backdropFilter: "blur(10px)",
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.82),
          ml: { lg: `${drawerWidth}px` },
          width: { lg: `calc(100% - ${drawerWidth}px)` },
        }}
      >
        <Toolbar sx={{ gap: 1.2, minWidth: 0 }}>
          <IconButton sx={{ display: { lg: "none" } }} onClick={() => setMobileOpen(true)}>
            <MenuRounded />
          </IconButton>

          <Paper
            component="label"
            sx={{
              display: "flex",
              alignItems: "center",
              px: 1.2,
              py: 0.4,
              borderRadius: 2,
              flex: { xs: 1, md: "0 0 340px" },
              minWidth: 0,
              width: { xs: "auto", md: 340 },
              maxWidth: { md: 380 },
              bgcolor: (theme) => alpha(theme.palette.background.default, 0.65),
            }}
          >
            <SearchRounded sx={{ color: "text.secondary", mr: 1 }} fontSize="small" />
            <InputBase placeholder="Buscar lote, proveedor, NIT..." sx={{ fontSize: 14, width: "100%" }} inputProps={{ "aria-label": "Busqueda global" }} />
          </Paper>

          <Button startIcon={<KeyboardCommandKeyRounded />} variant="outlined" color="inherit" size="small" sx={{ display: { xs: "none", md: "inline-flex" } }}>
            Command K
          </Button>

          <Box sx={{ ml: { xs: 0, sm: "auto" }, display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <ThemeSwitcher />
            <IconButton aria-label="Centro de notificaciones">
              <Badge color="error" variant="dot">
                <NotificationsNoneRounded />
              </Badge>
            </IconButton>
            <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label="Menu de usuario">
              <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main" }}>A</Avatar>
            </IconButton>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              <MenuItem onClick={() => router.push("/parametrizacion")}>Preferencias</MenuItem>
              <MenuItem onClick={logout}>Cerrar sesion</MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { lg: drawerWidth }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", lg: "none" }, "& .MuiDrawer-paper": { width: drawerWidth } }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", lg: "block" },
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              borderRight: (theme) => `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, pt: { xs: 10, md: 11 } }}>
        <Breadcrumbs aria-label="breadcrumbs" sx={{ mb: 2.2 }}>
          <Link href="/dashboard">Inicio</Link>
          {breadcrumbs.map((item, index) => (
            index === breadcrumbs.length - 1
              ? <Typography key={item.href} color="text.primary">{item.label}</Typography>
              : <Link key={item.href} href={item.href}>{item.label}</Link>
          ))}
        </Breadcrumbs>
        {children}
      </Box>
    </Box>
  );
}
