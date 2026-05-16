"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Drawer,
  Chip,
  Grid,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import UploadRounded from "@mui/icons-material/UploadRounded";
import VisibilityRounded from "@mui/icons-material/VisibilityRounded";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { useParams } from "next/navigation";
import { getBatch, listBatchInvoices, triggerExport, type Batch, type Invoice, type InvoiceItem } from "@/lib/api";

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
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

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
    {
      field: "actions",
      headerName: "Abrir",
      width: 120,
      sortable: false,
      renderCell: (params) => (
        <Button size="small" startIcon={<VisibilityRounded fontSize="small" />} onClick={() => setSelectedInvoice(params.row)}>
          Abrir
        </Button>
      ),
    },
  ], []);

  function formatDate(value: string | null | undefined): string {
    if (!value) return "-";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString("es-CO");
  }

  function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
    if (value == null) return "-";
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 2,
    }).format(value);
  }

  const detailRows: Array<{ label: string; value: string }> = selectedInvoice
    ? [
        { label: "Tipo de documento", value: selectedInvoice.doc_tipo_operacion ?? selectedInvoice.document_type ?? "-" },
        { label: "CUFE/CUDE", value: selectedInvoice.cufe_cude ?? "-" },
        { label: "Numero de factura", value: selectedInvoice.doc_numero_factura ?? selectedInvoice.folio ?? selectedInvoice.invoice_number ?? "-" },
        { label: "Prefijo", value: selectedInvoice.prefix ?? "-" },
        { label: "Divisa", value: selectedInvoice.currency ?? "-" },
        { label: "Forma de pago", value: selectedInvoice.doc_forma_pago ?? selectedInvoice.payment_form ?? "-" },
        { label: "Medio de pago", value: selectedInvoice.doc_medio_pago ?? selectedInvoice.payment_method ?? "-" },
        { label: "Fecha emision", value: formatDate(selectedInvoice.doc_fecha_emision ?? selectedInvoice.issue_date) },
        { label: "Fecha vencimiento", value: formatDate(selectedInvoice.doc_fecha_vencimiento) },
        { label: "Fecha Recepcion", value: formatDate(selectedInvoice.reception_date) },
        { label: "NIT emisor", value: selectedInvoice.emisor_nit ?? selectedInvoice.vendor_tax_id ?? "-" },
        { label: "Nombre emisor", value: selectedInvoice.emisor_razon_social ?? selectedInvoice.vendor_name ?? "-" },
        { label: "NIT adquiriente", value: selectedInvoice.adquiriente_numero_documento ?? selectedInvoice.receiver_tax_id ?? "-" },
        { label: "Nombre adquiriente", value: selectedInvoice.adquiriente_nombre_razon_social ?? selectedInvoice.receiver_name ?? "-" },
        { label: "IVA", value: formatMoney(selectedInvoice.iva, selectedInvoice.currency) },
        { label: "ICA", value: formatMoney(selectedInvoice.ica, selectedInvoice.currency) },
        { label: "IC", value: formatMoney(selectedInvoice.ic, selectedInvoice.currency) },
        { label: "INC", value: formatMoney(selectedInvoice.inc, selectedInvoice.currency) },
        { label: "Timbre", value: formatMoney(selectedInvoice.timbre, selectedInvoice.currency) },
        { label: "INC Bolsas", value: formatMoney(selectedInvoice.inc_bolsas, selectedInvoice.currency) },
        { label: "IN Carbono", value: formatMoney(selectedInvoice.in_carbono, selectedInvoice.currency) },
        { label: "IN Combustibles", value: formatMoney(selectedInvoice.in_combustibles, selectedInvoice.currency) },
        { label: "IC Datos", value: formatMoney(selectedInvoice.ic_datos, selectedInvoice.currency) },
        { label: "ICL", value: formatMoney(selectedInvoice.icl, selectedInvoice.currency) },
        { label: "INPP", value: formatMoney(selectedInvoice.inpp, selectedInvoice.currency) },
        { label: "IBUA", value: formatMoney(selectedInvoice.ibua, selectedInvoice.currency) },
        { label: "ICUI", value: formatMoney(selectedInvoice.icui, selectedInvoice.currency) },
        { label: "Rete IVA", value: formatMoney(selectedInvoice.tot_rete_iva ?? selectedInvoice.rete_iva, selectedInvoice.currency) },
        { label: "Rete Fuente", value: formatMoney(selectedInvoice.tot_rete_fuente ?? selectedInvoice.rete_renta, selectedInvoice.currency) },
        { label: "Rete ICA", value: formatMoney(selectedInvoice.tot_rete_ica ?? selectedInvoice.rete_ica, selectedInvoice.currency) },
        { label: "Total factura", value: formatMoney(selectedInvoice.tot_total_factura ?? selectedInvoice.total_amount, selectedInvoice.currency) },
        { label: "Estado", value: selectedInvoice.status ?? "-" },
        { label: "Grupo", value: selectedInvoice.group_name ?? "-" },
      ]
    : [];

  const selectedInvoiceItems: InvoiceItem[] = selectedInvoice
    ? (selectedInvoice.items && selectedInvoice.items.length > 0
        ? selectedInvoice.items
        : [
            {
              line_number: selectedInvoice.detalle_nro ?? "1",
              item_code: selectedInvoice.detalle_codigo ?? selectedInvoice.item_code,
              item_description: selectedInvoice.detalle_descripcion ?? selectedInvoice.item_description,
              quantity: selectedInvoice.detalle_cantidad ?? selectedInvoice.quantity,
              unit_price: selectedInvoice.detalle_precio_unitario ?? selectedInvoice.unit_price,
              tax_iva: selectedInvoice.detalle_impuesto_iva,
              sale_unit_price: selectedInvoice.detalle_precio_unitario_venta,
            },
          ])
    : [];

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

      <Drawer anchor="right" open={Boolean(selectedInvoice)} onClose={() => setSelectedInvoice(null)}>
        <Box sx={{ width: { xs: 360, sm: 540 }, p: 2.5 }}>
          <Typography variant="h4">Detalle de factura</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selectedInvoice?.invoice_number ?? "Sin numero"}
          </Typography>

          <Stack spacing={1}>
            {detailRows.map((row) => (
              <Box key={row.label} sx={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 1 }}>
                <Typography variant="caption" color="text.secondary">{row.label}</Typography>
                <Typography variant="body2">{row.value}</Typography>
              </Box>
            ))}
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Items ({selectedInvoiceItems.length})</Typography>
          <Paper variant="outlined" sx={{ overflow: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Codigo</TableCell>
                  <TableCell>Descripcion</TableCell>
                  <TableCell align="right">Cantidad</TableCell>
                  <TableCell align="right">Precio unitario</TableCell>
                  <TableCell align="right">IVA</TableCell>
                  <TableCell align="right">Precio venta</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {selectedInvoiceItems.map((item, index) => (
                  <TableRow key={`${item.line_number ?? index}-${item.item_code ?? "item"}`}>
                    <TableCell>{item.line_number ?? index + 1}</TableCell>
                    <TableCell>{item.item_code ?? "-"}</TableCell>
                    <TableCell>{item.item_description ?? "-"}</TableCell>
                    <TableCell align="right">{item.quantity != null ? String(item.quantity) : "-"}</TableCell>
                    <TableCell align="right">{formatMoney(item.unit_price, selectedInvoice?.currency)}</TableCell>
                    <TableCell align="right">{formatMoney(item.tax_iva, selectedInvoice?.currency)}</TableCell>
                    <TableCell align="right">{formatMoney(item.sale_unit_price, selectedInvoice?.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">Raw JSON de respaldo</Typography>
          <TextField
            multiline
            minRows={10}
            fullWidth
            value={JSON.stringify(selectedInvoice?.raw_data ?? {}, null, 2)}
            slotProps={{ input: { readOnly: true } }}
            sx={{
              mt: 1,
              "& .MuiInputBase-inputMultiline": {
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: 12,
              },
            }}
          />
        </Box>
      </Drawer>
    </Stack>
  );
}
