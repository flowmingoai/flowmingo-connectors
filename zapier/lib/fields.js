'use strict'

// Zapier hands mapped values over as text; the API refuses a boolean or a number sent as text (docs §8.1).
const toBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (['true', 'yes', '1'].includes(text)) return true
  if (['false', 'no', '0'].includes(text)) return false
  return fallback
}

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

// Drops keys whose value is empty so an unset optional field is left out rather than sent as "".
const compact = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''))

const projectField = (overrides = {}) => ({
  key: 'com_project_id',
  label: 'Hiring Project',
  dynamic: 'project_list.id.title',
  altersDynamicFields: true,
  ...overrides
})

const stageField = (overrides = {}) => ({
  key: 'com_stage_id',
  label: 'Stage',
  dynamic: 'stage_list.id.name',
  helpText: 'Pick the hiring project first: its stages are listed here.',
  ...overrides
})

const jobPostField = (overrides = {}) => ({
  key: 'com_job_post_id',
  label: 'Job Post',
  dynamic: 'job_post_list.id.title',
  required: false,
  ...overrides
})

module.exports = { toBoolean, toNumber, compact, projectField, stageField, jobPostField }
