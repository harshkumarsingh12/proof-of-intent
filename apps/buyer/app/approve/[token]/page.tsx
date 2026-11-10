// A link sent before #257 carried its token in this path. The token is never read or passed on here, and the merchant
// API refuses tokens in paths (410), so the page only explains where the cart is now: the shop lists the carts waiting
// for the shopper, and approving still takes their own signature.
export const dynamic = "force-dynamic";

export const metadata = { title: "Approve a purchase · Proof of Intent", referrer: "no-referrer" as const };

export default function OutdatedApprovalLink() {
  return (
    <>
      <header className="wrap nav">
        <a href="/" className="brand">
          Proof of Intent
        </a>
      </header>
      <main>
        <div className="wrap shop">
          <section className="panel">
            <h2>Approve a purchase</h2>
            <p className="error">
              This approval link uses an old format and no longer works. Nothing was charged.
            </p>
            <p className="sub">
              Open the shop in the browser you signed your intent with: carts waiting for your approval are
              listed there.
            </p>
            <a className="btn btn-primary" href="/shop">
              Open the shop
            </a>
          </section>
        </div>
      </main>
    </>
  );
}
