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
// Matches the theme.ts breakpoint where the open sidebar floats over the page instead of pushing it.
const PHONE_QUERY = "(max-width: 640px)";
const isPhone = () => window.matchMedia(PHONE_QUERY).matches;

type NavItem = { label: string; icon: ReactNode; href?: string; external?: boolean };

const PRIMARY: NavItem[] = [
  { label: "Home", icon: <HomeIcon />, href: "/" },
  { label: "Orders", icon: <ReceiptIcon />, href: "/orders" },
  { label: "Disputes", icon: <ScaleIcon />, href: "/disputes" },
  { label: "Analytics", icon: <ChartIcon />, href: "/analytics" },
];

const SECONDARY: NavItem[] = [
  { label: "Specs", icon: <DocIcon />, href: `${REPO_URL}/tree/main/docs/specs`, external: true },
  { label: "Help", icon: <HelpIcon />, href: `${REPO_URL}/blob/main/docs/SETUP.md`, external: true },
];

export function AppShell({ mode, children }: { mode: PayPalMode; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);
  // Animate width only for the user's own toggles, not when the saved state is restored on load.
  const [ready, setReady] = useState(false);

  // Restore preferences after hydration so the server and first client render match.
  useEffect(() => {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    // Phones always start closed: an open sidebar there covers the page. Elsewhere, restore the saved choice,
    // or start collapsed on narrow screens.
    setCollapsed(isPhone() || (saved === null ? window.matchMedia("(max-width: 900px)").matches : saved === "1"));
    setBannerOpen(sessionStorage.getItem(BANNER_KEY) !== "1");
    requestAnimationFrame(() => setReady(true));
  }, []);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      // On phones the sidebar is a temporary overlay, so don't remember it as a preference.
      if (!isPhone()) localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });
  };

  // Phone overlay: close it after navigating, and on Escape.
  const closeOverlay = () => {
    if (isPhone()) setCollapsed(true);
  };
  useEffect(() => {
    closeOverlay();
  }, [pathname]);
  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeOverlay();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed]);

  const dismissBanner = () => {
    sessionStorage.setItem(BANNER_KEY, "1");
    setBannerOpen(false);
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const width = collapsed ? 72 : 260;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {!collapsed && (
        <div className="poi-sidebar-backdrop" aria-hidden="true" onClick={() => setCollapsed(true)} />
      )}
      <aside
        className="poi-sidebar"
        data-collapsed={collapsed}
        data-ready={ready ? "" : undefined}
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
          transition: ready ? "width 0.15s ease" : "none",
        }}
      >
        {!collapsed && (
          <button
            type="button"
            className="poi-sidebar-close"
            onClick={() => setCollapsed(true)}
            aria-label="Close navigation"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              background: "none",
              border: "none",
              padding: 6,
              cursor: "pointer",
              color: v("textMuted"),
            }}
          >
            <CloseIcon size={20} />
          </button>
        )}
        <Link
          href="/"
          aria-label="Proof of Intent home"
          className="poi-logo"
          style={{ display: "block", textDecoration: "none", textAlign: "center", marginBottom: 16 }}
        >
          {collapsed ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 40,
                height: 40,
                borderRadius: 10,
                background: v("navy"),
                color: "#ffffff",
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              PI
            </span>
          ) : (
            <>
              <span
                className="poi-sidebar-extra"
                style={{ display: "block", fontSize: 24, fontWeight: 800, color: v("navy"), letterSpacing: "-0.02em" }}
              >
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
          className="poi-header"
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
          <span
            className="poi-merchant"
            style={{ fontSize: 22, fontWeight: 700, color: v("text"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}
          >
            {MERCHANT_NAME}
          </span>

          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <DisputeSearch />
          </div>

          <Link
            href="/disputes"
            className="poi-header-link"
            style={{ fontSize: 15, color: v("text"), textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Dispute queue
          </Link>
          <span className="poi-header-link" style={{ width: 1, height: 32, background: v("border") }} aria-hidden="true" />
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
            className="poi-mode-banner"
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

        <main className="poi-main" style={{ flex: 1, padding: "40px 48px 64px", minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: PayPalMode }) {
  const sandbox = mode === "sandbox";
  return (
    <div className="poi-sidebar-extra" style={{ display: "flex", justifyContent: "center" }}>
      <span
        title="Set on the server with PAYPAL_MODE"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderRadius: 9999,
          fontSize: 13,
          fontWeight: 600,
          background: sandbox ? v("successBg") : v("surfaceMuted"),
          color: sandbox ? v("success") : v("textMuted"),
          border: `1px solid ${sandbox ? v("successBorder") : v("border")}`,
        }}
      >
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: "currentColor" }} />
        {sandbox ? "PayPal sandbox" : "Mock mode"}
      </span>
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
    </>
  );

  if (!item.href) return null;
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
