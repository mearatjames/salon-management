// Mobile primitives for Lacquer Book
const M = {};
const mkIcon = (paths) => ({ size = 22, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>{paths}</svg>
);
M.Home     = mkIcon(<><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2z"/></>);
M.Calendar = mkIcon(<><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>);
M.Heart    = mkIcon(<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>);
M.User     = mkIcon(<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>);
M.Search   = mkIcon(<><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>);
M.Star     = mkIcon(<polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>);
M.Clock    = mkIcon(<><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>);
M.Pin      = mkIcon(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></>);
M.Chevron  = mkIcon(<path d="M9 18l6-6-6-6"/>);
M.Back     = mkIcon(<path d="M15 18l-6-6 6-6"/>);
M.Check    = mkIcon(<path d="M5 12l5 5L20 7"/>);

function MTabs({ active, onChange }) {
  const tabs = [
    { id: "discover",  label: "Discover", icon: <M.Home /> },
    { id: "bookings",  label: "Bookings", icon: <M.Calendar /> },
    { id: "favorites", label: "Saved",    icon: <M.Heart /> },
    { id: "profile",   label: "Profile",  icon: <M.User /> },
  ];
  return (
    <div className="m-tabs">
      {tabs.map(t => (
        <div key={t.id} className={"m-tab" + (active === t.id ? " active" : "")} onClick={() => onChange?.(t.id)}>
          {t.icon}<span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { M, MTabs });
