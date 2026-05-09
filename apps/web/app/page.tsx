import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container">
      <section className="card">
        <h1>ETL Contable SaaS</h1>
        <p>Automatiza facturas, clasifica con IA y exporta a ERP con trazabilidad.</p>
        <Link href="/dashboard">Ir al dashboard</Link>
      </section>
    </main>
  );
}
