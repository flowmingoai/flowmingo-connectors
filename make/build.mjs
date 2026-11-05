// Writes the Flowmingo custom app for Make into ./src, in the local-project layout of Make's VS Code extension
// ("Make Apps Editor": makecomapp.json + one folder per component). The trigger modules come from
// ../shared/contract.json, so a new event type there becomes a new Watch module here.
//
//   node build.mjs           regenerate ./src
//   node build.mjs --check   fail if ./src differs from what the contract and this file produce
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SRC = join(ROOT, 'src')
const contract = JSON.parse(readFileSync(join(ROOT, '..', 'shared', 'contract.json'), 'utf8'))
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const USER_AGENT = `flowmingo-make/${VERSION}`
const CONNECTION = 'flowmingo'
// The list routes clamp `limit` to 100 and the events feed to its own max_limit: Make reads at those sizes and
// stops at the user's Limit, so a page size never caps what a run can return.
const LIST_PAGE_SIZE = 100
const FEED_PAGE_SIZE = contract.events_feed.max_limit
// Every date the API sends is an ISO 8601 date-time from JSON.stringify(Date), for example 2026-10-20T09:15:30.123Z.
const ISO_DATE = 'YYYY-MM-DDTHH:mm:ss.SSSZ'

// ── Labels ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const FIELD_LABELS = {
  event_id: 'Event ID',
  event_type: 'Event type',
  sub_event: 'Sub-event',
  timestamp: 'Recorded at',
  application_id: 'Application ID',
  com_project_id: 'Hiring project ID',
  com_job_post_id: 'Job post ID',
  com_stage_id: 'Stage ID',
  com_stage_from_id: 'Previous stage ID',
  tal_candidate_id: 'Candidate ID',
  candidate_id: 'Candidate ID',
  candidate_email: 'Candidate email',
  interview_set_id: 'Assessment ID',
  interview_name: 'Assessment name',
  submission_id: 'Result ID',
  submission_url: 'Result URL',
  invitation_id: 'Invitation ID',
  set_type: 'Assessment kind (number)',
  score_percent: 'Score (percent)',
  report_url: 'Report URL',
  is_practice: 'Practice run',
  activity_id: 'Activity ID'
}

const humanize = (key) =>
  FIELD_LABELS[key] ??
  key
    .split('_')
    .map((word) => ({ id: 'ID', url: 'URL', cv: 'CV', ai: 'AI' })[word] ?? word)
    .join(' ')
    .replace(/^./, (first) => first.toUpperCase())

const isDateField = (key) => key === 'timestamp' || key.endsWith('_at')

const fieldType = (key, value) => {
  if (isDateField(key)) return 'date'
  if (key.endsWith('_url')) return 'url'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'text'
}

// ── Dates and outputs ──────────────────────────────────────────────────────────────────────────────────────────────

/** A date field as a real date: the interface type alone does not convert the text. An empty value stays empty. */
const parsedDate = (path) => `{{if(${path}, parseDate(${path}, '${ISO_DATE}'), undefined)}}`

/** The whole object (so fields the API adds later can be mapped too), then its date fields as dates. */
const wholeWithDates = (source, dateKeys) => ({
  '{{...}}': `{{${source}}}`,
  ...Object.fromEntries(dateKeys.map((key) => [key, parsedDate(`${source}.${key}`)]))
})

const interfaceDates = (fields) => fields.filter((field) => field.type === 'date').map((field) => field.name)

// ── Base and connection ────────────────────────────────────────────────────────────────────────────────────────────

const ERROR_MESSAGE =
  "[{{statusCode}}] {{ifempty(body.message, 'Flowmingo returned an error.')}}{{if(body.code, ' (error code: ' + body.code + ')', '')}}"

const base = {
  baseUrl: contract.base_url,
  headers: { 'x-api-key': '{{connection.apiKey}}', 'user-agent': USER_AGENT },
  response: {
    error: {
      message: ERROR_MESSAGE,
      401: {
        type: 'InvalidAccessTokenError',
        message:
          '[401] Flowmingo did not accept the API key. It may have been revoked or disabled: reconnect with a valid key from Settings, API keys.'
      }
    }
  },
  log: { sanitize: ['request.headers.x-api-key'] }
}

const connection = {
  params: [
    {
      // The name stays apiKey: renaming it would break every connection already made.
      name: 'apiKey',
      type: 'password',
      label: 'API key',
      required: true,
      editable: true,
      help:
        'Create a key in Flowmingo under **Settings > API keys**. It starts with `fl_`. Give it the scopes your scenarios need: `read_hiring` for the Watch modules and lists, `read_candidates` for names and emails, `invite_candidates` to invite, `write_pipeline` to move, reject and review, `create_project` to create projects. The Watch modules need a key created by an Owner or Admin.'
    }
  ],
  communication: {
    url: `${contract.base_url}${contract.auth.test.path}`,
    method: 'GET',
    headers: { 'x-api-key': '{{parameters.apiKey}}', 'user-agent': USER_AGENT },
    response: {
      metadata: { type: 'text', value: 'Organization {{body.organization_id}}' },
      error: { message: ERROR_MESSAGE }
    },
    log: { sanitize: ['request.headers.x-api-key'] }
  }
}

