"use client";

// shadcn/ui's chart, trimmed to the container the report uses: its tooltip and legend parts are
// left out until a chart needs them. Colors are plain values, usually theme variables such as
// var(--color-primary), which already follow prefers-color-scheme; shadcn's light/dark theme
// pairs keyed on a .dark class are dropped, since troba has no such class. Recharts 3.10 names
// axis tick text recharts-cartesian-axis-tick-value, so the tick selector targets that.

import * as React from "react";
import { cn } from "cn";
import * as RechartsPrimitive from "recharts";

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;

export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  height,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  // A height in pixels, for a chart whose height follows its data; otherwise the container's
  // aspect ratio sets it.
  height?: number;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick-value]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension} height={height}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

// Each configured color as --color-<key> on this chart, for its series to use.
const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colors = Object.entries(config).filter(([, item]) => item.color);

  if (!colors.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colors
          .map(([key, item]) => `  --color-${key}: ${item.color};`)
          .join("\n")}\n}`,
      }}
    />
  );
};

export { ChartContainer, ChartStyle, useChart };
