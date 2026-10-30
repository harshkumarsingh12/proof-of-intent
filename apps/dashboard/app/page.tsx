// Owner: @hoursgotviral-dev. Spec: docs/specs/0007-dashboard.md. AG Studio lands once the trial key is in.
const pages = [
  ["Agent orders", "Grid of agent orders with verdicts and reason codes"],
  ["Verification queue", "STEP_UP carts with time left; opens the mandate diff"],
  ["Disputes", "Sorted by response deadline; recommendation, evidence preview, operator actions"],
  ["Analytics", "Disputes by class, overreach rate by agent platform, defended vs conceded"],
];

export default function Home() {
  return (
    <main>
      <h1>Proof of Intent · Operations</h1>
      <ul>
        {pages.map(([name, desc]) => (
          <li key={name}>
            <strong>{name}</strong>: {desc}
          </li>
        ))}
      </ul>
    </main>
  );
}
