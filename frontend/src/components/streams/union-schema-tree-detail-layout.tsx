import { useMemo } from 'react'
import { cn } from '../../lib/utils'
import { unionSchemaFieldMap } from '../../utils/unionSchema'
import { UnionFieldDetailPanel } from './union-field-detail-panel'
import { UnionSchemaTree, type UnionSchemaTreeProps } from './union-schema-tree'

export type UnionSchemaTreeDetailLayoutProps = UnionSchemaTreeProps & {
  selectedPath: string | null
  onSelectPath: (path: string) => void
  className?: string
}

export function UnionSchemaTreeDetailLayout({
  schema,
  selectedPath,
  onSelectPath,
  className,
  ...treeProps
}: UnionSchemaTreeDetailLayoutProps) {
  const selectedField = useMemo(() => {
    if (!selectedPath) return null
    return unionSchemaFieldMap(schema).get(selectedPath) ?? null
  }, [schema, selectedPath])

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col gap-2 xl:flex-row xl:gap-0', className)}
      data-testid="union-schema-tree-detail-layout"
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-auto xl:pr-2">
        <UnionSchemaTree
          {...treeProps}
          schema={schema}
          selectedPath={selectedPath}
          onSelectPath={onSelectPath}
        />
      </div>
      <div className="shrink-0 border-t border-slate-200/70 pt-2 dark:border-gdc-border xl:w-[38%] xl:min-w-[140px] xl:max-w-[220px] xl:border-l xl:border-t-0 xl:pl-2 xl:pt-0">
        <UnionFieldDetailPanel field={selectedField} schema={schema} />
      </div>
    </div>
  )
}
