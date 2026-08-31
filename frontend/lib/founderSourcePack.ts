/** Curated Phase 1 RSS pack for AI founders — no OAuth required. */

export type FounderPackSource = {
  name: string;
  identifier: string;
};

export const FOUNDER_INTELLIGENCE_PACK: FounderPackSource[] = [
  { name: "Product Hunt", identifier: "https://www.producthunt.com/feed" },
  { name: "Show HN", identifier: "https://hnrss.org/show" },
  { name: "The Rundown AI", identifier: "https://www.therundown.ai/rss" },
  { name: "Simon Willison's Blog", identifier: "https://simonwillison.net/atom/everything/" },
  { name: "The Batch (DeepLearning.AI)", identifier: "https://www.deeplearning.ai/the-batch/feed/" },
  { name: "Interconnects", identifier: "https://www.interconnects.ai/feed" },
  { name: "a16z Blog", identifier: "https://a16z.com/feed/" },
  { name: "YC Blog", identifier: "https://www.ycombinator.com/blog/rss.xml" },
];

export const FOUNDER_PACK_BLURB =
  "Product Hunt, Show HN, The Batch, a16z, YC, Simon Willison";
