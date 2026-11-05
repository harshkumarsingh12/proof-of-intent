// One quiet notice for every page that falls back to seed data while its API route is still being built.
import { InfoIcon } from "./icons";
import { v } from "../src/theme";

export function SampleDataNotice({ children }: { children: string }) {
  return (
    <div
      role="note"
      data-testid="sample-data-notice"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 10,
        background: v("infoBg"),
        color: v("text"),
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <InfoIcon size={16} style={{ flexShrink: 0, marginTop: 1, color: v("blue") }} />
      <span>
        <strong>Sample data.</strong> {children}
      </span>
    </div>
  );
}
