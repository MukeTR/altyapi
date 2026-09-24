import type { RenderSection } from "@altyapi/theme-engine";
import type { RenderCtx } from "../context";
import { CountdownSection, Faq, Hero, ImageBanner, ImageWithText, LogoCloud, Newsletter, RichText, SliderSection, Testimonials, Video } from "./content";
import { CartMain, CategoryCards, CollectionMain, FeaturedCollection, NotFoundMain, ProductGrid, ProductMain, SearchMain } from "./commerce";
import { AnnouncementBarSection, Footer, Header, PopupSection } from "./layout";

type Renderer = (props: { s: RenderSection; ctx: RenderCtx; index: number }) => React.ReactNode;

/** Renderer ids from section definitions → components. Unknown renderers render nothing. */
const RENDERERS: Record<string, Renderer> = {
  "builtin:announcement-bar@1": AnnouncementBarSection,
  "builtin:header@1": Header,
  "builtin:footer@1": Footer,
  "builtin:hero@1": Hero,
  "builtin:image-banner@1": ImageBanner,
  "builtin:slider@1": SliderSection,
  "builtin:rich-text@1": RichText,
  "builtin:featured-collection@1": FeaturedCollection,
  "builtin:product-grid@1": ProductGrid,
  "builtin:category-cards@1": CategoryCards,
  "builtin:image-with-text@1": ImageWithText,
  "builtin:video@1": Video,
  "builtin:testimonials@1": Testimonials,
  "builtin:logo-cloud@1": LogoCloud,
  "builtin:newsletter@1": Newsletter,
  "builtin:faq@1": Faq,
  "builtin:countdown@1": CountdownSection,
  "builtin:popup@1": PopupSection,
  "builtin:product-main@1": ProductMain,
  "builtin:collection-main@1": CollectionMain,
  "builtin:search-main@1": SearchMain,
  "builtin:cart-main@1": CartMain,
  "builtin:not-found-main@1": NotFoundMain,
};

export function registerRenderer(id: string, renderer: Renderer) {
  RENDERERS[id] = renderer;
}

export function Sections({ sections, ctx }: { sections: RenderSection[]; ctx: RenderCtx }) {
  return (
    <>
      {sections.map((s, index) => {
        const R = RENDERERS[s.renderer];
        return R ? <R key={s.id} s={s} ctx={ctx} index={index} /> : null;
      })}
    </>
  );
}
