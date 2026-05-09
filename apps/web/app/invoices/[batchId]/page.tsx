"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getBatch, listBatchInvoices, triggerExport, type Batch, type Invoice } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  raw: "bg-gray-800 text-gray-400",
  parsed: "bg-blue-900 text-blue-300",
  classified: "bg-purple-900 text-purple-300",
  exported: "bg-green-900 text-green-300",
  error: "bg-red-900 text-red-300",
};

export default function BatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [erpSystem, setErpSystem] = useState("siigo");
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [b, inv] = await Promise.all([
          getBatch(batchId),
          listBatchInvoices(batchId, page),
        ]);
        setBatch(b);
        setInvoices(inv.items);
        setTotal(inv.total);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [batchId, page]);

  async function handleExport() {
    setExporting(true);
    setExportMsg(null);
    try {
      const job = await triggerExport(batchId, erpSystem);
      setExportMsg(`✓ Exportación iniciada (ID: ${job.id.slice(0, 8)}...)`);
    } catch (err: unknown) {
      setExportMsg(`✗ ${err instanceof Error ? err.message : "Error"}`);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="text-gray-400 py-12 text-center">Cargando...</div>;
  }

  if (!batch) {
    return <div className="text-red-400 py-12 text-center">Lote no encontrado</div>;
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-400">
        <Link href="/invoices" className="hover:text-white transition-colors">Lotes</Link>
        <span className="mx-2">/</span>
        <span className="text-white font-mono">{batch.id.slice(0, 8)}...</span>
      </nav>

      {/* Batch summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">{batch.filename}</h1>
            <p className="text-gray-400 text-sm mt-1">
              {(batch.file_size / 1024).toFixed(1)} KB · {batch.file_type}
            </p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
            batch.status === "completed" ? "bg-green-900 text-green-300" :
            batch.status === "failed" ? "bg-red-900 text-red-300" :
            "bg-blue-900 text-blue-300"
          }`}>
            {batch.status}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-white">{batch.total_invoices}</div>
            <div className="text-xs text-gray-400 mt-1">Total</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{batch.processed_invoices}</div>
            <div className="text-xs text-gray-400 mt-1">Procesadas</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-red-400">{batch.failed_invoices}</div>
            <div className="text-xs text-gray-400 mt-1">Con error</div>
          </div>
        </div>

        {/* Export trigger */}
        {batch.status === "completed" && (
          <div className="flex items-center gap-3 mt-6 pt-6 border-t border-gray-800">
            <select
              value={erpSystem}
              onChange={(e) => setErpSystem(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="siigo">Siigo</option>
              <option value="sap">SAP B1</option>
              <option value="helisa">Helisa</option>
              <option value="world_office">World Office</option>
            </select>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {exporting ? "Exportando..." : "Exportar a ERP"}
            </button>
            {exportMsg && (
              <span className={`text-sm ${exportMsg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>
                {exportMsg}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Invoices table */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">
          Facturas del lote ({total})
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Nro. Factura</th>
                <th className="text-left px-4 py-3 font-medium">Proveedor</th>
                <th className="text-left px-4 py-3 font-medium">NIT</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-500 py-10">
                    Sin facturas aún
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                    <td className="px-4 py-3 text-white font-mono text-xs">{inv.invoice_number ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-300">{inv.vendor_name ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{inv.vendor_tax_id ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-white font-medium">
                      {inv.total_amount != null
                        ? new Intl.NumberFormat("es-CO", { style: "currency", currency: inv.currency }).format(inv.total_amount)
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-800 text-gray-300"}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {Math.ceil(total / 50) > 1 && (
          <div className="flex justify-between text-sm text-gray-400 mt-3">
            <span>Página {page} de {Math.ceil(total / 50)}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg">
                Anterior
              </button>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / 50)}
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg">
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
