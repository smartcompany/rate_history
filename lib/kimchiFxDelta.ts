import { readFileSync } from "fs";
import path from "path";

export const METHOD_QUINTILES = "equal_count_quintiles";
export const METHOD_AFFINE = "affine_fx_ratio";

export type KimchiFxDeltaBucket = {
  order: number;
  fxMinInclusive: number;
  fxMaxExclusive: number | null;
  fxMaxInclusive: number | null;
  deltaAddPp: number;
};

export type KimchiFxDeltaAffineRatio = {
  fxReference: number;
  biasPp: number;
  kPpPerFxPercent: number;
  highFxOnsetInclusive: number | null;
  kHiPpPerFxPercentSquared: number;
  clampMin: number | null;
  clampMax: number | null;
};

export type KimchiFxDeltaPayload = {
  buckets: KimchiFxDeltaBucket[];
  formulaModel: KimchiFxDeltaAffineRatio | null;
  method: string;
};

export type KimchiFxDeltaClientTuning = {
  method: string;
  affineFxReference: number;
  affineBiasPp: number;
  affineKPpPerFxPercent: number;
  affineHighFxOnsetInclusive: number | null;
  affineKHiPpPerFxPercentSquared: number;
  affineClampMin: number | null;
  affineClampMax: number | null;
  bucketDeltas: number[];
};

function parseAffineRatio(m: Record<string, unknown>): KimchiFxDeltaAffineRatio | null {
  if (m.type !== "affine_ratio") return null;
  const ref = Number(m.fx_reference);
  const k = Number(m.k_pp_per_fx_percent);
  const bias = Number(m.bias_pp);
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(k) || !Number.isFinite(bias)) {
    return null;
  }
  const onsetRaw = m.high_fx_onset_inclusive;
  const onset =
    onsetRaw != null && Number(onsetRaw) > 0 ? Number(onsetRaw) : null;
  const kHi = Number(m.k_hi_pp_per_fx_percent_squared ?? 0);
  const clampMin =
    m.clamp_min != null ? Number(m.clamp_min) : null;
  const clampMax =
    m.clamp_max != null ? Number(m.clamp_max) : null;
  return {
    fxReference: ref,
    biasPp: bias,
    kPpPerFxPercent: k,
    highFxOnsetInclusive: onset,
    kHiPpPerFxPercentSquared: Number.isFinite(kHi) ? kHi : 0,
    clampMin: clampMin != null && Number.isFinite(clampMin) ? clampMin : null,
    clampMax: clampMax != null && Number.isFinite(clampMax) ? clampMax : null,
  };
}

function parseBuckets(raw: unknown): KimchiFxDeltaBucket[] {
  if (!Array.isArray(raw)) return [];
  const list: KimchiFxDeltaBucket[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const min = Number(m.fx_min_inclusive);
    const d = Number(m.delta_add_pp);
    const dex = m.fx_max_exclusive != null ? Number(m.fx_max_exclusive) : null;
    const din = m.fx_max_inclusive != null ? Number(m.fx_max_inclusive) : null;
    if (!Number.isFinite(min) || !Number.isFinite(d)) continue;
    if (dex == null && din == null) continue;
    list.push({
      order: Number(m.order ?? 0),
      fxMinInclusive: min,
      fxMaxExclusive: dex != null && Number.isFinite(dex) ? dex : null,
      fxMaxInclusive: din != null && Number.isFinite(din) ? din : null,
      deltaAddPp: d,
    });
  }
  list.sort((a, b) => a.order - b.order);
  return list;
}

export function parseKimchiFxDeltaPayload(json: unknown): KimchiFxDeltaPayload | null {
  if (!json || typeof json !== "object") return null;
  const m = json as Record<string, unknown>;
  const method = m.method as string;
  if (method !== METHOD_QUINTILES && method !== METHOD_AFFINE) return null;

  const dm = m.delta_model;
  const formula =
    dm && typeof dm === "object"
      ? parseAffineRatio(dm as Record<string, unknown>)
      : null;
  const buckets = parseBuckets(m.buckets);

  if (method === METHOD_AFFINE) {
    if (!formula) return null;
    return { buckets, formulaModel: formula, method };
  }
  if (buckets.length === 0) return null;
  return { buckets, formulaModel: formula, method };
}

