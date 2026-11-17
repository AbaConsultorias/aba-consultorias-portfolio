"use client";

// Substitui o layout raiz quando ele mesmo falha: sem CSS global nem fontes, por isso o estilo é inline.
export default function ErroGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.25rem",
          fontFamily: "system-ui, sans-serif",
          background: "#f5f7f8",
          color: "#1c2832",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 600 }}>Algo deu errado</h1>
          <p style={{ lineHeight: 1.6 }}>
            Não foi possível carregar o site agora. Tente de novo em instantes.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "3rem",
              padding: "0 1.5rem",
              border: 0,
              borderRadius: "999px",
              background: "#2a3b4a",
              color: "#fff",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
          {error.digest && <p style={{ fontSize: "0.75rem", opacity: 0.7 }}>Código: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
