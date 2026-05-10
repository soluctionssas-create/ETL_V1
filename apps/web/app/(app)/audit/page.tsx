"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { listBatches, type Batch } from "@/lib/api";

type AuditRow = {
  id: string;
  lote: string;
  evento: string;
  severidad: "info" | "warning" | "error";
  fecha: string;
};

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const response = await listBatches(1, 150);
        const mapped = response.items.flatMap((batch: Batch) => {
          const base = new Date().toISOString();
          return [
            {
              id: `${batch.id}-ingesta`,
              lote: batch.filename,
              evento: "Ingesta de lote",
              severidad: "info" as const,
              fecha: base,
            },
            {
              id: `${batch.id}-estado`,
              lote: batch.filename,
              evento: `Resultado ${batch.status}`,
              severidad: batch.status === "failed" ? "error" as const : "warning" as const,
              fecha: base,
            },
          ];
        });
        setRows(mapped);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "No se pudo cargar auditoria");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const columns = useMemo<GridColDef<AuditRow>[]>(() => [
    { field: "lote", headerName: "Lote", flex: 1.2, minWidth: 220 },
    { field: "evento", headerName: "Evento", flex: 1.2, minWidth: 240 },
    {
      field: "severidad",
      headerName: "Severidad",
      width: 130,
      renderCell: (params) => <Chip size="small" color={params.value === "error" ? "error" : params.value === "warning" ? "warning" : "info"} label={params.value} />,
    },
    { field: "fecha", headerName: "Fecha", width: 180 },
  ], []);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h2">Auditoria operativa</Typography>
        <Typography color="text.secondary">Registro de eventos de ingesta, procesamiento y consistencia del flujo contable.</Typography>
      </Box>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper sx={{ minHeight: 520 }}>
        <DataGrid rows={rows} columns={columns} loading={loading} pageSizeOptions={[20, 50, 100]} />
      </Paper>
    </Stack>
  );
}
