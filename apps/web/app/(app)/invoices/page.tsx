"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import UploadFileRounded from "@mui/icons-material/UploadFileRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import VisibilityRounded from "@mui/icons-material/VisibilityRounded";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { listBatches, uploadBatch, type Batch } from "@/lib/api";

const statusColor: Record<string, "default" | "info" | "success" | "error" | "warning"> = {
  pending: "warning",
  processing: "info",
  completed: "success",
  failed: "error",
  partial: "warning",
};

export default function InvoicesPage() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await listBatches(1, 100);
      setRows(response.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo cargar lotes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      await uploadBatch(files);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo subir el lote");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  const columns = useMemo<GridColDef<Batch>[]>(() => [
    {
      field: "filename",
      headerName: "Archivo",
      flex: 1.4,
      minWidth: 240,
      renderCell: (params) => (
        <Stack>
          <Typography fontWeight={600}>{params.row.filename}</Typography>
          <Typography variant="caption" color="text.secondary">{params.row.id.slice(0, 8)}...</Typography>
        </Stack>
      ),
    },
    {
      field: "status",
      headerName: "Estado",
      width: 140,
      renderCell: (params) => <Chip label={params.value} size="small" color={statusColor[params.value] ?? "default"} />,
    },
    { field: "total_invoices", headerName: "Total", width: 110 },
    { field: "processed_invoices", headerName: "Procesadas", width: 120 },
    { field: "failed_invoices", headerName: "Errores", width: 110 },
    {
      field: "actions",
      headerName: "Acciones",
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Button
          component={Link}
          href={`/invoices/${params.row.id}`}
          size="small"
          startIcon={<VisibilityRounded fontSize="small" />}
        >
          Abrir
        </Button>
      ),
    },
  ], []);

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography variant="h2">Lotes de facturas</Typography>
          <Typography color="text.secondary">Carga masiva, seguimiento de procesamiento y entrada al flujo de clasificacion.</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshRounded />} onClick={refresh}>
            Recargar
          </Button>
          <Button variant="contained" component="label" startIcon={<UploadFileRounded />} disabled={uploading}>
            {uploading ? "Subiendo" : "Subir lote"}
            <input hidden type="file" accept=".pdf,.xml,.zip,.csv" multiple onChange={onFileChange} />
          </Button>
        </Stack>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper sx={{ minHeight: 560 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          disableRowSelectionOnClick
          pageSizeOptions={[10, 20, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 20, page: 0 } } }}
          sx={{ borderRadius: 2 }}
        />
      </Paper>
    </Stack>
  );
}
