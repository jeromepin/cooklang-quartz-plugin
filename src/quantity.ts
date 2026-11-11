import type { Quantity } from "./types";

// Quantity grouping for the ingredient list, following cooklang-rs' `GroupedQuantity`
// (src/quantity.rs): a definition and all its `@&` references are summed when their units
// are compatible, and kept side by side otherwise so no information is lost.
//
//   - text values ("un peu")             -> never summed, kept as-is
//   - no unit                            -> summed together
//   - known unit (mass/volume, metric)   -> converted to the first unit seen, then summed
//   - unknown unit ("c.à.s", "gousses")  -> summed only with the exact same unit text
//   - ranges                             -> summed endpoint-wise (100 + 200-400 = 300-500)

export type GroupValue =
  | { kind: "number"; value: number; raw?: string }
  | { kind: "range"; low: number; high: number; raw?: { low: string; high: string } }
  | { kind: "text"; value: string };

export interface GroupedQuantityItem {
  value: GroupValue;
  unit: string | null;
}

type Dimension = "mass" | "volume";

// Subset of cooklang-rs' default converter: the metric units actually used in recipes.
// Keys are lowercased so "cL", "cl" and "CL" all resolve.
const KNOWN_UNITS: Record<string, { dim: Dimension; factor: number }> = {
  mg: { dim: "mass", factor: 0.001 },
  g: { dim: "mass", factor: 1 },
  kg: { dim: "mass", factor: 1000 },
  ml: { dim: "volume", factor: 1 },
  cl: { dim: "volume", factor: 10 },
  dl: { dim: "volume", factor: 100 },
  l: { dim: "volume", factor: 1000 },
};

// Units a summed total is re-expressed in (largest first), like cooklang-rs' `fit`.
const FIT_UNITS: Record<Dimension, { unit: string; factor: number }[]> = {
  mass: [
    { unit: "kg", factor: 1000 },
    { unit: "g", factor: 1 },
  ],
  volume: [
    { unit: "L", factor: 1000 },
    { unit: "cL", factor: 10 },
    { unit: "mL", factor: 1 },
  ],
};

function knownUnit(unit: string): { dim: Dimension; factor: number } | undefined {
  return KNOWN_UNITS[unit.trim().toLowerCase()];
}

export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(s) || /^\.\d+$/.test(s)) return Number(s);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac?.[1] && frac[2] && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2]);
  return null;
}

function toValue(q: Quantity): GroupValue | null {
  if (q.kind === "none") return null;
  if (q.kind === "range") {
    const low = parseNumber(q.low);
    const high = parseNumber(q.high);
    if (low === null || high === null) return { kind: "text", value: `${q.low}-${q.high}` };
    return { kind: "range", low, high, raw: { low: q.low, high: q.high } };
  }
  const n = parseNumber(q.value);
  return n === null ? { kind: "text", value: q.value } : { kind: "number", value: n, raw: q.value };
}

type NumericValue = Exclude<GroupValue, { kind: "text" }>;

// Arithmetic drops `raw`: once two values are combined, the original spelling no longer applies.
function addValues(a: NumericValue, b: NumericValue): NumericValue {
  if (a.kind === "number" && b.kind === "number")
    return { kind: "number", value: a.value + b.value };
  const [aLow, aHigh] = a.kind === "number" ? [a.value, a.value] : [a.low, a.high];
  const [bLow, bHigh] = b.kind === "number" ? [b.value, b.value] : [b.low, b.high];
  return { kind: "range", low: aLow + bLow, high: aHigh + bHigh };
}

function scaleValue(v: NumericValue, factor: number): NumericValue {
  if (factor === 1) return v;
  return v.kind === "number"
    ? { kind: "number", value: v.value * factor }
    : { kind: "range", low: v.low * factor, high: v.high * factor };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function formatNumber(n: number): string {
  return String(round(n));
}

interface KnownBucket {
  kind: "known";
  dim: Dimension;
  unit: string;
  factor: number;
  value: NumericValue;
  summed: boolean;
}

interface PlainBucket {
  kind: "plain";
  unit: string | null;
  value: NumericValue;
}

export class GroupedQuantity {
  private buckets: (KnownBucket | PlainBucket)[] = [];
  private other: GroupedQuantityItem[] = [];

  add(quantity: Quantity, unit: string | null): void {
    const value = toValue(quantity);
    if (!value) return;

    if (value.kind === "text") {
      this.other.push({ value, unit });
      return;
    }

    const known = unit ? knownUnit(unit) : undefined;
    if (unit && known) {
      const bucket = this.buckets.find(
        (b): b is KnownBucket => b.kind === "known" && b.dim === known.dim,
      );
      if (!bucket) {
        this.buckets.push({
          kind: "known",
          dim: known.dim,
          unit,
          factor: known.factor,
          value,
          summed: false,
        });
        return;
      }
      bucket.value = addValues(bucket.value, scaleValue(value, known.factor / bucket.factor));
      bucket.summed = true;
      return;
    }

    const bucket = this.buckets.find(
      (b): b is PlainBucket => b.kind === "plain" && b.unit === unit,
    );
    if (!bucket) {
      this.buckets.push({ kind: "plain", unit, value });
      return;
    }
    bucket.value = addValues(bucket.value, value);
  }

  isEmpty(): boolean {
    return this.buckets.length === 0 && this.other.length === 0;
  }

  toList(): GroupedQuantityItem[] {
    const items: GroupedQuantityItem[] = this.buckets.map((b) =>
      b.kind === "known" && b.summed ? fit(b) : b,
    );
    return [...items.map(({ value, unit }) => ({ value: roundValue(value), unit })), ...this.other];
  }
}

function roundValue(v: GroupValue): GroupValue {
  if (v.kind === "number") return { ...v, value: round(v.value) };
  if (v.kind === "range") return { ...v, low: round(v.low), high: round(v.high) };
  return v;
}

// Re-express a summed total (e.g. 1000 g + 200 g) in the largest unit where it is >= 1.
// Single, unsummed quantities keep the unit the author wrote.
function fit(bucket: KnownBucket): GroupedQuantityItem {
  const base = scaleValue(bucket.value, bucket.factor);
  const smallest = base.kind === "number" ? base.value : base.low;
  const candidates = FIT_UNITS[bucket.dim];
  const target =
    candidates.find((c) => smallest / c.factor >= 1) ?? candidates[candidates.length - 1]!;
  return { value: scaleValue(base, 1 / target.factor), unit: target.unit };
}
