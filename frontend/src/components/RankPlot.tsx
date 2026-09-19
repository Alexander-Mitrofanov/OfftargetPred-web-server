import { useEffect, useMemo, useRef } from "react";
import type { CandidateComparison } from "../features/comparison";

/** Draw every jointly ranked site; the comparison table supplies exact values. */
export function RankPlot({ candidates, firstLabel, secondLabel }: {
  candidates: CandidateComparison[];
  firstLabel: string;
  secondLabel: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const points = useMemo(() => candidates.filter(item => item.a && item.b), [candidates]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !points.length) return;
    const draw = () => {
      const width = Math.max(260, element.clientWidth), height = 280;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      element.width = width * scale; element.height = height * scale;
      const context = element.getContext("2d");
      if (!context) return;
      context.scale(scale, scale); context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      const left = 52, top = 16, plotWidth = width - 74, plotHeight = height - 66;
      const maximum = points.reduce((highest, item) => Math.max(highest, item.a!.lastRank, item.b!.lastRank), 2);
      const x = (rank: number) => left + (rank - 1) / (maximum - 1) * plotWidth;
      const y = (rank: number) => top + (rank - 1) / (maximum - 1) * plotHeight;
      context.strokeStyle = "#d7e2ea"; context.lineWidth = 1;
      context.strokeRect(left, top, plotWidth, plotHeight);
      context.setLineDash([4, 4]); context.beginPath(); context.moveTo(x(1), y(1)); context.lineTo(x(maximum), y(maximum)); context.stroke(); context.setLineDash([]);
      context.fillStyle = points.length > 2000 ? "rgba(8,127,121,.16)" : "rgba(8,127,121,.65)";
      for (const item of points) {
        context.beginPath(); context.arc(x(item.a!.rank), y(item.b!.rank), points.length > 2000 ? 1.4 : 3, 0, 2 * Math.PI); context.fill();
      }
      context.fillStyle = "#16334a"; context.font = "12px system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText("1", left, height - 36); context.fillText(String(maximum), left + plotWidth, height - 36);
      context.fillText(`${firstLabel} rank`, left + plotWidth / 2, height - 12);
      context.textAlign = "right"; context.fillText("1", left - 8, top + 5); context.fillText(String(maximum), left - 8, top + plotHeight);
      context.save(); context.translate(14, top + plotHeight / 2); context.rotate(-Math.PI / 2); context.textAlign = "center";
      context.fillText(`${secondLabel} rank`, 0, 0); context.restore();
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(element);
    return () => observer.disconnect();
  }, [points, firstLabel, secondLabel]);
  if (!points.length) return null;
  return <figure className="model-rank-plot">
    <canvas ref={canvas} role="img" aria-label={`Rank comparison for all ${points.length} jointly scored candidates. Horizontal: ${firstLabel}; vertical: ${secondLabel}. Rank 1 is at the top left. Exact ranks are in the comparison table below.`} style={{ width: "100%", height: 280, display: "block" }} />
    <figcaption>All {points.length.toLocaleString()} jointly scored candidates. The dashed diagonal marks equal ranks; darker regions contain overlapping points. Use the table for exact ranks and selection.</figcaption>
  </figure>;
}
