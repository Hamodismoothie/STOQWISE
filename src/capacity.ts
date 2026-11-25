/**
 * Shared capacity contract for every inventory surface.
 *
 * A subscription's article allowance is the only limit that may reject customer
 * data. The platform capacity below is the ceiling the layout, analysis and Live
 * Warehouse are designed to represent; it is not a per-plan display limit.
 */
export const TECHNICAL_ITEM_CAPACITY = 500_000;

/** Above this many articles the browser receives hierarchical clusters, not one
 * slot object per article. The full data set remains searchable on the server. */
export const LIVE_DETAIL_SLOT_BUDGET = 2_000;

/** Articles represented by one expandable 3D cluster at very large volumes. */
export const LIVE_CLUSTER_SIZE = 250;

/** Bays/levels inside one expanded cluster (10 × 10 × 5 = 250 articles). */
export const CLUSTER_BAYS = 10;
export const CLUSTER_LEVELS = 5;
