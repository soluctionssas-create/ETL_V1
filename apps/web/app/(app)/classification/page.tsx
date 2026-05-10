"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import SaveRounded from "@mui/icons-material/SaveRounded";
import { DataGrid, GridColDef, GridRowParams } from "@mui/x-data-grid";
import { listBatches, listBatchInvoices, type Batch, type Invoice } from "@/lib/api";

type ClassificationDraft = {
  costAccount: string;
  expenseAccount: string;
  taxAccount: string;
  note: string;
};

const defaultDraft: ClassificationDraft = {
  costAccount: "143505",
  expenseAccount: "513595",
  taxAccount: "240805",
  note: "",
};

export default function ClassificationPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState("");
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ClassificationDraft>>({});

  useEffect(() => {
    async function bootstrap() {
      setLoading(true);
      try {
        const response = await listBatches(1, 100, "completed");
        setBatches(response.items);
        if (response.items[0]) {
          setBatchId(response.items[0].id);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "No se pudo cargar lotes completados");
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (!batchId) return;
    async function loadInvoices() {
      setLoading(true);
      try {
        const invoiceResponse = await listBatchInvoices(batchId, 1, 400);
        setRows(invoiceResponse.items);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "No se pudo cargar facturas para clasificacion");
      } finally {
        setLoading(false);
      }
    }
    loadInvoices();
  }, [batchId]);

  const columns = useMemo<GridColDef<Invoice>[]>(() => [
    { field: "invoice_number", headerName: "Factura", minWidth: 130, flex: 0.75 },
    { field: "vendor_name", headerName: "Proveedor", minWidth: 220, flex: 1 },
    { field: "vendor_tax_id", headerName: "NIT", minWidth: 130, flex: 0.7 },
    {
      field: "total_amount",
      headerName: "Valor",
      minWidth: 120,
      renderCell: (params) =>
        params.value != null
          ? new Intl.NumberFormat("es-CO", { style: "currency", currency: params.row.currency || "COP" }).format(params.value)
          : "-",
    },
    {
      field: "ia",
      headerName: "Clasificacion IA",
      minWidth: 170,
      sortable: false,
      renderCell: (params) => {
        const current = drafts[params.row.id] ?? defaultDraft;
        const confidence = params.row.total_amount && params.row.total_amount > 4000000 ? "Alta" : "Media";
        return <Chip icon={<AutoAwesomeRounded />} label={`${current.costAccount} · ${confidence}`} color="info" size="small" />;
      },
    },
  ], [drafts]);

  function openDrawer(params: GridRowParams<Invoice>) {
    setSelectedInvoice(params.row);
    setDrawerOpen(true);
  }

  function currentDraft() {
    if (!selectedInvoice) return defaultDraft;
    return drafts[selectedInvoice.id] ?? defaultDraft;
  }

  function updateDraft(field: keyof ClassificationDraft, value: string) {
    if (!selectedInvoice) return;
    setDrafts((prev) => ({
      ...prev,
      [selectedInvoice.id]: {
        ...(prev[selectedInvoice.id] ?? defaultDraft),
        [field]: value,
      },
    }));
  }

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Box>
          <Typography variant="h2">Clasificacion contable</Typography>
          <Typography color="text.secondary">Revision asistida de cuentas costo/gasto/impuesto por factura.</Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 320 }}>
          <InputLabel id="batch-select-label">Lote para clasificar</InputLabel>
          <Select
            labelId="batch-select-label"
            label="Lote para clasificar"
            value={batchId}
            onChange={(event) => setBatchId(String(event.target.value))}
          >
            {batches.map((batch) => (
              <MenuItem key={batch.id} value={batch.id}>{batch.filename}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper sx={{ minHeight: 560 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          disableRowSelectionOnClick
          onRowClick={openDrawer}
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
        />
      </Paper>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: 330, sm: 420 }, p: 2.5 }}>
          <Typography variant="h4">Edicion de clasificacion</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selectedInvoice?.invoice_number} · {selectedInvoice?.vendor_name}
          </Typography>

          <Stack spacing={1.5}>
            <TextField
              label="Cuenta costo"
              value={currentDraft().costAccount}
              onChange={(event) => updateDraft("costAccount", event.target.value)}
            />
            <TextField
              label="Cuenta gasto"
              value={currentDraft().expenseAccount}
              onChange={(event) => updateDraft("expenseAccount", event.target.value)}
            />
            <TextField
              label="Cuenta impuesto"
              value={currentDraft().taxAccount}
              onChange={(event) => updateDraft("taxAccount", event.target.value)}
            />
            <TextField
              label="Nota de auditoria"
              multiline
              minRows={4}
              value={currentDraft().note}
              onChange={(event) => updateDraft("note", event.target.value)}
            />
            <Button variant="contained" startIcon={<SaveRounded />} onClick={() => setDrawerOpen(false)}>
              Guardar clasificacion
            </Button>
          </Stack>
        </Box>
      </Drawer>
    </Stack>
  );
}
