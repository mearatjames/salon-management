# Lacquer Studio — UI Kit (web)

The desktop/web app used by salon owners and staff. Three key surfaces:

1. **Calendar / Schedule** — day-grid showing techs as columns, time as rows, appointments as blocks
2. **Clients** — searchable table with profile drawer
3. **Checkout** — POS-style payment screen for completing an appointment

Components are JSX (Babel in browser). Load order matters — `Components.jsx` registers shared primitives on `window` for the screen files to consume.

## Files
- `index.html` — interactive shell, switches between screens via a sidebar
- `Components.jsx` — Sidebar, TopBar, Button, Input, Badge, Avatar, Card, IconButton
- `CalendarScreen.jsx`
- `ClientsScreen.jsx`
- `CheckoutScreen.jsx`
