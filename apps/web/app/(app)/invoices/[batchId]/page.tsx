"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import UploadRounded from "@mui/icons-material/UploadRounded";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useParams } from "next/navigation";
import { getBatch, listBatchInvoices, triggerExport, type Batch, type Invoice } from "@/lib/api";

const statusColor: Record<string, "default" | "info" | "success" | "error" | "warning"> = {
  raw: "default",
  parsed: "info",
  classified: "warning",
  exported: "success",
  error: "error",
};

export default function BatchDetailPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params.batchId;

  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [erp, setErp] = useState("siigo");
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setFeedback(null);
      try {
        const [batchRes, invoiceRes] = await Promise.all([
          getBatch(batchId),
          listBatchInvoices(batchId, 1, 100),
        ]);
        setBatch(batchRes);
        setRows(invoiceRes.items);
      } catch (err: unknown) {
        setFeedback(err instanceof Error ? err.message : "No se pudo cargar el lote");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [batchId]);

  async function runExport() {
    setExporting(true);
    setFeedback(null);
    try {
      const job = await triggerExport(batchId, erp);
      setFeedback(`Exportacion iniciada: ${job.id.slice(0, 12)}...`);
    } catch (err: unknown) {
      setFeedback(err instanceof Error ? err.message : "No se pudo iniciar la exportacion");
    } finally {
      setExporting(false);
    }
  }

  const columns = useMemo<GridColDef<Invoice>[]>(() => [
    { field: "invoice_number", headerName: "Factura", minWidth: 130, flex: 0.9 },
    { field: "vendor_name", headerName: "Proveedor", minWidth: 220, flex: 1.2 },
    { field: "vendor_tax_id", headerName: "NIT", minWidth: 130, flex: 0.8 },
    {
      field: "total_amount",
      headerName: "Total",
      minWidth: 120,
      renderCell: (params) =>
        params.value != null
          ? new Intl.NumberFormat("es-CO", { style: "currency", currency: params.row.currency || "COP" }).format(params.value)
          : "-",
    },
    {
      field: "status",
      headerName: "Estado",
      minWidth: 120,
      renderCell: (params) => <Chip size="small" label={params.value} color={statusColor[params.value] ?? "default"} />,
    },
  ], []);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h2">Detalle de lote</Typography>
        <Typography color="text.secondary">Control de facturas, trazabilidad de estados y exportacion ERP.</Typography>
      </Box>

      {batch ? (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card><CardContent><Typography variant="overline">Total facturas</Typography><Typography variant="h3">{batch.total_invoices}</Typography></CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card><CardContent><Typography variant="overline">Procesadas</Typography><Typography variant="h3">{batch.processed_invoices}</Typography></CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card><CardContent><Typography variant="overline">Errores</Typography><Typography variant="h3">{batch.failed_invoices}</Typography></CardContent></Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card><CardContent><Typography variant="overline">Estado</Typography><Chip sx={{ mt: 0.8 }} label={batch.status} color={statusColor[batch.status] ?? "default"} /></CardContent></Card>
          </Grid>
        </Grid>
      ) : null}

      <Paper sx={{ p: 2, display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary">ERP destino:</Typography>
        <Select size="small" value={erp} onChange={(event) => setErp(String(event.target.value))}>
          <MenuItem value="siigo">Siigo</MenuItem>
          <MenuItem value="sap">SAP B1</MenuItem>
          <MenuItem value="helisa">Helisa</MenuItem>
          <MenuItem value="world_office">World Office</MenuItem>
        </Select>
        <Button variant="contained" startIcon={<UploadRounded />} onClick={runExport} disabled={exporting || !batch || batch.status !== "completed"}>
          {exporting ? "Exportando" : "Exportar lote"}
        </Button>
        {batch?.status !== "completed" ? <Typography variant="caption" color="text.secondary">La exportacion se habilita cuando el lote este completado.</Typography> : null}
      </Paper>

      {feedback ? <Alert severity={feedback.startsWith("Exportacion") ? "success" : "error"}>{feedback}</Alert> : null}

      <Paper sx={{ minHeight: 560 }}>
        <DataGrid rows={rows} columns={columns} loading={loading} disableRowSelectionOnClick pageSizeOptions={[20, 50, 100]} />
      </Paper>
    </Stack>
  );
}
