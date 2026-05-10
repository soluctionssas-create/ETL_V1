"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Card, CardContent, Grid, LinearProgress, Skeleton, Stack, Typography } from "@mui/material";
import TrendingUpRounded from "@mui/icons-material/TrendingUpRounded";
import VerifiedRounded from "@mui/icons-material/VerifiedRounded";
import BoltRounded from "@mui/icons-material/BoltRounded";
import AlarmOnRounded from "@mui/icons-material/AlarmOnRounded";
import { listBatches, type Batch } from "@/lib/api";

type KPI = {
  label: string;
  value: string;
  helper: string;
  progress: number;
  icon: React.ReactNode;
};

export default function DashboardPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await listBatches(1, 100);
        setBatches(data.items);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const kpis = useMemo<KPI[]>(() => {
    const total = batches.length;
    const done = batches.filter((batch) => batch.status === "completed").length;
    const failed = batches.filter((batch) => batch.status === "failed").length;
    const invoices = batches.reduce((acc, batch) => acc + batch.total_invoices, 0);
    const processed = batches.reduce((acc, batch) => acc + batch.processed_invoices, 0);

    const automation = invoices > 0 ? Math.round((processed / invoices) * 100) : 0;
    const health = total > 0 ? Math.round(((total - failed) / total) * 100) : 100;

    return [
      {
        label: "Tiempo Ahorrado",
        value: `${Math.max(12, done * 3.2).toFixed(1)} h`,
        helper: "Comparado con proceso manual",
        progress: Math.min(100, done * 8),
        icon: <TrendingUpRounded color="primary" />,
      },
      {
        label: "Salud Tributaria",
        value: `${health}%`,
        helper: "Lotes sin incidencias criticas",
        progress: health,
        icon: <VerifiedRounded color="success" />,
      },
      {
        label: "Automatizacion",
        value: `${automation}%`,
        helper: "Items procesados sin intervencion",
        progress: automation,
        icon: <BoltRounded color="secondary" />,
      },
      {
        label: "Riesgo Operativo",
        value: `${failed}`,
        helper: "Lotes pendientes de correccion",
        progress: total > 0 ? Math.round((failed / total) * 100) : 0,
        icon: <AlarmOnRounded color="warning" />,
      },
    ];
  }, [batches]);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h2">Dashboard ROI</Typography>
        <Typography color="text.secondary">Visibilidad financiera, estado operativo y calidad de clasificacion por tenant.</Typography>
      </Box>

      <Grid container spacing={2}>
        {kpis.map((item) => (
          <Grid key={item.label} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Card>
              <CardContent>
                <Stack spacing={1.1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" color="text.secondary">{item.label}</Typography>
                    {item.icon}
                  </Stack>
                  {loading ? <Skeleton width={90} height={42} /> : <Typography variant="h3">{item.value}</Typography>}
                  <Typography variant="caption" color="text.secondary">{item.helper}</Typography>
                  <LinearProgress variant="determinate" value={item.progress} sx={{ height: 8, borderRadius: 99 }} />
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h4" sx={{ mb: 1 }}>Pipeline de lotes</Typography>
          {loading ? (
            <Stack spacing={1.4}>
              <Skeleton height={16} />
              <Skeleton height={16} />
              <Skeleton height={16} />
            </Stack>
          ) : (
            <Stack spacing={1.4}>
              {batches.slice(0, 8).map((batch) => (
                <Box key={batch.id}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2">{batch.filename}</Typography>
                    <Typography variant="caption" color="text.secondary">{batch.status}</Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={batch.total_invoices > 0 ? (batch.processed_invoices / batch.total_invoices) * 100 : 0}
                    sx={{ mt: 0.6, height: 6, borderRadius: 99 }}
                  />
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
