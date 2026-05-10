"use client";

import { useMemo, useState } from "react";
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
    base_uvt: 10,
    rate: 0.025,
    account_code: "236540",
  },
  rules: [],
};

const defaultAccounting = {
  default_uvt_value_cop: 52374,
  iva_treatment: "separado",
  default_payable_expense_account_code: "23359501",
  default_payable_cost_account_code: "22050101",
};

export default function ParametrizacionPage() {
  const [tab, setTab] = useState(0);
  const [retefuente, setRetefuente] = useState(JSON.stringify(defaultReteFuente, null, 2));
  const [accounting, setAccounting] = useState(JSON.stringify(defaultAccounting, null, 2));
  const [message, setMessage] = useState<string | null>(null);

  const validation = useMemo(() => {
    try {
      JSON.parse(retefuente);
      JSON.parse(accounting);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : "JSON invalido" };
    }
  }, [accounting, retefuente]);

  function saveLocal() {
    if (!validation.ok) {
      setMessage("No se guardo: hay errores de sintaxis JSON.");
      return;
    }
    localStorage.setItem("param_retefuente", retefuente);
    localStorage.setItem("param_accounting", accounting);
    setMessage("Parametrizacion guardada localmente en el navegador.");
  }

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Box>
          <Typography variant="h2">Parametrizacion avanzada</Typography>
          <Typography color="text.secondary">Panel tecnico para reglas contables, impuestos y configuracion operativa.</Typography>
        </Box>
        <Button variant="contained" startIcon={<SaveRounded />} onClick={saveLocal}>Guardar cambios</Button>
      </Box>

      <Paper sx={{ p: 1 }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)}>
          <Tab label="ReteFuente" />
          <Tab label="Contabilidad" />
        </Tabs>
      </Paper>

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
          />
        </Paper>
      ) : null}

      {tab === 1 ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h4" sx={{ mb: 1 }}>Preferencias contables</Typography>
          <TextField
            multiline
            minRows={20}
            fullWidth
            value={accounting}
            onChange={(event) => setAccounting(event.target.value)}
            error={!validation.ok}
            helperText={!validation.ok ? validation.message : "JSON valido"}
          />
        </Paper>
      ) : null}

      {message ? <Alert severity={message.startsWith("Parametrizacion") ? "success" : "error"}>{message}</Alert> : null}
    </Stack>
  );
}
