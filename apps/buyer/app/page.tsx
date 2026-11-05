import { compliantCart, greyJacketIntent, overreachingCart } from "@poi/contracts/fixtures";
import type { CartMandate } from "@poi/contracts";

// Landing page for shoppers. The signing and checkout flow (docs/specs/0001, 0003) replaces the example card
// with the real form. Owner: @srshriv.

// Runtime env (Dokploy .env), not build time, so the dashboard link follows the deployment.
export const dynamic = "force-dynamic";

const REPO_URL = "https://github.com/harshkumarsingh12/proof-of-intent";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const color = (cart: CartMandate) => cart.contents.lines[0]?.attributes.color ?? "";

export default function Home() {
  const opsHost = process.env.OPS_HOST;
  const dashboardUrl = opsHost && !opsHost.endsWith("example.com") ? `https://${opsHost}` : "http://localhost:3002";
  const c = greyJacketIntent.constraints;

  return (
    <>
      <header className="wrap nav">
        <a href="/" className="brand">
          Proof of Intent
        </a>
        <nav className="nav-links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#merchants">For merchants</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <main>
        <section className="wrap hero">
          <div>
            <span className="eyebrow">Agent shopping on PayPal</span>
            <h1>Sign what you want, not just what you pay.</h1>
            <p className="lead">
              Tell your shopping agent what you&apos;re after and sign it. Before PayPal takes any money, the merchant
              checks the agent&apos;s cart against what you signed, and a cart that doesn&apos;t match never gets charged.
            </p>
            <div className="ctas">
              <a className="btn btn-primary" href="#how">
                See how it works
              </a>
              <a className="btn btn-ghost" href={dashboardUrl}>
                Merchant dashboard →
              </a>
            </div>
          </div>

          <figure className="mandate" aria-label="Example signed intent and two carts" style={{ margin: 0 }}>
            <div className="mandate-head">
              <span>Example signed intent</span>
              <span className="tag tag-ok">Signed in your browser</span>
            </div>
            <p className="quote">&ldquo;{greyJacketIntent.natural_language_description}&rdquo;</p>
            <ul className="rules">
              <li>
                <span>Spend at most</span>
                <code>{money(c.amount_max?.value ?? 0)}</code>
              </li>
              <li>
                <span>Color</span>
                <code>{c.attributes?.color}</code>
              </li>
              <li>
                <span>Items per order</span>
                <code>{c.quantity_max?.per_order}</code>
              </li>
            </ul>
            <div className="cart">
              <span>
                <strong>{compliantCart.contents.lines[0]?.title}</strong>
                <small>
                  {color(compliantCart)} · {money(compliantCart.contents.total.value)}
                </small>
              </span>
              <span className="tag tag-ok">Fits · paid</span>
            </div>
            <div className="cart">
              <span>
                <strong>{overreachingCart.contents.lines[0]?.title}</strong>
                <small>
                  {color(overreachingCart)} · {money(overreachingCart.contents.total.value)}
                </small>
              </span>
              <span className="tag tag-no">Blocked · not charged</span>
            </div>
          </figure>
        </section>

        <section id="how" className="band alt">
          <div className="wrap">
            <h2>How it works</h2>
            <p className="sub">Three steps, and you stay in control of every one.</p>
            <div className="steps">
              <div className="step">
                <span className="num">1</span>
                <h3>Say what you want</h3>
                <p>Type it the way you&apos;d tell a friend. The app turns it into clear limits: price, color, size, merchant.</p>
              </div>
              <div className="step">
                <span className="num">2</span>
                <h3>Sign it once</h3>
                <p>Your browser signs those limits with a key that never leaves your device. Nobody can change them afterwards.</p>
              </div>
              <div className="step">
                <span className="num">3</span>
                <h3>Let the agent shop</h3>
                <p>The merchant checks every cart against your signature before PayPal charges you. Off-limits carts are refused.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="merchants" className="band">
          <div className="wrap">
            <h2>Why merchants use it</h2>
            <p className="sub">When an AI agent buys the wrong thing, the merchant usually pays. A signed intent changes that.</p>
            <div className="steps">
              <div className="step">
                <h3>Stop bad carts before capture</h3>
                <p>Carts that break the shopper&apos;s limits are rejected before any PayPal order exists.</p>
              </div>
              <div className="step">
                <h3>Defend disputes with proof</h3>
                <p>The signed intent and cart become an evidence package for PayPal&apos;s dispute process.</p>
              </div>
              <div className="step">
                <h3>Refund fairly when the agent erred</h3>
                <p>When the agent really overreached, the copilot recommends accepting the claim. A person always decides.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <span>Proof of Intent · built for the PayPal AI Hackathon · runs on the PayPal sandbox</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
