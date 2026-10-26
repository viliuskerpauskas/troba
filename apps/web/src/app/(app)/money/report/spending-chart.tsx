"use client";

import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

type ChartBar = {
  name: string;
  // Bars are as long as their share: every bar is over the same total, so the proportions are
  // the amounts', and no amount goes through a float. Labels are the server-formatted amounts.
  shareBasisPoints: number;
  label: string;
};

const barHeight = 36;

// A client component because Recharts measures and draws in the browser. The table beside it
// carries the same figures, so the chart is one image to assistive technology. Bars take the
// primary color, which contrasts with the background in light and dark.
export function SpendingChart({ bars, title }: { bars: ChartBar[]; title: string }) {
  return (
    <figure role="img" aria-label={title} className="m-0 w-full">
      <ChartContainer height={bars.length * barHeight + 16} className="aspect-auto">
        <BarChart data={bars} layout="vertical" margin={{ top: 8, right: 96, bottom: 8, left: 8 }}>
          <XAxis type="number" dataKey="shareBasisPoints" hide />
          <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} />
          <Bar
            dataKey="shareBasisPoints"
            fill="var(--color-primary)"
            radius={4}
            isAnimationActive={false}
          >
            <LabelList dataKey="label" position="right" className="fill-foreground" />
          </Bar>
        </BarChart>
      </ChartContainer>
    </figure>
  );
}
