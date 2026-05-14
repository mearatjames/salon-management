export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "0.75rem",
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 600, margin: 0 }}>Tang Nails</h1>
      <p style={{ fontSize: "1rem", color: "#555", margin: 0 }}>
        The project is scaffolded. Features are coming soon.
      </p>
    </main>
  );
}
