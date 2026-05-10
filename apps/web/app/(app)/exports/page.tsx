"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { listBatches, type Batch } from "@/lib/api";

export default function ExportsPage() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const response = await listBatches(1, 100);
        setRows(response.items.filter((item) => item.status === "completed"));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "No se pudo cargar exportaciones");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const columns = useMemo<GridColDef<Batch>[]>(() => [
    { field: "filename", headerName: "Lote", flex: 1.2, minWidth: 220 },
    { field: "processed_invoices", headerName: "Registros listos", width: 150 },
    {
      field: "status",
      headerName: "Estado",
      width: 140,
      renderCell: (params) => <Chip label={params.value} size="small" color="success" />,
    },
  ], []);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h2">Exportaciones ERP</Typography>
        <Typography color="text.secondary">Lotes completados y listos para envio a sistemas contables externos.</Typography>
      </Box>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper sx={{ minHeight: 520 }}>
        <DataGrid rows={rows} columns={columns} loading={loading} pageSizeOptions={[10, 20, 50, 100]} />
      </Paper>
    </Stack>
  );
}
