"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Drawer,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import SaveRounded from "@mui/icons-material/SaveRounded";
import WarningRounded from "@mui/icons-material/WarningRounded";
import {
  DataGrid,
  GridColDef,
  GridRowClassNameParams,
  GridRowParams,
} from "@mui/x-data-grid";
import {
  listBatches,
  listTaxCalculations,
  reclassifyInvoice,
  type Batch,
  type ReclassifyInvoicePayload,
  type TaxCalculation,
  type TaxCalculationListParams,
} from "@/lib/api";
import {
  accountDisplay,
  defaultDraft,
  draftFromCalc,
  EditDraft,
  fmtCOP,
  rowStatus,
} from "@/lib/classification/helpers";


// ─────────────────────────────────────────────────────────────────────────────

export default function ClassificationPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState("");
  const [rows, setRows] = useState<TaxCalculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const rowSelectionModel = useMemo(
    () => ({ type: "include" as const, ids: new Set(selectedIds) }),
    [selectedIds],
  );

  // filters (applied on button click or batch change)
  const [filterText, setFilterText] = useState("");
  const [filterReview, setFilterReview] = useState<boolean | null>(null);
  // stable ref so event-handler callbacks always read current filter values
  const filterRef = useRef({ filterText, filterReview });
  filterRef.current = { filterText, filterReview };

  // drawer
  const [selectedCalc, setSelectedCalc] = useState<TaxCalculation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(defaultDraft);
  const [linesExpanded, setLinesExpanded] = useState(false);

  // save state
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // bulk state
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  // ── data loading ───────────────────────────────────────────────────────────

  async function loadCalcs(bid: string) {
    setLoading(true);
    setError(null);
    const { filterText: txt, filterReview: rev } = filterRef.current;
    const params: TaxCalculationListParams = { limit: 200, offset: 0 };
    if (rev !== null) params.requiresReview = rev;
    if (txt.trim()) params.name = txt.trim();
    try {
      const resp = await listTaxCalculations(bid, params);
      setRows(resp.items);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error cargando cálculos tributarios",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function bootstrap() {
      setLoading(true);
      try {
        const resp = await listBatches(1, 100, "completed");
        setBatches(resp.items);
        if (resp.items[0]) setBatchId(resp.items[0].id);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "No se pudo cargar lotes completados",
        );
        setLoading(false);
      }
    }
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!batchId) return;
    void loadCalcs(batchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  // ── columns ────────────────────────────────────────────────────────────────

  const columns = useMemo<GridColDef<TaxCalculation>[]>(
    () => [
      { field: "invoice_number", headerName: "Factura", minWidth: 140, flex: 0.8 },
      { field: "supplier_name", headerName: "Proveedor", minWidth: 200, flex: 1.2 },
      { field: "supplier_nit", headerName: "NIT", minWidth: 120, flex: 0.7 },
      {
        field: "subtotal",
        headerName: "Subtotal",
        minWidth: 120,
        renderCell: (p) => fmtCOP(p.value as number | null),
      },
      {
        field: "iva_total",
        headerName: "IVA",
        minWidth: 110,
        renderCell: (p) => fmtCOP(p.value as number | null),
      },
      {
        field: "total_invoice",
        headerName: "Total",
        minWidth: 130,
        renderCell: (p) => fmtCOP(p.value as number | null),
      },
      {
        field: "_account",
        headerName: "Cuenta IA",
        minWidth: 150,
        sortable: false,
        renderCell: (p) => {
          const mc = p.row.result_json?.manual_classification;
          return (
            <Chip
              icon={mc?.account_code ? <CheckCircleRounded /> : <AutoAwesomeRounded />}
              label={accountDisplay(p.row)}
              color={mc?.account_code ? "success" : "info"}
              size="small"
            />
          );
        },
      },
      {
        field: "retefuente_calculated",
        headerName: "ReteFuente",
        minWidth: 130,
        renderCell: (p) => {
          const val = p.value as number | null;
          const diff = p.row.retefuente_difference ?? 0;
          if (val == null)
            return (
              <Chip label="No aplica" size="small" color="default" variant="outlined" />
            );
          return (
            <Tooltip
              title={
                Math.abs(diff) > 1
                  ? `Diferencia reportado vs calculado: ${fmtCOP(diff)}`
                  : "Sin diferencia"
              }
            >
              <Chip
                label={fmtCOP(val)}
                size="small"
                color={Math.abs(diff) > 1 ? "error" : "default"}
              />
            </Tooltip>
          );
        },
      },
      {
        field: "reteica_calculated",
        headerName: "ReteICA",
        minWidth: 130,
        renderCell: (p) => {
          const val = p.value as number | null;
          const diff = p.row.reteica_difference ?? 0;
          if (val == null)
            return (
              <Chip label="No aplica" size="small" color="default" variant="outlined" />
            );
          return (
            <Tooltip
              title={
                Math.abs(diff) > 1 ? `Diferencia: ${fmtCOP(diff)}` : "Sin diferencia"
              }
            >
              <Chip
                label={fmtCOP(val)}
                size="small"
                color={Math.abs(diff) > 1 ? "error" : "default"}
              />
            </Tooltip>
          );
        },
      },
      {
        field: "reteiva_calculated",
        headerName: "ReteIVA",
        minWidth: 130,
        renderCell: (p) => {
          const val = p.value as number | null;
          if (val == null)
            return (
              <Chip label="No aplica" size="small" color="default" variant="outlined" />
            );
          return <Chip label={fmtCOP(val)} size="small" />;
        },
      },
      {
        field: "requires_review",
        headerName: "Estado",
        minWidth: 130,
        sortable: false,
        renderCell: (p) => {
          const s = rowStatus(p.row);
          if (s === "error")
            return (
              <Chip
                icon={<WarningRounded />}
                label="Diferencia"
                color="error"
                size="small"
              />
            );
          if (s === "warning")
            return (
              <Chip
                icon={<WarningRounded />}
                label="Revisar"
                color="warning"
                size="small"
              />
            );
          return (
            <Chip icon={<CheckCircleRounded />} label="OK" color="success" size="small" />
          );
        },
      },
    ],
    [],
  );

  // ── row coloring ───────────────────────────────────────────────────────────

  function getRowClassName(p: GridRowClassNameParams<TaxCalculation>) {
    const s = rowStatus(p.row);
    if (s === "error") return "row-error";
    if (s === "warning") return "row-warning";
    return "";
  }

  // ── drawer ─────────────────────────────────────────────────────────────────

  function openDrawer(p: GridRowParams<TaxCalculation>) {
    setSelectedCalc(p.row);
    setDraft(draftFromCalc(p.row));
    setLinesExpanded(false);
    setSaveMessage(null);
    setSaveError(null);
    setDrawerOpen(true);
  }

  // ── save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedCalc?.invoice_number) {
      setSaveError("Factura sin número — no se puede reclasificar");
      return;
    }
    if (draft.reason.trim().length < 8) {
      setSaveError("La nota de auditoría debe tener al menos 8 caracteres");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload: ReclassifyInvoicePayload = {
        reason: draft.reason.trim(),
        mark_as_reviewed: draft.mark_as_reviewed,
      };
      if (draft.cost_or_expense !== "unknown")
        payload.cost_or_expense = draft.cost_or_expense;
      if (draft.account_code) payload.account_code = draft.account_code;
      if (draft.payable_account_code)
        payload.payable_account_code = draft.payable_account_code;
      if (draft.retefuente_concept)
        payload.retefuente_concept = draft.retefuente_concept;
      if (draft.reteica_city) payload.reteica_city = draft.reteica_city;
      if (draft.reteica_kind) payload.reteica_kind = draft.reteica_kind;

      const result = await reclassifyInvoice(selectedCalc.invoice_number, payload);
      setSaveMessage(
        `Guardado. Auditoría: ${result.audit_rows_created} fila(s). ` +
          `Memoria: ${result.memory_updated ? "actualizada" : "sin cambios"}.`,
      );
      await loadCalcs(batchId);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ── bulk confirm ───────────────────────────────────────────────────────────

  async function handleBulkConfirm() {
    if (!selectedIds.length) return;
    setBulkRunning(true);
    setBulkProgress(0);
    setBulkMessage(null);
    let done = 0;
    let errors = 0;
    for (const id of selectedIds) {
      const calc = rows.find((r) => r.id === id);
      if (!calc?.invoice_number) {
        errors++;
        done++;
        setBulkProgress(Math.round((done / selectedIds.length) * 100));
        continue;
      }
      try {
        await reclassifyInvoice(calc.invoice_number, {
          mark_as_reviewed: true,
          reason: "Clasificacion IA confirmada en bulk — sin modificar cuentas",
        });
      } catch {
        errors++;
      }
      done++;
      setBulkProgress(Math.round((done / selectedIds.length) * 100));
    }
    await loadCalcs(batchId);
    setBulkMessage(`Procesadas ${done} factura(s). Errores: ${errors}.`);
    setBulkRunning(false);
    setSelectedIds([]);
  }

  // ── stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = rows.length;
    const review = rows.filter((r) => r.requires_review).length;
    const withErrors = rows.filter((r) => rowStatus(r) === "error").length;
    return { total, review, withErrors };
  }, [rows]);

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <Stack spacing={2}>
      {/* Header */}
      <Box
        sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}
      >
        <Box>
          <Typography variant="h2">Clasificación contable</Typography>
          <Typography color="text.secondary">
            Revisión asistida tributaria y contable · ReteFuente · ReteICA · ReteIVA
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 320 }}>
          <InputLabel id="batch-select-label">Lote para clasificar</InputLabel>
          <Select
            labelId="batch-select-label"
            label="Lote para clasificar"
            value={batchId}
            onChange={(e) => setBatchId(String(e.target.value))}
          >
            {batches.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.filename}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Stats */}
      <Stack direction="row" spacing={1} flexWrap="wrap">
        <Chip label={`${stats.total} facturas`} size="small" />
        <Chip
          label={`${stats.review} requieren revisión`}
          size="small"
          color={stats.review > 0 ? "warning" : "default"}
        />
        <Chip
          label={`${stats.withErrors} con diferencia tributaria`}
          size="small"
          color={stats.withErrors > 0 ? "error" : "default"}
        />
      </Stack>

      {/* Filters */}
      <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
        <TextField
          size="small"
          label="Buscar proveedor / NIT"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadCalcs(batchId);
          }}
          sx={{ minWidth: 240 }}
        />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="review-filter-label">Estado</InputLabel>
          <Select
            labelId="review-filter-label"
            label="Estado"
            value={filterReview === null ? "" : String(filterReview)}
            onChange={(e) => {
              const v = e.target.value;
              setFilterReview(v === "" ? null : v === "true");
            }}
          >
            <MenuItem value="">Todos</MenuItem>
            <MenuItem value="true">Requiere revisión</MenuItem>
            <MenuItem value="false">Validados</MenuItem>
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          size="small"
          onClick={() => void loadCalcs(batchId)}
          disabled={!batchId}
        >
          Aplicar filtros
        </Button>
      </Stack>

      {/* Actions bar */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {selectedIds.length
            ? `${selectedIds.length} factura(s) seleccionada(s)`
            : "Selecciona facturas para confirmar clasificación en bulk"}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AutoAwesomeRounded />}
          onClick={() => void handleBulkConfirm()}
          disabled={!selectedIds.length || bulkRunning}
        >
          Confirmar clasificación IA ({selectedIds.length})
        </Button>
      </Box>

      {bulkRunning && (
        <LinearProgress variant="determinate" value={bulkProgress} sx={{ borderRadius: 1 }} />
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {bulkMessage && (
        <Alert severity="info" onClose={() => setBulkMessage(null)}>
          {bulkMessage}
        </Alert>
      )}

      {/* DataGrid */}
      <Paper
        sx={{
          minHeight: 560,
          "& .MuiDataGrid-row.row-error": {
            bgcolor: "error.light",
            "&:hover": { bgcolor: "error.main" },
          },
          "& .MuiDataGrid-row.row-warning": {
            bgcolor: "warning.light",
            "&:hover": { bgcolor: "warning.main" },
          },
        }}
      >
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          checkboxSelection
          disableRowSelectionOnClick
          rowSelectionModel={rowSelectionModel}
          onRowSelectionModelChange={(model) =>
            setSelectedIds(Array.from(model.ids ?? []).map(String))
          }
          onRowClick={openDrawer}
          getRowClassName={getRowClassName}
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
        />
      </Paper>

      {/* Edit Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: 360, sm: 480 }, p: 3, overflowY: "auto" }}>
          <Typography variant="h4" gutterBottom>
            Editar clasificación
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            <strong>{selectedCalc?.invoice_number}</strong> · {selectedCalc?.supplier_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            NIT {selectedCalc?.supplier_nit} · Ciudad: {selectedCalc?.city ?? "–"}
          </Typography>

          {/* Retenciones chips */}
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, mb: 2, flexWrap: "wrap" }}>
            <Chip
              label={`ReteFuente: ${fmtCOP(selectedCalc?.retefuente_calculated)}`}
              size="small"
              color={
                Math.abs(selectedCalc?.retefuente_difference ?? 0) > 1 ? "error" : "default"
              }
            />
            <Chip
              label={`ReteICA: ${fmtCOP(selectedCalc?.reteica_calculated)}`}
              size="small"
              color={
                Math.abs(selectedCalc?.reteica_difference ?? 0) > 1 ? "error" : "default"
              }
            />
            <Chip
              label={`ReteIVA: ${fmtCOP(selectedCalc?.reteiva_calculated)}`}
              size="small"
            />
          </Stack>

          {selectedCalc?.warnings_json?.length ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {selectedCalc.warnings_json.join(" | ")}
            </Alert>
          ) : null}

          <Stack spacing={1.5}>
            <FormControl size="small" fullWidth>
              <InputLabel>Tipo de clasificación</InputLabel>
              <Select
                label="Tipo de clasificación"
                value={draft.cost_or_expense}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    cost_or_expense: e.target.value as EditDraft["cost_or_expense"],
                  }))
                }
              >
                <MenuItem value="cost">Costo</MenuItem>
                <MenuItem value="expense">Gasto</MenuItem>
                <MenuItem value="asset">Activo</MenuItem>
                <MenuItem value="liability">Pasivo</MenuItem>
                <MenuItem value="unknown">Desconocido</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Cuenta costo / gasto (ej: 511505)"
              size="small"
              fullWidth
              value={draft.account_code}
              onChange={(e) => setDraft((d) => ({ ...d, account_code: e.target.value }))}
            />

            <TextField
              label="Cuenta por pagar (ej: 220500)"
              size="small"
              fullWidth
              value={draft.payable_account_code}
              onChange={(e) =>
                setDraft((d) => ({ ...d, payable_account_code: e.target.value }))
              }
            />

            <TextField
              label="Concepto ReteFuente"
              size="small"
              fullWidth
              placeholder="Compras, Servicios, etc."
              value={draft.retefuente_concept}
              onChange={(e) =>
                setDraft((d) => ({ ...d, retefuente_concept: e.target.value }))
              }
            />

            <TextField
              label="Ciudad ReteICA"
              size="small"
              fullWidth
              placeholder="Bogotá, Medellín, Cali…"
              value={draft.reteica_city}
              onChange={(e) => setDraft((d) => ({ ...d, reteica_city: e.target.value }))}
            />

            <FormControl size="small" fullWidth>
              <InputLabel>Tipo actividad ReteICA</InputLabel>
              <Select
                label="Tipo actividad ReteICA"
                value={draft.reteica_kind}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    reteica_kind: e.target.value as "service" | "purchase",
                  }))
                }
              >
                <MenuItem value="service">Servicio</MenuItem>
                <MenuItem value="purchase">Compra</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Nota de auditoría (mín. 8 caracteres)"
              size="small"
              fullWidth
              multiline
              minRows={3}
              value={draft.reason}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
              error={draft.reason.length > 0 && draft.reason.length < 8}
              helperText={
                draft.reason.length > 0 && draft.reason.length < 8
                  ? "Mínimo 8 caracteres"
                  : ""
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={draft.mark_as_reviewed}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, mark_as_reviewed: e.target.checked }))
                  }
                />
              }
              label="Marcar como revisada"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={draft.save_to_memory}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, save_to_memory: e.target.checked }))
                  }
                />
              }
              label="Guardar en memoria del tenant"
            />

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                startIcon={<SaveRounded />}
                disabled={saving || draft.reason.trim().length < 8}
                onClick={() => void handleSave()}
                fullWidth
              >
                {saving ? "Guardando…" : "Guardar clasificación"}
              </Button>
              <Button variant="outlined" onClick={() => setDrawerOpen(false)}>
                Cancelar
              </Button>
            </Stack>

            {saveMessage && (
              <Alert severity="success" onClose={() => setSaveMessage(null)}>
                {saveMessage}
              </Alert>
            )}
            {saveError && (
              <Alert severity="error" onClose={() => setSaveError(null)}>
                {saveError}
              </Alert>
            )}
          </Stack>

          {/* Classified lines & tax groups — expandable */}
          <Box sx={{ mt: 3 }}>
            <Button
              size="small"
              endIcon={
                <ExpandMoreRounded
                  sx={{
                    transform: linesExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }}
                />
              }
              onClick={() => setLinesExpanded((v) => !v)}
            >
              Líneas clasificadas ({selectedCalc?.result_json?.classified_lines?.length ?? 0})
            </Button>

            <Collapse in={linesExpanded}>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {selectedCalc?.result_json?.classified_lines?.length ? (
                  selectedCalc.result_json.classified_lines.map((line, i) => (
                    <Paper key={line.line_id ?? i} variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        #{line.source_line_number} — {line.description}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        flexWrap="wrap"
                        sx={{ mt: 0.5, mb: 0.5 }}
                      >
                        <Chip label={line.kind} size="small" color="info" />
                        {line.retefuente_concept && (
                          <Chip label={`RF: ${line.retefuente_concept}`} size="small" />
                        )}
                        {line.reteica_city && (
                          <Chip label={`ICA: ${line.reteica_city}`} size="small" />
                        )}
                        <Chip
                          label={`${Math.round(line.confidence * 100)}%`}
                          size="small"
                          color={line.confidence >= 0.7 ? "success" : "warning"}
                        />
                        {line.requires_review && (
                          <Chip label="Revisar" size="small" color="warning" />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Base: {fmtCOP(line.line_base)} · IVA: {fmtCOP(line.iva_amount)}
                      </Typography>
                    </Paper>
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Sin líneas clasificadas disponibles.
                  </Typography>
                )}

                {/* Tax groups: ReteFuente / ReteICA / ReteIVA */}
                {selectedCalc?.result_json?.groups?.length ? (
                  <>
                    <Typography variant="subtitle2" sx={{ mt: 1 }}>
                      Grupos tributarios
                    </Typography>
                    {selectedCalc.result_json.groups.map((g, i) => (
                      <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 0.5 }}>
                          <Chip
                            label={g.tax_type.toUpperCase()}
                            size="small"
                            color={
                              g.tax_type === "retefuente"
                                ? "primary"
                                : g.tax_type === "reteica"
                                  ? "secondary"
                                  : "info"
                            }
                          />
                          <Chip
                            label={g.applies ? "Aplica" : "No aplica"}
                            size="small"
                            color={g.applies ? "success" : "default"}
                            variant={g.applies ? "filled" : "outlined"}
                          />
                        </Stack>
                        <Typography variant="caption" display="block">
                          {g.concept} · Cuenta: {g.account_code}
                        </Typography>
                        {g.applies ? (
                          <Typography variant="caption" color="text.secondary">
                            Base: {fmtCOP(g.base)} · Tasa: {(g.rate * 100).toFixed(2)}% ·
                            Calculado: {fmtCOP(g.calculated_amount)}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            No aplica: {g.reasons[0] ?? "sin razón especificada"}
                          </Typography>
                        )}
                        {g.legal_reference && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                          >
                            Ref: {g.legal_reference}
                          </Typography>
                        )}
                      </Paper>
                    ))}
                  </>
                ) : null}
              </Stack>
            </Collapse>
          </Box>
        </Box>
      </Drawer>
    </Stack>
  );
}

