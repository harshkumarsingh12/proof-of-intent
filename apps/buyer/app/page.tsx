import { greyJacketIntent } from "@poi/contracts/fixtures";

// Owner: @srshriv. Spec: docs/specs/0001 (signing) and 0003 (checkout). Placeholder until M1.
export default function Home() {
  return (
    <main>
      <h1>Proof of Intent</h1>
      <p>Sign what you want, not just what you pay.</p>
      <h2>Coming in M1</h2>
      <ol>
        <li>Type your intent; the app turns it into an Intent Mandate.</li>
        <li>Sign it with a key that never leaves this browser.</li>
        <li>Your agent shops; the merchant checks the cart before PayPal takes any money.</li>
      </ol>
      <p>
        Example intent: <em>{greyJacketIntent.natural_language_description}</em>
      </p>
    </main>
  );
}
