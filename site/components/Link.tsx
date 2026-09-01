import NextLink from 'next/link'
import type { ComponentProps } from 'react'

/**
 * Every internal route. `scroll={false}` is the whole reason this wrapper
 * exists: Next's own reset puts the new page at the top in the same frame it
 * renders, and `ScrollToTop` cannot animate a jump that has already happened.
 */
export function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink scroll={false} {...props} />
}
