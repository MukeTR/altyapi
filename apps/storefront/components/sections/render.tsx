import type { RenderSection } from "@altyapi/theme-engine";
import type { RenderCtx } from "../context";
import {
  CountdownSection, Faq, Hero, ImageBanner, ImageWithText, LogoCloud, Newsletter, RichText, SliderSection, Testimonials, Video,
  countdownHeading, faqHeading, heroHeading, imageWithTextHeading, logoCloudHeading, newsletterHeading, richTextHeading, sliderHeading, testimonialsHeading, videoHeading,
} from "./content";
import {
  CartMain, CategoryCards, CollectionMain, FeaturedCollection, NotFoundMain, ProductGrid, ProductMain, SearchMain,
  categoryCardsHeading, collectionMainOwnsH1, featuredCollectionHeading, productGridHeading, productMainOwnsH1,
} from "./commerce";
import { AnnouncementBarSection, Footer, Header, PopupSection } from "./layout";

/** Tag of a section's main heading: the page's single H1, or H2. */
export type HeadingTag = "h1" | "h2";

export type Renderer = (props: { s: RenderSection; ctx: RenderCtx; index: number; heading: HeadingTag }) => React.ReactNode;

interface RendererEntry {
  render: Renderer;
  /** Main heading text exactly as the section will render it; empty when it renders none. */
  heading?: (s: RenderSection, ctx: RenderCtx) => string;
  /** The section renders the page's H1 itself (product, collection, search, cart, not found). */
  ownsH1?: (s: RenderSection, ctx: RenderCtx) => boolean;
}

const always = () => true;

/** Renderer ids from section definitions → components. Unknown renderers render nothing. */
const RENDERERS: Record<string, RendererEntry> = {
  "builtin:announcement-bar@1": { render: AnnouncementBarSection },
  "builtin:header@1": { render: Header },
  "builtin:footer@1": { render: Footer },
  "builtin:hero@1": { render: Hero, heading: heroHeading },
  "builtin:image-banner@1": { render: ImageBanner },
  "builtin:slider@1": { render: SliderSection, heading: sliderHeading },
  "builtin:rich-text@1": { render: RichText, heading: richTextHeading },
  "builtin:featured-collection@1": { render: FeaturedCollection, heading: featuredCollectionHeading },
  "builtin:product-grid@1": { render: ProductGrid, heading: productGridHeading },
  "builtin:category-cards@1": { render: CategoryCards, heading: categoryCardsHeading },
  "builtin:image-with-text@1": { render: ImageWithText, heading: imageWithTextHeading },
  "builtin:video@1": { render: Video, heading: videoHeading },
  "builtin:testimonials@1": { render: Testimonials, heading: testimonialsHeading },
  "builtin:logo-cloud@1": { render: LogoCloud, heading: logoCloudHeading },
  "builtin:newsletter@1": { render: Newsletter, heading: newsletterHeading },
  "builtin:faq@1": { render: Faq, heading: faqHeading },
  "builtin:countdown@1": { render: CountdownSection, heading: countdownHeading },
  "builtin:popup@1": { render: PopupSection },
  "builtin:product-main@1": { render: ProductMain, ownsH1: productMainOwnsH1 },
  "builtin:collection-main@1": { render: CollectionMain, ownsH1: collectionMainOwnsH1 },
  "builtin:search-main@1": { render: SearchMain, ownsH1: always },
  "builtin:cart-main@1": { render: CartMain, ownsH1: always },
  "builtin:not-found-main@1": { render: NotFoundMain, ownsH1: always },
};

export function registerRenderer(id: string, renderer: Renderer, options: Omit<RendererEntry, "render"> = {}) {
  RENDERERS[id] = { render: renderer, ...options };
}

type HeadingPlan = { h1SectionId: string | null; fallbackTitle: string | null };

/** Rendered for every visitor on every screen size (no client targeting, no responsive hiding). */
const alwaysShown = (s: RenderSection) => !s.visibility && !s.settings?.hideOn?.length;

/**
 * Every page gets exactly one H1. Page-kind main sections (product, collection, search,
 * cart, not found) render their own; otherwise the first section that renders a main
 * heading takes it and every other section heading is an H2. A page without any heading
 * gets a visually hidden H1 with its title. Sections behind client-side targeting or hidden
 * on some screen sizes (settings.hideOn) are skipped: they may be hidden for a visitor, and
 * the H1 must not disappear with them.
 */
function planHeadings(sections: RenderSection[], ctx: RenderCtx): HeadingPlan {
  let candidate: string | null = null;
  for (const s of sections) {
    const entry = RENDERERS[s.renderer];
    if (!entry) continue;
    if (entry.ownsH1?.(s, ctx)) return { h1SectionId: null, fallbackTitle: null };
    if (!candidate && alwaysShown(s) && entry.heading?.(s, ctx)) candidate = s.id;
  }
  if (candidate) return { h1SectionId: candidate, fallbackTitle: null };
  return { h1SectionId: null, fallbackTitle: ctx.route?.seo.title || ctx.site.name };
}

export function Sections({ sections, ctx }: { sections: RenderSection[]; ctx: RenderCtx }) {
  // Global sections (header, footer, popups) render without a route and never take the H1.
  const plan: HeadingPlan = ctx.route ? planHeadings(sections, ctx) : { h1SectionId: null, fallbackTitle: null };
  return (
    <>
      {plan.fallbackTitle && <h1 className="sr-only">{plan.fallbackTitle}</h1>}
      {sections.map((s, index) => {
        const entry = RENDERERS[s.renderer];
        if (!entry) return null;
        const R = entry.render;
        return <R key={s.id} s={s} ctx={ctx} index={index} heading={s.id === plan.h1SectionId ? "h1" : "h2"} />;
      })}
    </>
  );
}