// ── RPCs (dropdowns) ───────────────────────────────────────────────────────────────────────────────────────────────

const RPC_LIMIT = 500

const pagedList = (path, label, extra = {}) => ({
  url: path,
  method: 'GET',
  qs: { limit: LIST_PAGE_SIZE, ...(extra.qs ?? {}) },
  response: {
    limit: RPC_LIMIT,
    iterate: extra.iterate ?? '{{body.data}}',
    output: { label, value: '{{item.id}}' }
  },
  pagination: { qs: { page: '{{pagination.page}}' }, condition: `{{length(body.data) = ${LIST_PAGE_SIZE}}}` }
})

// IML has no "in" operator: one equality per kind, nested in if(); a set without a kind (older AI interviews) is kept.
const invitableCondition = Object.keys(contract.invitable_set_types).reduceRight(
  (otherwise, type) => `if(item.set_type = ${type}, true, ${otherwise})`,
  'false'
)
// The label names the kind and, when the assessment is not active, its state: "Sales (AI Interview, Draft)". A draft can be invited
// but its invitation is not emailed until it is published, so the dropdown says so. Same nested if() as above, one per value.
const lookup = (field, labels, otherwise) =>
  Object.entries(labels).reduceRight((rest, [value, label]) => `if(item.${field} = ${value}, ${label}, ${rest})`, otherwise)
const kindOf = lookup('set_type', Object.fromEntries(Object.entries(contract.invitable_set_types).map(([k, v]) => [k, `'${v}'`])), "''")
const stateOf = lookup('status', Object.fromEntries(Object.entries(contract.inactive_set_statuses).map(([k, v]) => [k, `'${v}'`])), "''")
const isInactive = lookup('status', Object.fromEntries(Object.keys(contract.inactive_set_statuses).map((k) => [k, 'true'])), 'false')
const assessmentLabel =
  '{{item.title}}' +
  `{{if(item.set_type, ' (', if(${isInactive}, ' (', ''))}}` +
  `{{${kindOf}}}` +
  `{{if(item.set_type, if(${isInactive}, ', ', ''), '')}}` +
  `{{${stateOf}}}` +
  `{{if(item.set_type, ')', if(${isInactive}, ')', ''))}}`

const rpcs = {
  listProjects: { label: 'List hiring projects', communication: pagedList('/hiring/projects/v1', '{{item.title}}') },
  listAssessments: {
    label: 'List assessments',
    // Only the kinds the invite route can send: a Showcase, Recording or Questionnaire answers 400 there.
    communication: pagedList('/hiring/interview-sets/v1', assessmentLabel, {
      iterate: {
        container: '{{body.data}}',
        condition: `{{if(item.set_type, ${invitableCondition}, true)}}`
      }
    })
  },
  listJobPosts: {
    label: 'List job posts',
    // Filtered by the module's hiring project when it has one (Add a candidate to a hiring project). Invite a candidate
    // takes several projects and the route filters by one, so there it lists every post: the date tells same-titled posts apart.
    communication: pagedList('/hiring/job-posts/v1', `{{item.title}} (created {{formatDate(parseDate(item.created_at, '${ISO_DATE}'), 'D MMM YYYY')}})`, {
      qs: { com_project_id: '{{parameters.com_project_id}}' }
    })
  },
  listStages: {
    label: 'List stages',
    // The route returns every stage of the project in one response, in pipeline order (no paging), and an empty list for
    // a project that is not yours.
    communication: {
      url: '/hiring/projects/{{parameters.com_project_id}}/stages/v1',
      method: 'GET',
      response: { limit: RPC_LIMIT, iterate: '{{body.data}}', output: { label: '{{item.name}}', value: '{{item.id}}' } }
    }
  }
}

// ── Shared parameters ──────────────────────────────────────────────────────────────────────────────────────────────
// Every parameter is named after the API field it fills, so a request body is built from `parameters` in one go and a
// field the API adds later needs only a new parameter.

const text = (name, label, extra = {}) => ({ name, type: 'text', label, ...extra })

const projectSelect = (nested, extra = {}) => ({
  name: 'com_project_id',
  type: 'select',
  label: 'Hiring project',
  required: true,
  options: { store: 'rpc://listProjects', nested },
  ...extra
})
const stageSelect = (extra = {}) => ({ name: 'com_stage_id', type: 'select', label: 'Stage', options: 'rpc://listStages', ...extra })
const jobPostSelect = (extra = {}) => ({
  name: 'com_job_post_id',
  type: 'select',
  label: 'Job post',
  options: 'rpc://listJobPosts',
  ...extra
})
const resultId = text('submission_id', 'Result ID', {
  required: true,
  help: 'The result (submission) ID, for example from **Watch AI evaluations** or **Watch completed assessments**.'
})
const applicationId = text('application_id', 'Application ID', {
  required: true,
  help: 'The application ID, for example from **Watch new applications**.'
})
const limitParam = (noun, { required }) => ({
  name: 'limit',
  type: 'uinteger',
  label: 'Limit',
  required,
  default: 10,
  help: required
    ? `The maximum number of ${noun} Make returns during one execution cycle.`
    : `The maximum number of ${noun} Make returns during one execution cycle. Leave empty to return them all.`
})

