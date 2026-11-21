import type { AnchorHTMLAttributes } from 'react'
import { Page } from '../site/Layout'
import { Link } from '../site/router'
import Content from './paper.mdx'

/** Site links in the markdown navigate without a page load. */
function MdxLink({ href = '', ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return href.startsWith('/') ? <Link to={href} {...rest} /> : <a href={href} {...rest} />
}

export function Paper() {
  return (
    <Page>
      <article className="prose mx-auto max-w-[720px] py-12 md:py-16">
        <Content components={{ a: MdxLink }} />
      </article>
    </Page>
  )
}
