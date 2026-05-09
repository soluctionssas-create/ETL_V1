"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listBatches, uploadBatch, type Batch } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-900 text-yellow-300",
  processing: "bg-blue-900 text-blue-300",
  completed: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
  partial: "bg-orange-900 text-orange-300",
};

export default function InvoicesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchBatches(p = page) {
    setLoading(true);
    try {
      const res = await listBatches(p, pageSize);
      setBatches(res.items);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar lotes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBatches();
  }, [page]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadBatch(file);
      await fetchBatches(1);
      setPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al subir archivo");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Lotes de Facturas</h1>
          <p className="text-gray-400 text-sm mt-1">{total} lotes en total</p>
        </div>
        <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
          {uploading ? (
            <span>Subiendo...</span>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Subir Archivo
            </>
          )}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.xml,.csv,.zip"
            onChange={handleFileChange}
            disabled={uploading}
          />
        </label>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="text-left px-4 py-3 font-medium">Archivo</th>
              <th className="text-left px-4 py-3 font-medium">Estado</th>
              <th className="text-right px-4 py-3 font-medium">Facturas</th>
              <th className="text-right px-4 py-3 font-medium">Procesadas</th>
              <th className="text-right px-4 py-3 font-medium">Errores</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-500 py-12">
                  Cargando...
                </td>
              </tr>
            ) : batches.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-500 py-12">
                  No hay lotes. Sube tu primer archivo de facturas.
                </td>
              </tr>
            ) : (
              batches.map((b) => (
                <tr key={b.id} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3 text-white font-mono text-xs truncate max-w-[200px]">
                    {b.filename}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[b.status] ?? "bg-gray-800 text-gray-300"}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{b.total_invoices}</td>
                  <td className="px-4 py-3 text-right text-green-400">{b.processed_invoices}</td>
                  <td className="px-4 py-3 text-right text-red-400">{b.failed_invoices}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/invoices/${b.id}`}
                      className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
                    >
                      Ver →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg transition-colors"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
