export const shellCardStyle: Record<string, string | number> = {
  border: "1px solid rgba(73, 63, 46, 0.18)",
  borderRadius: 20,
  padding: 24,
  background: "rgba(255,255,255,0.82)",
  boxShadow: "0 20px 50px rgba(58, 43, 25, 0.08)",
  backdropFilter: "blur(8px)",
};

export const labelStyle: Record<string, string | number> = {
  display: "block",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6b5d46",
  marginBottom: 8,
};

export const inputStyle: Record<string, string | number> = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(107, 93, 70, 0.22)",
  padding: "12px 14px",
  fontSize: 15,
  background: "#fffdfa",
  color: "#1f2933",
  boxSizing: "border-box",
};

export const buttonStyle = (tone: "primary" | "secondary" = "secondary") => ({
  borderRadius: 999,
  border: tone === "primary" ? "1px solid #0f766e" : "1px solid rgba(73, 63, 46, 0.18)",
  background: tone === "primary" ? "#0f766e" : "#fffdf8",
  color: tone === "primary" ? "#f8fffe" : "#2d251a",
  padding: "10px 14px",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
});
