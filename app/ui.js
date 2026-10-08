"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const Spinner = ({ size = 14 }) => <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;

/** Indeterminate bar pinned to the top of the nearest positioned parent. */
export const Progress = () => <div className="progress" />;

export function Skeleton({ rows = 6, widths = [70, 45, 85, 55, 65, 40] }) {
  return (
    <div className="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-line" style={{ width: `${widths[i % widths.length]}%`, animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}

const CLOSE_MS = 140;
const stack = []; // open modals, so Esc only closes the top one

/**
 * Animated modal. Closes on Esc / backdrop click with an exit animation.
 * `children` may be a function receiving `close` (animated close).
 */
export function Modal({ onClose, children, className = "", as: Tag = "div", ...props }) {
  const [closing, setClosing] = useState(false);
  const id = useRef(Symbol());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }, []);

  useEffect(() => {
    const me = id.current;
    stack.push(me);
    const onKey = (e) => {
      if (e.key === "Escape" && stack[stack.length - 1] === me) { e.stopPropagation(); close(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(me), 1);
    };
  }, [close]);

  return (
    <div className={`modal-bg ${closing ? "closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <Tag className={`modal ${className}`} role="dialog" aria-modal="true" {...props}>
        {typeof children === "function" ? children(close) : children}
      </Tag>
    </div>
  );
}

/* ---------- confirm() replacement ---------- */

const ConfirmCtx = createContext(null);

/** const confirm = useConfirm(); if (await confirm({ title, body, confirmLabel, danger })) ... */
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const ask = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), []);
  const finish = (value) => { req.resolve(value); setReq(null); };

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <Modal className="confirm" onClose={() => finish(false)}>
          {(close) => (
            <>
              <h3>{req.title}</h3>
              {req.body && <p className="muted confirm-body">{req.body}</p>}
              <div className="row gap end">
                <button className="btn" onClick={close}>Cancel</button>
                <button autoFocus className={`btn ${req.danger ? "danger solid" : "primary"}`} onClick={() => finish(true)}>
                  {req.confirmLabel ?? "OK"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ---------- dropdown ---------- */

const Chevron = () => (
  <svg className="dd-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Custom <select>. options: [{ value, label, hint? }]
 * Keyboard: ↑/↓/Home/End to move, Enter/Space to pick, Esc to close, type a letter to jump.
 * The list is portalled to <body> so modals and scroll containers don't clip it.
 */
export function Select({ value, options, onChange, size = "", className = "", disabled, title }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const list = useRef(null);
  const index = options.findIndex((o) => o.value === value);
  const current = options[index];

  function place() {
    const r = btn.current.getBoundingClientRect();
    const want = Math.min(320, options.length * 38 + 10);
    const below = window.innerHeight - r.bottom - 12;
    const up = below < want && r.top > below;
    setPos({
      left: r.left,
      minWidth: r.width,
      maxHeight: Math.min(320, (up ? r.top : below) - 12),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      up,
    });
  }

  function show() {
    if (disabled || !options.length) return;
    place();
    setActive(Math.max(0, index));
    setOpen(true);
  }

  function choose(o) {
    setOpen(false);
    btn.current?.focus();
    if (o && o.value !== value) onChange(o.value);
  }

  useEffect(() => {
    if (!open) return;
    const outside = (e) => !btn.current?.contains(e.target) && !list.current?.contains(e.target);
    const onDown = (e) => outside(e) && setOpen(false);
    const onScroll = (e) => !list.current?.contains(e.target) && setOpen(false);
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    const last = options.length - 1;
    const keys = {
      ArrowDown: () => setActive((a) => Math.min(last, a + 1)),
      ArrowUp: () => setActive((a) => Math.max(0, a - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(options[active]),
      " ": () => choose(options[active]),
      Escape: () => { e.stopPropagation(); setOpen(false); }, // don't also close a surrounding modal
      Tab: () => setOpen(false),
    };
    if (keys[e.key]) {
      if (e.key !== "Tab") e.preventDefault();
      keys[e.key]();
    } else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const order = [...options.keys()].map((i) => (active + 1 + i) % options.length);
      const hit = order.find((i) => String(options[i].label).toLowerCase().startsWith(k));
      if (hit !== undefined) setActive(hit);
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        title={title}
        disabled={disabled}
        className={`dd ${size} ${open ? "open" : ""} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className="dd-label">{current?.label ?? "Select…"}</span>
        {current?.hint && !size && <span className="dd-hint">{current.hint}</span>}
        <Chevron />
      </button>
      {open && pos && createPortal(
        <ul
          ref={list}
          role="listbox"
          className={`dd-list ${pos.up ? "up" : ""} ${size}`}
          style={{ left: pos.left, minWidth: pos.minWidth, maxHeight: pos.maxHeight, top: pos.top, bottom: pos.bottom }}
          onMouseDown={(e) => e.preventDefault()} // keep focus on the trigger
        >
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={`dd-opt ${i === active ? "active" : ""} ${o.value === value ? "selected" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              <span className="dd-check">{o.value === value ? "✓" : ""}</span>
              <span className="dd-label">{o.label}</span>
              {o.hint && <span className="dd-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

export function Footer({ className = "" }) {
  const year = new Date().getFullYear();
  return (
    <footer className={`app-footer ${className}`}>
      <a href="https://nezden.com" target="_blank" rel="noopener noreferrer">© Nezden {year}</a>
      <span className="dot">·</span>
      <span>
        Built by{" "}
        <a href="https://dev.nezden.com" target="_blank" rel="noopener noreferrer">Anees Rehman</a>
      </span>
    </footer>
  );
}
