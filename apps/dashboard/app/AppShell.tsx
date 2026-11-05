"use client";
// App shell: sidebar, top bar and mode banner, laid out like a merchant developer dashboard.
// Our own wordmark and icons; no PayPal logo or assets. Spec: docs/specs/0007-dashboard.md.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ChartIcon,
  CloseIcon,
  DocIcon,
  ExternalIcon,
  HelpIcon,
  HomeIcon,
  HourglassIcon,
  InfoIcon,
  MenuIcon,
  ReceiptIcon,
  ScaleIcon,
} from "./icons";
import { MERCHANT_NAME, merchantInitials, REPO_URL, type PayPalMode } from "../src/merchant";
import { v } from "../src/theme";
import { DisputeSearch } from "./DisputeSearch";

const COLLAPSED_KEY = "poi.sidebar.collapsed";
const BANNER_KEY = "poi.modeBanner.dismissed";

type NavItem = { label: string; icon: ReactNode; href?: string; external?: boolean; soon?: boolean };

const PRIMARY: NavItem[] = [
  { label: "Home", icon: <HomeIcon />, href: "/" },
  { label: "Disputes", icon: <ScaleIcon />, href: "/disputes" },
  { label: "Analytics", icon: <ChartIcon />, href: "/analytics" },
  { label: "Verification queue", icon: <HourglassIcon />, soon: true },
  { label: "Agent orders", icon: <ReceiptIcon />, soon: true },
];

const SECONDARY: NavItem[] = [
  { label: "Specs", icon: <DocIcon />, href: `${REPO_URL}/tree/main/docs/specs`, external: true },
  { label: "Help", icon: <HelpIcon />, href: `${REPO_URL}/blob/main/docs/SETUP.md`, external: true },
];

