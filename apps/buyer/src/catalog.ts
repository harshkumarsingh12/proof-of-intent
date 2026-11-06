/**
 * What the shop sells: the shared demo store in packages/contracts/src/catalog.ts, so the shop, the buyer agent,
 * the recorded J1 answers (packages/ai/replay) and the demo seed all talk about the same products.
 */
export {
  CATALOG,
  CATEGORIES,
  COLORS,
  PRESETS,
  categoryLabel,
  presetFor,
  productBySku,
  productsIn,
  type Product,
  type ShopperPreset,
} from "@poi/contracts/catalog";