export function loadKimchiFxDeltaPayloadFromFile(): KimchiFxDeltaPayload | null {
  try {
    const filePath = path.join(process.cwd(), "data", "kimchi-fx-delta.json");
    const raw = readFileSync(filePath, "utf8");
    return parseKimchiFxDeltaPayload(JSON.parse(raw));
  } catch (e) {
    console.error("[kimchiFxDelta] load failed:", e);
    return null;
  }
}

function bucketContains(b: KimchiFxDeltaBucket, fx: number): boolean {
  if (fx < b.fxMinInclusive) return false;
  if (b.fxMaxExclusive != null) return fx < b.fxMaxExclusive;
  if (b.fxMaxInclusive != null) return fx <= b.fxMaxInclusive;
  return false;
}

function upperBoundInclusive(b: KimchiFxDeltaBucket): number {
  if (b.fxMaxInclusive != null) return b.fxMaxInclusive;
  if (b.fxMaxExclusive != null) return b.fxMaxExclusive - 1e-9;
  return b.fxMinInclusive;
}

function deltaFromAffine(model: KimchiFxDeltaAffineRatio, fx: number): number {
  if (fx <= 0 || model.fxReference <= 0) return model.biasPp;
  const x = (fx / model.fxReference - 1) * 100;
  let d = model.biasPp + model.kPpPerFxPercent * x;
  if (
    model.highFxOnsetInclusive != null &&
    model.kHiPpPerFxPercentSquared !== 0 &&
    fx >= model.highFxOnsetInclusive
  ) {
    const xOnset =
      (model.highFxOnsetInclusive / model.fxReference - 1) * 100;
    const xHi = Math.max(0, x - xOnset);
    d += model.kHiPpPerFxPercentSquared * xHi * xHi;
  }
  if (model.clampMin != null) d = Math.max(d, model.clampMin);
  if (model.clampMax != null) d = Math.min(d, model.clampMax);
  return d;
}

export function deltaForFx(payload: KimchiFxDeltaPayload, fx: number): number {
  if (payload.method === METHOD_AFFINE && payload.formulaModel) {
    return deltaFromAffine(payload.formulaModel, fx);
  }
  for (const b of payload.buckets) {
    if (bucketContains(b, fx)) return b.deltaAddPp;
  }
  if (payload.buckets.length === 0) return 0;
  const first = payload.buckets[0];
  const last = payload.buckets[payload.buckets.length - 1];
  if (fx < first.fxMinInclusive) return first.deltaAddPp;
  if (fx > upperBoundInclusive(last)) return last.deltaAddPp;
  return 0;
}

export function parseClientTuning(raw: unknown): KimchiFxDeltaClientTuning | null {
  if (raw == null) return null;
  let m: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      m = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof raw === "object") {
    m = raw as Record<string, unknown>;
  } else {
    return null;
  }

  const method = m.method as string;
  if (method !== METHOD_QUINTILES && method !== METHOD_AFFINE) return null;
  const aff = m.affine;
  if (!aff || typeof aff !== "object") return null;
  const a = aff as Record<string, unknown>;

  const ref = Number(a.fx_reference);
  const k = Number(a.k_pp_per_fx_percent);
  const bias = Number(a.bias_pp);
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(k) || !Number.isFinite(bias)) {
    return null;
  }

  const onsetRaw = a.high_fx_onset_inclusive;
  const onset =
    onsetRaw != null && Number(onsetRaw) > 0 ? Number(onsetRaw) : null;
  const kHi = Number(a.k_hi_pp_per_fx_percent_squared ?? 0);

  const bd: number[] = [];
  const bdRaw = m.bucket_deltas;
  if (Array.isArray(bdRaw)) {
    for (const e of bdRaw) {
      if (typeof e === "number" && Number.isFinite(e)) bd.push(e);
    }
  }

  return {
    method,
    affineFxReference: ref,
    affineBiasPp: bias,
    affineKPpPerFxPercent: k,
    affineHighFxOnsetInclusive: onset,
    affineKHiPpPerFxPercentSquared: Number.isFinite(kHi) ? kHi : 0,
    affineClampMin:
      a.clamp_min != null && Number.isFinite(Number(a.clamp_min))
        ? Number(a.clamp_min)
        : null,
    affineClampMax:
      a.clamp_max != null && Number.isFinite(Number(a.clamp_max))
        ? Number(a.clamp_max)
        : null,
    bucketDeltas: bd,
  };
}

