"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import { register } from "@/lib/api";

const steps = ["Empresa", "Administrador", "Credenciales"];

export default function RegisterPage() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canContinue = useMemo(() => {
    if (activeStep === 0) return tenantName.trim().length > 2 && tenantSlug.trim().length > 2;
    if (activeStep === 1) return fullName.trim().length > 2 && email.includes("@");
    return password.length >= 8;
  }, [activeStep, email, fullName, password, tenantName, tenantSlug]);

  async function handleFinish() {
    setError(null);
    setLoading(true);
    try {
      await register({
        tenant_name: tenantName,
        tenant_slug: tenantSlug.toLowerCase(),
        full_name: fullName,
        email,
        password,
      });
      router.push("/login");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo completar el registro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
      <Paper sx={{ width: "100%", maxWidth: 720, p: { xs: 3, md: 4 } }}>
        <Typography variant="h3">Crear workspace enterprise</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.8, mb: 3 }}>
          Configura tu tenant y habilita el entorno contable multiusuario.
        </Typography>

        <Stack spacing={1.1} sx={{ mb: 3.5 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
            {steps.map((label, index) => (
              <Typography
                key={label}
                variant="caption"
                sx={{
                  px: 1,
                  py: 0.4,
                  borderRadius: 999,
                  bgcolor: index <= activeStep ? "primary.main" : "action.hover",
                  color: index <= activeStep ? "primary.contrastText" : "text.secondary",
                  fontWeight: 700,
                }}
              >
                {label}
              </Typography>
            ))}
          </Box>
          <LinearProgress variant="determinate" value={((activeStep + 1) / steps.length) * 100} sx={{ height: 8, borderRadius: 99 }} />
        </Stack>

        <Stack spacing={2.2}>
          {activeStep === 0 ? (
            <>
              <TextField label="Razon social" value={tenantName} onChange={(event) => setTenantName(event.target.value)} required />
              <TextField
                label="Slug del tenant"
                helperText="Solo minusculas, numeros y guion. Ejemplo: empresa-abc"
                value={tenantSlug}
                onChange={(event) => setTenantSlug(event.target.value.replace(/[^a-z0-9-]/g, ""))}
                required
              />
            </>
          ) : null}

          {activeStep === 1 ? (
            <>
              <TextField label="Nombre completo del administrador" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
              <TextField label="Correo del administrador" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </>
          ) : null}

          {activeStep === 2 ? (
            <>
              <TextField
                label="Contrasena"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                helperText="Minimo 8 caracteres, 1 mayuscula y 1 numero."
                required
              />
              <Alert icon={<CheckCircleRounded />} severity="info">
                Al finalizar, seras redirigido al login para iniciar sesion con tu nueva cuenta.
              </Alert>
            </>
          ) : null}

          {error ? <Alert severity="error">{error}</Alert> : null}

          <Box sx={{ display: "flex", justifyContent: "space-between", pt: 1 }}>
            <Button component={Link} href="/login" startIcon={<ArrowBackRounded />}>Volver al login</Button>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button disabled={activeStep === 0} onClick={() => setActiveStep((prev) => prev - 1)}>
                Anterior
              </Button>
              {activeStep < steps.length - 1 ? (
                <Button variant="contained" endIcon={<ArrowForwardRounded />} disabled={!canContinue} onClick={() => setActiveStep((prev) => prev + 1)}>
                  Continuar
                </Button>
              ) : (
                <Button variant="contained" disabled={!canContinue || loading} onClick={handleFinish}>
                  {loading ? "Creando workspace" : "Finalizar registro"}
                </Button>
              )}
            </Box>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
