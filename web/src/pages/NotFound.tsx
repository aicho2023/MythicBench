import { Page } from '../site/Layout'
import { Link } from '../site/router'

export function NotFound() {
  return (
    <Page>
      <div className="py-24">
        <h1 className="text-[28px] font-normal text-fg">Nothing here</h1>
        <p className="mt-3 text-[15px] text-fg-muted">This page doesn't exist. <Link to="/" className="text-fg underline decoration-white/30 underline-offset-4">Back to the leaderboard</Link></p>
      </div>
    </Page>
  )
}