const quoted = (names) => names.map((name) => `'${name}'`).join(', ')

// ── Modules ────────────────────────────────────────────────────────────────────────────────────────────────────────

const TRIGGER_NAMES = {
  application_created: ['watchNewApplications', 'Watch new applications', 'applications'],
  candidate_stage_changed: ['watchStageChanges', 'Watch stage changes', 'stage changes'],
  application_rejected: ['watchRejectedApplications', 'Watch rejected applications', 'rejected applications'],
  interview_status_updated: ['watchInterviewStatus', 'Watch interview status changes', 'interview status changes'],
  interview_evaluated: ['watchEvaluations', 'Watch AI evaluations', 'evaluations'],
  assessment_completed: ['watchCompletedAssessments', 'Watch completed assessments', 'completed assessments'],
  invitation_lifecycle_updated: ['watchInvitations', 'Watch invitations', 'invitation updates'],
  invitation_email_status: ['watchInvitationEmails', 'Watch invitation emails', 'invitation email updates'],
  submission_reviewed: ['watchResultReviews', 'Watch result reviews', 'reviews']
}

const EVENT_ENVELOPE = ['event_id', 'event_type', 'sub_event', 'timestamp']

const triggerModule = (event) => {
  const names = TRIGGER_NAMES[event.key]
  if (!names) throw new Error(`No Watch module name for contract event ${event.key}: add it to TRIGGER_NAMES`)
  const [id, label, noun] = names
  const filterParam = event.sub_event_field ?? null
  const fields = { event_id: '', event_type: '', sub_event: '', timestamp: '', ...event.sample }
  // The event's data fields at the top level (all of them, including fields the API adds later), then the envelope after
  // them, then every date as a date.
  const output = {
    '{{...}}': '{{item.data}}',
    ...Object.fromEntries(EVENT_ENVELOPE.map((key) => [key, `{{item.${key}}}`])),
    timestamp: parsedDate('item.timestamp'),
    ...Object.fromEntries(Object.keys(event.sample).filter(isDateField).map((key) => [key, parsedDate(`item.data.${key}`)]))
  }

  return {
    id,
    group: 'Triggers',
    metadata: { label, description: event.description, moduleType: 'trigger' },
    staticParams: [
      limitParam(noun, { required: true }),
      ...(filterParam
        ? [
            {
              name: filterParam,
              type: 'select',
              label: humanize(filterParam),
              help: 'Leave empty to watch every kind.',
              options: Object.entries(event.sub_event_choices).map(([value, choice]) => ({ label: choice, value }))
            }
          ]
        : [])
    ],
    mappableParams: [],
    communication: {
      url: contract.events_feed.path,
      method: 'GET',
      qs: { event_type: event.event_type, limit: FEED_PAGE_SIZE },
      response: {
        limit: '{{parameters.limit}}',
        iterate: filterParam
          ? {
              container: '{{body.data}}',
              condition: `{{if(parameters.${filterParam}, item.data.${event.sub_event_field} = parameters.${filterParam}, true)}}`
            }
          : '{{body.data}}',
        trigger: { id: '{{item.event_id}}', date: `{{parseDate(item.timestamp, '${ISO_DATE}')}}`, type: 'date', order: 'desc' },
        output
      },
      pagination: { qs: { cursor: '{{body.next_cursor}}' }, condition: '{{body.next_cursor}}' }
    },
    interface: Object.entries(fields).map(([key, value]) => ({ name: key, label: humanize(key), type: fieldType(key, value) })),
    samples: {
      ...event.sample,
      event_id: 'cca11cbd-00fd-4e16-ba60-75625ee9d196',
      event_type: event.event_type,
      sub_event: event.sub_event_field ? event.sample[event.sub_event_field] : null,
      timestamp: '2026-10-20T09:15:30.123Z'
    }
  }
}

const CANDIDATE_FIELDS = ['email', 'firstname', 'lastname', 'cv_link']

// The first result as the API sends it (invitations, applications, submissions and their messages), then the fields a
// scenario needs most, read out of it.
const INVITE_OUTPUT = {
  '{{...}}': '{{body.results[1]}}',
  email: '{{body.results[1].email_address}}',
  tal_candidate_id:
    '{{ifempty(body.results[1].invitations[1].tal_candidate_id, ifempty(body.results[1].applications[1].tal_candidate_id, body.results[1].submissions[1].tal_candidate_id))}}',
  invitation_id: '{{body.results[1].invitations[1].id}}',
  invitation_status: '{{body.results[1].invitations[1].status_text}}',
  application_id: '{{body.results[1].applications[1].id}}',
  submission_id: '{{body.results[1].submissions[1].id}}',
  submission_status: '{{body.results[1].submissions[1].status_text}}',
  // What was created but will not go out as things stand (an invitation to a draft assessment is not emailed).
  warnings: "{{join(map(ifempty(body.results[1].warnings, emptyarray), 'message'), ' ')}}"
}

