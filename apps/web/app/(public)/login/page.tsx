"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import VisibilityRounded from "@mui/icons-material/VisibilityRounded";
import VisibilityOffRounded from "@mui/icons-material/VisibilityOffRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import { motion } from "framer-motion";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tokens = await login(email, password);
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem("access_token", tokens.access_token);
      storage.setItem("refresh_token", tokens.refresh_token);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.1fr 1fr" } }}>
      <Box
        sx={{
          p: { xs: 3, md: 6 },
          background: "linear-gradient(165deg, #0f172a 0%, #172554 45%, #0f766e 100%)",
          color: "white",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <Box>
          <Typography variant="overline" sx={{ opacity: 0.9 }}>ETL SaaS</Typography>
          <Typography variant="h2" sx={{ mt: 1 }}>Control contable enterprise</Typography>
          <Typography sx={{ mt: 2, maxWidth: 460, color: "rgba(255,255,255,0.82)" }}>
            Centraliza lotes, clasificacion y exportaciones ERP con trazabilidad multiempresa y operacion en tiempo real.
          </Typography>
        </Box>

        <Paper
          component={motion.div}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          sx={{
            mt: 4,
            p: 2.5,
            borderRadius: 3,
            bgcolor: "rgba(255,255,255,0.1)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.18)",
          }}
        >
          <Typography variant="h6">Rendimiento operativo</Typography>
          <Typography variant="body2" sx={{ mt: 0.6, opacity: 0.9 }}>
            94.1% de clasificacion automatizada y 98.2% de salud tributaria validada.
          </Typography>
        </Paper>
      </Box>

      <Box sx={{ display: "grid", placeItems: "center", p: 3, bgcolor: "background.default" }}>
        <Paper sx={{ width: "100%", maxWidth: 460, p: { xs: 3, md: 4 } }}>
          <Typography variant="h3" sx={{ mb: 0.8 }}>Iniciar sesion</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Accede al panel administrativo de ETL SaaS.
          </Typography>

          <Stack component="form" spacing={2} onSubmit={handleSubmit}>
            <TextField
              label="Correo corporativo"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="admin@empresa.com"
            />
            <TextField
              label="Contrasena"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword((prev) => !prev)} aria-label="Mostrar u ocultar contrasena" edge="end">
                      {showPassword ? <VisibilityOffRounded /> : <VisibilityRounded />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <FormControlLabel
                control={<Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)} />}
                label="Recordar sesion"
              />
              <Link href="/register">Crear cuenta</Link>
            </Box>

            {error ? <Alert severity="error">{error}</Alert> : null}

            <Button type="submit" variant="contained" size="large" disabled={loading} endIcon={loading ? <CircularProgress size={16} color="inherit" /> : <ArrowForwardRounded />}>
              {loading ? "Validando acceso" : "Ingresar al dashboard"}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
