import { createClient } from "@/utils/supabase/server";
import { addTodo, deleteTodo } from "@/app/actions/supabase-todos";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await createClient();

  const { data: todos, error } = await supabase
    .from("todos")
    .select("id, name")
    .order("id", { ascending: false });

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1rem", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Supabase + Vercel Ready</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>Lectura y escritura a la tabla <strong>todos</strong> desde Server Actions.</p>

      <form action={addTodo} style={{ display: "flex", gap: 8, margin: "1rem 0 1.2rem" }}>
        <input
          name="name"
          placeholder="Escribe una tarea"
          required
          style={{ flex: 1, padding: "0.6rem 0.7rem", borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <button type="submit" style={{ padding: "0.6rem 0.9rem", borderRadius: 8, border: "1px solid #0f766e", background: "#0f766e", color: "white" }}>
          Guardar
        </button>
      </form>

      {error ? (
        <p style={{ color: "#b91c1c" }}>
          Error leyendo Supabase: {error.message}
        </p>
      ) : null}

      <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {todos?.map((todo) => (
          <li key={todo.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 0.8rem", border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <span>{todo.name}</span>
            <form action={deleteTodo}>
              <input type="hidden" name="id" value={todo.id} />
              <button type="submit" style={{ border: "1px solid #dc2626", color: "#dc2626", background: "white", borderRadius: 8, padding: "0.35rem 0.65rem" }}>
                Eliminar
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