const idList = (name, label, idLabel) => ({
  name,
  label,
  type: 'array',
  spec: [
    { name: 'id', label: idLabel, type: 'text' },
    { name: 'status_text', label: 'Status', type: 'text' }
  ]
})

const errorValues = (field) => `join(map(toArray(body.results[1].${field}), 'value'), ' ')`

const actionModules = [
  {
    id: 'inviteCandidate',
    group: 'Candidates',
    metadata: {
      label: 'Invite a candidate',
      description: 'Adds a candidate and invites them to assessments, hiring projects, or both. Emails the invitation unless Send invitation is off.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      {
        name: 'com_interview_set_ids',
        type: 'select',
        multiple: true,
        label: 'Assessments',
        options: 'rpc://listAssessments',
        help: 'AI Interviews, Role-plays, CV Evaluations, Skill Tests or Technical Tests. A Skill Test or Technical Test must be the only assessment, and attached to the hiring project you pick. Pick assessments, hiring projects, or both.'
      },
      {
        name: 'com_project_ids',
        type: 'select',
        multiple: true,
        label: 'Hiring projects',
        options: 'rpc://listProjects',
        help: 'Puts the candidate in these pipelines.'
      },
      jobPostSelect({
        name: 'com_job_post_ids',
        multiple: true,
        label: 'Job posts',
        help: 'The job posts the invitation is for. The list shows every job post of your account, with its creation date.'
      }),
      { name: 'email', type: 'email', label: 'Email', help: 'Where the invitation goes. Required for a Skill Test or Technical Test. Without an email, the address is read from the CV.' },
      text('firstname', 'First name'),
      text('lastname', 'Last name'),
      { name: 'cv_link', type: 'url', label: 'CV link', help: 'A public link to the CV. Required to order a CV Evaluation.' },
      text('invitation_message', 'Invitation message', { multiline: true, help: 'A note added to the invitation email, 10 to 5000 characters.' }),
      { name: 'send_invite', type: 'boolean', label: 'Send invitation', default: true, help: 'Turn off to add the candidate without emailing them.' }
    ],
    communication: {
      url: '/interview/candidate/invite/v1',
      method: 'POST',
      // The route takes a list of candidates: this module sends one, built from the candidate fields; every other
      // parameter goes in as it is.
      body: {
        '{{...}}': `{{omit(parameters, ${quoted(CANDIDATE_FIELDS)})}}`,
        candidates: [`{{pick(parameters, ${quoted(CANDIDATE_FIELDS)})}}`]
      },
      response: {
        // A 201 can still refuse the candidate (docs §4.5): fail when nothing was created, return the messages otherwise.
        valid: {
          condition:
            '{{ifempty(body.results[1].invitations[1].id, ifempty(body.results[1].applications[1].id, body.results[1].submissions[1].id))}}',
          message: `{{ifempty(body.results[1].error_message, trim(${errorValues('invitation_error_messages')} + ' ' + ${errorValues('application_error_messages')} + ' ' + ${errorValues('submission_error_messages')}))}}`,
          type: 'DataError'
        },
        output: INVITE_OUTPUT
      }
    },
    interface: [
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'tal_candidate_id', label: 'Candidate ID', type: 'text' },
      { name: 'invitation_id', label: 'Invitation ID', type: 'text' },
      { name: 'invitation_status', label: 'Invitation status', type: 'text' },
      { name: 'application_id', label: 'Application ID', type: 'text' },
      { name: 'submission_id', label: 'Result ID', type: 'text' },
      { name: 'submission_status', label: 'Result status', type: 'text' },
      { name: 'warnings', label: 'Warnings', type: 'text' },
      idList('invitations', 'Invitations', 'Invitation ID'),
      idList('applications', 'Applications', 'Application ID'),
      idList('submissions', 'Results', 'Result ID'),
      { name: 'invitation_error_messages', label: 'Invitation warnings', type: 'collection' },
      { name: 'application_error_messages', label: 'Application warnings', type: 'collection' },
      { name: 'submission_error_messages', label: 'Result warnings', type: 'collection' }
    ],
    samples: {
      email: 'alex@example.com',
      tal_candidate_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      invitation_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      invitation_status: 'pending',
      application_id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3',
      submission_id: '550e8400-e29b-41d4-a716-446655440000',
      submission_status: 'need_interview',
      warnings: ''
    }
  },
  {
    id: 'addCandidateToProject',
    group: 'Applications',
    metadata: {
      label: 'Add a candidate to a hiring project',
      description: 'Puts a candidate already in your Flowmingo account into a hiring project.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      text('tal_candidate_id', 'Candidate ID', { required: true, help: 'A candidate already in your account. To bring in someone new, use **Invite a candidate**.' }),
      projectSelect([
        jobPostSelect({ help: 'Needed when the project has more than one job post.' }),
        stageSelect({ help: 'Leave empty to start in the first stage.' })
      ])
    ],
    communication: {
      url: '/hiring/applications/v1',
      method: 'POST',
      body: '{{parameters}}',
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Application ID', type: 'text' },
      { name: 'com_project_id', label: 'Hiring project ID', type: 'text' },
      { name: 'com_job_post_id', label: 'Job post ID', type: 'text' },
      { name: 'com_stage_id', label: 'Stage ID', type: 'text' },
      { name: 'status', label: 'Status', type: 'number' }
    ],
    samples: {
      id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3',
      com_project_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      com_job_post_id: 'c0ffee00-dead-4bee-8f00-0123456789ab',
      com_stage_id: '5b8d1e92-3a7c-4c60-b2f4-91e6a0d7c358',
      status: 1
    }
  },
  {
    id: 'moveApplication',
    group: 'Applications',
    metadata: {
      label: 'Move an application to a stage',
      description: 'Moves an application to another stage of its hiring project. Emails the candidate if your team switched that on for the stage.',
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [
      applicationId,
      {
        name: 'com_project_id',
        type: 'select',
        label: 'Hiring project',
        options: 'rpc://listProjects',
        help: "Pick the application's hiring project to list its stages below. It is not sent to Flowmingo, so leave it empty when you map the Stage ID."
      },
      stageSelect({ required: true, help: 'A stage of the application\'s own hiring project.' })
    ],
    communication: {
      url: '/hiring/applications/{{encodeURL(parameters.application_id)}}/move-stage/v1',
      method: 'POST',
      // The application ID goes in the path and the project only fills the stage list.
      body: "{{omit(parameters, 'application_id', 'com_project_id')}}",
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Application ID', type: 'text' },
      { name: 'com_stage_id', label: 'Stage ID', type: 'text' }
    ],
    samples: { id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3', com_stage_id: '5b8d1e92-3a7c-4c60-b2f4-91e6a0d7c358' }
  },
  {
    id: 'rejectApplication',
    group: 'Applications',
    metadata: {
      label: 'Reject an application',
      description: "Moves an application into its project's Rejected stage. Nothing is deleted. Emails the candidate if your team switched that on for the stage.",
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [applicationId],
    communication: {
      url: '/hiring/applications/{{encodeURL(parameters.application_id)}}/reject/v1',
      method: 'POST',
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Application ID', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'com_stage_id', label: 'Rejected stage ID', type: 'text' }
    ],
    samples: { id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3', status: 'rejected', com_stage_id: '9e7a4d31-6b02-4f85-8c19-3a5d70e2b6c4' }
  },
  {
    id: 'addResultNote',
    group: 'Results',
    metadata: {
      label: 'Add a note to a result',
      description: 'Adds a note, and optionally a rating, to a result under the name of the person who created the API key.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      resultId,
      text('note', 'Note', { required: true, multiline: true, help: '1 to 2000 characters.' }),
      { name: 'rating', type: 'number', label: 'Rating', validate: { min: 0.5, max: 10 }, help: '0.5 to 10, in steps of 0.5.' }
    ],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.submission_id)}}/note/v1',
      method: 'POST',
      body: "{{omit(parameters, 'submission_id')}}",
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Note ID', type: 'text' },
      { name: 'note', label: 'Note', type: 'text' },
      { name: 'rating', label: 'Rating', type: 'number' },
      { name: 'created_at', label: 'Created at', type: 'date' }
    ],
    samples: { id: 'eca87aad-100e-4fe3-848e-83d55b07c78f', note: 'Strong systems thinking.', rating: 8, created_at: '2026-10-20T09:41:12.000Z' }
  },
  {
    id: 'rateResult',
    group: 'Results',
    metadata: {
      label: 'Rate a result',
      description: 'Rates a result from 0 to 10, replacing the earlier rating by the same person.',
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [
      resultId,
      { name: 'rating', type: 'number', label: 'Rating', required: true, validate: { min: 0, max: 10 }, help: '0 to 10, in steps of 0.5.' }
    ],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.submission_id)}}/rate/v1',
      method: 'POST',
      body: "{{omit(parameters, 'submission_id')}}",
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Rating ID', type: 'text' },
      { name: 'rating', label: 'Rating', type: 'number' },
      { name: 'rated_at', label: 'Rated at', type: 'date' }
    ],
    samples: { id: '7241c51b-23a7-4072-b345-5484cd0b54af', rating: 8, rated_at: '2026-10-20T09:42:03.000Z' }
  },
  {
    id: 'shortlistResult',
    group: 'Results',
    metadata: {
      label: 'Shortlist a result',
      description: 'Shortlists a result, or removes the shortlist mark.',
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [resultId, { name: 'shortlisted', type: 'boolean', label: 'Shortlisted', required: true, default: true }],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.submission_id)}}/shortlist/v1',
      method: 'POST',
      body: "{{omit(parameters, 'submission_id')}}",
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Activity ID', type: 'text' },
      { name: 'shortlisted', label: 'Shortlisted', type: 'boolean' }
    ],
    samples: { id: 'b2cf0e3f-215b-483d-97f2-4078f18bf619', shortlisted: true }
  },
  {
    id: 'createProject',
    group: 'Hiring projects',
    metadata: {
      label: 'Create a hiring project',
      description: 'Creates a hiring project with its four default stages and an AI-drafted job post. Assessments are added in Flowmingo afterwards.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      text('title', 'Project title', { required: true, help: 'How your team sees the project, up to 255 characters.' }),
      text('position', 'Position', { required: true, help: 'The role being hired for. It becomes the job post title.' }),
      text('description', 'Job description', { multiline: true, help: 'The job description as text, up to 15000 characters. The job post is drafted from it.' }),
      text('idempotency_key', 'Unique key', {
        required: true,
        validate: { pattern: '^[A-Za-z0-9._:-]{8,128}$' },
        help: 'An ID of this job in your own system, 8 to 128 characters from A-Z a-z 0-9 . _ : -. Sending the same key again returns the same project instead of a second one.'
      })
    ],
    communication: {
      url: '/hiring/projects/v1',
      method: 'POST',
      // assessments: [] keeps the call to a few seconds; making them waits up to 45 s, past Make's 40 s module timeout.
      body: { '{{...}}': '{{parameters}}', assessments: [] },
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Hiring project ID', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'position', label: 'Position', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'created_at', label: 'Created at', type: 'date' },
      {
        name: 'stages',
        label: 'Stages',
        type: 'array',
        spec: [
          { name: 'id', label: 'Stage ID', type: 'text' },
          { name: 'name', label: 'Name', type: 'text' }
        ]
      },
      {
        name: 'job_post',
        label: 'Job post',
        type: 'collection',
        spec: [
          { name: 'id', label: 'Job post ID', type: 'text' },
          { name: 'status', label: 'Status', type: 'text' }
        ]
      },
      { name: 'idempotent_replay', label: 'Returned an existing project', type: 'boolean' }
    ],
    samples: {
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'Support Engineer - Q4 hiring',
      position: 'Support Engineer',
      status: 'active',
      created_at: '2026-10-22T04:18:44.051Z',
      stages: [{ id: 'b0b0b0b0-abcd-4ef0-8123-456789abcdef', name: 'Unassigned' }],
      job_post: { id: 'c0ffee00-dead-4bee-8f00-0123456789ab', status: 'active' },
      idempotent_replay: false
    }
  }
]

