"use client";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  LabelList,
} from "recharts";

interface LeadsByMonthChartProps {
  data: Array<{ month: string; leads: number }>;
}

/** Reads a CSS custom property from :root at runtime (avoids SVG css-var issues). */
function useCssVar(name: string, fallback: string) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    if (v) setValue(v);
  }, [name]);
  return value;
}

export function LeadsByMonthChart({ data }: LeadsByMonthChartProps) {
  const primary = useCssVar("--primary", "#3b82f6");
  const border = useCssVar("--border", "#e5e7eb");
  const mutedFg = useCssVar("--muted-foreground", "#6b7280");
  const card = useCssVar("--card", "#ffffff");

  const maxLeads = Math.max(...data.map((d) => d.leads), 0);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 24, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primary} stopOpacity={1} />
            <stop offset="100%" stopColor={primary} stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke={border}
          opacity={0.6}
        />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: mutedFg }}
          axisLine={false}
          tickLine={false}
          tickMargin={10}
        />
        <YAxis
          tick={{ fontSize: 12, fill: mutedFg }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          tickMargin={10}
        />
        <Tooltip
          cursor={{ fill: primary, opacity: 0.06 }}
          contentStyle={{
            background: card,
            border: `1px solid ${border}`,
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            fontSize: 12,
            fontWeight: 500,
          }}
          itemStyle={{ color: primary, fontWeight: 700 }}
        />
        <Bar dataKey="leads" name="Leads" radius={[6, 6, 0, 0]} maxBarSize={44}>
          <LabelList
            dataKey="leads"
            position="top"
            style={{ fontSize: 11, fontWeight: 700, fill: mutedFg }}
            formatter={(v) => (Number(v) === 0 ? "" : v)}
          />
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.leads === maxLeads && maxLeads > 0 ? primary : `url(#barGradient)`}
              opacity={entry.leads === 0 ? 0.2 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