export function AppShell({ mode, children }: { mode: PayPalMode; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);

  // Restore preferences after hydration so the server and first client render match.
  useEffect(() => {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    // No saved choice yet: start collapsed on narrow screens.
    setCollapsed(saved === null ? window.matchMedia("(max-width: 900px)").matches : saved === "1");
    setBannerOpen(sessionStorage.getItem(BANNER_KEY) !== "1");
  }, []);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });
  };

  const dismissBanner = () => {
    sessionStorage.setItem(BANNER_KEY, "1");
    setBannerOpen(false);
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const width = collapsed ? 72 : 260;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        className="poi-sidebar"
        aria-label="Main navigation"
        style={{
          width,
          flexShrink: 0,
          background: v("sidebarBg"),
          borderRight: `1px solid ${v("border")}`,
          padding: "24px 12px",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          transition: "width 0.15s ease",
        }}
      >
        <Link
          href="/"
          aria-label="Proof of Intent home"
          style={{ display: "block", textDecoration: "none", textAlign: "center", marginBottom: 16 }}
        >
          {collapsed ? (
            <span style={{ fontSize: 20, fontWeight: 800, color: v("navy") }}>PoI</span>
          ) : (
            <>
              <span style={{ display: "block", fontSize: 24, fontWeight: 800, color: v("navy"), letterSpacing: "-0.02em" }}>
                Proof of Intent
              </span>
              <span className="poi-sidebar-extra" style={{ fontSize: 12, color: v("textMuted") }}>
                Built for PayPal merchants
              </span>
            </>
          )}
        </Link>

        {!collapsed && <ModeBadge mode={mode} />}

        <nav style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 20 }}>
          {PRIMARY.map((item) => (
            <NavLink key={item.label} item={item} active={!!item.href && isActive(item.href)} collapsed={collapsed} />
          ))}
          <hr style={{ border: 0, borderTop: `1px solid ${v("border")}`, margin: "16px 8px" }} />
          {SECONDARY.map((item) => (
            <NavLink key={item.label} item={item} active={false} collapsed={collapsed} />
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            height: 72,
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "0 32px",
            background: v("surface"),
            borderBottom: `1px solid ${v("border")}`,
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
            style={{ background: "none", border: "none", padding: 6, cursor: "pointer", color: v("text"), display: "flex" }}
          >
            <MenuIcon size={24} />
          </button>
          <span style={{ fontSize: 22, fontWeight: 700, color: v("text"), whiteSpace: "nowrap" }}>{MERCHANT_NAME}</span>

          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <DisputeSearch />
          </div>

          <Link href="/disputes" style={{ fontSize: 15, color: v("text"), textDecoration: "none", whiteSpace: "nowrap" }}>
            Dispute queue
          </Link>
          <span style={{ width: 1, height: 32, background: v("border") }} aria-hidden="true" />
          <span
            title={MERCHANT_NAME}
            aria-label={`Merchant: ${MERCHANT_NAME}`}
            style={{
              width: 44,
              height: 44,
              borderRadius: 9999,
              background: v("text"),
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {merchantInitials()}
          </span>
        </header>

        {bannerOpen && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "8px 48px",
              background: v("modeBg"),
              color: v("modeText"),
              fontSize: 14,
              position: "relative",
            }}
          >
            <InfoIcon size={16} />
            {mode === "sandbox" ? (
              <span>You&apos;re in sandbox mode. Orders and disputes use the PayPal sandbox.</span>
            ) : (
              <span>You&apos;re in mock mode. PayPal calls are simulated, so nothing reaches PayPal.</span>
            )}
            <button
              type="button"
              onClick={dismissBanner}
              aria-label="Dismiss mode banner"
              style={{
                position: "absolute",
                right: 16,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: v("modeText"),
                display: "flex",
                padding: 4,
              }}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        )}

        <main style={{ flex: 1, padding: "40px 48px 64px", minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: PayPalMode }) {
  const segment = (value: PayPalMode, label: string) => {
    const on = mode === value;
    return (
      <span
        style={{
          padding: "6px 14px",
          borderRadius: 9999,
          fontSize: 14,
          fontWeight: on ? 700 : 500,
          background: on ? v("text") : "transparent",
          color: on ? "#ffffff" : v("textMuted"),
        }}
      >
        {label}
      </span>
    );
  };
  return (
    <div className="poi-sidebar-extra" style={{ display: "flex", justifyContent: "center" }}>
      <div
        role="img"
        aria-label={`PayPal mode: ${mode}. Set on the server with PAYPAL_MODE.`}
        title="Set on the server with PAYPAL_MODE"
        style={{
          display: "inline-flex",
          padding: 3,
          borderRadius: 9999,
          border: `1px solid ${v("border")}`,
          background: v("surface"),
        }}
      >
        {segment("mock", "Mock")}
        {segment("sandbox", "Sandbox")}
      </div>
    </div>
  );
}

function NavLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const style: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: collapsed ? "12px 0" : "12px 14px",
    justifyContent: collapsed ? "center" : "flex-start",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: active ? 700 : 600,
    color: active ? v("navy") : v("text"),
    textDecoration: "none",
  };

  const content = (
    <>
      <span style={{ display: "flex", flexShrink: 0 }}>{item.icon}</span>
      {!collapsed && <span className="poi-nav-label" style={{ flex: 1 }}>{item.label}</span>}
      {!collapsed && item.external && <ExternalIcon size={14} className="poi-nav-label" />}
      {!collapsed && item.soon && (
        <span
          className="poi-nav-label"
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 9999,
            background: v("surfaceMuted"),
            color: v("textMuted"),
          }}
        >
          Soon
        </span>
      )}
    </>
  );

  if (item.soon || !item.href) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label}: not built yet`}
        style={{ ...style, color: v("textSubtle"), cursor: "default" }}
      >
        {content}
      </span>
    );
  }
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className="poi-nav-item" title={collapsed ? item.label : undefined} style={style}>
        {content}
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      className="poi-nav-item"
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      style={style}
    >
      {content}
    </Link>
  );
}
