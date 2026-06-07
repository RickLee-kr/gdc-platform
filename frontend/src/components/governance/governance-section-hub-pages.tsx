import { Link } from 'react-router-dom'
import { NAV_PATH } from '../../config/nav-paths'

type SectionHubProps = {
  title: string
  description: string
  testId: string
  primaryCta: { label: string; to: string; testId: string }
  secondaryCta?: { label: string; to: string; testId: string }
}

function GovernanceSectionHub({ title, description, testId, primaryCta, secondaryCta }: SectionHubProps) {
  return (
    <section
      className="rounded-xl border border-dashed border-slate-300/80 bg-slate-50/50 p-8 text-center dark:border-gdc-border dark:bg-gdc-card/40"
      data-testid={testId}
    >
      <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-[13px] text-slate-600 dark:text-gdc-muted">{description}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          to={primaryCta.to}
          data-testid={primaryCta.testId}
          className="rounded-md border border-violet-300/80 bg-violet-50 px-3 py-1.5 text-[12px] font-semibold text-violet-900 hover:bg-violet-100/80 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/20"
        >
          {primaryCta.label}
        </Link>
        {secondaryCta ? (
          <Link
            to={secondaryCta.to}
            data-testid={secondaryCta.testId}
            className="rounded-md border border-slate-200/90 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-gdc-border dark:text-slate-200 dark:hover:bg-gdc-rowHover"
          >
            {secondaryCta.label}
          </Link>
        ) : null}
      </div>
    </section>
  )
}

export { PolicyCatalogPage as GovernanceDataProtectionHubPage } from './policy-catalog-page'

export function GovernanceQuarantineHubPage() {
  return (
    <GovernanceSectionHub
      title="Quarantine"
      description="Review and release quarantined events across streams. Bulk queue workflows are planned — open pending items from the Dashboard risk overview or stream Monitoring today."
      testId="governance-quarantine-hub"
      primaryCta={{ label: 'Governance Dashboard', to: NAV_PATH.governance, testId: 'governance-quarantine-cta-dashboard' }}
      secondaryCta={{ label: 'View quarantine logs', to: `${NAV_PATH.logs}?stage=quarantine`, testId: 'governance-quarantine-cta-logs' }}
    />
  )
}

export function GovernanceReplayHubPage() {
  return (
    <GovernanceSectionHub
      title="Replay"
      description="Pending replay deliveries and recovery actions. Cross-stream recovery queue UI is planned — use the Dashboard and stream Monitoring Replay panel for now."
      testId="governance-replay-hub"
      primaryCta={{ label: 'Governance Dashboard', to: NAV_PATH.governance, testId: 'governance-replay-cta-dashboard' }}
      secondaryCta={{ label: 'View replay logs', to: `${NAV_PATH.logs}?stage=replay`, testId: 'governance-replay-cta-logs' }}
    />
  )
}
