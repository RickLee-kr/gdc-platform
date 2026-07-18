/**
 * Coherent governance / collection bundles.
 * These are the valid cartesian of dependent governance axes (invalid tuples never emitted).
 * Underlying axis fields are still materialized on every combination for evidence/oracle.
 */
import type {
  ClassificationProfile,
  DedupStrategy,
  IncrementalFetch,
  SensitiveDetectionProfile,
  UnknownFieldPolicy,
  UnknownFieldType,
} from './cross-product-types.js'

export type GovernanceBundleId =
  | 'GOV_NONE'
  | 'GOV_NORMAL_PASS'
  | 'GOV_NORMAL_DROP'
  | 'GOV_NORMAL_QUARANTINE'
  | 'GOV_SENSITIVE_PASS'
  | 'GOV_SENSITIVE_AUTO'
  | 'GOV_SENSITIVE_DROP'
  | 'GOV_SENSITIVE_QUARANTINE'

export type GovernanceBundle = {
  id: GovernanceBundleId
  unknown_field_type: UnknownFieldType
  unknown_field_policy: UnknownFieldPolicy
  sensitive_detection_profile: SensitiveDetectionProfile
  classification_profile: ClassificationProfile
}

/** Full valid governance cartesian (normal vs sensitive separated; AUTO_PROTECT only with sensitive match). */
export const GOVERNANCE_BUNDLES: GovernanceBundle[] = [
  {
    id: 'GOV_NONE',
    unknown_field_type: 'NONE',
    unknown_field_policy: 'NONE',
    sensitive_detection_profile: 'OFF',
    classification_profile: 'NONE',
  },
  {
    id: 'GOV_NORMAL_PASS',
    unknown_field_type: 'NORMAL',
    unknown_field_policy: 'PASS_THROUGH',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
  },
  {
    id: 'GOV_NORMAL_DROP',
    unknown_field_type: 'NORMAL',
    unknown_field_policy: 'DROP_FIELD',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
  },
  {
    id: 'GOV_NORMAL_QUARANTINE',
    unknown_field_type: 'NORMAL',
    unknown_field_policy: 'QUARANTINE',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
  },
  {
    id: 'GOV_SENSITIVE_PASS',
    unknown_field_type: 'SENSITIVE',
    unknown_field_policy: 'PASS_THROUGH',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
  },
  {
    id: 'GOV_SENSITIVE_AUTO',
    unknown_field_type: 'SENSITIVE',
    unknown_field_policy: 'AUTO_PROTECT',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
  },
  {
    id: 'GOV_SENSITIVE_DROP',
    unknown_field_type: 'SENSITIVE',
    unknown_field_policy: 'DROP_FIELD',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
  },
  {
    id: 'GOV_SENSITIVE_QUARANTINE',
    unknown_field_type: 'SENSITIVE',
    unknown_field_policy: 'QUARANTINE',
    sensitive_detection_profile: 'ON',
    classification_profile: 'CONFIDENTIAL',
  },
]

export type CollectionBundle = {
  id: string
  incremental_fetch: IncrementalFetch
  dedup_strategy: DedupStrategy
}

export const COLLECTION_BUNDLES: CollectionBundle[] = [
  { id: 'COLL_NONE', incremental_fetch: 'OFF', dedup_strategy: 'OFF' },
  { id: 'COLL_DEDUP', incremental_fetch: 'OFF', dedup_strategy: 'EVENT_ID_SKIP_DUPLICATE' },
  { id: 'COLL_INCR', incremental_fetch: 'ON', dedup_strategy: 'OFF' },
  { id: 'COLL_INCR_DEDUP', incremental_fetch: 'ON', dedup_strategy: 'EVENT_ID_SKIP_DUPLICATE' },
]

/** Default chain partners for fault/recovery (checkpoint + dedup + replay assertions). */
export const FAULT_CHAIN_GOVERNANCE = GOVERNANCE_BUNDLES.find((b) => b.id === 'GOV_SENSITIVE_AUTO')!
export const FAULT_CHAIN_COLLECTION = COLLECTION_BUNDLES.find((b) => b.id === 'COLL_INCR_DEDUP')!
export const COMPOSITION_GOVERNANCE = GOVERNANCE_BUNDLES.find((b) => b.id === 'GOV_NORMAL_PASS')!
export const COMPOSITION_COLLECTION = COLLECTION_BUNDLES.find((b) => b.id === 'COLL_DEDUP')!