export function mergeClientTuning(
  base: KimchiFxDeltaPayload,
  tuning: KimchiFxDeltaClientTuning,
): KimchiFxDeltaPayload {
  if (tuning.method === METHOD_AFFINE) {
    const formula: KimchiFxDeltaAffineRatio = {
      fxReference: tuning.affineFxReference,
      biasPp: tuning.affineBiasPp,
      kPpPerFxPercent: tuning.affineKPpPerFxPercent,
      highFxOnsetInclusive: tuning.affineHighFxOnsetInclusive,
      kHiPpPerFxPercentSquared: tuning.affineKHiPpPerFxPercentSquared,
      clampMin: tuning.affineClampMin,
      clampMax: tuning.affineClampMax,
    };
    return {
      buckets: base.buckets,
      formulaModel: formula,
      method: METHOD_AFFINE,
    };
  }

  const buckets = base.buckets.map((b, i) => ({
    ...b,
    deltaAddPp:
      i < tuning.bucketDeltas.length
        ? tuning.bucketDeltas[i]
        : b.deltaAddPp,
  }));
  return {
    buckets,
    formulaModel: base.formulaModel,
    method: METHOD_QUINTILES,
  };
}

export function effectivePayloadForUser(
  base: KimchiFxDeltaPayload | null,
  userData: Record<string, unknown> | null | undefined,
): KimchiFxDeltaPayload | null {
  if (!base) return null;
  const tuning = parseClientTuning(userData?.kimchiFxDeltaClientTuningJson);
  if (!tuning) return base;
  return mergeClientTuning(base, tuning);
}

export function deltaForFxWhenEnabled(
  base: KimchiFxDeltaPayload | null,
  userData: Record<string, unknown> | null | undefined,
  fx: number,
): number {
  const enabled = userData?.kimchiFxDeltaCorrection === true;
  if (!enabled) return 0;
  const payload = effectivePayloadForUser(base, userData);
  if (!payload) return 0;
  return deltaForFx(payload, fx);
}

/** 시뮬·푸시와 동일: 환율×(1+(임계−Δ)/100), FX 한도 적용. */
export function kimchiTradingPrices(
  exchangeRate: number,
  userData: Record<string, unknown> | null | undefined,
  basePayload: KimchiFxDeltaPayload | null,
): { buyPrice: number; sellPrice: number; deltaPp: number } {
  const buyPercent = Number(userData?.gimchiBuyPercent ?? 0);
  const sellPercent = Number(userData?.gimchiSellPercent ?? 1);
  const d = deltaForFxWhenEnabled(basePayload, userData, exchangeRate);
  const buyPrice = exchangeRate * (1 + (buyPercent - d) / 100);
  const sellPrice = exchangeRate * (1 + (sellPercent - d) / 100);
  return { buyPrice, sellPrice, deltaPp: d };
}

export function fxBlocksBuy(
  exchangeRate: number,
  userData: Record<string, unknown> | null | undefined,
): boolean {
  const fxBuyMax = Number(userData?.kimchiFxBuyMax ?? 2000);
  return fxBuyMax > 0 && exchangeRate > 0 && exchangeRate >= fxBuyMax;
}

export function fxBlocksSell(
  exchangeRate: number,
  userData: Record<string, unknown> | null | undefined,
): boolean {
  const fxSellMin = Number(userData?.kimchiFxSellMin ?? 0);
  return fxSellMin > 0 && exchangeRate > 0 && exchangeRate <= fxSellMin;
}
