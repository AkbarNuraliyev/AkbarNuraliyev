import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * App-wide link. Every page is rendered per request from the tenant's data, so
 * viewport prefetching would run a full server render (and database queries)
 * for each visible link. Prefetch is therefore opt-in; navigation fetches on click.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
