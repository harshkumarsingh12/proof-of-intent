// Grey placeholder bars shown while a page loads (Next.js loading.tsx). Uses .poi-skeleton from src/theme.ts.
import { card } from "../src/theme";

export function Bar({ width = "100%", height = 16, style }: { width?: number | string; height?: number; style?: React.CSSProperties }) {
  return <div className="poi-skeleton" style={{ width, height, ...style }} />;
}

/** Title, subtitle, then `blocks` cards of lines: the common shape of every page here. */
export function PageSkeleton({ blocks = 2, lines = 3 }: { blocks?: number; lines?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" style={{ maxWidth: 1400, margin: "0 auto" }}>
      <Bar width={320} height={40} style={{ marginBottom: 14 }} />
      <Bar width={520} height={18} style={{ marginBottom: 36 }} />
      {Array.from({ length: blocks }, (_, b) => (
        <div key={b} style={{ ...card, padding: 32, marginBottom: 28 }}>
          <Bar width="40%" height={22} style={{ marginBottom: 22 }} />
          {Array.from({ length: lines }, (_, i) => (
            <Bar key={i} width={`${92 - i * 11}%`} style={{ marginBottom: 14 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
