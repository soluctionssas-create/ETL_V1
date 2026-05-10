"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import SaveRounded from "@mui/icons-material/SaveRounded";

const defaultReteFuente = {
  uvt_value_cop: 52374,
  default_rule: {
    concept: "Compras generales declarantes",
    normativity: "Art. 401 ET / DUR 1625",
    base_uvt: 10,
    base_cop: 523740,
    rate: 0.025,
    account_code: "236540",
    keywords: [],
  },
  rules: [
    {
      concept: "Servicios generales",
      normativity: "Art. 401 ET / DUR 1625",
      base_uvt: 4,
      base_cop: 209496,
      rate: 0.04,
      account_code: "236525",
      keywords: ["servicio", "asesoria", "honorario", "flete"],
    },
    {
      concept: "Compras bienes declarantes",
      normativity: "Art. 401 ET / DUR 1625",
      base_uvt: 10,
      base_cop: 523740,
      rate: 0.025,
      account_code: "236540",
      keywords: ["compra", "insumo", "mercancia", "producto"],
    },
  ],
};

const defaultReteIca = {
  account_code: "23680101",
  cities: {
    CALI: {
      service: {
        account_code: "23680102",
        base_uvt: 3,
        base_cop: 157122,
        rate: 0.01,
        keywords: ["servicio"],
      },
      purchase: {
        account_code: "23680101",
        base_uvt: 15,
        base_cop: 785610,
        rate: 0.0077,
        keywords: ["compra"],
      },
    },
  },
};

const defaultReteIva = {
  account_code: "236701",
  fallback_rate: 0.15,
  legal_reference: "Art. 437-1 ET / Decreto 380/1996",
  apply_when: {
    missing_or_zero_reteiva: true,
    iva_greater_than_zero: true,
  },
};

export default function ParametrizacionPage() {
  const [tab, setTab] = useState(0);
  const [retefuente, setRetefuente] = useState(JSON.stringify(defaultReteFuente, null, 2));
  const [reteica, setReteica] = useState(JSON.stringify(defaultReteIca, null, 2));
  const [reteiva, setReteiva] = useState(JSON.stringify(defaultReteIva, null, 2));
  const [message, setMessage] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const validation = useMemo(() => {
    try {
      JSON.parse(retefuente);
      JSON.parse(reteica);
      JSON.parse(reteiva);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : "JSON invalido" };
    }
  }, [retefuente, reteica, reteiva]);

  useEffect(() => {
    async function loadTaxConfig() {
      setLoadingConfig(true);
      try {
        const response = await fetch("/api/v1/config/tax", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`No fue posible cargar la configuracion (${response.status})`);
        }

        const data = (await response.json()) as {
          retefuente?: unknown;
          reteica?: unknown;
          reteiva?: unknown;
        };

        if (data.retefuente) {
          setRetefuente(JSON.stringify(data.retefuente, null, 2));
        }
        if (data.reteica) {
          setReteica(JSON.stringify(data.reteica, null, 2));
        }
        if (data.reteiva) {
          setReteiva(JSON.stringify(data.reteiva, null, 2));
        }
      } catch {
        setMessage("Se usaron valores locales por defecto porque no se pudo leer la configuracion del proyecto.");
      } finally {
        setLoadingConfig(false);
      }
    }

    void loadTaxConfig();
  }, []);

  async function saveLocal() {
    if (!validation.ok) {
      setMessage("No se guardo: hay errores de sintaxis JSON.");
      return;
    }

    try {
      const response = await fetch("/api/v1/config/tax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retefuente: JSON.parse(retefuente),
          reteica: JSON.parse(reteica),
          reteiva: JSON.parse(reteiva),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail ?? `Error ${response.status}`);
      }

      localStorage.setItem("param_retefuente", retefuente);
      localStorage.setItem("param_reteica", reteica);
      localStorage.setItem("param_reteiva", reteiva);
      setMessage("Parametrizacion fiscal aplicada al proyecto y guardada localmente.");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "No fue posible guardar la configuracion fiscal.");
    }
  }

  function formatActiveJson() {
    try {
      if (tab === 0) {
        setRetefuente(JSON.stringify(JSON.parse(retefuente), null, 2));
      } else if (tab === 1) {
        setReteica(JSON.stringify(JSON.parse(reteica), null, 2));
      } else {
        setReteiva(JSON.stringify(JSON.parse(reteiva), null, 2));
      }
      setMessage("JSON formateado correctamente.");
    } catch {
      setMessage("No se pudo formatear: el JSON activo tiene errores.");
    }
  }

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Box>
          <Typography variant="h2">Parametrizacion avanzada</Typography>
          <Typography color="text.secondary">Panel tecnico para reglas contables, impuestos y configuracion operativa.</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="outlined" color="inherit" onClick={formatActiveJson}>Formatear JSON</Button>
          <Button variant="contained" startIcon={<SaveRounded />} onClick={saveLocal}>Guardar cambios</Button>
        </Box>
      </Box>

      <Paper sx={{ p: 1 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)}>
          <Tab label="ReteFuente" />
          <Tab label="ReteICA" />
          <Tab label="ReteIVA" />
        </Tabs>
      </Paper>

      {loadingConfig ? <Alert severity="info">Cargando configuracion fiscal del proyecto...</Alert> : null}

      {tab === 0 ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h4" sx={{ mb: 1 }}>Reglas retefuente</Typography>
          <TextField
            multiline
            minRows={20}
            fullWidth
            value={retefuente}
            onChange={(event) => setRetefuente(event.target.value)}
            error={!validation.ok}
            helperText={!validation.ok ? validation.message : "JSON valido"}
            sx={{
              "& .MuiInputBase-inputMultiline": {
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre",
                tabSize: 2,
              },
            }}
          />
        </Paper>
      ) : null}

      {tab === 1 ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h4" sx={{ mb: 1 }}>Reglas reteica por ciudad</Typography>
          <TextField
            multiline
            minRows={20}
            fullWidth
            value={reteica}
            onChange={(event) => setReteica(event.target.value)}
            error={!validation.ok}
            helperText={!validation.ok ? validation.message : "JSON valido"}
            sx={{
              "& .MuiInputBase-inputMultiline": {
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre",
                tabSize: 2,
              },
            }}
          />
        </Paper>
      ) : null}

      {tab === 2 ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h4" sx={{ mb: 1 }}>Configuracion reteiva</Typography>
          <TextField
            multiline
            minRows={16}
            fullWidth
            value={reteiva}
            onChange={(event) => setReteiva(event.target.value)}
            error={!validation.ok}
            helperText={!validation.ok ? validation.message : "JSON valido"}
            sx={{
              "& .MuiInputBase-inputMultiline": {
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre",
                tabSize: 2,
              },
            }}
          />
        </Paper>
      ) : null}

      {message ? <Alert severity={message.includes("aplicada") ? "success" : "warning"}>{message}</Alert> : null}
    </Stack>
  );
}
