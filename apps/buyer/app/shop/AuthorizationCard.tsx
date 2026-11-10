"use client";

// What the shopper authorized (#176), read only from the intent they signed. A display: it signs and changes nothing.
import type { IntentMandate } from "@poi/contracts";
import { Fragment } from "react";
import { authorizationRows } from "../../src/authorization";

export default function AuthorizationCard({ intent }: { intent: IntentMandate }) {
  return (
    <dl className="authz" aria-label="What you authorized">
      {authorizationRows(intent).map((row) => (
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