const CANDIDATE_INTERFACE = [
  { name: 'id', label: 'Candidate ID', type: 'text' },
  { name: 'firstname', label: 'First name', type: 'text' },
  { name: 'lastname', label: 'Last name', type: 'text' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'cv_link', label: 'CV link', type: 'url' },
  { name: 'created_at', label: 'Created at', type: 'date' }
]
const CANDIDATE_SAMPLE = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  firstname: 'Alex',
  lastname: 'Kim',
  email: 'alex@example.com',
  cv_link: 'https://data.flowmingo.ai/cv/alex.pdf',
  created_at: '2026-10-19T08:30:00.000Z'
}

const readModules = [
  {
    id: 'searchCandidates',
    group: 'Candidates',
    metadata: { label: 'Search candidates', description: 'Searches the candidates in your pipelines by email, or by name and CV text.', moduleType: 'search' },
    staticParams: [],
    mappableParams: [
      { name: 'email', type: 'email', label: 'Email', help: 'Matched exactly, ignoring capital letters.' },
      text('q', 'Search text', { help: 'Matched against name, email and CV text, up to 120 characters. Used when Email is empty.' }),
      limitParam('candidates', { required: false })
    ],
    communication: {
      url: '/hiring/candidates/v1',
      method: 'GET',
      qs: { email: '{{parameters.email}}', q: '{{if(parameters.email, undefined, parameters.q)}}', limit: LIST_PAGE_SIZE },
      response: {
        limit: '{{parameters.limit}}',
        // The docs ask callers to compare the address before treating a row as a match (§5.6).
        iterate: {
          container: '{{body.data}}',
          condition: '{{if(parameters.email, lower(item.email) = lower(parameters.email), true)}}'
        },
        output: '{{item}}'
      },
      pagination: { qs: { page: '{{pagination.page}}' }, condition: `{{length(body.data) = ${LIST_PAGE_SIZE}}}` }
    },
    interface: CANDIDATE_INTERFACE,
    samples: CANDIDATE_SAMPLE
  },
  {
    id: 'getCandidate',
    group: 'Candidates',
    metadata: { label: 'Get a candidate', description: 'Gets one candidate by ID.', moduleType: 'action', actionCrud: 'read' },
    staticParams: [],
    mappableParams: [text('tal_candidate_id', 'Candidate ID', { required: true })],
    communication: {
      url: '/hiring/candidates/{{encodeURL(parameters.tal_candidate_id)}}/v1',
      method: 'GET',
      response: { output: '{{body}}' }
    },
    interface: [...CANDIDATE_INTERFACE, { name: 'phone', label: 'Phone', type: 'text' }, { name: 'thumb_cv_link', label: 'CV thumbnail link', type: 'url' }],
    samples: CANDIDATE_SAMPLE
  },
  {
    id: 'getResult',
    group: 'Results',
    metadata: {
      label: 'Get a result',
      description: 'Gets one result with its AI evaluation: score, summary, strengths and gaps.',
      moduleType: 'action',
      actionCrud: 'read'
    },
    staticParams: [],
    mappableParams: [resultId],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.submission_id)}}/detail/v1',
      method: 'GET',
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Result ID', type: 'text' },
      { name: 'assessment_type', label: 'Assessment type', type: 'text' },
      { name: 'assessment_name', label: 'Assessment name', type: 'text' },
      { name: 'tal_candidate_id', label: 'Candidate ID', type: 'text' },
      { name: 'candidate_name', label: 'Candidate name', type: 'text' },
      { name: 'email', label: 'Candidate email', type: 'email' },
      { name: 'overall_score', label: 'Overall score (0-10)', type: 'number' },
      { name: 'score_status', label: 'Score status', type: 'text' },
      { name: 'submission_at', label: 'Submitted at', type: 'date' },
      {
        name: 'evaluation',
        label: 'Evaluation',
        type: 'collection',
        spec: [
          { name: 'summary', label: 'Summary', type: 'text' },
          { name: 'overall_rating', label: 'Overall rating', type: 'number' },
          { name: 'strengths', label: 'Strengths', type: 'array', spec: { type: 'text' } },
          { name: 'gaps', label: 'Gaps', type: 'array', spec: { type: 'text' } },
          { name: 'recommendations', label: 'Recommendations', type: 'array', spec: { type: 'text' } }
        ]
      }
    ],
    samples: {
      id: '59065d06-a013-44c2-97d2-88e9d6b3c858',
      assessment_type: 'ai_interview',
      assessment_name: 'AI Engineer - AI Interview',
      tal_candidate_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      candidate_name: 'Alex Kim',
      email: 'alex@example.com',
      overall_score: 7.2,
      score_status: 'scored',
      submission_at: '2026-09-10T12:00:49.000Z',
      evaluation: { summary: 'A strong applied engineer.', overall_rating: 7.2, strengths: ['Ships production RAG pipelines'], gaps: [], recommendations: [] }
    }
  },
  {
    id: 'listProjects',
    group: 'Hiring projects',
    metadata: { label: 'List hiring projects', description: 'Lists your hiring projects, newest first.', moduleType: 'search' },
    staticParams: [],
    mappableParams: [limitParam('hiring projects', { required: false })],
    communication: {
      url: '/hiring/projects/v1',
      method: 'GET',
      qs: { limit: LIST_PAGE_SIZE },
      response: { limit: '{{parameters.limit}}', iterate: '{{body.data}}', output: '{{item}}' },
      pagination: { qs: { page: '{{pagination.page}}' }, condition: `{{length(body.data) = ${LIST_PAGE_SIZE}}}` }
    },
    interface: [
      { name: 'id', label: 'Hiring project ID', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'created_at', label: 'Created at', type: 'date' },
      { name: 'candidates', label: 'Candidates in the pipeline', type: 'number' }
    ],
    samples: { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', title: 'Backend hiring, Q4', created_at: '2026-10-19T08:30:00.000Z', candidates: 56 }
  }
]

