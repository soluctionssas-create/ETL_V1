const cards = [
  { title: "Ingestion", text: "Cargar PDF/XML/ZIP y crear lotes" },
  { title: "Clasificacion", text: "Revisar sugerencias IA y aprobar" },
  { title: "Exportacion ERP", text: "Enviar asientos y monitorear estado" },
  { title: "Auditoria", text: "Trazabilidad por usuario, tenant y evento" },
];

export default function DashboardPage() {
  return (
    <main className="container">
      <h1>Dashboard</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
        {cards.map((card) => (
          <article key={card.title} className="card">
            <h3>{card.title}</h3>
            <p>{card.text}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
