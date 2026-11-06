import ShopFlow from "./ShopFlow";

// Runtime env (Dokploy .env), not build time: PAYPAL_MODE and the client id follow the deployment.
export const dynamic = "force-dynamic";

export const metadata = { title: "Shop · Proof of Intent" };

export default function Shop() {
  const sandbox = process.env.PAYPAL_MODE === "sandbox";
  return (
    <>
      <header className="wrap nav">
        <a href="/" className="brand">
          Proof of Intent
        </a>
        <nav className="nav-links" aria-label="Main">
          <a href="/#how">How it works</a>
        </nav>
      </header>
      <main>
        <ShopFlow
          config={{
            merchantId: process.env.MERCHANT_ID ?? "merchant-trailhead",
            paypalMode: sandbox ? "sandbox" : "mock",
            // Public by design: PayPal's JS SDK needs it in the page. The secret never leaves the API.
            paypalClientId: sandbox ? process.env.PAYPAL_CLIENT_ID || undefined : undefined,
          }}
        />
      </main>
    </>
  );
}