const keyValueArray = (name, label, extra = {}) => ({
  name,
  type: 'array',
  label,
  spec: [text('key', 'Key'), text('value', 'Value')],
  ...extra
})

const universalModule = {
  id: 'makeApiCall',
  group: 'Other',
  metadata: { label: 'Make an API call', description: 'Performs an arbitrary authorized API call.', moduleType: 'universal' },
  staticParams: [],
  mappableParams: [
    text('url', 'URL', {
      required: true,
      help: `Enter a path relative to \`${contract.base_url}\`. For example: \`/hiring/projects/v1\`. The routes are listed at ${contract.auth.docs_url}.`
    }),
    {
      name: 'method',
      type: 'select',
      label: 'Method',
      required: true,
      default: 'GET',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({ label: method, value: method }))
    },
    keyValueArray('headers', 'Headers', {
      help: "You don't have to add the API key header; it is added for you.",
      default: [{ key: 'Content-Type', value: 'application/json' }]
    }),
    keyValueArray('qs', 'Query string'),
    { name: 'body', type: 'any', label: 'Body', help: 'Enter the body as JSON.' }
  ],
  communication: {
    // The API's own address in front of the path, so the key only ever goes to Flowmingo.
    url: `${contract.base_url}{{parameters.url}}`,
    method: '{{parameters.method}}',
    headers: { '{{...}}': "{{toCollection(parameters.headers, 'key', 'value')}}" },
    qs: { '{{...}}': "{{toCollection(parameters.qs, 'key', 'value')}}" },
    body: '{{parameters.body}}',
    type: 'text',
    response: { output: { body: '{{body}}', headers: '{{headers}}', statusCode: '{{statusCode}}' } }
  },
  interface: [
    { name: 'body', label: 'Body', type: 'any' },
    { name: 'headers', label: 'Headers', type: 'collection' },
    { name: 'statusCode', label: 'Status code', type: 'number' }
  ],
  samples: { body: { data: [], total: 0, page: 1, limit: 20 }, headers: {}, statusCode: 200 }
}

