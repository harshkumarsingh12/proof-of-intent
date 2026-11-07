import WalletReturn from "./WalletReturn";

export const dynamic = "force-dynamic";

// PayPal sends the shopper here with the setup token in the URL; keep it out of Referer headers.
export const metadata = {
  title: "Saving your PayPal wallet · Proof of Intent",
  referrer: "no-referrer" as const,
};

export default function Wallet() {
  return (
    <>
      <header className="wrap nav">
        <a href="/" className="brand">
          Proof of Intent
        </a>
      </header>
      <main>
        <WalletReturn />
      </main>
    </>
  );
}
