"use client";

import { useState } from "react";
import { Footer, Spinner } from "../ui";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Login failed");
      window.location.replace("/");
    } catch (err) {
      setError(err.message);
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big">db<span>desk</span></div>
        <label className="label" htmlFor="pw">Admin password</label>
        <input
          id="pw"
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="err small">{error}</div>}
        <button className="btn primary" disabled={busy || !password}>
          {busy ? <><Spinner size={12} /> Signing in…</> : "Sign in"}
        </button>
      </form>
      <Footer className="login-footer" />
    </div>
  );
}
