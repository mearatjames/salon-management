// Clients screen — searchable table with profile drawer
const { useState: useStateClients } = React;

function ClientsScreen() {
  const [selected, setSelected] = useStateClients(0);
  const clients = [
    { initials: "MP", name: "Maya Patel",     phone: "(415) 555-0142", email: "maya@hey.com",       last: "Apr 14",  visits: 12, spend: 740, tags: ["VIP"] },
    { initials: "JL", name: "Jules Lambert",  phone: "(415) 555-0188", email: "jules@studio.co",    last: "Apr 22",  visits: 8,  spend: 520, tags: [] },
    { initials: "EK", name: "Eva Kowalski",   phone: "(510) 555-0119", email: "eva.k@gmail.com",    last: "Apr 30",  visits: 4,  spend: 220, tags: ["Allergies"] },
    { initials: "AH", name: "Aisha Khan",     phone: "(415) 555-0102", email: "aisha@write.dev",    last: "May 1",   visits: 1,  spend: 65,  tags: ["First visit"] },
    { initials: "HI", name: "Hana Ito",       phone: "(415) 555-0177", email: "hana.ito@me.com",    last: "May 3",   visits: 22, spend: 1480, tags: ["VIP"] },
    { initials: "DP", name: "Dani Park",      phone: "(415) 555-0136", email: "dani@park.studio",   last: "May 5",   visits: 6,  spend: 380, tags: [] },
    { initials: "SW", name: "Sam Wright",     phone: "(415) 555-0144", email: "sam.w@gmail.com",    last: "May 6",   visits: 3,  spend: 195, tags: [] },
    { initials: "KS", name: "Kim Suh",        phone: "(415) 555-0193", email: "kim@suh.design",     last: "May 6",   visits: 9,  spend: 615, tags: ["VIP"] },
  ];
  const c = clients[selected];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div className="h-page">Clients</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>248 total · 14 added this month</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" size="sm">Import</Button>
          <Button variant="primary" size="sm" icon={<I.Plus />}>Add client</Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        {/* Table */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Input icon={<I.Search />} placeholder="Search by name, phone, email…" />
            </div>
            <Button variant="outline" size="sm">Filters</Button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--muted)" }}>
                {["Client","Phone","Last visit","Visits","Spend","Tags"].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 3 && i <= 4 ? "right" : "left", padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((cl, i) => (
                <tr key={i} onClick={() => setSelected(i)} style={{ cursor: "pointer", background: selected === i ? "var(--accent)" : "transparent", borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar initials={cl.initials} primary={cl.tags.includes("VIP")} size={28} />
                      <div>
                        <div style={{ fontWeight: 500 }}>{cl.name}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{cl.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }} className="tnum muted">{cl.phone}</td>
                  <td style={{ padding: "10px 12px" }} className="muted">{cl.last}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }} className="tnum">{cl.visits}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }} className="tnum">${cl.spend}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {cl.tags.map(t => <Badge key={t} tone={t === "VIP" ? "primary" : t === "First visit" ? "info" : "default"}>{t}</Badge>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Profile panel */}
        <div className="card" style={{ padding: 20, alignSelf: "start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <Avatar initials={c.initials} primary={c.tags.includes("VIP")} size={48} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{c.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>Client since 2023</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
            {c.tags.length ? c.tags.map(t => <Badge key={t} tone={t === "VIP" ? "primary" : t === "First visit" ? "info" : "default"}>{t}</Badge>) : <span className="muted" style={{ fontSize: 12 }}>No tags</span>}
          </div>
          <div style={{ display: "grid", gap: 10, fontSize: 13, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><I.Phone size={14} /><span className="tnum">{c.phone}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><I.Mail size={14} /><span>{c.email}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><I.Calendar size={14} /><span>Last visit {c.last}</span></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "12px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
            <div><div className="muted" style={{ fontSize: 11 }}>Visits</div><div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>{c.visits}</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Lifetime spend</div><div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>${c.spend}</div></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button variant="primary" size="sm" icon={<I.Plus />}>Book</Button>
            <Button variant="outline" size="sm">Message</Button>
            <Button variant="ghost" size="sm" icon={<I.More />} />
          </div>
        </div>
      </div>
    </div>
  );
}

window.ClientsScreen = ClientsScreen;