// A module that returns the whole body or item gets its date fields (from the interface) parsed after it.
const withParsedDates = (module) => {
  const output = module.communication.response?.output
  const source = typeof output === 'string' && output.match(/^\{\{(body|item)\}\}$/)?.[1]
  const dates = interfaceDates(module.interface)
  if (!source || dates.length === 0) return module
  return {
    ...module,
    communication: { ...module.communication, response: { ...module.communication.response, output: wholeWithDates(source, dates) } }
  }
}

// Inside a group: list and search modules first, then get, then create, then update (Make's naming conventions).
const ORDER_IN_GROUP = { search: 0, read: 1, create: 2, update: 3, delete: 4 }
const rankInGroup = (module) => ORDER_IN_GROUP[module.metadata.actionCrud ?? module.metadata.moduleType] ?? 0

const modules = [...contract.events.map(triggerModule), ...actionModules, ...readModules, universalModule].map(withParsedDates)

const GROUP_ORDER = ['Triggers', 'Candidates', 'Applications', 'Results', 'Hiring projects', 'Other']
const groups = GROUP_ORDER.map((label) => ({
  label,
  modules: modules
    .map((module, index) => ({ module, index }))
    .filter(({ module }) => module.group === label)
    .sort((a, b) => rankInGroup(a.module) - rankInGroup(b.module) || a.index - b.index)
    .map(({ module }) => module.id)
}))

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const kebab = (id) => id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
const files = new Map()
const put = (path, content) => files.set(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 4)}\n`)
const codeFile = (dir, id, code) => `${dir}/${id}/${kebab(id)}.${code}.iml.jsonc`

put('general/base.iml.jsonc', base)
put('modules/groups.json', groups)
put(codeFile('connections', CONNECTION, 'communication'), connection.communication)
put(codeFile('connections', CONNECTION, 'params'), connection.params)

const rpcComponents = {}
for (const [id, rpc] of Object.entries(rpcs)) {
  const codeFiles = { communication: codeFile('rpcs', id, 'communication'), params: codeFile('rpcs', id, 'params') }
  put(codeFiles.communication, rpc.communication)
  put(codeFiles.params, [])
  rpcComponents[id] = { label: rpc.label, connection: CONNECTION, codeFiles }
}

const moduleComponents = {}
for (const module of modules) {
  const codeFiles = {
    communication: codeFile('modules', module.id, 'communication'),
    staticParams: codeFile('modules', module.id, 'static-params'),
    mappableParams: codeFile('modules', module.id, 'mappable-params'),
    interface: codeFile('modules', module.id, 'interface'),
    samples: codeFile('modules', module.id, 'samples'),
    scope: codeFile('modules', module.id, 'scope')
  }
  if (module.metadata.moduleType === 'trigger') codeFiles.epoch = null
  put(codeFiles.communication, module.communication)
  put(codeFiles.staticParams, module.staticParams)
  put(codeFiles.mappableParams, module.mappableParams)
  put(codeFiles.interface, module.interface)
  put(codeFiles.samples, module.samples)
  put(codeFiles.scope, [])
  moduleComponents[module.id] = { ...module.metadata, connection: CONNECTION, codeFiles }
}

put('README.md', readFileSync(join(ROOT, 'APP-README.md'), 'utf8'))

put('makecomapp.json', {
  fileVersion: 1,
  generalCodeFiles: { base: 'general/base.iml.jsonc', common: null, readme: 'README.md', groups: 'modules/groups.json' },
  components: {
    connection: {
      [CONNECTION]: {
        label: 'Flowmingo',
        connectionType: 'basic',
        codeFiles: {
          communication: codeFile('connections', CONNECTION, 'communication'),
          params: codeFile('connections', CONNECTION, 'params'),
          common: null
        }
      }
    },
    webhook: {},
    module: moduleComponents,
    rpc: rpcComponents,
    function: {},
    endpoint: {}
  },
  // Filled in when the app is first deployed from Make's VS Code extension (the app id comes from Make).
  origins: []
})

// ── Write or check ─────────────────────────────────────────────────────────────────────────────────────────────────

const listFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [relative(SRC, path)]
  })

if (process.argv.includes('--check')) {
  const existing = new Set(listFiles(SRC))
  const problems = []
  for (const [path, content] of files) {
    if (!existing.has(path)) problems.push(`missing ${path}`)
    else if (readFileSync(join(SRC, path), 'utf8') !== content) problems.push(`differs ${path}`)
    existing.delete(path)
  }
  for (const path of existing) problems.push(`not generated ${path}`)
  if (problems.length) {
    console.error(`src/ is out of date (run node build.mjs):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`src/ is up to date (${files.size} files)`)
} else {
  rmSync(SRC, { recursive: true, force: true })
  for (const [path, content] of files) {
    mkdirSync(dirname(join(SRC, path)), { recursive: true })
    writeFileSync(join(SRC, path), content)
  }
  console.log(`wrote ${files.size} files to src/ (${modules.length} modules, ${Object.keys(rpcs).length} RPCs)`)
}
