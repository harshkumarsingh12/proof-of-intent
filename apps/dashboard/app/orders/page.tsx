import { serverApiBaseUrl } from "../../src/api";
import { fetchOrders } from "../../src/orders";
import { pageSubtitle, pageTitle } from "../../src/theme";
import { OrdersView } from "./OrdersView";

export const metadata = {
  title: "Agent orders · Proof of Intent operations",
  description: "Every agent checkout: the verdict, its reason codes, and what reached PayPal",
};

// Load on the server at request time, so the grid arrives filled and never shows build-time data.
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const data = await fetchOrders({ apiBaseUrl: serverApiBaseUrl() });
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div className="poi-page-head" style={{ marginBottom: 24 }}>
        <h1 style={pageTitle}>Agent orders</h1>
        <p style={pageSubtitle}>
          Every cart an agent proposed, the verdict against the shopper&apos;s signed mandate, and what reached
          PayPal.
        </p>
      </div>
      <OrdersView data={data} />
    </div>
  );
}
